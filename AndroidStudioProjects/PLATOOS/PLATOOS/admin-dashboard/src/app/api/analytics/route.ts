import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Platform commission rates
const PLATFORM_COMMISSION_RATE = 0.15; // 15%
const GST_RATE = 0.18; // 18% GST on commission
const DELIVERY_FEE_PLATFORM_SHARE = 0.00; // 0% - delivery partners get 100%

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

        // Fetch all data in parallel
        const [
            ordersSnapshot,
            vendorsSnapshot,
            deliverySnapshot,
            customersSnapshot
        ] = await Promise.all([
            db.collection(collections.orders).get(),
            db.collection(collections.vendors).get(),
            db.collection(collections.deliveryPersons).get(),
            db.collection(collections.customers).get()
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

        const revenueByDayMap: Record<string, { revenue: number; orders: number; platformEarnings: number }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const orderTotal = order.total || 0;
            const deliveryFee = order.deliveryFee || 0;
            const subtotal = order.subtotal || orderTotal - deliveryFee;

            // Parse order date
            let orderDate: Date | null = null;
            if (order.createdAt) {
                if (order.createdAt.toDate) {
                    orderDate = order.createdAt.toDate();
                } else if (order.createdAt._seconds) {
                    orderDate = new Date(order.createdAt._seconds * 1000);
                } else if (typeof order.createdAt === 'string') {
                    orderDate = new Date(order.createdAt);
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
                    revenueByDayMap[dayKey].platformEarnings += (subtotal * PLATFORM_COMMISSION_RATE) + (deliveryFee * DELIVERY_FEE_PLATFORM_SHARE);
                }
            }
        });

        // Calculate platform earnings
        const platformFromCommissions = totalRevenue * PLATFORM_COMMISSION_RATE;
        const platformFromDeliveryFees = totalDeliveryFees * DELIVERY_FEE_PLATFORM_SHARE;
        const totalPlatformEarnings = platformFromCommissions + platformFromDeliveryFees;

        const todayPlatformEarnings = todayRevenue * PLATFORM_COMMISSION_RATE;
        const weekPlatformEarnings = weekRevenue * PLATFORM_COMMISSION_RATE;
        const monthPlatformEarnings = monthRevenue * PLATFORM_COMMISSION_RATE;

        // Process vendors
        const vendorEarningsMap: Record<string, number> = {};
        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            if ((order.status === 'Delivered' || order.status === 'Completed') && order.vendorId) {
                if (!vendorEarningsMap[order.vendorId]) vendorEarningsMap[order.vendorId] = 0;
                vendorEarningsMap[order.vendorId] += (order.subtotal || order.total || 0);
            }
        });

        const vendorOrdersMap: Record<string, number> = {};
        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            if (order.vendorId) {
                if (!vendorOrdersMap[order.vendorId]) vendorOrdersMap[order.vendorId] = 0;
                vendorOrdersMap[order.vendorId]++;
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

        vendorsSnapshot.docs.forEach(doc => {
            const vendor = doc.data();
            if (vendor.isVerified) verifiedVendors++;
            if (vendor.isSuspended) suspendedVendors++;
            if (vendor.isOnline) onlineVendors++;

            topVendors.push({
                vendorId: doc.id,
                shopName: vendor.shopName || '',
                totalOrders: vendorOrdersMap[doc.id] || 0,
                totalRevenue: vendorEarningsMap[doc.id] || 0,
                rating: vendor.rating || 0
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

        deliverySnapshot.docs.forEach(doc => {
            const dp = doc.data();
            if (dp.isVerified) verifiedDelivery++;
            if (dp.isSuspended) suspendedDelivery++;
            if (dp.isOnline) onlineDelivery++;

            topDelivery.push({
                deliveryPersonId: doc.id,
                fullName: dp.fullName || '',
                totalDeliveries: dp.totalDeliveries || 0,
                rating: dp.rating || 0
            });
        });

        topDelivery.sort((a, b) => b.totalDeliveries - a.totalDeliveries);
        const topPerformingDelivery = topDelivery.slice(0, 5);

        // Process customers
        let newCustomersThisMonth = 0;
        const activeCustomerIds = new Set<string>();

        customersSnapshot.docs.forEach(doc => {
            const customer = doc.data();
            let createdAt: Date | null = null;
            if (customer.createdAt) {
                if (customer.createdAt.toDate) {
                    createdAt = customer.createdAt.toDate();
                } else if (typeof customer.createdAt === 'string') {
                    createdAt = new Date(customer.createdAt);
                }
            }
            if (createdAt && createdAt >= monthStart) {
                newCustomersThisMonth++;
            }
        });

        // Count active customers (who ordered this month)
        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            let orderDate: Date | null = null;
            if (order.createdAt) {
                if (order.createdAt.toDate) {
                    orderDate = order.createdAt.toDate();
                } else if (typeof order.createdAt === 'string') {
                    orderDate = new Date(order.createdAt);
                }
            }
            if (orderDate && orderDate >= monthStart && order.customerId) {
                activeCustomerIds.add(order.customerId);
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
                fromCommissions: Math.round(platformFromCommissions * 100) / 100,
                fromDeliveryFees: Math.round(platformFromDeliveryFees * 100) / 100,
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
                total: vendorsSnapshot.size,
                verified: verifiedVendors,
                suspended: suspendedVendors,
                online: onlineVendors,
                topPerformers: topPerformingVendors,
            },
            deliveryPartners: {
                total: deliverySnapshot.size,
                verified: verifiedDelivery,
                suspended: suspendedDelivery,
                online: onlineDelivery,
                topPerformers: topPerformingDelivery,
            },
            customers: {
                total: customersSnapshot.size,
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

