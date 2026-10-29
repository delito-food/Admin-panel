import { NextResponse } from 'next/server';
import { collections, countDocuments, cachedCollection, cachedQuery } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { istTodayBounds, istDaysAgoStart, istCurrentMonthBounds, IST_OFFSET_MS } from '@/lib/fiscal';

import { calcOrderBreakdown } from '@/lib/order-breakdown';
import { loadFulfilledMarks, isFulfilledOrder } from '@/lib/fulfilled-marks';

/** The IST calendar day of an instant, as "YYYY-MM-DD". */
const istDayKey = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

type PeriodAccumulator = {
    gmv: number;
    subtotal: number;
    customerDeliveryFees: number;  // collected from customers
    partnerDeliveryPayouts: number; // paid to partners
    deliveryFeeProfit: number;     // net delivery (may be negative)
    commission: number;            // ex-GST
    gstOnCommission: number;       // collected from vendors, remitted
    platformCommissionEarning: number; // commission + GST, as billed to vendors
    platformFees: number;          // platform / small-order / COD fees (ex-GST)
    delitoFundedDiscounts: number; // promo, coins, HungerGame, Delito share of offers (ex-GST)
    customerGst: number;           // GST on customer bills, remitted
    tips: number;                  // passed to riders
    otherAdjustments: number;      // rounding / unexplained
    refunds: number;               // refunded or waived on these orders (not netted)
    netPlatformEarning: number;    // Delito's real earning
    vendorPayout: number;
    orderCount: number;
    markedFulfilledCount: number;  // of orderCount, counted via admin marker
};

function emptyAccum(): PeriodAccumulator {
    return {
        gmv: 0, subtotal: 0, customerDeliveryFees: 0, partnerDeliveryPayouts: 0,
        deliveryFeeProfit: 0, commission: 0, gstOnCommission: 0,
        platformCommissionEarning: 0, platformFees: 0, delitoFundedDiscounts: 0,
        customerGst: 0, tips: 0, otherAdjustments: 0, refunds: 0,
        netPlatformEarning: 0, vendorPayout: 0, orderCount: 0, markedFulfilledCount: 0,
    };
}

function addToAccum(acc: PeriodAccumulator, b: ReturnType<typeof calcOrderBreakdown>, marked: boolean) {
    acc.gmv += b.gmv;
    acc.subtotal += b.subtotal;
    acc.customerDeliveryFees += b.customerDeliveryFee;
    acc.partnerDeliveryPayouts += b.partnerDeliveryPayout;
    acc.deliveryFeeProfit += b.deliveryFeeProfit;
    acc.commission += b.commission;
    acc.gstOnCommission += b.gstOnCommission;
    acc.platformCommissionEarning += b.platformCommissionEarning;
    acc.platformFees += b.platformFees;
    acc.delitoFundedDiscounts += b.delitoFundedDiscounts;
    acc.customerGst += b.customerGst;
    acc.tips += b.tip;
    acc.otherAdjustments += b.otherAdjustments;
    acc.refunds += b.refunded;
    acc.netPlatformEarning += b.netPlatformEarning;
    acc.vendorPayout += b.vendorPayout;
    acc.orderCount += 1;
    if (marked) acc.markedFulfilledCount += 1;
}

function roundAccum(acc: PeriodAccumulator): PeriodAccumulator {
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
        gmv: r(acc.gmv),
        subtotal: r(acc.subtotal),
        customerDeliveryFees: r(acc.customerDeliveryFees),
        partnerDeliveryPayouts: r(acc.partnerDeliveryPayouts),
        deliveryFeeProfit: r(acc.deliveryFeeProfit),
        commission: r(acc.commission),
        gstOnCommission: r(acc.gstOnCommission),
        platformCommissionEarning: r(acc.platformCommissionEarning),
        platformFees: r(acc.platformFees),
        delitoFundedDiscounts: r(acc.delitoFundedDiscounts),
        customerGst: r(acc.customerGst),
        tips: r(acc.tips),
        otherAdjustments: r(acc.otherAdjustments),
        refunds: r(acc.refunds),
        netPlatformEarning: r(acc.netPlatformEarning),
        vendorPayout: r(acc.vendorPayout),
        orderCount: acc.orderCount,
        markedFulfilledCount: acc.markedFulfilledCount,
    };
}

/**
 * How long a computed dashboard payload is reused.
 *
 * The summary walks every completed order four times over (today, week, month,
 * all time) plus a 30-day trend, so rebuilding it is the expensive part even
 * when the collections it reads are already cached. Anything shorter than the
 * orders cache itself would just recompute the same numbers from the same
 * cached rows; anything much longer would make the panel feel stale.
 */
const DASHBOARD_PAYLOAD_TTL = 30_000;

async function buildDashboardPayload() {
    // Date calculations
    // All period boundaries in IST. Built with setHours() on a UTC host, the
    // day started at 05:30 IST, so the morning trade was reported against
    // the previous day.
    const now = new Date();
    const today = istTodayBounds(now).start;
    // Week starts on the IST Sunday.
    const istDayOfWeek = new Date(today.getTime() + 5.5 * 3600_000).getUTCDay();
    const weekStart = istDaysAgoStart(istDayOfWeek, now);
    const monthStart = istCurrentMonthBounds(now).start;

    // Get ALL data from cached collections — single source of truth.
    // Each collection carries its own freshness window (see COLLECTION_TTL in
    // lib/firebase-admin.ts): orders are re-read often, partner and customer
    // records much less, because they only change when someone acts on them
    // and every write path invalidates them explicitly.
    const allOrders = await cachedCollection(collections.orders);
    const allVendorDocs = await cachedCollection(collections.vendors);
    const allDeliveryDocs = await cachedCollection(collections.deliveryPersons);
    const allCustomerDocs = await cachedCollection(collections.customers);
    // Orders an admin marked "count as fulfilled" (really delivered, wrong status).
    const fulfilledMarks = await loadFulfilledMarks();
    const isMarked = (o: any) => !!o.id && fulfilledMarks.has(o.id) && !/^(delivered|completed)$/i.test(String(o.status || ''));

    // Compute counts from cached data (avoids 15 individual Firestore count queries)
    const totalVendors = allVendorDocs.length;
    const activeVendors = allVendorDocs.filter(v => v.isVerified === true).length;
    const onlineVendors = allVendorDocs.filter(v => v.isOnline === true).length;
    const pendingVendors = allVendorDocs.filter(v => v.isVerified === false).length;
    const suspendedVendors = allVendorDocs.filter(v => v.isSuspended === true).length;

    const totalDeliveryPersons = allDeliveryDocs.length;
    const activeDeliveryPersons = allDeliveryDocs.filter(d => d.isVerified === true).length;
    const onlineDeliveryPersons = allDeliveryDocs.filter(d => d.isOnline === true).length;
    const pendingDeliveryPersons = allDeliveryDocs.filter(d => d.isVerified === false).length;
    const suspendedDeliveryPersons = allDeliveryDocs.filter(d => d.isSuspended === true).length;

    const totalCustomers = allCustomerDocs.length;
    const totalOrders = allOrders.length;
    const pendingOrders = allOrders.filter(o => o.status === 'Pending').length;
    const completedOrders = allOrders.filter(o => isFulfilledOrder(o, fulfilledMarks)).length;
    const markedFulfilledOrders = allOrders.filter(isMarked).length;
    const cancelledOrders = allOrders.filter(o => o.status === 'Cancelled' && !isMarked(o)).length;

    // Accumulators for each period
    let todayAcc = emptyAccum();
    let weekAcc = emptyAccum();
    let monthAcc = emptyAccum();
    let allTimeAcc = emptyAccum();

    // Daily trends (last 30 days)
    const dailyTrends: Record<string, { orders: number; gmv: number; netPlatformEarning: number }> = {};
    // Keyed by IST calendar day. toISOString() alone gives the UTC day, which
    // put every order placed between 00:00 and 05:30 IST on the previous day.
    for (let i = 0; i < 30; i++) {
        const key = istDayKey(new Date(today.getTime() - i * 86_400_000));
        dailyTrends[key] = { orders: 0, gmv: 0, netPlatformEarning: 0 };
    }

    // Vendor & delivery performance tracking
    const vendorPerformance: Record<string, { orders: number; revenue: number; name: string }> = {};
    const deliveryPerformance: Record<string, { deliveries: number; name: string }> = {};

    // Helper to safely parse dates
    function parseDate(value: any): Date | null {
        if (!value) return null;
        if (value._seconds !== undefined) return new Date(value._seconds * 1000);
        if (typeof value.toDate === 'function') return value.toDate();
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    }

    // Process all fulfilled orders: delivered/completed, plus admin-marked ones
    allOrders.forEach((order: any) => {
        if (!isFulfilledOrder(order, fulfilledMarks)) return;
        const marked = isMarked(order);

        const orderDate = parseDate(order.createdAt);
        const breakdown = calcOrderBreakdown(order, order.id);

        // All time
        addToAccum(allTimeAcc, breakdown, marked);

        if (orderDate && !isNaN(orderDate.getTime())) {
            if (orderDate >= today) addToAccum(todayAcc, breakdown, marked);
            if (orderDate >= weekStart) addToAccum(weekAcc, breakdown, marked);
            if (orderDate >= monthStart) addToAccum(monthAcc, breakdown, marked);

            // Daily trends
            try {
                const dateKey = istDayKey(orderDate);
                if (dailyTrends[dateKey]) {
                    dailyTrends[dateKey].orders += 1;
                    dailyTrends[dateKey].gmv += breakdown.gmv;
                    dailyTrends[dateKey].netPlatformEarning += breakdown.netPlatformEarning;
                }
            } catch (_) { /* skip */ }
        }

        // Vendor performance
        if (order.vendorId) {
            if (!vendorPerformance[order.vendorId]) {
                vendorPerformance[order.vendorId] = { orders: 0, revenue: 0, name: order.vendorName || 'Unknown' };
            }
            vendorPerformance[order.vendorId].orders += 1;
            vendorPerformance[order.vendorId].revenue += breakdown.subtotal;
        }

        // Delivery partner performance
        if (order.deliveryPartnerId || order.deliveryPersonId) {
            const partnerId = order.deliveryPartnerId || order.deliveryPersonId;
            if (!deliveryPerformance[partnerId]) {
                deliveryPerformance[partnerId] = { deliveries: 0, name: order.deliveryPartnerName || order.deliveryPersonName || 'Unknown' };
            }
            deliveryPerformance[partnerId].deliveries += 1;
        }
    });

    // Round all accumulators
    todayAcc = roundAccum(todayAcc);
    weekAcc = roundAccum(weekAcc);
    monthAcc = roundAccum(monthAcc);
    allTimeAcc = roundAccum(allTimeAcc);

    // Average order value (based on subtotal of completed orders)
    const avgOrderValue = allTimeAcc.orderCount > 0
        ? Math.round((allTimeAcc.subtotal / allTimeAcc.orderCount) * 100) / 100
        : 0;

    // Top performers
    const topVendors = Object.entries(vendorPerformance)
        .map(([id, data]) => ({ vendorId: id, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

    const topDeliveryPartners = Object.entries(deliveryPerformance)
        .map(([id, data]) => ({ deliveryPartnerId: id, ...data }))
        .sort((a, b) => b.deliveries - a.deliveries)
        .slice(0, 5);

    // Revenue trend
    const revenueTrend = Object.entries(dailyTrends)
        .map(([date, data]) => ({
            date,
            gmv: Math.round(data.gmv * 100) / 100,
            orders: data.orders,
            platformEarnings: Math.round(data.netPlatformEarning * 100) / 100,
            // keep 'revenue' alias for chart backwards-compat
            revenue: Math.round(data.gmv * 100) / 100,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // Customer metrics — reuse the documents already read above rather than
    // asking for the collection a second time.
    let newCustomersThisMonth = 0;
    let activeCustomersThisMonth = 0;

    allCustomerDocs.forEach(data => {
        const createdAt = parseDate(data.createdAt);
        const lastOrderAt = parseDate(data.lastOrderAt);
        if (createdAt && !isNaN(createdAt.getTime()) && createdAt >= monthStart) newCustomersThisMonth++;
        if (lastOrderAt && !isNaN(lastOrderAt.getTime()) && lastOrderAt >= monthStart) activeCustomersThisMonth++;
    });

    const retentionRate = totalCustomers > 0
        ? Math.round((activeCustomersThisMonth / totalCustomers) * 100)
        : 0;

    const pendingMenuItems = await countDocuments(collections.menuItems, 'isVerified', '==', false);

    const todayOrdersCount = allOrders.filter((o: any) => {
        const d = parseDate(o.createdAt);
        return d && !isNaN(d.getTime()) && d >= today;
    }).length;

    return {
            // Platform Earnings (all periods) — full breakdown
            platformEarnings: {
                today: todayAcc,
                thisWeek: weekAcc,
                thisMonth: monthAcc,
                allTime: allTimeAcc,
            },

            // Orders Overview
            ordersOverview: {
                total: totalOrders,
                completed: completedOrders,
                markedFulfilled: markedFulfilledOrders,
                pending: pendingOrders,
                cancelled: cancelledOrders,
                avgOrderValue,
                todayOrders: todayOrdersCount,
            },

            // Vendor Statistics
            vendorStats: {
                total: totalVendors,
                verified: activeVendors,
                suspended: suspendedVendors,
                online: onlineVendors,
                pending: pendingVendors,
                topPerformers: topVendors.map(v => ({
                    id: v.vendorId,
                    name: v.name,
                    totalOrders: v.orders,
                    revenue: v.revenue,
                    rating: 4.5,
                })),
            },

            // Delivery Partner Statistics
            deliveryStats: {
                total: totalDeliveryPersons,
                verified: activeDeliveryPersons,
                suspended: suspendedDeliveryPersons,
                online: onlineDeliveryPersons,
                pending: pendingDeliveryPersons,
                topPerformers: topDeliveryPartners.map(d => ({
                    id: d.deliveryPartnerId,
                    name: d.name,
                    totalOrders: d.deliveries,
                    revenue: d.deliveries * 25, // avg partner earning per delivery
                    rating: 4.5,
                })),
            },

            // Customer Metrics
            customerMetrics: {
                total: totalCustomers,
                newThisMonth: newCustomersThisMonth,
                activeThisMonth: activeCustomersThisMonth,
                retentionRate,
            },

            // Revenue Trend (last 30 days)
            revenueTrend,

            // Verification
            verification: {
                pendingVendors,
                pendingDeliveryPersons,
                pendingMenuItems,
                total: pendingVendors + pendingDeliveryPersons + pendingMenuItems,
            },

            // Legacy stats for backwards compatibility
            stats: {
                totalOrders,
                todayOrders: todayOrdersCount,
                totalRevenue: allTimeAcc.gmv,
                todayRevenue: todayAcc.gmv,
                activeVendors: onlineVendors,
                activeDelivery: onlineDeliveryPersons,
                totalCustomers,
            },
    };
}

async function handleGET() {
    try {
        const data = await cachedQuery(
            'dashboard:summary',
            buildDashboardPayload,
            DASHBOARD_PAYLOAD_TTL
        );
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch dashboard stats' },
            { status: 500 }
        );
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
