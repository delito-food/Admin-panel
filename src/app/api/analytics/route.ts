import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Platform commission rates
const PLATFORM_COMMISSION_RATE = 0.15; // 15%
const GST_ON_COMMISSION_RATE = 0.18; // 18% GST on commission

interface AnalyticsData {
    platformEarnings: {
        total: number;
        today: number;
        thisWeek: number;
        thisMonth: number;
        fromCommissions: number;
        fromDeliveryFees: number;
    };
    orders: {
        total: number;
        today: number;
        thisWeek: number;
        thisMonth: number;
        pending: number;
        completed: number;
        cancelled: number;
        averageOrderValue: number;
    };
    vendors: {
        total: number;
        verified: number;
        suspended: number;
        online: number;
        topPerformers: Array<{
            vendorId: string;
            shopName: string;
            totalOrders: number;
            totalRevenue: number;
            rating: number;
        }>;
    };
    deliveryPartners: {
        total: number;
        verified: number;
        suspended: number;
        online: number;
        topPerformers: Array<{
            deliveryPersonId: string;
            fullName: string;
            totalDeliveries: number;
            rating: number;
        }>;
    };
    customers: {
        total: number;
        newThisMonth: number;
        activeThisMonth: number;
    };
    revenueByDay: Array<{
        date: string;
        revenue: number;
        orders: number;
        platformEarnings: number;
    }>;
}

function getDateRanges() {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    return { todayStart, weekStart, monthStart };
}

export async function GET() {
    try {
        const { todayStart, weekStart, monthStart } = getDateRanges();

        // Fetch all data using cached collections (60s TTL)
        const [
            orderDocs,
            vendorDocs,
            deliveryDocs,
            customerDocs
        ] = await Promise.all([
            cachedCollection(collections.orders),
            cachedCollection(collections.vendors),
            cachedCollection(collections.deliveryPersons),
            cachedCollection(collections.customers)
        ]);

        // Process orders
        let totalRevenue = 0;
        let todayRevenue = 0;
        let weekRevenue = 0;
        let monthRevenue = 0;
        let totalOrders = 0;
        let todayOrders = 0;
        let weekOrders = 0;
        let monthOrders = 0;
        let pendingOrders = 0;
        let completedOrders = 0;
        let cancelledOrders = 0;
        let totalDeliveryFees = 0;
        let totalOriginalSubtotal = 0;
        let totalStoredCommission = 0;
        let totalStoredGstOnCommission = 0;

        const revenueByDayMap: Record<string, { revenue: number; orders: number; platformEarnings: number }> = {};

        orderDocs.forEach(order => {
            const orderTotal = Number(order.total || 0);
            const deliveryFee = Number(order.deliveryFee || 0);
            const subtotal = Number(order.subtotal || 0) || (orderTotal - deliveryFee);
            const originalItemTotal = Number(order.originalItemTotal || 0) || subtotal; // Commission base (before discounts)

            // Parse order date
            let orderDate: Date | null = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const createdAt = order.createdAt as any;
            if (createdAt) {
                if (createdAt.toDate) {
                    orderDate = createdAt.toDate();
                } else if (createdAt._seconds) {
                    orderDate = new Date(createdAt._seconds * 1000);
                } else if (typeof createdAt === 'string') {
                    orderDate = new Date(createdAt);
                }
            }

            totalOrders++;

            // Count by status
            if (order.status === 'Pending') pendingOrders++;
            else if (order.status === 'Delivered' || order.status === 'Completed') completedOrders++;
            else if (order.status === 'Cancelled') cancelledOrders++;

            // Only count revenue from completed orders
            if (order.status === 'Delivered' || order.status === 'Completed') {
                totalRevenue += orderTotal;
                totalDeliveryFees += deliveryFee;
                totalOriginalSubtotal += originalItemTotal;
                // Accumulate stored commission values
                const vendorPlatformCut = Number(order.vendorPlatformCut || 0);
                if (vendorPlatformCut > 0) {
                    totalStoredCommission += vendorPlatformCut;
                    totalStoredGstOnCommission += (Number(order.vendorGstOnPlatformCut || 0) || Math.round(vendorPlatformCut * GST_ON_COMMISSION_RATE * 10) / 10);
                }

                if (orderDate) {
                    if (orderDate >= todayStart) {
                        todayRevenue += orderTotal;
                        todayOrders++;
                    }
                    if (orderDate >= weekStart) {
                        weekRevenue += orderTotal;
                        weekOrders++;
                    }
                    if (orderDate >= monthStart) {
                        monthRevenue += orderTotal;
                        monthOrders++;
                    }

                    // Track revenue by day (last 30 days)
                    const dayKey = orderDate.toISOString().split('T')[0];
                    if (!revenueByDayMap[dayKey]) {
                        revenueByDayMap[dayKey] = { revenue: 0, orders: 0, platformEarnings: 0 };
                    }
                    revenueByDayMap[dayKey].revenue += orderTotal;
                    revenueByDayMap[dayKey].orders++;
                    // Platform earnings = commission + GST on commission
                    // Use stored values when available, fall back to 15% for old orders
                    const storedCut = Number(order.vendorPlatformCut || 0);
                    const storedGst = Number(order.vendorGstOnPlatformCut || 0);
                    const comm = storedCut > 0 ? storedCut : Math.round(originalItemTotal * PLATFORM_COMMISSION_RATE * 10) / 10;
                    const gstOnComm = storedGst > 0 ? storedGst : Math.round(comm * GST_ON_COMMISSION_RATE * 10) / 10;
                    revenueByDayMap[dayKey].platformEarnings += comm + gstOnComm;
                }
            }
        });

        // Calculate platform earnings — use stored commission values when available
        const platformCommission = totalStoredCommission > 0
            ? totalStoredCommission
            : Math.round(totalOriginalSubtotal * PLATFORM_COMMISSION_RATE * 10) / 10;
        const platformGstOnCommission = totalStoredGstOnCommission > 0
            ? totalStoredGstOnCommission
            : Math.round(platformCommission * GST_ON_COMMISSION_RATE * 10) / 10;
        const totalPlatformEarnings = platformCommission + platformGstOnCommission;

        // For period-based earnings, use ratio of period subtotal to total subtotal
        // This is more accurate than using total revenue (which includes delivery fees)
        const earningsPerSubtotalUnit = totalOriginalSubtotal > 0
            ? totalPlatformEarnings / totalOriginalSubtotal
            : (PLATFORM_COMMISSION_RATE + PLATFORM_COMMISSION_RATE * GST_ON_COMMISSION_RATE);
        const todayPlatformEarnings = todayRevenue > 0
            ? todayRevenue * (totalOriginalSubtotal > 0 ? earningsPerSubtotalUnit * (totalOriginalSubtotal / totalRevenue) : earningsPerSubtotalUnit)
            : 0;
        const weekPlatformEarnings = weekRevenue > 0
            ? weekRevenue * (totalOriginalSubtotal > 0 ? earningsPerSubtotalUnit * (totalOriginalSubtotal / totalRevenue) : earningsPerSubtotalUnit)
            : 0;
        const monthPlatformEarnings = monthRevenue > 0
            ? monthRevenue * (totalOriginalSubtotal > 0 ? earningsPerSubtotalUnit * (totalOriginalSubtotal / totalRevenue) : earningsPerSubtotalUnit)
            : 0;

        // Process vendors
        const vendorEarningsMap: Record<string, number> = {};
        orderDocs.forEach(order => {
            if ((order.status === 'Delivered' || order.status === 'Completed') && order.vendorId) {
                const vid = String(order.vendorId);
                if (!vendorEarningsMap[vid]) vendorEarningsMap[vid] = 0;
                vendorEarningsMap[vid] += Number(order.subtotal || order.total || 0);
            }
        });

        const vendorOrdersMap: Record<string, number> = {};
        orderDocs.forEach(order => {
            if (order.vendorId) {
                const vid = String(order.vendorId);
                if (!vendorOrdersMap[vid]) vendorOrdersMap[vid] = 0;
                vendorOrdersMap[vid]++;
            }
        });

        let verifiedVendors = 0;
        let suspendedVendors = 0;
        let onlineVendors = 0;
        const topVendors: Array<{
            vendorId: string;
            shopName: string;
            totalOrders: number;
            totalRevenue: number;
            rating: number;
        }> = [];

        vendorDocs.forEach(vendor => {
            if (vendor.isVerified) verifiedVendors++;
            if (vendor.isSuspended) suspendedVendors++;
            if (vendor.isOnline) onlineVendors++;

            topVendors.push({
                vendorId: vendor.id,
                shopName: (vendor.shopName || '') as string,
                totalOrders: vendorOrdersMap[vendor.id] || 0,
                totalRevenue: vendorEarningsMap[vendor.id] || 0,
                rating: (vendor.rating || 0) as number
            });
        });

        // Sort by orders and take top 5
        topVendors.sort((a, b) => b.totalOrders - a.totalOrders);
        const topPerformingVendors = topVendors.slice(0, 5);

        // Process delivery partners
        let verifiedDelivery = 0;
        let suspendedDelivery = 0;
        let onlineDelivery = 0;
        const topDelivery: Array<{
            deliveryPersonId: string;
            fullName: string;
            totalDeliveries: number;
            rating: number;
        }> = [];

        deliveryDocs.forEach(dp => {
            if (dp.isVerified) verifiedDelivery++;
            if (dp.isSuspended) suspendedDelivery++;
            if (dp.isOnline) onlineDelivery++;

            topDelivery.push({
                deliveryPersonId: dp.id,
                fullName: (dp.fullName || '') as string,
                totalDeliveries: (dp.totalDeliveries || 0) as number,
                rating: (dp.rating || 0) as number
            });
        });

        topDelivery.sort((a, b) => b.totalDeliveries - a.totalDeliveries);
        const topPerformingDelivery = topDelivery.slice(0, 5);

        // Process customers
        let newCustomersThisMonth = 0;
        const activeCustomerIds = new Set<string>();

        customerDocs.forEach(customer => {
            let createdAt: Date | null = null;
            if (customer.createdAt) {
                if ((customer.createdAt as any).toDate) {
                    createdAt = (customer.createdAt as any).toDate();
                } else if (typeof customer.createdAt === 'string') {
                    createdAt = new Date(customer.createdAt);
                }
            }
            if (createdAt && createdAt >= monthStart) {
                newCustomersThisMonth++;
            }
        });

        // Count active customers (who ordered this month)
        orderDocs.forEach(order => {
            let orderDate: Date | null = null;
            if (order.createdAt) {
                if ((order.createdAt as any).toDate) {
                    orderDate = (order.createdAt as any).toDate();
                } else if (typeof order.createdAt === 'string') {
                    orderDate = new Date(order.createdAt);
                }
            }
            if (orderDate && orderDate >= monthStart && order.customerId) {
                activeCustomerIds.add(order.customerId as string);
            }
        });

        // Build revenue by day array (last 30 days)
        const revenueByDay: Array<{ date: string; revenue: number; orders: number; platformEarnings: number }> = [];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        for (let d = new Date(thirtyDaysAgo); d <= new Date(); d.setDate(d.getDate() + 1)) {
            const dayKey = d.toISOString().split('T')[0];
            const dayData = revenueByDayMap[dayKey] || { revenue: 0, orders: 0, platformEarnings: 0 };
            revenueByDay.push({
                date: dayKey,
                ...dayData
            });
        }

        const averageOrderValue = completedOrders > 0 ? totalRevenue / completedOrders : 0;

        const analytics: AnalyticsData = {
            platformEarnings: {
                total: Math.round(totalPlatformEarnings * 100) / 100,
                today: Math.round(todayPlatformEarnings * 100) / 100,
                thisWeek: Math.round(weekPlatformEarnings * 100) / 100,
                thisMonth: Math.round(monthPlatformEarnings * 100) / 100,
                fromCommissions: Math.round((platformCommission + platformGstOnCommission) * 100) / 100,
                fromDeliveryFees: 0, // Delivery fees go to partners, not platform
            },
            orders: {
                total: totalOrders,
                today: todayOrders,
                thisWeek: weekOrders,
                thisMonth: monthOrders,
                pending: pendingOrders,
                completed: completedOrders,
                cancelled: cancelledOrders,
                averageOrderValue: Math.round(averageOrderValue * 100) / 100,
            },
            vendors: {
                total: vendorDocs.length,
                verified: verifiedVendors,
                suspended: suspendedVendors,
                online: onlineVendors,
                topPerformers: topPerformingVendors,
            },
            deliveryPartners: {
                total: deliveryDocs.length,
                verified: verifiedDelivery,
                suspended: suspendedDelivery,
                online: onlineDelivery,
                topPerformers: topPerformingDelivery,
            },
            customers: {
                total: customerDocs.length,
                newThisMonth: newCustomersThisMonth,
                activeThisMonth: activeCustomerIds.size,
            },
            revenueByDay,
        };

        return NextResponse.json({ success: true, data: analytics });
    } catch (error) {
        console.error('Analytics fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch analytics' },
            { status: 500 }
        );
    }
}

