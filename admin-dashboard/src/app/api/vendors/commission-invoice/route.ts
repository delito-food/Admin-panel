import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import {
    COMMISSION_PLATFORM,
    COMMISSION_HSN_CODE,
    COMMISSION_INVOICES_COLLECTION,
    COMMISSION_INVOICE_COUNTER_DOC,
    COMMISSION_INVOICE_NOT_ISSUED,
    CommissionInvoiceData,
    commissionInvoiceDocId,
    formatCommissionInvoiceNumber,
    parseCommissionInvoiceSequence,
} from '@/lib/invoice-constants';

/**
 * GET /api/vendors/commission-invoice?vendorId=xxx&month=2026-02&format=pdf|json&issue=true
 *
 * Generates a Commission Tax Invoice for a vendor for a given month.
 * Aggregates all delivered orders, groups them by week, calculates commission + GST.
 *
 * Invoice numbering
 * -----------------
 * A number is allocated **once** per vendor per billing month and stored in the
 * `commissionInvoices` collection. Every later request for the same
 * vendor + month returns that same number, so a re-download never produces a
 * second document for the same period.
 *
 * Allocation runs inside a Firestore transaction against a single counter
 * (`counters/commissionInvoices`), which makes the series gap-free and safe
 * against two admins generating invoices at the same moment.
 *
 * A number is only consumed when the invoice is actually issued — that is, when
 * a PDF is requested or `issue=true` is passed. Opening the JSON preview does
 * not burn a number.
 */

interface IssuedInvoice {
    invoiceNumber: string;
    sequence: number;
    issuedAt: string | null;
    issued: boolean;
}

/**
 * Look up the invoice already issued for this vendor + month, if any.
 */
async function findIssuedInvoice(vendorId: string, month: string): Promise<IssuedInvoice | null> {
    const docId = commissionInvoiceDocId(vendorId, month);
    const snap = await db.collection(COMMISSION_INVOICES_COLLECTION).doc(docId).get();
    if (!snap.exists) return null;

    const data = snap.data() || {};
    const invoiceNumber = (data.invoiceNumber as string) || '';
    if (!invoiceNumber) return null;

    return {
        invoiceNumber,
        sequence: (data.sequence as number) || parseCommissionInvoiceSequence(invoiceNumber),
        issuedAt: data.issuedAt?.toDate?.()?.toISOString?.() || (data.issuedAt as string) || null,
        issued: true,
    };
}

/**
 * Allocate — atomically and exactly once — the invoice number for this
 * vendor + month, and record it alongside a snapshot of the billed totals.
 */
async function issueInvoiceNumber(
    vendorId: string,
    month: string,
    year: number,
    monthNum: number,
    snapshot: Record<string, unknown>
): Promise<IssuedInvoice> {
    const invoiceRef = db.collection(COMMISSION_INVOICES_COLLECTION).doc(commissionInvoiceDocId(vendorId, month));
    const counterRef = db.collection('counters').doc(COMMISSION_INVOICE_COUNTER_DOC);

    return db.runTransaction(async (tx) => {
        // Idempotency: if another request issued it first, reuse that number.
        const existing = await tx.get(invoiceRef);
        if (existing.exists && existing.data()?.invoiceNumber) {
            const data = existing.data()!;
            return {
                invoiceNumber: data.invoiceNumber as string,
                sequence: (data.sequence as number) || parseCommissionInvoiceSequence(data.invoiceNumber as string),
                issuedAt: data.issuedAt?.toDate?.()?.toISOString?.() || null,
                issued: true,
            };
        }

        const counterSnap = await tx.get(counterRef);
        const currentCount = (counterSnap.data()?.count as number) || 0;
        const sequence = currentCount + 1;
        const invoiceNumber = formatCommissionInvoiceNumber(year, monthNum, sequence);
        const issuedAt = Timestamp.now();

        tx.set(counterRef, { count: sequence, updatedAt: issuedAt }, { merge: true });
        tx.set(invoiceRef, {
            ...snapshot,
            invoiceNumber,
            sequence,
            vendorId,
            month,
            issuedAt,
        }, { merge: true });

        return {
            invoiceNumber,
            sequence,
            issuedAt: issuedAt.toDate().toISOString(),
            issued: true,
        };
    });
}
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const vendorId = searchParams.get('vendorId');
        const month = searchParams.get('month'); // format: YYYY-MM
        const format = searchParams.get('format') || 'json';

        if (!vendorId) {
            return NextResponse.json(
                { success: false, error: 'vendorId is required' },
                { status: 400 }
            );
        }

        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return NextResponse.json(
                { success: false, error: 'month is required in YYYY-MM format' },
                { status: 400 }
            );
        }

        // ── 1. Fetch vendor details ──
        const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
        if (!vendorDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Vendor not found' },
                { status: 404 }
            );
        }
        const vendorData = vendorDoc.data()!;

        // ── 2. Get commission rate ──
        const settingsDoc = await db.collection('platformSettings').doc('commission').get();
        const platformDefault = settingsDoc.exists ? (settingsDoc.data()?.defaultRate ?? 15) : 15;
        const commissionRate = (vendorData.commissionRate ?? platformDefault) as number;

        // ── 3. Parse month range ──
        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr);
        const monthNum = parseInt(monthStr); // 1-indexed
        const monthStart = new Date(year, monthNum - 1, 1);
        const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999); // last day of month

        // ── 4. Fetch all orders for this vendor ──
        const allOrders = await cachedCollection(collections.orders, 30_000);
        const vendorOrders = allOrders.filter(order => {
            if (order.vendorId !== vendorId) return false;
            const status = ((order.status as string) || '').toLowerCase();
            if (status !== 'delivered' && status !== 'completed') return false;

            // Parse date
            let orderDate: Date;
            if (order.createdAt?.toDate) {
                orderDate = order.createdAt.toDate();
            } else if (order.createdAt) {
                orderDate = new Date(order.createdAt as string);
            } else {
                return false;
            }

            return orderDate >= monthStart && orderDate <= monthEnd;
        });

        // ── 5. Group orders by week ──
        const daysInMonth = monthEnd.getDate();
        const weeks: Array<{
            start: number;
            end: number;
            orders: typeof vendorOrders;
        }> = [];

        // Standard weeks: 1-7, 8-14, 15-21, 22-end
        const weekRanges = [
            [1, 7],
            [8, 14],
            [15, 21],
            [22, daysInMonth],
        ];

        // If month has 5th week possibility (days > 28)
        if (daysInMonth > 28) {
            // Keep 4 weeks, last week extends to end of month
            weekRanges[3] = [22, daysInMonth];
        }

        for (const [start, end] of weekRanges) {
            const weekStart = new Date(year, monthNum - 1, start);
            const weekEnd = new Date(year, monthNum - 1, end, 23, 59, 59, 999);

            const weekOrders = vendorOrders.filter(order => {
                let orderDate: Date;
                if (order.createdAt?.toDate) {
                    orderDate = order.createdAt.toDate();
                } else {
                    orderDate = new Date(order.createdAt as string);
                }
                return orderDate >= weekStart && orderDate <= weekEnd;
            });

            weeks.push({ start, end, orders: weekOrders });
        }

        // ── 6. Calculate weekly breakdown ──
        const monthNames = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        const monthFullNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const mn = monthNames[monthNum - 1];

        const weeklyBreakdown = weeks.map((week, idx) => {
            const grossSales = week.orders.reduce((sum, o) => {
                // Gross sales = food subtotal (inclusive of food price + packing)
                return sum + ((o.itemTotal as number) || (o.subtotal as number) || 0);
            }, 0);

            const commission = Math.round(grossSales * commissionRate / 100 * 100) / 100;
            const gstOnCommission = Math.round(commission * 0.18 * 100) / 100;
            const totalDeduction = Math.round((commission + gstOnCommission) * 100) / 100;
            const netPayout = Math.round((grossSales - totalDeduction) * 100) / 100;

            const startStr = String(week.start).padStart(2, '0');
            const endStr = String(week.end).padStart(2, '0');

            return {
                weekLabel: `Week ${idx + 1} (${startStr} ${mn} – ${endStr} ${mn} ${year})`,
                orders: week.orders.length,
                grossSales: Math.round(grossSales * 100) / 100,
                commission,
                gstOnCommission,
                totalDeduction,
                netPayout,
            };
        });

        // ── 7. Calculate monthly totals ──
        const monthlyTotals = {
            orders: weeklyBreakdown.reduce((s, w) => s + w.orders, 0),
            grossSales: Math.round(weeklyBreakdown.reduce((s, w) => s + w.grossSales, 0) * 100) / 100,
            commission: Math.round(weeklyBreakdown.reduce((s, w) => s + w.commission, 0) * 100) / 100,
            gstOnCommission: Math.round(weeklyBreakdown.reduce((s, w) => s + w.gstOnCommission, 0) * 100) / 100,
            totalDeduction: Math.round(weeklyBreakdown.reduce((s, w) => s + w.totalDeduction, 0) * 100) / 100,
            netPayout: Math.round(weeklyBreakdown.reduce((s, w) => s + w.netPayout, 0) * 100) / 100,
        };

        // ── 8. GST Breakup ──
        // Same state → CGST + SGST; different state → IGST
        const vendorState = ((vendorData.state || vendorData.city || '') as string).toLowerCase();
        const platformState = COMMISSION_PLATFORM.state.toLowerCase();
        const isSameState = vendorState.includes('uttar pradesh') || vendorState.includes('hathras') || platformState.includes(vendorState);

        const gstBreakup = {
            igstRate: isSameState ? 0 : 18,
            igstAmount: isSameState ? 0 : monthlyTotals.gstOnCommission,
            cgstRate: isSameState ? 9 : 0,
            cgstAmount: isSameState ? Math.round(monthlyTotals.gstOnCommission / 2 * 100) / 100 : 0,
            sgstRate: isSameState ? 9 : 0,
            sgstAmount: isSameState ? Math.round(monthlyTotals.gstOnCommission / 2 * 100) / 100 : 0,
            totalGst: monthlyTotals.gstOnCommission,
            totalCommissionPlusGst: monthlyTotals.totalDeduction,
        };

        // ── 9. Resolve the invoice number ──
        // Reuse the number already issued for this vendor + month; only allocate
        // a new one when the invoice is actually being issued (PDF download or an
        // explicit issue=true). Previews never consume a number, which is what
        // keeps the series contiguous.
        const mm = String(monthNum).padStart(2, '0');
        const shouldIssue = format === 'pdf' || searchParams.get('issue') === 'true';

        let issued = await findIssuedInvoice(vendorId, month);

        if (!issued && shouldIssue) {
            issued = await issueInvoiceNumber(vendorId, month, year, monthNum, {
                vendorName: (vendorData.shopName || vendorData.fullName || 'Restaurant') as string,
                vendorGstin: (vendorData.gstNumber || '') as string,
                commissionRate,
                orderCount: monthlyTotals.orders,
                grossSales: monthlyTotals.grossSales,
                commission: monthlyTotals.commission,
                gstOnCommission: monthlyTotals.gstOnCommission,
                totalDeduction: monthlyTotals.totalDeduction,
                netPayout: monthlyTotals.netPayout,
            });
        }

        const invoiceNumber = issued?.invoiceNumber || COMMISSION_INVOICE_NOT_ISSUED;

        // ── 10. Build invoice date (last day of month) ──
        const invoiceDate = `${String(monthEnd.getDate()).padStart(2, '0')}-${mm}-${year}`;

        // ── 11. Assemble invoice data ──
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
                state: (vendorData.state || vendorData.city || 'Uttar Pradesh') as string,
            },
            invoiceNumber,
            invoiceIssued: !!issued?.issued,
            invoiceIssuedAt: issued?.issuedAt || null,
            invoiceDate,
            hsnCode: COMMISSION_HSN_CODE,
            placeOfSupply: (vendorData.state || vendorData.city || 'Uttar Pradesh') as string,
            serviceType: 'Platform Commission',
            category: 'B2B',
            reverseCharges: false,
            billingPeriod: `${monthFullNames[monthNum - 1]} ${year}`,
            commissionRate,
            weeklyBreakdown,
            monthlyTotals,
            gstBreakup,
        };

        // ── 12. Return response ──
        if (format === 'pdf') {
            // Dynamic import to avoid loading PDF lib on JSON requests
            const { generateCommissionInvoicePDF } = await import('@/lib/commission-invoice-pdf');
            const pdfBytes = generateCommissionInvoicePDF(invoiceData);
            return new Response(Buffer.from(pdfBytes), {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="Commission-Invoice-${invoiceNumber}.pdf"`,
                    'Cache-Control': 'no-cache',
                },
            });
        }

        return NextResponse.json({
            success: true,
            data: invoiceData,
        });
    } catch (error) {
        console.error('Commission invoice error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to generate commission invoice' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/vendors/commission-invoice
 *
 * Bulk fetch commission summary for all vendors for a given month.
 * Used by the Commission Invoices listing page.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { month } = body; // YYYY-MM

        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return NextResponse.json(
                { success: false, error: 'month is required in YYYY-MM format' },
                { status: 400 }
            );
        }

        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr);
        const monthNum = parseInt(monthStr);
        const monthStart = new Date(year, monthNum - 1, 1);
        const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);

        // Fetch vendors and orders
        const vendorDocs = await cachedCollection(collections.vendors);
        const allOrders = await cachedCollection(collections.orders, 30_000);

        // Get platform default commission rate
        const settingsDoc = await db.collection('platformSettings').doc('commission').get();
        const platformDefault = settingsDoc.exists ? (settingsDoc.data()?.defaultRate ?? 15) : 15;

        // Invoice numbers already issued for this billing month, keyed by vendor
        const issuedByVendor: Record<string, { invoiceNumber: string; sequence: number; issuedAt: string | null }> = {};
        try {
            const issuedSnap = await db.collection(COMMISSION_INVOICES_COLLECTION)
                .where('month', '==', month)
                .get();
            issuedSnap.docs.forEach(doc => {
                const d = doc.data();
                if (!d.vendorId || !d.invoiceNumber) return;
                issuedByVendor[d.vendorId as string] = {
                    invoiceNumber: d.invoiceNumber as string,
                    sequence: (d.sequence as number) || parseCommissionInvoiceSequence(d.invoiceNumber as string),
                    issuedAt: d.issuedAt?.toDate?.()?.toISOString?.() || null,
                };
            });
        } catch (err) {
            console.warn('Could not load issued commission invoices:', err);
        }

        // Filter delivered orders in the month
        const monthOrders = allOrders.filter(order => {
            const status = ((order.status as string) || '').toLowerCase();
            if (status !== 'delivered' && status !== 'completed') return false;

            let orderDate: Date;
            if (order.createdAt?.toDate) {
                orderDate = order.createdAt.toDate();
            } else if (order.createdAt) {
                orderDate = new Date(order.createdAt as string);
            } else {
                return false;
            }

            return orderDate >= monthStart && orderDate <= monthEnd;
        });

        // Group orders by vendor
        const vendorOrdersMap: Record<string, typeof monthOrders> = {};
        for (const order of monthOrders) {
            const vid = order.vendorId as string;
            if (!vid) continue;
            if (!vendorOrdersMap[vid]) vendorOrdersMap[vid] = [];
            vendorOrdersMap[vid].push(order);
        }

        // Build summary per vendor
        const vendorSummaries = vendorDocs.map(v => {
            const orders = vendorOrdersMap[v.id] || [];
            const commissionRate = (v.commissionRate ?? platformDefault) as number;

            const grossSales = orders.reduce((sum, o) =>
                sum + ((o.itemTotal as number) || (o.subtotal as number) || 0), 0);

            const commission = Math.round(grossSales * commissionRate / 100 * 100) / 100;
            const gstOnCommission = Math.round(commission * 0.18 * 100) / 100;
            const totalDeduction = Math.round((commission + gstOnCommission) * 100) / 100;
            const netPayout = Math.round((grossSales - totalDeduction) * 100) / 100;

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
                orderCount: orders.length,
                grossSales: Math.round(grossSales * 100) / 100,
                commission,
                gstOnCommission,
                totalDeduction,
                netPayout,
            };
        }).filter(v => v.orderCount > 0) // Only show vendors with orders
            .sort((a, b) => b.grossSales - a.grossSales); // Sort by revenue

        return NextResponse.json({
            success: true,
            data: {
                month,
                platformDefaultRate: platformDefault,
                vendors: vendorSummaries,
                totals: {
                    vendors: vendorSummaries.length,
                    orders: vendorSummaries.reduce((s, v) => s + v.orderCount, 0),
                    grossSales: Math.round(vendorSummaries.reduce((s, v) => s + v.grossSales, 0) * 100) / 100,
                    commission: Math.round(vendorSummaries.reduce((s, v) => s + v.commission, 0) * 100) / 100,
                    gstOnCommission: Math.round(vendorSummaries.reduce((s, v) => s + v.gstOnCommission, 0) * 100) / 100,
                    totalDeduction: Math.round(vendorSummaries.reduce((s, v) => s + v.totalDeduction, 0) * 100) / 100,
                    netPayout: Math.round(vendorSummaries.reduce((s, v) => s + v.netPayout, 0) * 100) / 100,
                },
            },
        });
    } catch (error) {
        console.error('Commission invoice bulk error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch commission data' },
            { status: 500 }
        );
    }
}
