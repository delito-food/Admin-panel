import { NextResponse } from 'next/server';
import { collections, cachedCollection } from '@/lib/firebase-admin';
import { PLATFORM, GST_RATES, HSN_CODES } from '@/lib/invoice-constants';
import { getInvoiceNumberMap, invoiceNumberFor } from '@/lib/invoice-lookup';

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

function csvEscape(v: unknown): string {
    return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
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

        const addB2CS = (rate: number, taxable: number, cgst: number, sgst: number) => {
            if (taxable <= 0) return;
            const key = String(rate);
            if (!b2csBuckets[key]) {
                b2csBuckets[key] = { rate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, invoiceCount: 0 };
            }
            b2csBuckets[key].taxableValue += taxable;
            b2csBuckets[key].cgst += cgst;
            b2csBuckets[key].sgst += sgst;
            b2csBuckets[key].invoiceCount += 1;
        };

        const addHSN = (
            hsn: string, description: string, uqc: string, quantity: number,
            rate: number, taxable: number, cgst: number, sgst: number
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
            b.total += taxable + cgst + sgst;
        };

        let earliestTs = Number.POSITIVE_INFINITY;
        let latestTs = 0;
        let cancelledCount = 0;

        orderDocs.forEach(order => {
            const status = ((order.status as string) || '').toLowerCase();
            const isCancelled = status === 'cancelled' || status === 'canceled';

            const orderDate = order.deliveredAt?.toDate?.() || order.createdAt?.toDate?.() || order.createdAt;
            if (!orderDate) return;
            const dateObj = orderDate instanceof Date ? orderDate : new Date(orderDate);
            if (isNaN(dateObj.getTime())) return;

            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                if (dateObj < start) return;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                if (dateObj > end) return;
            }
            if (vendorId && order.vendorId !== vendorId) return;

            // Cancelled orders are counted in the document summary only
            if (isCancelled) { cancelledCount++; return; }
            if (status !== 'delivered' && status !== 'completed') return;

            const orderVendorId = (order.vendorId as string) || '';
            const orderVendorName = vendorMap[orderVendorId] || (order.vendorName as string) || 'Unknown';

            // ── Values ──
            const itemTotal = (order.itemTotal ?? order.subtotal ?? 0) as number;
            const originalItemTotal = (order.originalItemTotal as number) || itemTotal;

            // Item-level discount computed from the lines, with the order-level
            // originalItemTotal as a fallback (older orders only carry one of them).
            const lineDiscount = ((order.items as any[]) || []).reduce((sum: number, it: any) => {
                const qty = it?.quantity || 1;
                const price = it?.price || 0;
                const original = it?.originalPrice ?? price;
                return sum + Math.max(0, (original - price) * qty);
            }, 0);
            const itemDiscount = Math.max(lineDiscount, Math.max(0, originalItemTotal - itemTotal));
            const grossItemTotal = itemTotal + itemDiscount;

            // Post-supply discounts — do NOT reduce the taxable value (sec 15(3)(b))
            const hgDeliveryDiscount = (order.hungerGameLevel2DeliveryDiscount as number) || 0;
            const hgComponents = ((order.hungerGameLevel1Discount as number) || 0)
                + ((order.hungerGameCouponDiscount as number) || 0)
                + ((order.hungerGameLevel5Savings as number) || 0);
            const hungerGameDiscount = hgComponents > 0
                ? hgComponents
                : Math.max(0, ((order.hungerGameDiscount as number) || 0) - hgDeliveryDiscount);
            const deliveryDiscount = ((order.deliveryDiscount ?? order.discount ?? 0) as number) + hgDeliveryDiscount;
            const postSupplyDiscount = hungerGameDiscount
                + ((order.coinDiscount as number) || 0)
                + ((order.promoDiscount as number) || 0)
                + deliveryDiscount;

            const deliveryFee = (order.deliveryFee as number) || 0;
            const platformFee = (order.smallOrderSupportFee as number) || 0;

            // ── Tax ──
            // Prefer the amounts actually charged by the app; fall back to rates.
            const storedGstOnFood = (order.gstOnFood as number) || 0;
            const foodGst = storedGstOnFood > 0 ? storedGstOnFood : r2(itemTotal * GST_ON_FOOD);
            const serviceBase = deliveryFee + platformFee;
            const storedGstOnServices = (order.gstOnServices as number) || 0;
            const servicesGst = storedGstOnServices > 0 ? storedGstOnServices : r2(serviceBase * GST_ON_SERVICES);
            const deliveryGst = serviceBase > 0 ? r2(servicesGst * deliveryFee / serviceBase) : 0;
            const platformGst = r2(servicesGst - deliveryGst);

            const commission = (order.vendorPlatformCut as number) > 0
                ? (order.vendorPlatformCut as number)
                : r2(originalItemTotal * DEFAULT_COMMISSION_RATE);
            const gstOnCommission = (order.vendorGstOnPlatformCut as number) > 0
                ? (order.vendorGstOnPlatformCut as number)
                : r2(commission * GST_ON_COMMISSION);

            const half = (n: number) => r2(n / 2);
            const foodCgst = half(foodGst), foodSgst = r2(foodGst - foodCgst);
            const delCgst = half(deliveryGst), delSgst = r2(deliveryGst - delCgst);
            const pfCgst = half(platformGst), pfSgst = r2(platformGst - pfCgst);
            const comCgst = half(gstOnCommission), comSgst = r2(gstOnCommission - comCgst);

            const taxableValue = r2(itemTotal + deliveryFee + platformFee + commission);
            const cgst = r2(foodCgst + delCgst + pfCgst + comCgst);
            const sgst = r2(foodSgst + delSgst + pfSgst + comSgst);
            const totalGst = r2(cgst + sgst);
            const invoiceValue = r2(taxableValue + totalGst);

            // ── GSTR-1 buckets ──
            addB2CS(GST_RATES.IGST, itemTotal, foodCgst, foodSgst);                    // 5%
            addB2CS(18, deliveryFee + platformFee + commission,
                r2(delCgst + pfCgst + comCgst), r2(delSgst + pfSgst + comSgst));       // 18%

            const itemQty = ((order.items as any[]) || [])
                .reduce((s: number, it: any) => s + (it?.quantity || 0), 0);
            addHSN(HSN_CODES.FOOD, 'Restaurant service (food supply)', 'NOS', itemQty, 5, itemTotal, foodCgst, foodSgst);
            addHSN(HSN_CODES.DELIVERY, 'Courier / delivery service', 'NOS', deliveryFee > 0 ? 1 : 0, 18, deliveryFee, delCgst, delSgst);
            addHSN(HSN_CODES.PLATFORM, 'Platform / convenience fee', 'NOS', platformFee > 0 ? 1 : 0, 18, platformFee, pfCgst, pfSgst);
            addHSN('998399', 'Commission on restaurant sales', 'NOS', commission > 0 ? 1 : 0, 18, commission, comCgst, comSgst);

            earliestTs = Math.min(earliestTs, dateObj.getTime());
            latestTs = Math.max(latestTs, dateObj.getTime());

            const entry: GSTEntry = {
                invoiceNumber: invoiceNumberFor(invoiceNumbers, order.id),
                orderId: order.id,
                vendorId: orderVendorId,
                vendorName: orderVendorName,
                orderDate: dateObj.toISOString(),
                placeOfSupply: PLACE_OF_SUPPLY,
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
                igst: 0,
                totalGst,
                invoiceValue,
                commission: r2(commission),
                gstOnCommission: r2(gstOnCommission),
                totalPlatformEarning: r2(commission + gstOnCommission),
                paymentMode: (order.paymentMode as string) || 'Unknown',
            };
            gstEntries.push(entry);

            // ── Tax period aggregation ──
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
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

        const documentSummary = {
            natureOfDocument: 'Invoices for outward supply',
            from: gstEntries.length ? gstEntries[gstEntries.length - 1].invoiceNumber : '',
            to: gstEntries.length ? gstEntries[0].invoiceNumber : '',
            totalIssued: gstEntries.length,
            cancelled: cancelledCount,
            net: gstEntries.length,
        };

        // GSTR-3B Table 3.1(a) — outward taxable supplies (other than zero rated)
        const gstr3b = {
            outwardTaxableSupplies: {
                label: '3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)',
                taxableValue: summary.totalTaxableValue,
                igst: 0,
                cgst: summary.totalCgst,
                sgst: summary.totalSgst,
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
            netTaxPayable: summary.totalGstCollected,
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

        // ── CSV export (per section, Excel-friendly) ──
        if (format === 'csv') {
            const lines: string[] = [];
            const head = (title: string) => {
                lines.push(csvEscape(`${PLATFORM.legalName} — ${title}`));
                lines.push(`${csvEscape('GSTIN')},${csvEscape(meta.gstin)}`);
                lines.push(`${csvEscape('Period')},${csvEscape(`${meta.periodFrom || 'Beginning'} to ${meta.periodTo || 'Date'}`)}`);
                lines.push(`${csvEscape('Place of supply')},${csvEscape(meta.placeOfSupply)}`);
                lines.push('');
            };

            if (section === 'b2cs') {
                head('GSTR-1 Table 7 — B2C (Others)');
                lines.push(['Place of Supply', 'Rate (%)', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Invoices'].map(csvEscape).join(','));
                b2cs.forEach(b => lines.push([
                    csvEscape(PLACE_OF_SUPPLY), b.rate, b.taxableValue.toFixed(2), b.igst.toFixed(2),
                    b.cgst.toFixed(2), b.sgst.toFixed(2), b.invoiceCount,
                ].join(',')));
            } else if (section === 'hsn') {
                head('GSTR-1 Table 12 — HSN-wise summary of outward supplies');
                lines.push(['HSN', 'Description', 'UQC', 'Quantity', 'Rate (%)', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total Value'].map(csvEscape).join(','));
                hsnSummary.forEach(h => lines.push([
                    csvEscape(h.hsn), csvEscape(h.description), csvEscape(h.uqc), h.quantity,
                    h.rate, h.taxableValue.toFixed(2), h.igst.toFixed(2), h.cgst.toFixed(2),
                    h.sgst.toFixed(2), h.total.toFixed(2),
                ].join(',')));
            } else if (section === 'monthly') {
                head('Tax period summary');
                lines.push(['Tax Period', 'Invoices', 'Gross Sales', 'Discounts', 'Food Taxable', 'Delivery Taxable', 'Platform Fee Taxable', 'Commission Taxable', 'Total Taxable Value', 'CGST', 'SGST', 'Total GST', 'Invoice Value'].map(csvEscape).join(','));
                monthlyData.forEach(m => lines.push([
                    csvEscape(m.month), m.ordersCount, m.grossSales.toFixed(2), m.totalDiscount.toFixed(2),
                    m.foodTaxable.toFixed(2), m.deliveryTaxable.toFixed(2), m.platformTaxable.toFixed(2),
                    m.commissionTaxable.toFixed(2), m.taxableValue.toFixed(2), m.cgst.toFixed(2),
                    m.sgst.toFixed(2), m.totalGst.toFixed(2), m.invoiceValue.toFixed(2),
                ].join(',')));
            } else if (section === 'vendor') {
                head('Supplier-wise summary');
                lines.push(['Restaurant', 'GSTIN', 'Invoices', 'Gross Sales', 'Discounts', 'Food Taxable', 'Delivery Taxable', 'Commission', 'Total Taxable Value', 'CGST', 'SGST', 'Total GST'].map(csvEscape).join(','));
                vendorData.forEach(v => lines.push([
                    csvEscape(v.vendorName), csvEscape(v.gstin || 'Unregistered'), v.ordersCount,
                    v.grossSales.toFixed(2), v.totalDiscount.toFixed(2), v.foodTaxable.toFixed(2),
                    v.deliveryTaxable.toFixed(2), v.commissionTaxable.toFixed(2), v.taxableValue.toFixed(2),
                    v.cgst.toFixed(2), v.sgst.toFixed(2), v.totalGst.toFixed(2),
                ].join(',')));
            } else {
                head('Invoice-wise outward supply register');
                lines.push([
                    'Invoice No.', 'Invoice Date', 'Order ID', 'Restaurant', 'Place of Supply', 'Payment Mode',
                    'Gross Item Total', 'Item Discount', 'Post-supply Discount', 'Total Discount',
                    'Food Taxable (5%)', 'Delivery Taxable (18%)', 'Platform Fee Taxable (18%)',
                    'Commission Taxable (18%)', 'Total Taxable Value', 'CGST', 'SGST', 'IGST',
                    'Total GST', 'Invoice Value',
                ].map(csvEscape).join(','));
                gstEntries.forEach(e => lines.push([
                    csvEscape(e.invoiceNumber),
                    csvEscape(new Date(e.orderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })),
                    csvEscape(e.orderId), csvEscape(e.vendorName), csvEscape(e.placeOfSupply), csvEscape(e.paymentMode),
                    e.grossItemTotal.toFixed(2), e.itemDiscount.toFixed(2), e.postSupplyDiscount.toFixed(2), e.totalDiscount.toFixed(2),
                    e.foodTaxable.toFixed(2), e.deliveryTaxable.toFixed(2), e.platformTaxable.toFixed(2),
                    e.commissionTaxable.toFixed(2), e.taxableValue.toFixed(2), e.cgst.toFixed(2),
                    e.sgst.toFixed(2), e.igst.toFixed(2), e.totalGst.toFixed(2), e.invoiceValue.toFixed(2),
                ].join(',')));
                lines.push('');
                lines.push([
                    csvEscape('TOTAL'), '', '', '', '', '',
                    summary.grossSales.toFixed(2), summary.totalItemDiscount.toFixed(2),
                    summary.totalPostSupplyDiscount.toFixed(2), summary.totalDiscount.toFixed(2),
                    summary.foodTaxable.toFixed(2), summary.deliveryTaxable.toFixed(2),
                    summary.platformTaxable.toFixed(2), summary.commissionTaxable.toFixed(2),
                    summary.totalTaxableValue.toFixed(2), summary.totalCgst.toFixed(2),
                    summary.totalSgst.toFixed(2), '0.00', summary.totalGstCollected.toFixed(2),
                    summary.totalInvoiceValue.toFixed(2),
                ].join(','));
            }

            const filename = `GST-${section}-${meta.periodFrom || 'all'}_${meta.periodTo || 'date'}.csv`;
            return new Response('﻿' + lines.join('\n'), {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                },
            });
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
