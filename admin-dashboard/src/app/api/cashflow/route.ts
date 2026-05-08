import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';

/**
 * Cashflow API — Unified financial overview
 *
 * Money IN (platform perspective):
 *  - Online payments from customers (Razorpay)
 *  - COD collections from delivery partners (settled)
 *  - Platform commission (15% of food subtotal)
 *  - Delivery fees collected from customers
 *  - GST collected on commission
 *  - Small order fees
 *  - Tips (pass-through but flows through platform)
 *
 * Money OUT:
 *  - Vendor payouts (85% of food subtotal)
 *  - Delivery partner payouts (₹10 base + ₹6.5/km)
 *  - Delivery partner tips (pass-through)
 *  - Refunds to customers
 *  - COD pending (money held by delivery partners)
 *
 * Net = Commission earned - GST paid - delivery subsidy
 */

interface CashflowPeriod {
    label: string;
    startDate: Date;
    endDate: Date;
}

function getPeriods(): CashflowPeriod[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);

    return [
        { label: 'today', startDate: today, endDate: now },
        { label: 'yesterday', startDate: yesterday, endDate: today },
        { label: 'thisWeek', startDate: weekStart, endDate: now },
        { label: 'thisMonth', startDate: monthStart, endDate: now },
        { label: 'lastMonth', startDate: lastMonthStart, endDate: lastMonthEnd },
    ];
}

export async function GET() {
    try {
        // Use cached collections (60s TTL) to reduce Firestore reads
        const orderDocs = await cachedCollection(collections.orders);

        // Fetch COD settlements (small collection, no cache needed)
        const settlementsSnapshot = await db.collection('codSettlements')
            .orderBy('createdAt', 'desc')
            .limit(500)
            .get()
            .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

        // Fetch delivery partners (cached)
        const deliveryDocs = await cachedCollection(collections.deliveryPersons);

        const periods = getPeriods();

        // Helper to get Date from Firestore data
        const toDate = (v: any): Date | null => {
            if (!v) return null;
            if (v.toDate) return v.toDate();
            if (v._seconds) return new Date(v._seconds * 1000);
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d;
        };

        // Parse all orders into a uniform structure
        interface ParsedOrder {
            orderId: string;
            date: Date;
            status: string;
            paymentMode: string;
            subtotal: number;
            originalItemTotal: number;
            deliveryFee: number;
            taxes: number;
            gstOnFood: number;
            gstOnServices: number;
            tip: number;
            smallOrderFee: number;
            discount: number;
            total: number;
            distanceKm: number;
            deliveryPersonEarnings: number;
            vendorEarning: number;
            vendorPlatformCut: number;
            vendorGstOnPlatformCut: number;
            refundAmount: number;
            refundStatus: string;
            codSettled: boolean;
        }

        const allOrders: ParsedOrder[] = [];
        orderDocs.forEach(d => {
            const date = toDate(d.createdAt);
            if (!date) return;
            // Cast Firestore untyped fields
            const o = d as Record<string, any>;
            allOrders.push({
                orderId: o.id || '',
                date,
                status: String(o.status || '').toLowerCase(),
                paymentMode: String(o.paymentMode || '').toLowerCase(),
                subtotal: Number(o.subtotal || o.itemTotal || 0),
                originalItemTotal: Number(o.originalItemTotal || o.itemTotal || o.subtotal || 0),
                deliveryFee: Number(o.deliveryFee || 0),
                taxes: Number(o.taxes || 0),
                gstOnFood: Number(o.gstOnFood || 0),
                gstOnServices: Number(o.gstOnServices || 0),
                tip: Number(o.tip || 0),
                smallOrderFee: Number(o.smallOrderSupportFee || 0),
                discount: Number(o.discount || 0),
                total: Number(o.total || 0),
                distanceKm: Number(o.distanceKm || 0),
                deliveryPersonEarnings: Number(o.deliveryPersonEarnings || 0),
                vendorEarning: Number(o.vendorEarning || 0),
                vendorPlatformCut: Number(o.vendorPlatformCut || 0),
                vendorGstOnPlatformCut: Number(o.vendorGstOnPlatformCut || 0),
                refundAmount: Number(o.refundAmount || 0),
                refundStatus: String(o.refundStatus || ''),
                codSettled: o.codSettled === true,
            });
        });

        // Parse settlements
        interface ParsedSettlement {
            date: Date;
            amount: number;
            method: string;
            status: string;
            processedBy: string;
        }
        const allSettlements: ParsedSettlement[] = [];
        settlementsSnapshot.docs.forEach(doc => {
            const s = doc.data();
            const date = toDate(s.createdAt);
            if (!date) return;
            allSettlements.push({
                date,
                amount: s.amount || 0,
                method: s.method || 'Cash',
                status: s.status || 'completed',
                processedBy: s.processedBy || 'admin',
            });
        });

        // Compute cashflow for each period + all-time
        function computeCashflow(orders: ParsedOrder[], settlements: ParsedSettlement[]) {
            const delivered = orders.filter(o => o.status === 'delivered' || o.status === 'completed');
            const cancelled = orders.filter(o => o.status === 'cancelled' || o.status === 'not responded' || o.status === 'declined');
            const isCod = (pm: string) => pm.includes('cod') || pm.includes('cash');

            // INFLOW
            const totalRevenue = delivered.reduce((s, o) => s + o.total, 0);
            const onlineOrders = delivered.filter(o => !isCod(o.paymentMode));
            const codOrders = delivered.filter(o => isCod(o.paymentMode));
            const onlinePayments = onlineOrders.reduce((s, o) => s + o.total, 0);
            const codCollected = codOrders.reduce((s, o) => s + o.total, 0);
            const codSettledAmount = settlements.filter(s => s.status === 'completed').reduce((s, r) => s + r.amount, 0);
            const subtotalSum = delivered.reduce((s, o) => s + o.subtotal, 0);
            // Commission: use stored vendorPlatformCut when available (respects custom rates),
            // fall back to 15% calculation for old orders
            const commission = delivered.reduce((s, o) => {
                if (o.vendorPlatformCut > 0) return s + o.vendorPlatformCut;
                const commBase = o.originalItemTotal || o.subtotal;
                return s + Math.round(commBase * 0.15 * 10) / 10;
            }, 0);
            const gstOnCommission = delivered.reduce((s, o) => {
                if (o.vendorGstOnPlatformCut > 0) return s + o.vendorGstOnPlatformCut;
                const commBase = o.originalItemTotal || o.subtotal;
                const comm = Math.round(commBase * 0.15 * 10) / 10;
                return s + Math.round(comm * 0.18 * 10) / 10;
            }, 0);
            const deliveryFeesCollected = delivered.reduce((s, o) => s + o.deliveryFee, 0);
            const tipsCollected = delivered.reduce((s, o) => s + o.tip, 0);
            const smallOrderFees = delivered.reduce((s, o) => s + o.smallOrderFee, 0);

            // OUTFLOW
            // Vendor gets: subtotal - commission - GST on commission
            const vendorPayouts = delivered.reduce((s, o) => {
                // Use stored vendorEarning if available, else calculate
                if (o.vendorEarning > 0) return s + o.vendorEarning;
                const comm = o.vendorPlatformCut > 0 ? o.vendorPlatformCut : Math.round((o.originalItemTotal || o.subtotal) * 0.15 * 10) / 10;
                const gst = o.vendorGstOnPlatformCut > 0 ? o.vendorGstOnPlatformCut : Math.round(comm * 0.18 * 10) / 10;
                return s + Math.round((o.subtotal - comm - gst) * 10) / 10;
            }, 0);
            const deliveryPartnerPayouts = delivered.reduce((s, o) => {
                const payout = o.deliveryPersonEarnings || (o.distanceKm > 0 ? Math.max(15, Math.round((10 + o.distanceKm * 6.5) * 10) / 10) : 15);
                return s + payout;
            }, 0);
            const tipPayouts = tipsCollected; // Tips go to delivery partners
            const refundsIssued = orders.reduce((s, o) => s + o.refundAmount, 0);
            const codPending = codCollected - codSettledAmount;

            // Delivery fee P&L
            const deliveryFeeProfit = deliveryFeesCollected - deliveryPartnerPayouts;

            // GST collected from customers (to be remitted to government)
            // Use stored gstOnFood & gstOnServices if available; fallback calculates both
            const gstOnFood = delivered.reduce((s, o) => {
                if (o.gstOnFood > 0) return s + o.gstOnFood;
                if (o.taxes > 0) return s + o.taxes;
                return s + (o.subtotal * 0.05); // 5% GST on food
            }, 0);
            const gstOnDeliveryServices = delivered.reduce((s, o) => {
                if (o.gstOnServices > 0) return s + o.gstOnServices;
                return s + (o.deliveryFee * 0.18); // 18% GST on services
            }, 0);
            const totalGstCollectedFromCustomer = Math.round((gstOnFood + gstOnDeliveryServices) * 100) / 100;

            // Platform net income = Commission earned - GST on commission (remitted to govt) + delivery fee P&L + small order fees
            // GST collected from customers is a pass-through to govt, NOT platform income
            const platformNet = commission - gstOnCommission + deliveryFeeProfit + smallOrderFees;

            // Total outflow = vendor payouts + delivery payouts + GST on commission + tips + refunds
            // Note: Customer-facing GST (food 5% + services 18%) is a pass-through and is
            // already accounted for within vendor payouts and delivery fee calculations.
            // Only gstOnCommission is the platform's own tax liability.
            const totalOutflow = vendorPayouts + deliveryPartnerPayouts + gstOnCommission + tipPayouts + refundsIssued;

            return {
                totalOrders: orders.length,
                deliveredOrders: delivered.length,
                cancelledOrders: cancelled.length,
                // Revenue
                totalRevenue: Math.round(totalRevenue),
                onlinePayments: Math.round(onlinePayments),
                codCollected: Math.round(codCollected),
                codSettled: Math.round(codSettledAmount),
                codPending: Math.round(Math.max(0, codPending)),
                // Food subtotal (for reference)
                subtotalSum: Math.round(subtotalSum),
                // Platform income
                commission: Math.round(commission),
                gstOnCommission: Math.round(gstOnCommission),
                deliveryFeesCollected: Math.round(deliveryFeesCollected),
                smallOrderFees: Math.round(smallOrderFees),
                tipsCollected: Math.round(tipsCollected),
                // Outflows
                vendorPayouts: Math.round(vendorPayouts),
                deliveryPartnerPayouts: Math.round(deliveryPartnerPayouts),
                tipPayouts: Math.round(tipPayouts),
                refundsIssued: Math.round(refundsIssued),
                totalOutflow: Math.round(totalOutflow),
                // Net
                deliveryFeeProfit: Math.round(deliveryFeeProfit),
                platformNet: Math.round(platformNet),
                // Discount
                totalDiscount: Math.round(delivered.reduce((s, o) => s + o.discount, 0)),
                // Payment mode split per period
                paymentModeSplit: {
                    online: { count: onlineOrders.length, revenue: Math.round(onlinePayments) },
                    cod: { count: codOrders.length, revenue: Math.round(codCollected) },
                },
            };
        }

        // Compute by period
        const periodData: Record<string, ReturnType<typeof computeCashflow>> = {};
        for (const period of periods) {
            const filteredOrders = allOrders.filter(o => o.date >= period.startDate && o.date < period.endDate);
            const filteredSettlements = allSettlements.filter(s => s.date >= period.startDate && s.date < period.endDate);
            periodData[period.label] = computeCashflow(filteredOrders, filteredSettlements);
        }
        // All time
        periodData['allTime'] = computeCashflow(allOrders, allSettlements);

        // Daily trend (last 14 days)
        const dailyTrend: Array<{
            date: string;
            revenue: number;
            commission: number;
            vendorPayout: number;
            deliveryPayout: number;
            platformNet: number;
            orders: number;
        }> = [];

        for (let i = 13; i >= 0; i--) {
            const dayStart = new Date();
            dayStart.setDate(dayStart.getDate() - i);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);

            const dayOrders = allOrders.filter(o => o.date >= dayStart && o.date <= dayEnd);
            const delivered = dayOrders.filter(o => o.status === 'delivered' || o.status === 'completed');
            const subtotal = delivered.reduce((s, o) => s + o.subtotal, 0);
            const comm = delivered.reduce((s, o) => {
                if (o.vendorPlatformCut > 0) return s + o.vendorPlatformCut;
                return s + Math.round(o.subtotal * 0.15 * 10) / 10;
            }, 0);
            const delFees = delivered.reduce((s, o) => s + o.deliveryFee, 0);
            const delPayouts = delivered.reduce((s, o) => {
                return s + (o.deliveryPersonEarnings || (o.distanceKm > 0 ? Math.max(15, Math.round((10 + o.distanceKm * 6.5) * 10) / 10) : 15));
            }, 0);
            const vPay = delivered.reduce((s, o) => {
                if (o.vendorEarning > 0) return s + o.vendorEarning;
                const c = o.vendorPlatformCut > 0 ? o.vendorPlatformCut : Math.round(o.subtotal * 0.15 * 10) / 10;
                const g = o.vendorGstOnPlatformCut > 0 ? o.vendorGstOnPlatformCut : Math.round(c * 0.18 * 10) / 10;
                return s + Math.round((o.subtotal - c - g) * 10) / 10;
            }, 0);
            const smallFee = delivered.reduce((s, o) => s + o.smallOrderFee, 0);

            const commGst = delivered.reduce((s, o) => {
                if (o.vendorGstOnPlatformCut > 0) return s + o.vendorGstOnPlatformCut;
                const c = o.vendorPlatformCut > 0 ? o.vendorPlatformCut : Math.round(o.subtotal * 0.15 * 10) / 10;
                return s + Math.round(c * 0.18 * 10) / 10;
            }, 0);

            dailyTrend.push({
                date: dayStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                revenue: Math.round(delivered.reduce((s, o) => s + o.total, 0)),
                commission: comm,
                vendorPayout: Math.round(vPay),
                deliveryPayout: delPayouts,
                platformNet: comm - commGst + (delFees - delPayouts) + smallFee,
                orders: delivered.length,
            });
        }

        return NextResponse.json({
            success: true,
            data: {
                periods: periodData,
                dailyTrend,
            },
        });
    } catch (error) {

        console.error('Cashflow fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch cashflow data' },
            { status: 500 }
        );
    }
}

