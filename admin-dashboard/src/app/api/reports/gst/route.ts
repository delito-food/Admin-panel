/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { collections, cachedCollection } from '@/lib/firebase-admin';
import { PLATFORM, GST_RATES, HSN_CODES } from '@/lib/invoice-constants';
import { getInvoiceNumberMap, invoiceNumberFor } from '@/lib/invoice-lookup';
import { reportResponse, platformMeta, formatDay } from '@/lib/report-export';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';
import { withAdmin } from '@/lib/api-guard';
import { computeOrderEconomics, isBillableStatus, isCancelledStatus } from '@/lib/pricing-engine';
import { istDayBoundsFromString, istMonthKey, toDate } from '@/lib/fiscal';
import { db } from '@/lib/firebase-admin';
import { CREDIT_NOTES_COLLECTION } from '@/lib/credit-note';
import { COMMISSION_DEBIT_NOTES_COLLECTION, DEBIT_NOTES_COLLECTION } from '@/lib/debit-note';
import { INVOICE_SCHEMA_VERSION } from '@/lib/invoice-document';
import { HOME_STATE_CODE, isInterState as computeInterState, placeOfSupplyLabel, resolveStateCode, splitTax } from '@/lib/gst';

/**
 * GST report — structured to mirror the GSTR-1 / GSTR-3B return layout.
 *
 * Sections produced:
 *   • summary          — control totals for the period
 *   • b2cs             — GSTR-1 Table 7 (B2C others, rate-wise, place of supply)
 *   • hsnSummary       — GSTR-1 Table 12 (HSN-wise outward supplies)
 *   • documentSummary  — GSTR-1 Table 13 (documents issued)
 *   • gstr3b           — GSTR-3B Table 3.1(a) outward taxable supplies
 *   • monthlyData      — tax-period-wise breakdown
 *   • vendorData       — supplier-wise breakdown (internal reconciliation)
 *   • entries          — invoice-wise register (the audit trail)
 *
 * Rates applied (restaurant service through an e-commerce operator):
 *   Food        HSN 9963   5%  (2.5% CGST + 2.5% SGST)
 *   Delivery    HSN 996812 18% (9% CGST + 9% SGST)
 *   Platform    HSN 998599 18% (9% CGST + 9% SGST)
 *   Commission  HSN 998399 18% (9% CGST + 9% SGST) — billed to the restaurant
 *
 * Taxable value follows section 15(3): discounts recorded on the invoice
 * (menu/offer discounts) reduce the taxable value; post-supply discounts
 * (coins, promo codes, HungerGame rewards) do not, and are reported separately.
 */

const GST_ON_COMMISSION = 0.18;
const GST_ON_SERVICES = 0.18;
const GST_ON_FOOD = 0.05;
const DEFAULT_COMMISSION_RATE = 0.15;

const PLACE_OF_SUPPLY = '09-Uttar Pradesh';

type Rated = { taxableValue: number; cgst: number; sgst: number; igst: number };

interface GSTEntry {
    invoiceNumber: string;
    /** ISO date the serial was allocated. Empty when no document exists yet. */
    invoiceDateIssued?: string;
    /** False when this row is costed from the order because no tax invoice
     *  has been issued — it cannot be filed until one is. */
    documentIssued?: boolean;
    orderId: string;
    vendorId: string;
    vendorName: string;
    orderDate: string;
    placeOfSupply: string;
    // Values
    grossItemTotal: number;
    itemDiscount: number;
    postSupplyDiscount: number;
    totalDiscount: number;
    // Rate-wise taxable value
    foodTaxable: number;
    deliveryTaxable: number;
    platformTaxable: number;
    commissionTaxable: number;
    taxableValue: number;
    // Tax
    cgst: number;
    sgst: number;
    igst: number;
    totalGst: number;
    invoiceValue: number;
    // Platform economics
    commission: number;
    gstOnCommission: number;
    totalPlatformEarning: number;
    paymentMode: string;
}

interface PeriodRow extends Rated {
    [key: string]: unknown;
    month: string;
    monthKey: string;
    ordersCount: number;
    grossSales: number;
    totalDiscount: number;
    foodTaxable: number;
    deliveryTaxable: number;
    platformTaxable: number;
    commissionTaxable: number;
    totalGst: number;
    invoiceValue: number;
    totalCommission: number;
    totalGstOnCommission: number;
    totalPlatformEarning: number;
    totalPlatformEarningExclGst: number;
    // legacy aliases kept so older widgets keep rendering
    totalItemSales: number;
    totalDeliveryFees: number;
    totalCommissionLegacy?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Commission GST split by head, matching the invoice raised to the vendor. */
function splitCommissionTax(amount: number, interState: boolean) {
    return splitTax(amount, interState);
}

async function handleGET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const vendorId = searchParams.get('vendorId');
        const format = searchParams.get('format');
        const section = (searchParams.get('section') || 'register').toLowerCase();

        const vendorDocs = await cachedCollection(collections.vendors);
        const vendorMap: Record<string, string> = {};
        const vendorGstinMap: Record<string, string> = {};
        vendorDocs.forEach(data => {
            vendorMap[data.id] = (data.shopName || data.fullName || 'Unknown') as string;
            vendorGstinMap[data.id] = (data.gstNumber || data.gstin || '') as string;
        });

        const orderDocs = await cachedCollection(collections.orders);
        const invoiceNumbers = await getInvoiceNumberMap();

        // ── The issued documents ──
        //
        // A return is filed from documents, not from orders. Where a stored tax
        // invoice exists its frozen figures are authoritative and are used as
        // they were issued; an order with no invoice is still costed, so the
        // report stays usable, but it is counted separately and listed under
        // `unbilled` because it cannot be filed until a document exists for it.
        const storedInvoices: Record<string, any> = {};
        try {
            const snap = await db.collection('invoices').get();
            snap.docs.forEach(d => {
                const data = d.data();
                if (data?.schemaVersion === INVOICE_SCHEMA_VERSION) storedInvoices[d.id] = data;
            });
        } catch (err) {
            console.warn('[gst] could not load stored invoices:', err);
        }

        const creditNoteDocs: any[] = [];
        try {
            const snap = await db.collection(CREDIT_NOTES_COLLECTION).get();
            snap.docs.forEach(d => creditNoteDocs.push({ id: d.id, ...d.data() }));
        } catch (err) {
            console.warn('[gst] could not load credit notes:', err);
        }

        // Debit notes RAISE an invoice's value (s.34(3)); credit notes reduce it.
        // Both are Table 9B documents and both change the net liability, in
        // opposite directions.
        const debitNoteDocs: any[] = [];
        for (const coll of [DEBIT_NOTES_COLLECTION, COMMISSION_DEBIT_NOTES_COLLECTION]) {
            try {
                const snap = await db.collection(coll).get();
                snap.docs.forEach(d => debitNoteDocs.push({ id: d.id, ...d.data() }));
            } catch (err) {
                console.warn(`[gst] could not load ${coll}:`, err);
            }
        }

        const unbilled: Array<{ orderId: string; vendorName: string; orderDate: string; invoiceValue: number }> = [];

        const gstEntries: GSTEntry[] = [];
        const monthly: Record<string, PeriodRow> = {};
        const vendorAgg: Record<string, {
            vendorId: string;
            vendorName: string;
            gstin: string;
            ordersCount: number;
            grossSales: number;
            totalDiscount: number;
            foodTaxable: number;
            deliveryTaxable: number;
            platformTaxable: number;
            commissionTaxable: number;
            taxableValue: number;
            cgst: number;
            sgst: number;
            totalGst: number;
            totalCommission: number;
            totalPlatformEarning: number;
            totalPlatformEarningExclGst: number;
            // legacy aliases
            totalItemSales: number;
            totalDeliveryFees: number;
        }> = {};

        // Rate-wise buckets for GSTR-1 Table 7 (B2C others)
        const b2csBuckets: Record<string, Rated & { rate: number; invoiceCount: number }> = {};
        // HSN buckets for GSTR-1 Table 12
        const hsnBuckets: Record<string, Rated & {
            hsn: string; description: string; uqc: string; quantity: number; rate: number; total: number;
        }> = {};

        const addB2CS = (rate: number, taxable: number, cgst: number, sgst: number, igst = 0) => {
            if (taxable <= 0) return;
            const key = String(rate);
            if (!b2csBuckets[key]) {
                b2csBuckets[key] = { rate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, invoiceCount: 0 };
            }
            b2csBuckets[key].taxableValue += taxable;
            b2csBuckets[key].cgst += cgst;
            b2csBuckets[key].sgst += sgst;
            b2csBuckets[key].igst += igst;
            b2csBuckets[key].invoiceCount += 1;
        };

        const addHSN = (
            hsn: string, description: string, uqc: string, quantity: number,
            rate: number, taxable: number, cgst: number, sgst: number, igst = 0
        ) => {
            if (taxable <= 0) return;
            const key = `${hsn}|${rate}`;
            if (!hsnBuckets[key]) {
                hsnBuckets[key] = {
                    hsn, description, uqc, quantity: 0, rate,
                    taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0,
                };
            }
            const b = hsnBuckets[key];
            b.quantity += quantity;
            b.taxableValue += taxable;
            b.cgst += cgst;
            b.sgst += sgst;
            b.igst += igst;
            b.total += taxable + cgst + sgst + igst;
        };

        let earliestTs = Number.POSITIVE_INFINITY;
        let latestTs = 0;
        let cancelledCount = 0;

        orderDocs.forEach(order => {
            const isCancelled = isCancelledStatus(order.status);

            // The tax period is the delivery date, in IST. Computing bounds with
            // setHours() on a UTC host shifted every boundary 5h30m early, which
            // leaked orders placed between midnight and 05:30 IST into the
            // previous month's return.
            const dateObj = toDate(order.deliveredAt) || toDate(order.createdAt);
            if (!dateObj) return;

            if (startDate) {
                const bounds = istDayBoundsFromString(startDate);
                if (bounds && dateObj < bounds.start) return;
            }
            if (endDate) {
                const bounds = istDayBoundsFromString(endDate);
                if (bounds && dateObj > bounds.end) return;
            }
            if (vendorId && order.vendorId !== vendorId) return;

            // Cancelled orders are counted in the document summary only
            if (isCancelled) { cancelledCount++; return; }
            if (!isBillableStatus(order.status)) return;

            const orderVendorId = (order.vendorId as string) || '';
            const orderVendorName = vendorMap[orderVendorId] || (order.vendorName as string) || 'Unknown';

            // ── Values, from the shared pricing engine ──
            //
            // Every figure below is the same one the customer tax invoice and
            // the commission invoice print. Recomputing tax here by hand is what
            // let the report declare a different commission base from the one
            // actually billed.
            //
            // Discounts reduce the taxable value (s.15(3)), so the taxable
            // amounts here are net of promo codes, coins and HungerGame rewards,
            // matching the invoice issued for the same order.
            const vendorStateCode = resolveStateCode(
                vendorGstinMap[orderVendorId],
                (order.deliveryState || order.customerState) as string | undefined
            ) || HOME_STATE_CODE;
            const orderInterState = computeInterState(HOME_STATE_CODE, vendorStateCode);

            const economics = computeOrderEconomics(order, order.id, { interState: orderInterState });

            // A document already issued is frozen: its figures are what the
            // customer holds and what must be filed, even if a rate or a
            // rounding rule has changed since.
            const issuedDoc = storedInvoices[order.id];
            const documentIssued = !!issuedDoc;
            const sourceComponents = documentIssued ? (issuedDoc.components as any[]) : economics.components;

            const foodC = sourceComponents.find((c: any) => c.key === 'food');
            const delC = sourceComponents.find((c: any) => c.key === 'delivery');
            const pfC = sourceComponents.find((c: any) => c.key === 'platform');

            if (!documentIssued) {
                unbilled.push({
                    orderId: order.id,
                    vendorName: orderVendorName,
                    orderDate: dateObj.toISOString(),
                    invoiceValue: economics.invoiceValue,
                });
            }

            const itemTotal = foodC?.taxableValue ?? 0;
            const deliveryFee = delC?.taxableValue ?? 0;
            const platformFee = pfC?.taxableValue ?? 0;

            const foodCgst = foodC?.cgst ?? 0, foodSgst = foodC?.sgst ?? 0, foodIgst = foodC?.igst ?? 0;
            const delCgst = delC?.cgst ?? 0, delSgst = delC?.sgst ?? 0, delIgst = delC?.igst ?? 0;
            const pfCgst = pfC?.cgst ?? 0, pfSgst = pfC?.sgst ?? 0, pfIgst = pfC?.igst ?? 0;

            const itemDiscount = r2(economics.discounts.filter(d => d.key === 'item').reduce((sum, d) => sum + d.amount, 0));
            const orderLevelDiscount = r2(economics.discounts.filter(d => d.key !== 'item').reduce((sum, d) => sum + d.amount, 0));
            // Field kept for the existing register columns. Under the current
            // policy no discount is treated as post-supply, so this is the
            // order-level discount that reduced the taxable value.
            const postSupplyDiscount = orderLevelDiscount;
            const grossItemTotal = r2((foodC?.grossTaxableValue ?? 0) + itemDiscount);

            const commissionResult = economics.commission;
            const commission = commissionResult.amount;
            const gstOnCommission = commissionResult.gst;
            const commissionTax = splitCommissionTax(gstOnCommission, orderInterState);
            const comCgst = commissionTax.cgst, comSgst = commissionTax.sgst, comIgst = commissionTax.igst;

            const taxableValue = r2(itemTotal + deliveryFee + platformFee + commission);
            const cgst = r2(foodCgst + delCgst + pfCgst + comCgst);
            const sgst = r2(foodSgst + delSgst + pfSgst + comSgst);
            const igst = r2(foodIgst + delIgst + pfIgst + comIgst);
            const totalGst = r2(cgst + sgst + igst);
            const invoiceValue = r2(taxableValue + totalGst);

            // ── GSTR-1 buckets ──
            // Commission is a B2B supply to a registered restaurant and belongs in
            // GSTR-1 Table 4, invoice-wise against the vendor's GSTIN. It is kept
            // out of the B2C bucket here; Phase 3 adds the Table 4 section proper.
            addB2CS(5, itemTotal, foodCgst, foodSgst, foodIgst);
            addB2CS(18, r2(deliveryFee + platformFee),
                r2(delCgst + pfCgst), r2(delSgst + pfSgst), r2(delIgst + pfIgst));

            const itemQty = ((order.items as any[]) || [])
                .reduce((s: number, it: any) => s + (it?.quantity || 0), 0);
            addHSN(HSN_CODES.FOOD, 'Restaurant service (food supply)', 'NOS', itemQty, 5, itemTotal, foodCgst, foodSgst, foodIgst);
            addHSN(HSN_CODES.DELIVERY, 'Courier / delivery service', 'NOS', deliveryFee > 0 ? 1 : 0, 18, deliveryFee, delCgst, delSgst, delIgst);
            addHSN(HSN_CODES.PLATFORM, 'Platform / convenience fee', 'NOS', platformFee > 0 ? 1 : 0, 18, platformFee, pfCgst, pfSgst, pfIgst);
            addHSN('998399', 'Commission on restaurant sales', 'NOS', commission > 0 ? 1 : 0, 18, commission, comCgst, comSgst, comIgst);

            earliestTs = Math.min(earliestTs, dateObj.getTime());
            latestTs = Math.max(latestTs, dateObj.getTime());

            const entry: GSTEntry = {
                invoiceNumber: (issuedDoc?.invoiceNumber as string) || invoiceNumberFor(invoiceNumbers, order.id),
                invoiceDateIssued: (issuedDoc?.invoiceDate as string) || '',
                documentIssued,
                orderId: order.id,
                vendorId: orderVendorId,
                vendorName: orderVendorName,
                orderDate: dateObj.toISOString(),
                placeOfSupply: placeOfSupplyLabel(vendorStateCode),
                grossItemTotal: r2(grossItemTotal),
                itemDiscount: r2(itemDiscount),
                postSupplyDiscount: r2(postSupplyDiscount),
                totalDiscount: r2(itemDiscount + postSupplyDiscount),
                foodTaxable: r2(itemTotal),
                deliveryTaxable: r2(deliveryFee),
                platformTaxable: r2(platformFee),
                commissionTaxable: r2(commission),
                taxableValue,
                cgst,
                sgst,
                igst,
                totalGst,
                invoiceValue,
                commission: r2(commission),
                gstOnCommission: r2(gstOnCommission),
                totalPlatformEarning: r2(commission + gstOnCommission),
                paymentMode: (order.paymentMode as string) || 'Unknown',
            };
            gstEntries.push(entry);

            // ── Tax period aggregation ──
            const monthKey = istMonthKey(dateObj);
            if (!monthly[monthKey]) {
                monthly[monthKey] = {
                    month: dateObj.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
                    monthKey,
                    ordersCount: 0,
                    grossSales: 0,
                    totalDiscount: 0,
                    foodTaxable: 0,
                    deliveryTaxable: 0,
                    platformTaxable: 0,
                    commissionTaxable: 0,
                    taxableValue: 0,
                    cgst: 0,
                    sgst: 0,
                    igst: 0,
                    totalGst: 0,
                    invoiceValue: 0,
                    totalCommission: 0,
                    totalGstOnCommission: 0,
                    totalPlatformEarning: 0,
                    totalPlatformEarningExclGst: 0,
                    totalItemSales: 0,
                    totalDeliveryFees: 0,
                };
            }
            const m = monthly[monthKey];
            m.ordersCount++;
            m.grossSales += entry.grossItemTotal;
            m.totalDiscount += entry.totalDiscount;
            m.foodTaxable += entry.foodTaxable;
            m.deliveryTaxable += entry.deliveryTaxable;
            m.platformTaxable += entry.platformTaxable;
            m.commissionTaxable += entry.commissionTaxable;
            m.taxableValue += entry.taxableValue;
            m.cgst += entry.cgst;
            m.sgst += entry.sgst;
            m.totalGst += entry.totalGst;
            m.invoiceValue += entry.invoiceValue;
            m.totalCommission += entry.commission;
            m.totalGstOnCommission += entry.gstOnCommission;
            m.totalPlatformEarning += entry.totalPlatformEarning;
            m.totalPlatformEarningExclGst += entry.commission;
            m.totalItemSales += entry.foodTaxable;
            m.totalDeliveryFees += entry.deliveryTaxable;

            // ── Vendor aggregation ──
            if (!vendorAgg[orderVendorId]) {
                vendorAgg[orderVendorId] = {
                    vendorId: orderVendorId,
                    vendorName: orderVendorName,
                    gstin: vendorGstinMap[orderVendorId] || '',
                    ordersCount: 0,
                    grossSales: 0,
                    totalDiscount: 0,
                    foodTaxable: 0,
                    deliveryTaxable: 0,
                    platformTaxable: 0,
                    commissionTaxable: 0,
                    taxableValue: 0,
                    cgst: 0,
                    sgst: 0,
                    totalGst: 0,
                    totalCommission: 0,
                    totalPlatformEarning: 0,
                    totalPlatformEarningExclGst: 0,
                    totalItemSales: 0,
                    totalDeliveryFees: 0,
                };
            }
            const v = vendorAgg[orderVendorId];
            v.ordersCount++;
            v.grossSales += entry.grossItemTotal;
            v.totalDiscount += entry.totalDiscount;
            v.foodTaxable += entry.foodTaxable;
            v.deliveryTaxable += entry.deliveryTaxable;
            v.platformTaxable += entry.platformTaxable;
            v.commissionTaxable += entry.commissionTaxable;
            v.taxableValue += entry.taxableValue;
            v.cgst += entry.cgst;
            v.sgst += entry.sgst;
            v.totalGst += entry.totalGst;
            v.totalCommission += entry.commission;
            v.totalPlatformEarning += entry.totalPlatformEarning;
            v.totalPlatformEarningExclGst += entry.commission;
            v.totalItemSales += entry.foodTaxable;
            v.totalDeliveryFees += entry.deliveryTaxable;
        });

        gstEntries.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

        // Round every numeric field on a row to 2 decimals without losing its type
        const roundRow = <T extends object>(row: T): T => {
            const out: Record<string, unknown> = {};
            for (const [k, val] of Object.entries(row)) {
                out[k] = typeof val === 'number' ? r2(val) : val;
            }
            return out as T;
        };

        const monthlyData = Object.values(monthly)
            .map(roundRow)
            .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
        const vendorData = Object.values(vendorAgg)
            .map(roundRow)
            .sort((a, b) => b.totalGst - a.totalGst);
        const b2cs = Object.values(b2csBuckets)
            .map(roundRow)
            .sort((a, b) => a.rate - b.rate);
        const hsnSummary = Object.values(hsnBuckets)
            .map(roundRow)
            .sort((a, b) => b.taxableValue - a.taxableValue);

        const sum = (fn: (e: GSTEntry) => number) => r2(gstEntries.reduce((s, e) => s + fn(e), 0));

        const summary = {
            totalOrders: gstEntries.length,
            grossSales: sum(e => e.grossItemTotal),
            totalItemDiscount: sum(e => e.itemDiscount),
            totalPostSupplyDiscount: sum(e => e.postSupplyDiscount),
            totalDiscount: sum(e => e.totalDiscount),
            foodTaxable: sum(e => e.foodTaxable),
            deliveryTaxable: sum(e => e.deliveryTaxable),
            platformTaxable: sum(e => e.platformTaxable),
            commissionTaxable: sum(e => e.commissionTaxable),
            totalTaxableValue: sum(e => e.taxableValue),
            totalCgst: sum(e => e.cgst),
            totalSgst: sum(e => e.sgst),
            totalIgst: 0,
            totalGstCollected: sum(e => e.totalGst),
            totalInvoiceValue: sum(e => e.invoiceValue),
            totalCommission: sum(e => e.commission),
            totalGstOnCommission: sum(e => e.gstOnCommission),
            totalPlatformEarning: sum(e => e.totalPlatformEarning),
            totalPlatformEarningExclGst: sum(e => e.commission),
            // Rate-wise tax (kept for the summary cards)
            totalGstOnFood: r2(gstEntries.reduce((s, e) => s + e.foodTaxable, 0) * GST_ON_FOOD),
            totalGstOnDelivery: r2(gstEntries.reduce((s, e) => s + e.deliveryTaxable, 0) * GST_ON_SERVICES),
            totalGstOnPlatformFee: r2(gstEntries.reduce((s, e) => s + e.platformTaxable, 0) * GST_ON_SERVICES),
            // Legacy aliases
            totalItemSales: sum(e => e.foodTaxable),
            totalDeliveryFees: sum(e => e.deliveryTaxable),
            commissionRate: DEFAULT_COMMISSION_RATE * 100,
            gstOnCommissionRate: GST_ON_COMMISSION * 100,
            gstOnFoodRate: GST_ON_FOOD * 100,
            gstOnDeliveryRate: GST_ON_SERVICES * 100,
            gstRate: GST_ON_COMMISSION * 100,
        };

        // ── GSTR-1 Table 9B — credit notes issued in the period ──
        //
        // A credit note reverses output tax already declared on an invoice. It
        // is reported separately and subtracted from the net liability, never
        // netted into the invoice rows themselves.
        const periodCreditNotes = creditNoteDocs.filter(cn => {
            const d = toDate(cn.creditNoteDate);
            if (!d) return false;
            if (startDate) { const b = istDayBoundsFromString(startDate); if (b && d < b.start) return false; }
            if (endDate) { const b = istDayBoundsFromString(endDate); if (b && d > b.end) return false; }
            if (vendorId) {
                const linked = gstEntries.find(e => e.orderId === cn.orderId);
                if (!linked) return false;
            }
            return true;
        });

        const creditNoteRows = periodCreditNotes.map(cn => ({
            creditNoteNumber: cn.creditNoteNumber as string,
            creditNoteDate: cn.creditNoteDate as string,
            originalInvoiceNumber: cn.originalInvoiceNumber as string,
            originalInvoiceDate: cn.originalInvoiceDate as string,
            orderId: cn.orderId as string,
            reasonCode: cn.reasonCode as string,
            reason: cn.reason as string,
            scope: cn.scope as string,
            placeOfSupply: cn.placeOfSupply as string,
            taxableValue: r2(cn.totals?.taxableValue || 0),
            cgst: r2(cn.totals?.cgst || 0),
            sgst: r2(cn.totals?.sgst || 0),
            igst: r2(cn.totals?.igst || 0),
            totalTax: r2(cn.totals?.totalTax || 0),
            creditValue: r2(cn.totals?.creditValue || 0),
        })).sort((a, b) => (a.creditNoteNumber < b.creditNoteNumber ? 1 : -1));

        const creditNoteTotals = creditNoteRows.reduce((acc, c) => ({
            count: acc.count + 1,
            taxableValue: r2(acc.taxableValue + c.taxableValue),
            cgst: r2(acc.cgst + c.cgst),
            sgst: r2(acc.sgst + c.sgst),
            igst: r2(acc.igst + c.igst),
            totalTax: r2(acc.totalTax + c.totalTax),
            creditValue: r2(acc.creditValue + c.creditValue),
        }), { count: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, creditValue: 0 });

        const periodDebitNotes = debitNoteDocs.filter(dn => {
            const d = toDate(dn.debitNoteDate);
            if (!d) return false;
            if (startDate) { const b = istDayBoundsFromString(startDate); if (b && d < b.start) return false; }
            if (endDate) { const b = istDayBoundsFromString(endDate); if (b && d > b.end) return false; }
            if (vendorId && dn.vendorId && dn.vendorId !== vendorId) return false;
            return true;
        });

        const debitNoteRows = periodDebitNotes.map(dn => ({
            debitNoteNumber: dn.debitNoteNumber as string,
            debitNoteDate: dn.debitNoteDate as string,
            originalInvoiceNumber: dn.originalInvoiceNumber as string,
            originalInvoiceDate: dn.originalInvoiceDate as string,
            target: dn.target as string,
            vendorId: (dn.vendorId as string) || '',
            billingMonth: (dn.billingMonth as string) || '',
            reasonCode: dn.reasonCode as string,
            reason: dn.reason as string,
            ratePercent: r2(dn.ratePercent || 0),
            taxableValue: r2(dn.totals?.taxableValue || 0),
            cgst: r2(dn.totals?.cgst || 0),
            sgst: r2(dn.totals?.sgst || 0),
            igst: r2(dn.totals?.igst || 0),
            totalTax: r2(dn.totals?.totalTax || 0),
            debitValue: r2(dn.totals?.debitValue || 0),
        })).sort((a, b) => (a.debitNoteNumber < b.debitNoteNumber ? 1 : -1));

        const debitNoteTotals = debitNoteRows.reduce((acc, d) => ({
            count: acc.count + 1,
            taxableValue: r2(acc.taxableValue + d.taxableValue),
            cgst: r2(acc.cgst + d.cgst),
            sgst: r2(acc.sgst + d.sgst),
            igst: r2(acc.igst + d.igst),
            totalTax: r2(acc.totalTax + d.totalTax),
            debitValue: r2(acc.debitValue + d.debitValue),
        }), { count: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, debitValue: 0 });

        // ── GSTR-1 Table 13 — documents issued ──
        //
        // Reported per series, from the serials actually allocated. A row here
        // must be defensible against the counter, so `notIssued` counts orders
        // in the period that carry no document at all — the gap that has to
        // reach zero before the return can be filed.
        const issuedSerials = gstEntries
            .filter(e => e.documentIssued)
            .map(e => e.invoiceNumber)
            .filter(Boolean)
            .sort();
        const creditSerials = creditNoteRows.map(c => c.creditNoteNumber).filter(Boolean).sort();
        const debitSerials = debitNoteRows.map(d => d.debitNoteNumber).filter(Boolean).sort();

        const documentSummary = {
            natureOfDocument: 'Invoices for outward supply',
            from: issuedSerials[0] || '',
            to: issuedSerials[issuedSerials.length - 1] || '',
            totalIssued: issuedSerials.length,
            cancelled: cancelledCount,
            net: issuedSerials.length,
            /** Orders in the period with no tax invoice — cannot be filed yet. */
            notIssued: unbilled.length,
            series: [
                {
                    natureOfDocument: 'Tax invoice (outward supply)',
                    from: issuedSerials[0] || '',
                    to: issuedSerials[issuedSerials.length - 1] || '',
                    totalIssued: issuedSerials.length,
                    cancelled: cancelledCount,
                    net: issuedSerials.length,
                },
                {
                    natureOfDocument: 'Credit note',
                    from: creditSerials[0] || '',
                    to: creditSerials[creditSerials.length - 1] || '',
                    totalIssued: creditSerials.length,
                    cancelled: 0,
                    net: creditSerials.length,
                },
                {
                    natureOfDocument: 'Debit note',
                    from: debitSerials[0] || '',
                    to: debitSerials[debitSerials.length - 1] || '',
                    totalIssued: debitSerials.length,
                    cancelled: 0,
                    net: debitSerials.length,
                },
            ],
        };

        // GSTR-3B Table 3.1(a) — outward taxable supplies (other than zero rated)
        const gstr3b = {
            outwardTaxableSupplies: {
                label: '3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)',
                taxableValue: summary.totalTaxableValue,
                igst: r2(gstEntries.reduce((sum, e) => sum + (e.igst || 0), 0)),
                cgst: summary.totalCgst,
                sgst: summary.totalSgst,
                cess: 0,
            },
            // Debit notes add to the liability declared above.
            debitNotes: {
                label: 'Add: debit notes issued (GSTR-1 Table 9B)',
                taxableValue: debitNoteTotals.taxableValue,
                igst: debitNoteTotals.igst,
                cgst: debitNoteTotals.cgst,
                sgst: debitNoteTotals.sgst,
                cess: 0,
            },
            // Credit notes reduce the liability declared above.
            creditNotes: {
                label: 'Less: credit notes issued (GSTR-1 Table 9B)',
                taxableValue: -creditNoteTotals.taxableValue,
                igst: -creditNoteTotals.igst,
                cgst: -creditNoteTotals.cgst,
                sgst: -creditNoteTotals.sgst,
                cess: 0,
            },
            supplies95: {
                label: 'Supplies u/s 9(5) — tax payable by the e-commerce operator',
                taxableValue: summary.foodTaxable,
                igst: 0,
                cgst: r2(summary.foodTaxable * GST_RATES.CGST / 100),
                sgst: r2(summary.foodTaxable * GST_RATES.SGST / 100),
                cess: 0,
            },
            netTaxPayable: r2(summary.totalGstCollected + debitNoteTotals.totalTax - creditNoteTotals.totalTax),
        };

        const meta = {
            legalName: PLATFORM.legalName,
            tradeName: PLATFORM.name,
            gstin: PLATFORM.gstin,
            address: PLATFORM.address,
            placeOfSupply: PLACE_OF_SUPPLY,
            periodFrom: startDate || (isFinite(earliestTs) ? new Date(earliestTs).toISOString().slice(0, 10) : ''),
            periodTo: endDate || (latestTs > 0 ? new Date(latestTs).toISOString().slice(0, 10) : ''),
            generatedAt: new Date().toISOString(),
            vendorId: vendorId || '',
            basisOfPreparation: 'Accrual — delivered/completed orders only. Values in INR.',
        };

        // ── File export (styled .xlsx by default, CSV on request) ──
        if (format === 'csv' || format === 'xlsx') {
            const periodLabel = `${meta.periodFrom ? formatDay(meta.periodFrom) : 'Beginning'} to ${meta.periodTo ? formatDay(meta.periodTo) : 'Date'}`;
            const commonMeta = platformMeta([
                { label: 'Place of supply', value: PLACE_OF_SUPPLY },
                { label: 'Tax period', value: periodLabel },
                { label: 'Invoices in period', value: `${documentSummary.totalIssued} issued, ${documentSummary.cancelled} cancelled` },
            ]);
            const basis = [
                'Prepared on an accrual basis from delivered/completed orders only.',
                'Invoice discounts reduce the taxable value (sec. 15(3)(a)); post-supply discounts (coins, promo codes, HungerGame rewards) are reported separately and do not.',
                'Figures are system-generated and should be reconciled with the books of account before filing.',
            ];

            let spec: XlsxSheetSpec;

            if (section === 'b2cs') {
                spec = {
                    sheetName: 'GSTR-1 Table 7',
                    title: 'GSTR-1 Table 7 — B2C (Others)',
                    subtitle: 'Rate-wise summary of supplies to unregistered persons',
                    meta: commonMeta,
                    columns: [
                        { header: 'Place of Supply', key: 'pos', width: 22 },
                        { header: 'Rate', key: 'rate', width: 10, type: 'percent' },
                        { header: 'Taxable Value', key: 'taxableValue', width: 16, type: 'currency' },
                        { header: 'IGST', key: 'igst', width: 14, type: 'currency' },
                        { header: 'CGST', key: 'cgst', width: 14, type: 'currency' },
                        { header: 'SGST', key: 'sgst', width: 14, type: 'currency' },
                        { header: 'Invoices', key: 'invoiceCount', width: 11, type: 'number' },
                    ],
                    rows: b2cs.map(b => ({ ...b, pos: PLACE_OF_SUPPLY })),
                    totals: {
                        pos: 'TOTAL',
                        taxableValue: summary.totalTaxableValue,
                        igst: 0,
                        cgst: summary.totalCgst,
                        sgst: summary.totalSgst,
                        invoiceCount: summary.totalOrders,
                    },
                    notes: basis,
                };
            } else if (section === 'hsn') {
                spec = {
                    sheetName: 'GSTR-1 Table 12',
                    title: 'GSTR-1 Table 12 — HSN-wise summary of outward supplies',
                    subtitle: 'Consolidated by HSN/SAC and tax rate',
                    meta: commonMeta,
                    columns: [
                        { header: 'HSN / SAC', key: 'hsn', width: 12 },
                        { header: 'Description', key: 'description', width: 34 },
                        { header: 'UQC', key: 'uqc', width: 8 },
                        { header: 'Quantity', key: 'quantity', width: 11, type: 'number' },
                        { header: 'Rate', key: 'rate', width: 9, type: 'percent' },
                        { header: 'Taxable Value', key: 'taxableValue', width: 16, type: 'currency' },
                        { header: 'IGST', key: 'igst', width: 13, type: 'currency' },
                        { header: 'CGST', key: 'cgst', width: 13, type: 'currency' },
                        { header: 'SGST', key: 'sgst', width: 13, type: 'currency' },
                        { header: 'Total Value', key: 'total', width: 15, type: 'currency' },
                    ],
                    rows: hsnSummary,
                    totals: {
                        hsn: 'TOTAL',
                        taxableValue: summary.totalTaxableValue,
                        igst: 0,
                        cgst: summary.totalCgst,
                        sgst: summary.totalSgst,
                        total: summary.totalInvoiceValue,
                    },
                    notes: basis,
                };
            } else if (section === 'monthly') {
                spec = {
                    sheetName: 'Tax periods',
                    title: 'GST summary by tax period',
                    subtitle: 'Month-wise outward supplies and tax payable',
                    meta: commonMeta,
                    columns: [
                        { header: 'Tax Period', key: 'month', width: 18 },
                        { header: 'Invoices', key: 'ordersCount', width: 10, type: 'number' },
                        { header: 'Gross Sales', key: 'grossSales', width: 15, type: 'currency' },
                        { header: 'Discounts', key: 'totalDiscount', width: 14, type: 'currency' },
                        { header: 'Food Taxable', key: 'foodTaxable', width: 15, type: 'currency' },
                        { header: 'Delivery Taxable', key: 'deliveryTaxable', width: 16, type: 'currency' },
                        { header: 'Platform Fee Taxable', key: 'platformTaxable', width: 18, type: 'currency' },
                        { header: 'Commission Taxable', key: 'commissionTaxable', width: 18, type: 'currency' },
                        { header: 'Total Taxable Value', key: 'taxableValue', width: 18, type: 'currency' },
                        { header: 'CGST', key: 'cgst', width: 13, type: 'currency' },
                        { header: 'SGST', key: 'sgst', width: 13, type: 'currency' },
                        { header: 'Total GST', key: 'totalGst', width: 14, type: 'currency' },
                        { header: 'Invoice Value', key: 'invoiceValue', width: 15, type: 'currency' },
                    ],
                    rows: monthlyData,
                    totals: {
                        month: 'TOTAL',
                        ordersCount: summary.totalOrders,
                        grossSales: summary.grossSales,
                        totalDiscount: summary.totalDiscount,
                        foodTaxable: summary.foodTaxable,
                        deliveryTaxable: summary.deliveryTaxable,
                        platformTaxable: summary.platformTaxable,
                        commissionTaxable: summary.commissionTaxable,
                        taxableValue: summary.totalTaxableValue,
                        cgst: summary.totalCgst,
                        sgst: summary.totalSgst,
                        totalGst: summary.totalGstCollected,
                        invoiceValue: summary.totalInvoiceValue,
                    },
                    notes: basis,
                };
            } else if (section === 'vendor') {
                spec = {
                    sheetName: 'By restaurant',
                    title: 'GST summary by restaurant',
                    subtitle: 'Supplier-wise outward supplies and commission',
                    meta: commonMeta,
                    columns: [
                        { header: 'Restaurant', key: 'vendorName', width: 28 },
                        { header: 'GSTIN', key: 'gstinLabel', width: 20 },
                        { header: 'Invoices', key: 'ordersCount', width: 10, type: 'number' },
                        { header: 'Gross Sales', key: 'grossSales', width: 15, type: 'currency' },
                        { header: 'Discounts', key: 'totalDiscount', width: 14, type: 'currency' },
                        { header: 'Food Taxable', key: 'foodTaxable', width: 15, type: 'currency' },
                        { header: 'Delivery Taxable', key: 'deliveryTaxable', width: 16, type: 'currency' },
                        { header: 'Commission', key: 'commissionTaxable', width: 14, type: 'currency' },
                        { header: 'Total Taxable Value', key: 'taxableValue', width: 18, type: 'currency' },
                        { header: 'CGST', key: 'cgst', width: 13, type: 'currency' },
                        { header: 'SGST', key: 'sgst', width: 13, type: 'currency' },
                        { header: 'Total GST', key: 'totalGst', width: 14, type: 'currency' },
                    ],
                    rows: vendorData.map(v => ({ ...v, gstinLabel: v.gstin || 'Unregistered' })),
                    totals: {
                        vendorName: 'TOTAL',
                        ordersCount: summary.totalOrders,
                        grossSales: summary.grossSales,
                        totalDiscount: summary.totalDiscount,
                        foodTaxable: summary.foodTaxable,
                        deliveryTaxable: summary.deliveryTaxable,
                        commissionTaxable: summary.commissionTaxable,
                        taxableValue: summary.totalTaxableValue,
                        cgst: summary.totalCgst,
                        sgst: summary.totalSgst,
                        totalGst: summary.totalGstCollected,
                    },
                    notes: basis,
                };
            } else {
                spec = {
                    sheetName: 'Invoice register',
                    title: 'Invoice-wise outward supply register',
                    subtitle: 'Every tax invoice issued in the period, with its taxable value and tax',
                    meta: commonMeta,
                    columns: [
                        { header: 'Invoice No.', key: 'invoiceNumber', width: 20 },
                        { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
                        { header: 'Order ID', key: 'orderId', width: 24 },
                        { header: 'Restaurant', key: 'vendorName', width: 26 },
                        { header: 'Place of Supply', key: 'placeOfSupply', width: 18 },
                        { header: 'Payment Mode', key: 'paymentMode', width: 14 },
                        { header: 'Gross Item Total', key: 'grossItemTotal', width: 16, type: 'currency' },
                        { header: 'Item Discount', key: 'itemDiscount', width: 14, type: 'currency' },
                        { header: 'Post-supply Discount', key: 'postSupplyDiscount', width: 18, type: 'currency' },
                        { header: 'Total Discount', key: 'totalDiscount', width: 15, type: 'currency' },
                        { header: 'Food Taxable (5%)', key: 'foodTaxable', width: 16, type: 'currency' },
                        { header: 'Delivery Taxable (18%)', key: 'deliveryTaxable', width: 18, type: 'currency' },
                        { header: 'Platform Fee Taxable (18%)', key: 'platformTaxable', width: 20, type: 'currency' },
                        { header: 'Commission Taxable (18%)', key: 'commissionTaxable', width: 20, type: 'currency' },
                        { header: 'Total Taxable Value', key: 'taxableValue', width: 18, type: 'currency' },
                        { header: 'CGST', key: 'cgst', width: 13, type: 'currency' },
                        { header: 'SGST', key: 'sgst', width: 13, type: 'currency' },
                        { header: 'IGST', key: 'igst', width: 13, type: 'currency' },
                        { header: 'Total GST', key: 'totalGst', width: 14, type: 'currency' },
                        { header: 'Invoice Value', key: 'invoiceValue', width: 15, type: 'currency' },
                    ],
                    rows: gstEntries.map(e => ({ ...e, invoiceDate: formatDay(e.orderDate) })),
                    totals: {
                        invoiceNumber: 'TOTAL',
                        grossItemTotal: summary.grossSales,
                        itemDiscount: summary.totalItemDiscount,
                        postSupplyDiscount: summary.totalPostSupplyDiscount,
                        totalDiscount: summary.totalDiscount,
                        foodTaxable: summary.foodTaxable,
                        deliveryTaxable: summary.deliveryTaxable,
                        platformTaxable: summary.platformTaxable,
                        commissionTaxable: summary.commissionTaxable,
                        taxableValue: summary.totalTaxableValue,
                        cgst: summary.totalCgst,
                        sgst: summary.totalSgst,
                        igst: 0,
                        totalGst: summary.totalGstCollected,
                        invoiceValue: summary.totalInvoiceValue,
                    },
                    notes: basis,
                };
            }

            return reportResponse(
                spec,
                `GST-${section}-${meta.periodFrom || 'all'}_${meta.periodTo || 'date'}`,
                format
            );
        }

        return NextResponse.json({
            success: true,
            data: {
                meta,
                summary,
                b2cs,
                hsnSummary,
                documentSummary,
                gstr3b,
                creditNotes: creditNoteRows,
                creditNoteTotals,
                debitNotes: debitNoteRows,
                debitNoteTotals,
                /** Delivered orders in the period with no tax invoice issued.
                 *  Each one is a row the return cannot yet account for. */
                unbilled: unbilled.slice(0, 500),
                unbilledCount: unbilled.length,
                monthlyData,
                vendorData,
                entries: gstEntries.slice(0, 500),
                entriesTruncated: gstEntries.length > 500,
            },
        });
    } catch (error) {
        console.error('GST report fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch GST report' },
            { status: 500 }
        );
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
