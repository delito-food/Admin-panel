import { NextResponse } from 'next/server';
import { db, collections, countDocuments, cachedCollection } from '@/lib/firebase-admin';

// Platform rate constants
const COMMISSION_RATE = 0.15;      // 15% commission on food subtotal
const GST_RATE = 0.18;             // 18% GST on commission
const BASE_DELIVERY_FEE_PARTNER = 10;  // ₹10 base given to delivery partner
const PER_KM_RATE_PARTNER = 6.5;  // ₹6.5/km given to delivery partner
// Customer-facing delivery fee is stored in order.deliveryFee (4.5/km based)

/**
 * Calculate the complete money breakdown for a single delivered order.
 *
 * Customer pays:  subtotal + customerDeliveryFee
 * Vendor gets:    subtotal - commission - gstOnCommission
 * Platform gets:  commission + gstOnCommission + deliveryFeeProfit (may be negative)
 * Partner gets:   partnerDeliveryPayout (₹10 base + ₹6.5/km)
 *
 * deliveryFeeProfit = customerDeliveryFee - partnerDeliveryPayout
 *   → positive means platform earns on delivery
 *   → negative means platform subsidises delivery (usual case)
 */
function calcOrderBreakdown(order: {
    subtotal?: number;
    itemTotal?: number;
    total?: number;
    deliveryFee?: number;
    deliveryPersonEarnings?: number;
    distanceKm?: number;
    smallOrderSupportFee?: number;
    taxes?: number;
    gstOnFood?: number;
    gstOnServices?: number;
    vendorEarning?: number;
    vendorPlatformCut?: number;
    vendorGstOnPlatformCut?: number;
}) {
    const subtotal = order.subtotal || order.itemTotal || 0;
    const customerDeliveryFee = order.deliveryFee || 0;

    // What the delivery partner actually earns — round1 precision matching apps
    const distanceKm = order.distanceKm || 0;
    const partnerDeliveryPayout = order.deliveryPersonEarnings != null
        ? order.deliveryPersonEarnings
        : (distanceKm > 0
            ? Math.max(15, Math.round((BASE_DELIVERY_FEE_PARTNER + distanceKm * PER_KM_RATE_PARTNER) * 10) / 10)
            : 15); // ₹15 minimum if no distance data

    // Use stored commission values when available (respects custom vendor rates)
    const commission = (order.vendorPlatformCut && order.vendorPlatformCut > 0)
        ? order.vendorPlatformCut
        : Math.round(subtotal * COMMISSION_RATE * 10) / 10;
    const gstOnCommission = (order.vendorGstOnPlatformCut && order.vendorGstOnPlatformCut > 0)
        ? order.vendorGstOnPlatformCut
        : Math.round(commission * GST_RATE * 10) / 10;
    const platformCommissionEarning = Math.round((commission + gstOnCommission) * 10) / 10;

    // Delivery profit/loss for platform
    const deliveryFeeProfit = customerDeliveryFee - partnerDeliveryPayout; // usually negative

    // Small order fee (₹10 bonus platform gets for orders below threshold)
    const smallOrderFee = order.smallOrderSupportFee || 0;

    // Net platform earnings from this order (commission + delivery profit/loss + small order fee)
    const netPlatformEarning = platformCommissionEarning + deliveryFeeProfit + smallOrderFee;

    // What vendor receives — use stored value if available, else calculate
    const vendorPayout = order.vendorEarning != null && order.vendorEarning > 0
        ? order.vendorEarning
        : Math.round((subtotal - platformCommissionEarning) * 10) / 10;

    // Total GMV = what customer actually pays (use stored total, which includes GST)
    // Fallback to subtotal + deliveryFee if total is not available
    const gmv = order.total || (subtotal + customerDeliveryFee);

    return {
        gmv,                        // total customer payment
        subtotal,                   // food-only subtotal
        customerDeliveryFee,        // delivery fee charged to customer
        partnerDeliveryPayout,      // actual payout to delivery partner
        deliveryFeeProfit,          // positive = platform earns; negative = platform subsidises
        commission,                 // 15% of subtotal
        gstOnCommission,            // 18% on commission
        platformCommissionEarning,  // commission + GST
        smallOrderFee,
        netPlatformEarning,         // platform's actual net (after delivery subsidy)
        vendorPayout,               // subtotal - commission - gst
    };
}

type PeriodAccumulator = {
    gmv: number;
    subtotal: number;
    customerDeliveryFees: number;  // collected from customers
    partnerDeliveryPayouts: number; // paid to partners
    deliveryFeeProfit: number;     // net delivery (may be negative)
    commission: number;
    gstOnCommission: number;
    platformCommissionEarning: number;
    netPlatformEarning: number;    // actual revenue in hand
    vendorPayout: number;
    orderCount: number;
};

function emptyAccum(): PeriodAccumulator {
    return {
        gmv: 0, subtotal: 0, customerDeliveryFees: 0, partnerDeliveryPayouts: 0,
        deliveryFeeProfit: 0, commission: 0, gstOnCommission: 0,
        platformCommissionEarning: 0, netPlatformEarning: 0, vendorPayout: 0, orderCount: 0,
    };
}

function addToAccum(acc: PeriodAccumulator, b: ReturnType<typeof calcOrderBreakdown>) {
    acc.gmv += b.gmv;
    acc.subtotal += b.subtotal;
    acc.customerDeliveryFees += b.customerDeliveryFee;
    acc.partnerDeliveryPayouts += b.partnerDeliveryPayout;
    acc.deliveryFeeProfit += b.deliveryFeeProfit;
    acc.commission += b.commission;
    acc.gstOnCommission += b.gstOnCommission;
    acc.platformCommissionEarning += b.platformCommissionEarning;
    acc.netPlatformEarning += b.netPlatformEarning;
    acc.vendorPayout += b.vendorPayout;
    acc.orderCount += 1;
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
        netPlatformEarning: r(acc.netPlatformEarning),
        vendorPayout: r(acc.vendorPayout),
        orderCount: acc.orderCount,
    };
}

export async function GET() {
    try {
        // Date calculations
        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);

        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);

        // Get ALL data from cached collections (60s TTL) — single source of truth
        const allOrders = await cachedCollection(collections.orders);
        const allVendorDocs = await cachedCollection(collections.vendors);
        const allDeliveryDocs = await cachedCollection(collections.deliveryPersons);
        const allCustomerDocs = await cachedCollection(collections.customers);

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
        const completedOrders = allOrders.filter(o => o.status === 'Delivered' || o.status === 'Completed').length;
        const cancelledOrders = allOrders.filter(o => o.status === 'Cancelled').length;

        // Accumulators for each period
        let todayAcc = emptyAccum();
        let weekAcc = emptyAccum();
        let monthAcc = emptyAccum();
        let allTimeAcc = emptyAccum();

        // Daily trends (last 30 days)
        const dailyTrends: Record<string, { orders: number; gmv: number; netPlatformEarning: number }> = {};
        for (let i = 0; i < 30; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            const key = d.toISOString().split('T')[0];
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

        // Process all delivered/completed orders
        allOrders.forEach((order: any) => {
            const status = (order.status || '').toLowerCase();
            const isCompleted = status === 'delivered' || status === 'completed';
            if (!isCompleted) return;

            const orderDate = parseDate(order.createdAt);
            const breakdown = calcOrderBreakdown(order);

            // All time
            addToAccum(allTimeAcc, breakdown);

            if (orderDate && !isNaN(orderDate.getTime())) {
                if (orderDate >= today) addToAccum(todayAcc, breakdown);
                if (orderDate >= weekStart) addToAccum(weekAcc, breakdown);
                if (orderDate >= monthStart) addToAccum(monthAcc, breakdown);

                // Daily trends
                try {
                    const dateKey = orderDate.toISOString().split('T')[0];
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

        // Customer metrics (cached)
        const customerDocs = await cachedCollection(collections.customers);
        let newCustomersThisMonth = 0;
        let activeCustomersThisMonth = 0;

        customerDocs.forEach(data => {
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

        return NextResponse.json({
            success: true,
            data: {
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
            }
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch dashboard stats' },
            { status: 500 }
        );
    }
}
