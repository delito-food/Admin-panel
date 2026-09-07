/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Commission tax invoice — Delito → restaurant, monthly.
 *
 * GET  ?vendorId=…&month=2026-02&format=pdf|json&issue=true
 * POST { month } — summary for every vendor, for the listing page.
 *
 * ── What changed in Phase 2 ──────────────────────────────────────────────
 *
 * Commission billed now equals commission WITHHELD. The app deducts
 * `vendorPlatformCut` per order at order time, computed on the pre-discount
 * item total; this invoice is the sum of those per-order deductions. Before, it
 * recomputed 15% of the post-discount monthly total, so on a ₹500 order sold at
 * ₹400 the vendor was charged ₹75 and invoiced ₹60. Summing the actual
 * deductions also removes the drift from rounding weekly subtotals and then
 * rounding again.
 *
 * Month boundaries are IST, not the server's timezone, so an order placed at
 * 02:00 on the 1st no longer falls into the previous month's invoice.
 *
 * Place of supply comes from the state code in the vendor's GSTIN. The old
 * substring match on a free-text state field read a blank state as "same
 * state" and applied CGST + SGST to what may have been an inter-state supply.
 *
 * The invoice is frozen at issue. Once a serial has been allocated the stored
 * snapshot is what renders — a late-delivered or since-cancelled order cannot
 * change a document that has already gone out.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import {
    COMMISSION_PLATFORM,
    COMMISSION_HSN_CODE,
    COMMISSION_INVOICES_COLLECTION,
    COMMISSION_INVOICE_NOT_ISSUED,
    CommissionInvoiceData,
    commissionInvoiceDocId,
} from '@/lib/invoice-constants';
import { counterDocId, formatSerial, SERIES } from '@/lib/invoice-series';
import {
    daysInMonth,
    financialYearOf,
    formatMonthLong,
    istInstant,
    istMonthBounds,
    monthShortName,
    toDate,
    withinPeriod,
} from '@/lib/fiscal';
import {
    HOME_STATE_CODE,
    isInterState as computeInterState,
    placeOfSupplyLabel,
    resolveStateCode,
    splitTax,
    stateName,
} from '@/lib/gst';
import { computeCommission, isBillableStatus, PRICING, r2 } from '@/lib/pricing-engine';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

interface WeekRow {
    weekLabel: string;
    orders: number;
    grossSales: number;
    commissionBase: number;
    commission: number;
    gstOnCommission: number;
    totalDeduction: number;
    netPayout: number;
}

interface MonthAggregate {
    weeklyBreakdown: WeekRow[];
    monthlyTotals: {
        orders: number;
        grossSales: number;
        commissionBase: number;
        commission: number;
        gstOnCommission: number;
        totalDeduction: number;
        netPayout: number;
    };
}

/**
 * Aggregate a vendor's delivered orders for an IST calendar month.
 *
 * Every money figure comes from the pricing engine, so this agrees with the
 * payout screen and the GST report by construction.
 */
function aggregateMonth(
    orders: any[],
    year: number,
    monthNum: number,
    commissionRatePercent: number
): MonthAggregate {
    const lastDay = daysInMonth(year, monthNum);
    const mn = monthShortName(monthNum);
    const weekRanges: Array<[number, number]> = [[1, 7], [8, 14], [15, 21], [22, lastDay]];

    const weeklyBreakdown: WeekRow[] = weekRanges.map(([startDay, endDay], idx) => {
        const period = {
            start: istInstant(year, monthNum, startDay, 0, 0, 0, 0),
            end: istInstant(year, monthNum, endDay, 23, 59, 59, 999),
        };

        const weekOrders = orders.filter((o) => {
            const d = toDate(o.deliveredAt) || toDate(o.createdAt);
            return d ? withinPeriod(d, period) : false;
        });

        let grossSales = 0;
        let commissionBase = 0;
        let commission = 0;
        let gstOnCommission = 0;

        for (const o of weekOrders) {
            const itemTotal = num(o.itemTotal) || num(o.subtotal);
            const c = computeCommission(o, itemTotal, commissionRatePercent);
            grossSales += itemTotal;
            commissionBase += c.baseAmount;
            commission += c.amount;
            gstOnCommission += c.gst;
        }

        grossSales = r2(grossSales);
        commissionBase = r2(commissionBase);
        commission = r2(commission);
        gstOnCommission = r2(gstOnCommission);
        const totalDeduction = r2(commission + gstOnCommission);

        return {
            weekLabel: `Week ${idx + 1} (${String(startDay).padStart(2, '0')} ${mn} – ${String(endDay).padStart(2, '0')} ${mn} ${year})`,
            orders: weekOrders.length,
            grossSales,
            commissionBase,
            commission,
            gstOnCommission,
            totalDeduction,
            netPayout: r2(grossSales - totalDeduction),
        };
    });

    const sum = (pick: (w: WeekRow) => number) => r2(weeklyBreakdown.reduce((s, w) => s + pick(w), 0));
    const commission = sum((w) => w.commission);
    const gstOnCommission = sum((w) => w.gstOnCommission);
    const grossSales = sum((w) => w.grossSales);
    const totalDeduction = r2(commission + gstOnCommission);

    return {
        weeklyBreakdown,
        monthlyTotals: {
            orders: weeklyBreakdown.reduce((s, w) => s + w.orders, 0),
            grossSales,
            commissionBase: sum((w) => w.commissionBase),
            commission,
            gstOnCommission,
            totalDeduction,
            netPayout: r2(grossSales - totalDeduction),
        },
    };
}

/** Delivered orders for one vendor inside an IST month. */
async function vendorOrdersForMonth(vendorId: string, month: string): Promise<any[]> {
    const period = istMonthBounds(month);
    if (!period) return [];

    // Single-field query — no composite index needed — instead of pulling the
    // entire orders collection into memory and filtering in JavaScript.
    const snap = await db.collection(collections.orders).where('vendorId', '==', vendorId).get();

    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as any)
        .filter((o) => {
            if (!isBillableStatus(o.status)) return false;
            const d = toDate(o.deliveredAt) || toDate(o.createdAt);
            return d ? withinPeriod(d, period) : false;
        });
}

interface IssuedInvoice {
    invoiceNumber: string;
    sequence: number;
    issuedAt: string | null;
    snapshot: any | null;
}

async function findIssuedInvoice(vendorId: string, month: string): Promise<IssuedInvoice | null> {
    const snap = await db.collection(COMMISSION_INVOICES_COLLECTION).doc(commissionInvoiceDocId(vendorId, month)).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!data.invoiceNumber) return null;
    return {
        invoiceNumber: data.invoiceNumber as string,
        sequence: num(data.sequence),
        issuedAt: data.issuedAt?.toDate?.()?.toISOString?.() || (data.issuedAt as string) || null,
        snapshot: data.snapshot || null,
    };
}

/**
 * Allocate the next serial in this financial year's commission series and store
 * the full document with it, in one transaction.
 */
async function issueCommissionInvoice(
    vendorId: string,
    month: string,
    snapshot: Record<string, unknown>,
    issuedBy: string
): Promise<IssuedInvoice> {
    const invoiceRef = db.collection(COMMISSION_INVOICES_COLLECTION).doc(commissionInvoiceDocId(vendorId, month));
    const period = istMonthBounds(month)!;
    const fy = financialYearOf(period.end);
    const counterRef = db.collection('counters').doc(counterDocId('commission', fy.label));

    return db.runTransaction(async (tx) => {
        const existing = await tx.get(invoiceRef);
        if (existing.exists && existing.data()?.invoiceNumber) {
            const data = existing.data()!;
            return {
                invoiceNumber: data.invoiceNumber as string,
                sequence: num(data.sequence),
                issuedAt: data.issuedAt?.toDate?.()?.toISOString?.() || null,
                snapshot: data.snapshot || null,
            };
        }

        const counterSnap = await tx.get(counterRef);
        let current: number;
        if (!counterSnap.exists) {
            current = 0;
        } else {
            const raw = counterSnap.data()?.lastNumber;
            if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                throw new Error('Commission invoice counter is unreadable — refusing to allocate a number');
            }
            current = raw;
        }

        const sequence = current + 1;
        const invoiceNumber = formatSerial('commission', fy.label, sequence);
        const issuedAt = Timestamp.now();

        tx.set(counterRef, {
            lastNumber: sequence,
            series: SERIES.commission.prefix,
            financialYear: fy.label,
            updatedAt: issuedAt,
        }, { merge: true });

        tx.set(invoiceRef, {
            invoiceNumber,
            sequence,
            series: SERIES.commission.prefix,
            financialYear: fy.label,
            vendorId,
            month,
            issuedAt,
            issuedBy,
            snapshot,
        }, { merge: true });

        return { invoiceNumber, sequence, issuedAt: issuedAt.toDate().toISOString(), snapshot };
    });
}

async function handleGET(request: NextRequest, _ctx: unknown, auth: AdminResult) {
    try {
        const { searchParams } = new URL(request.url);
        const vendorId = searchParams.get('vendorId');
        const month = searchParams.get('month');
        const format = searchParams.get('format') || 'json';

        if (!vendorId) {
            return NextResponse.json({ success: false, error: 'vendorId is required' }, { status: 400 });
        }
        const period = month ? istMonthBounds(month) : null;
        if (!month || !period) {
            return NextResponse.json({ success: false, error: 'month is required in YYYY-MM format' }, { status: 400 });
        }

        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr, 10);
        const monthNum = parseInt(monthStr, 10);

        const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
        if (!vendorDoc.exists) {
            return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 });
        }
        const vendorData = vendorDoc.data()!;

        const settingsDoc = await db.collection('platformSettings').doc('commission').get();
        const platformDefault = settingsDoc.exists
            ? num(settingsDoc.data()?.defaultRate) || PRICING.DEFAULT_COMMISSION_RATE
            : PRICING.DEFAULT_COMMISSION_RATE;
        const commissionRate = num(vendorData.commissionRate) || platformDefault;

        const shouldIssue = format === 'pdf' || searchParams.get('issue') === 'true';
        const issued = await findIssuedInvoice(vendorId, month);

        // Place of supply from the GSTIN state code, falling back to an exact
        // state-name match — never a substring.
        const vendorStateCode = resolveStateCode(
            vendorData.gstNumber as string | undefined,
            (vendorData.state || '') as string
        ) || HOME_STATE_CODE;
        const interState = computeInterState(HOME_STATE_CODE, vendorStateCode);

        // An issued invoice renders from its own snapshot, always.
        let aggregate: MonthAggregate;
        if (issued?.snapshot?.weeklyBreakdown) {
            aggregate = {
                weeklyBreakdown: issued.snapshot.weeklyBreakdown as WeekRow[],
                monthlyTotals: issued.snapshot.monthlyTotals as MonthAggregate['monthlyTotals'],
            };
        } else {
            const orders = await vendorOrdersForMonth(vendorId, month);
            aggregate = aggregateMonth(orders, year, monthNum, commissionRate);
        }

        let invoiceNumber = issued?.invoiceNumber || COMMISSION_INVOICE_NOT_ISSUED;
        let issuedAt = issued?.issuedAt || null;

        if (!issued && shouldIssue) {
            if (aggregate.monthlyTotals.orders === 0) {
                return NextResponse.json(
                    { success: false, error: `No delivered orders for this vendor in ${formatMonthLong(year, monthNum)} — nothing to invoice.` },
                    { status: 409 }
                );
            }
            const fresh = await issueCommissionInvoice(vendorId, month, {
                vendorName: (vendorData.shopName || vendorData.fullName || 'Restaurant') as string,
                vendorGstin: (vendorData.gstNumber || '') as string,
                vendorStateCode,
                isInterState: interState,
                commissionRate,
                commissionBasis: 'pre-discount item total',
                weeklyBreakdown: aggregate.weeklyBreakdown,
                monthlyTotals: aggregate.monthlyTotals,
            }, auth.email || auth.uid || 'unknown');
            invoiceNumber = fresh.invoiceNumber;
            issuedAt = fresh.issuedAt;
        }

        const tax = splitTax(aggregate.monthlyTotals.gstOnCommission, interState);
        const invoiceDateInstant = issuedAt ? new Date(issuedAt) : period.end;

        const vendorAddress = [
            vendorData.address || '',
            vendorData.city || '',
            vendorData.pincode ? `– ${vendorData.pincode}` : '',
        ].filter(Boolean).join(',\n');

        const invoiceData: CommissionInvoiceData = {
            platform: COMMISSION_PLATFORM,
            vendor: {
                name: (vendorData.shopName || vendorData.fullName || 'Restaurant') as string,
                gstin: (vendorData.gstNumber || '') as string,
                fssaiLicense: (vendorData.fssaiLicense || '') as string,
                address: vendorAddress,
                state: stateName(vendorStateCode),
            },
            invoiceNumber,
            invoiceIssued: !!issued || invoiceNumber !== COMMISSION_INVOICE_NOT_ISSUED,
            invoiceIssuedAt: issuedAt,
            invoiceDate: `${String(invoiceDateInstant.getUTCDate()).padStart(2, '0')}-${monthStr}-${year}`,
            hsnCode: COMMISSION_HSN_CODE,
            placeOfSupply: placeOfSupplyLabel(vendorStateCode),
            serviceType: 'Platform Commission',
            category: 'B2B',
            reverseCharges: false,
            billingPeriod: formatMonthLong(year, monthNum),
            commissionRate,
            weeklyBreakdown: aggregate.weeklyBreakdown,
            monthlyTotals: aggregate.monthlyTotals,
            gstBreakup: {
                igstRate: interState ? PRICING.GST_ON_COMMISSION : 0,
                igstAmount: tax.igst,
                cgstRate: interState ? 0 : PRICING.GST_ON_COMMISSION / 2,
                cgstAmount: tax.cgst,
                sgstRate: interState ? 0 : PRICING.GST_ON_COMMISSION / 2,
                sgstAmount: tax.sgst,
                totalGst: tax.total,
                totalCommissionPlusGst: aggregate.monthlyTotals.totalDeduction,
            },
        };

        if (format === 'pdf') {
            const { generateCommissionInvoicePDF } = await import('@/lib/commission-invoice-pdf');
            const pdfBytes = generateCommissionInvoicePDF(invoiceData);
            return new Response(Buffer.from(pdfBytes), {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="Commission-Invoice-${invoiceNumber.replace(/\//g, '-')}.pdf"`,
                    'Cache-Control': 'no-cache',
                },
            });
        }

        return NextResponse.json({ success: true, data: invoiceData });
    } catch (error) {
        console.error('Commission invoice error:', error);
        const message = error instanceof Error ? error.message : 'Failed to generate commission invoice';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * POST — commission summary for every vendor in a month, for the listing page.
 */
async function handlePOST(request: NextRequest) {
    try {
        const body = await request.json();
        const month: string = body?.month;
        const period = month ? istMonthBounds(month) : null;
        if (!month || !period) {
            return NextResponse.json({ success: false, error: 'month is required in YYYY-MM format' }, { status: 400 });
        }

        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr, 10);
        const monthNum = parseInt(monthStr, 10);

        const vendorDocs = await cachedCollection(collections.vendors);
        const allOrders = await cachedCollection(collections.orders, 30_000);

        const settingsDoc = await db.collection('platformSettings').doc('commission').get();
        const platformDefault = settingsDoc.exists
            ? num(settingsDoc.data()?.defaultRate) || PRICING.DEFAULT_COMMISSION_RATE
            : PRICING.DEFAULT_COMMISSION_RATE;

        const issuedByVendor: Record<string, { invoiceNumber: string; sequence: number; issuedAt: string | null }> = {};
        try {
            const issuedSnap = await db.collection(COMMISSION_INVOICES_COLLECTION).where('month', '==', month).get();
            issuedSnap.docs.forEach((doc) => {
                const d = doc.data();
                if (!d.vendorId || !d.invoiceNumber) return;
                issuedByVendor[d.vendorId as string] = {
                    invoiceNumber: d.invoiceNumber as string,
                    sequence: num(d.sequence),
                    issuedAt: d.issuedAt?.toDate?.()?.toISOString?.() || null,
                };
            });
        } catch (err) {
            console.warn('Could not load issued commission invoices:', err);
        }

        const monthOrders = allOrders.filter((order) => {
            if (!isBillableStatus(order.status)) return false;
            const d = toDate(order.deliveredAt) || toDate(order.createdAt);
            return d ? withinPeriod(d, period) : false;
        });

        const byVendor: Record<string, any[]> = {};
        for (const order of monthOrders) {
            const vid = order.vendorId as string;
            if (!vid) continue;
            (byVendor[vid] ||= []).push(order);
        }

        const summaries = vendorDocs.map((v) => {
            const orders = byVendor[v.id] || [];
            const commissionRate = num(v.commissionRate) || platformDefault;
            const { monthlyTotals } = aggregateMonth(orders, year, monthNum, commissionRate);
            const issued = issuedByVendor[v.id];

            return {
                vendorId: v.id,
                invoiceNumber: issued?.invoiceNumber || COMMISSION_INVOICE_NOT_ISSUED,
                invoiceIssued: !!issued,
                invoiceIssuedAt: issued?.issuedAt || null,
                shopName: (v.shopName || v.fullName || 'Unknown') as string,
                shopImageUrl: (v.shopImageUrl || v.profileImageUrl || '') as string,
                city: (v.city || '') as string,
                gstin: (v.gstNumber || '') as string,
                fssaiLicense: (v.fssaiLicense || '') as string,
                isVerified: (v.isVerified || false) as boolean,
                commissionRate,
                orderCount: monthlyTotals.orders,
                grossSales: monthlyTotals.grossSales,
                commissionBase: monthlyTotals.commissionBase,
                commission: monthlyTotals.commission,
                gstOnCommission: monthlyTotals.gstOnCommission,
                totalDeduction: monthlyTotals.totalDeduction,
                netPayout: monthlyTotals.netPayout,
            };
        })
            // A vendor whose orders were all cancelled after their invoice was
            // issued still has a live document, so it has to stay visible —
            // otherwise the serial exists with no way to reach or credit it.
            .filter((v) => v.orderCount > 0 || v.invoiceIssued)
            .sort((a, b) => b.grossSales - a.grossSales);

        const total = (pick: (v: typeof summaries[number]) => number) => r2(summaries.reduce((s, v) => s + pick(v), 0));

        return NextResponse.json({
            success: true,
            data: {
                month,
                platformDefaultRate: platformDefault,
                vendors: summaries,
                totals: {
                    vendors: summaries.length,
                    orders: summaries.reduce((s, v) => s + v.orderCount, 0),
                    grossSales: total((v) => v.grossSales),
                    commission: total((v) => v.commission),
                    gstOnCommission: total((v) => v.gstOnCommission),
                    totalDeduction: total((v) => v.totalDeduction),
                    netPayout: total((v) => v.netPayout),
                },
            },
        });
    } catch (error) {
        console.error('Commission invoice bulk error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch commission data' }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
