import { NextResponse } from 'next/server';
import { db, collections, countDocuments } from '@/lib/firebase-admin';

// Platform earnings calculation: 15% commission + 18% GST on commission
function calculatePlatformEarnings(orderSubtotal: number, deliveryFee: number = 0) {
    const baseCommission = orderSubtotal * 0.15;
    const gstOnCommission = baseCommission * 0.18;
    const totalCommission = baseCommission + gstOnCommission;
    // Platform does NOT get delivery fee - it goes to delivery partner
    return {
        baseCommission,
        gstOnCommission,
        totalCommission,
        deliveryFee, // For tracking purposes
    };
}

export async function GET() {
    try {
        // Date calculations
        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay()); // Start of current week (Sunday)
        weekStart.setHours(0, 0, 0, 0);
        
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        // Get counts for dashboard stats
        const [
            totalVendors,
            activeVendors,
            onlineVendors,
            pendingVendors,
            suspendedVendors,
            totalDeliveryPersons,
            activeDeliveryPersons,
            onlineDeliveryPersons,
            pendingDeliveryPersons,
            suspendedDeliveryPersons,
            totalCustomers,
            totalOrders,
            pendingOrders,
            completedOrders,
            cancelledOrders,
        ] = await Promise.all([
            // Vendors
            countDocuments(collections.vendors),
            countDocuments(collections.vendors, 'isVerified', '==', true),
            countDocuments(collections.vendors, 'isOnline', '==', true),
            countDocuments(collections.vendors, 'isVerified', '==', false),
            countDocuments(collections.vendors, 'isSuspended', '==', true),

            // Delivery Persons
            countDocuments(collections.deliveryPersons),
            countDocuments(collections.deliveryPersons, 'isVerified', '==', true),
            countDocuments(collections.deliveryPersons, 'isOnline', '==', true),
            countDocuments(collections.deliveryPersons, 'isVerified', '==', false),
            countDocuments(collections.deliveryPersons, 'isSuspended', '==', true),

            // Customers
            countDocuments(collections.customers),

            // Orders
            countDocuments(collections.orders),
            countDocuments(collections.orders, 'status', '==', 'Pending'),
            countDocuments(collections.orders, 'status', '==', 'Delivered'),
            countDocuments(collections.orders, 'status', '==', 'Cancelled'),
        ]);

        // Get ALL orders for comprehensive analytics
        const allOrdersSnapshot = await db.collection(collections.orders).get();
        const allOrders = allOrdersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Calculate platform earnings for different periods
        let todayEarnings = { commission: 0, deliveryFees: 0, total: 0 };
        let weekEarnings = { commission: 0, deliveryFees: 0, total: 0 };
        let monthEarnings = { commission: 0, deliveryFees: 0, total: 0 };
        let totalEarnings = { commission: 0, deliveryFees: 0, total: 0 };
        
        // Order value stats
        let totalOrderValue = 0;
        let deliveredOrderCount = 0;
        
        // Daily trends for last 30 days
        const dailyTrends: Record<string, { orders: number; revenue: number; earnings: number }> = {};
        for (let i = 0; i < 30; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            const key = d.toISOString().split('T')[0];
            dailyTrends[key] = { orders: 0, revenue: 0, earnings: 0 };
        }

        // Vendor performance tracking
        const vendorPerformance: Record<string, { orders: number; revenue: number; name: string }> = {};
        
        // Delivery partner performance tracking
        const deliveryPerformance: Record<string, { deliveries: number; name: string }> = {};

        // Helper to safely parse dates (handles Firestore Timestamps and strings)
        function parseDate(value: any): Date | null {
            if (!value) return null;
            // Handle Firestore Timestamp
            if (value._seconds !== undefined) {
                return new Date(value._seconds * 1000);
            }
            // Handle toDate() method (Firestore Timestamp object)
            if (typeof value.toDate === 'function') {
                return value.toDate();
            }
            // Handle string or number
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date;
        }

        // Process all orders
        allOrders.forEach((order: any) => {
            const orderDate = parseDate(order.createdAt);
            const subtotal = order.subtotal || order.total || 0;
            const deliveryFee = order.deliveryFee || 0;
            const isDelivered = order.status === 'Delivered';
            
            if (isDelivered) {
                const earnings = calculatePlatformEarnings(subtotal, deliveryFee);
                totalEarnings.commission += earnings.totalCommission;
                totalEarnings.deliveryFees += deliveryFee;
                totalEarnings.total += earnings.totalCommission;
                
                totalOrderValue += subtotal;
                deliveredOrderCount++;
                
                if (orderDate && !isNaN(orderDate.getTime())) {
                    // Today's earnings
                    if (orderDate >= today) {
                        todayEarnings.commission += earnings.totalCommission;
                        todayEarnings.deliveryFees += deliveryFee;
                        todayEarnings.total += earnings.totalCommission;
                    }
                    
                    // This week's earnings
                    if (orderDate >= weekStart) {
                        weekEarnings.commission += earnings.totalCommission;
                        weekEarnings.deliveryFees += deliveryFee;
                        weekEarnings.total += earnings.totalCommission;
                    }
                    
                    // This month's earnings
                    if (orderDate >= monthStart) {
                        monthEarnings.commission += earnings.totalCommission;
                        monthEarnings.deliveryFees += deliveryFee;
                        monthEarnings.total += earnings.totalCommission;
                    }
                    
                    // Daily trends - safely get date key
                    try {
                        const dateKey = orderDate.toISOString().split('T')[0];
                        if (dailyTrends[dateKey]) {
                            dailyTrends[dateKey].orders += 1;
                            dailyTrends[dateKey].revenue += subtotal;
                            dailyTrends[dateKey].earnings += earnings.totalCommission;
                        }
                    } catch (e) {
                        // Skip if date conversion fails
                    }
                }
                
                // Track vendor performance
                if (order.vendorId) {
                    if (!vendorPerformance[order.vendorId]) {
                        vendorPerformance[order.vendorId] = { orders: 0, revenue: 0, name: order.vendorName || 'Unknown' };
                    }
                    vendorPerformance[order.vendorId].orders += 1;
                    vendorPerformance[order.vendorId].revenue += subtotal;
                }
                
                // Track delivery partner performance
                if (order.deliveryPartnerId) {
                    if (!deliveryPerformance[order.deliveryPartnerId]) {
                        deliveryPerformance[order.deliveryPartnerId] = { deliveries: 0, name: order.deliveryPartnerName || 'Unknown' };
                    }
                    deliveryPerformance[order.deliveryPartnerId].deliveries += 1;
                }
            }
        });

        // Calculate average order value
        const avgOrderValue = deliveredOrderCount > 0 ? totalOrderValue / deliveredOrderCount : 0;

        // Get top 5 vendors
        const topVendors = Object.entries(vendorPerformance)
            .map(([id, data]) => ({ vendorId: id, ...data }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        // Get top 5 delivery partners
        const topDeliveryPartners = Object.entries(deliveryPerformance)
            .map(([id, data]) => ({ deliveryPartnerId: id, ...data }))
            .sort((a, b) => b.deliveries - a.deliveries)
            .slice(0, 5);

        // Format daily trends for chart (sorted by date)
        const revenueTrend = Object.entries(dailyTrends)
            .map(([date, data]) => ({ date, ...data }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Get customer metrics - new this month
        const customersSnapshot = await db.collection(collections.customers).get();
        let newCustomersThisMonth = 0;
        let activeCustomersThisMonth = 0;
        
        customersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const createdAt = parseDate(data.createdAt);
            const lastOrderAt = parseDate(data.lastOrderAt);
            
            if (createdAt && !isNaN(createdAt.getTime()) && createdAt >= monthStart) {
                newCustomersThisMonth++;
            }
            if (lastOrderAt && !isNaN(lastOrderAt.getTime()) && lastOrderAt >= monthStart) {
                activeCustomersThisMonth++;
            }
        });

        const retentionRate = totalCustomers > 0 ? Math.round((activeCustomersThisMonth / totalCustomers) * 100) : 0;

        // Get pending menu items count
        const pendingMenuItems = await countDocuments(collections.menuItems, 'isVerified', '==', false);

        // Get today's orders count
        const todayOrdersCount = allOrders.filter((o: any) => {
            const d = parseDate(o.createdAt);
            return d && !isNaN(d.getTime()) && d >= today;
        }).length;

        // Count delivered orders by period
        const todayDeliveredCount = allOrders.filter((o: any) => {
            if (o.status !== 'Delivered') return false;
            const d = parseDate(o.createdAt);
            return d && !isNaN(d.getTime()) && d >= today;
        }).length;
        
        const weekDeliveredCount = allOrders.filter((o: any) => {
            if (o.status !== 'Delivered') return false;
            const d = parseDate(o.createdAt);
            return d && !isNaN(d.getTime()) && d >= weekStart;
        }).length;
        
        const monthDeliveredCount = allOrders.filter((o: any) => {
            if (o.status !== 'Delivered') return false;
            const d = parseDate(o.createdAt);
            return d && !isNaN(d.getTime()) && d >= monthStart;
        }).length;

        return NextResponse.json({
            success: true,
            data: {
                // Platform Earnings - structured for UI
                platformEarnings: {
                    today: {
                        totalRevenue: Math.round(todayEarnings.deliveryFees * 100) / 100 + Math.round((todayEarnings.commission / 0.177) * 100) / 100,
                        platformEarnings: Math.round(todayEarnings.total * 100) / 100,
                        commission: Math.round((todayEarnings.commission / 1.18) * 100) / 100,
                        gst: Math.round((todayEarnings.commission - todayEarnings.commission / 1.18) * 100) / 100,
                        deliveryFees: Math.round(todayEarnings.deliveryFees * 100) / 100,
                        orderCount: todayDeliveredCount,
                    },
                    thisWeek: {
                        totalRevenue: Math.round(weekEarnings.deliveryFees * 100) / 100 + Math.round((weekEarnings.commission / 0.177) * 100) / 100,
                        platformEarnings: Math.round(weekEarnings.total * 100) / 100,
                        commission: Math.round((weekEarnings.commission / 1.18) * 100) / 100,
                        gst: Math.round((weekEarnings.commission - weekEarnings.commission / 1.18) * 100) / 100,
                        deliveryFees: Math.round(weekEarnings.deliveryFees * 100) / 100,
                        orderCount: weekDeliveredCount,
                    },
                    thisMonth: {
                        totalRevenue: Math.round(monthEarnings.deliveryFees * 100) / 100 + Math.round((monthEarnings.commission / 0.177) * 100) / 100,
                        platformEarnings: Math.round(monthEarnings.total * 100) / 100,
                        commission: Math.round((monthEarnings.commission / 1.18) * 100) / 100,
                        gst: Math.round((monthEarnings.commission - monthEarnings.commission / 1.18) * 100) / 100,
                        deliveryFees: Math.round(monthEarnings.deliveryFees * 100) / 100,
                        orderCount: monthDeliveredCount,
                    },
                    allTime: {
                        totalRevenue: Math.round(totalOrderValue * 100) / 100,
                        platformEarnings: Math.round(totalEarnings.total * 100) / 100,
                        commission: Math.round((totalEarnings.commission / 1.18) * 100) / 100,
                        gst: Math.round((totalEarnings.commission - totalEarnings.commission / 1.18) * 100) / 100,
                        deliveryFees: Math.round(totalEarnings.deliveryFees * 100) / 100,
                        orderCount: deliveredOrderCount,
                    },
                },
                
                // Orders Overview
                ordersOverview: {
                    total: totalOrders,
                    completed: completedOrders,
                    pending: pendingOrders,
                    cancelled: cancelledOrders,
                    avgOrderValue: Math.round(avgOrderValue * 100) / 100,
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
                        rating: 4.5, // Default rating - can be enhanced later
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
                        revenue: d.deliveries * 35, // Estimate based on avg delivery fee
                        rating: 4.5, // Default rating
                    })),
                },
                
                // Customer Metrics
                customerMetrics: {
                    total: totalCustomers,
                    newThisMonth: newCustomersThisMonth,
                    activeThisMonth: activeCustomersThisMonth,
                    retentionRate: retentionRate,
                },
                
                // Revenue Trend (last 30 days)
                revenueTrend: revenueTrend.map(d => ({
                    date: d.date,
                    revenue: d.revenue,
                    orders: d.orders,
                    platformEarnings: d.earnings,
                })),
                
                // Legacy stats for backwards compatibility
                stats: {
                    totalOrders: totalOrders,
                    todayOrders: todayOrdersCount,
                    totalRevenue: Math.round(totalOrderValue * 100) / 100,
                    todayRevenue: Math.round(todayEarnings.total * 100) / 100,
                    activeVendors: onlineVendors,
                    activeDelivery: onlineDeliveryPersons,
                    totalCustomers: totalCustomers,
                },
                verification: {
                    pendingVendors,
                    pendingDeliveryPersons,
                    pendingMenuItems,
                    total: pendingVendors + pendingDeliveryPersons + pendingMenuItems,
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
