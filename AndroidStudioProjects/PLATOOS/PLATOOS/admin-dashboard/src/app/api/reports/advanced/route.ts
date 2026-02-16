import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';

// Types for reports
interface VendorRevenue {
    vendorId: string;
    vendorName: string;
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    completedOrders: number;
    cancelledOrders: number;
    cancellationRate: number;
}

interface AreaRevenue {
    area: string;
    pincode: string;
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
}

interface HourlyData {
    hour: number;
    hourLabel: string;
    orderCount: number;
    revenue: number;
}

interface DayOfWeekData {
    day: string;
    dayIndex: number;
    orderCount: number;
    revenue: number;
}

interface CustomerRetention {
    totalCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    retentionRate: number;
    averageOrdersPerCustomer: number;
    customersByOrderCount: {
        oneOrder: number;
        twoToFive: number;
        sixToTen: number;
        moreThanTen: number;
    };
    topCustomers: Array<{
        customerId: string;
        customerName: string;
        totalOrders: number;
        totalSpent: number;
        lastOrderDate: string;
    }>;
}

interface DeliveryTimeAnalysis {
    averageDeliveryTime: number;
    fastestDelivery: number;
    slowestDelivery: number;
    deliveryTimeByVendor: Array<{
        vendorId: string;
        vendorName: string;
        averageTime: number;
        totalDeliveries: number;
    }>;
    deliveryTimeByArea: Array<{
        area: string;
        pincode: string;
        averageTime: number;
        totalDeliveries: number;
    }>;
    deliveryTimeDistribution: Array<{
        range: string;
        count: number;
        percentage: number;
    }>;
}

interface CancellationAnalysis {
    totalCancellations: number;
    cancellationRate: number;
    cancellationsByReason: Array<{
        reason: string;
        count: number;
        percentage: number;
    }>;
    cancellationsByVendor: Array<{
        vendorId: string;
        vendorName: string;
        cancellations: number;
        totalOrders: number;
        cancellationRate: number;
    }>;
    cancellationsByHour: Array<{
        hour: number;
        hourLabel: string;
        count: number;
    }>;
    cancellationTrend: Array<{
        date: string;
        cancellations: number;
        totalOrders: number;
        rate: number;
    }>;
}

interface ReportsData {
    revenueByVendor: VendorRevenue[];
    revenueByArea: AreaRevenue[];
    peakHours: HourlyData[];
    ordersByDayOfWeek: DayOfWeekData[];
    customerRetention: CustomerRetention;
    deliveryTimeAnalysis: DeliveryTimeAnalysis;
    cancellationAnalysis: CancellationAnalysis;
    dateRange: {
        start: string;
        end: string;
    };
}

function parseFirestoreDate(dateField: unknown): Date | null {
    if (!dateField) return null;
    if (typeof dateField === 'object' && dateField !== null) {
        const df = dateField as { toDate?: () => Date; _seconds?: number };
        if (df.toDate) return df.toDate();
        if (df._seconds) return new Date(df._seconds * 1000);
    }
    if (typeof dateField === 'string') return new Date(dateField);
    return null;
}

function extractArea(address: string): string {
    if (!address) return 'Unknown';
    const parts = address.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        return parts[parts.length - 2] || parts[0];
    }
    return parts[0] || 'Unknown';
}

function extractPincode(address: string): string {
    if (!address) return 'Unknown';
    const pincodeMatch = address.match(/\b\d{6}\b/);
    return pincodeMatch ? pincodeMatch[0] : 'Unknown';
}

export async function GET() {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(now.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        // Fetch all data
        const [ordersSnapshot, vendorsSnapshot, customersSnapshot] = await Promise.all([
            db.collection(collections.orders).get(),
            db.collection(collections.vendors).get(),
            db.collection(collections.customers).get()
        ]);

        // Create vendor lookup
        const vendorLookup: Record<string, string> = {};
        vendorsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            vendorLookup[doc.id] = data.shopName || data.fullName || 'Unknown Vendor';
        });

        // Create customer lookup
        const customerLookup: Record<string, string> = {};
        customersSnapshot.docs.forEach(doc => {
            const data = doc.data();
            customerLookup[doc.id] = data.fullName || data.name || 'Unknown Customer';
        });

        // Initialize data structures
        const vendorRevenueMap: Record<string, VendorRevenue> = {};
        const areaRevenueMap: Record<string, AreaRevenue> = {};
        const hourlyOrdersMap: Record<number, { count: number; revenue: number }> = {};
        const dayOfWeekMap: Record<number, { count: number; revenue: number }> = {};
        const customerOrdersMap: Record<string, { count: number; spent: number; lastOrder: Date | null }> = {};
        const deliveryTimes: number[] = [];
        const vendorDeliveryTimes: Record<string, number[]> = {};
        const areaDeliveryTimes: Record<string, number[]> = {};
        const cancellationReasons: Record<string, number> = {};
        const vendorCancellations: Record<string, { cancelled: number; total: number }> = {};
        const hourlyCancellations: Record<number, number> = {};
        const dailyCancellations: Record<string, { cancelled: number; total: number }> = {};

        let totalOrders = 0;
        let totalCancellations = 0;

        // Process orders
        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const orderDate = parseFirestoreDate(order.createdAt);
            const deliveredAt = parseFirestoreDate(order.deliveredAt);
            
            if (!orderDate) return;

            totalOrders++;
            const vendorId = order.vendorId || 'unknown';
            const vendorName = vendorLookup[vendorId] || order.vendorName || 'Unknown Vendor';
            const customerId = order.customerId || 'unknown';
            const total = order.total || 0;
            const address = order.deliveryAddress || '';
            const area = extractArea(address);
            const pincode = extractPincode(address);
            const areaKey = `${area}|${pincode}`;

            // Initialize vendor revenue entry
            if (!vendorRevenueMap[vendorId]) {
                vendorRevenueMap[vendorId] = {
                    vendorId,
                    vendorName,
                    totalRevenue: 0,
                    totalOrders: 0,
                    averageOrderValue: 0,
                    completedOrders: 0,
                    cancelledOrders: 0,
                    cancellationRate: 0
                };
            }
            vendorRevenueMap[vendorId].totalOrders++;

            // Initialize area revenue entry
            if (!areaRevenueMap[areaKey]) {
                areaRevenueMap[areaKey] = {
                    area,
                    pincode,
                    totalRevenue: 0,
                    totalOrders: 0,
                    averageOrderValue: 0
                };
            }
            areaRevenueMap[areaKey].totalOrders++;

            // Initialize vendor cancellations
            if (!vendorCancellations[vendorId]) {
                vendorCancellations[vendorId] = { cancelled: 0, total: 0 };
            }
            vendorCancellations[vendorId].total++;

            // Daily tracking
            const dayKey = orderDate.toISOString().split('T')[0];
            if (!dailyCancellations[dayKey]) {
                dailyCancellations[dayKey] = { cancelled: 0, total: 0 };
            }
            dailyCancellations[dayKey].total++;

            // Process based on status
            if (order.status === 'Delivered' || order.status === 'Completed') {
                vendorRevenueMap[vendorId].totalRevenue += total;
                vendorRevenueMap[vendorId].completedOrders++;
                areaRevenueMap[areaKey].totalRevenue += total;

                // Peak hours analysis
                const hour = orderDate.getHours();
                if (!hourlyOrdersMap[hour]) {
                    hourlyOrdersMap[hour] = { count: 0, revenue: 0 };
                }
                hourlyOrdersMap[hour].count++;
                hourlyOrdersMap[hour].revenue += total;

                // Day of week analysis
                const dayOfWeek = orderDate.getDay();
                if (!dayOfWeekMap[dayOfWeek]) {
                    dayOfWeekMap[dayOfWeek] = { count: 0, revenue: 0 };
                }
                dayOfWeekMap[dayOfWeek].count++;
                dayOfWeekMap[dayOfWeek].revenue += total;

                // Customer retention
                if (!customerOrdersMap[customerId]) {
                    customerOrdersMap[customerId] = { count: 0, spent: 0, lastOrder: null };
                }
                customerOrdersMap[customerId].count++;
                customerOrdersMap[customerId].spent += total;
                if (!customerOrdersMap[customerId].lastOrder || orderDate > customerOrdersMap[customerId].lastOrder!) {
                    customerOrdersMap[customerId].lastOrder = orderDate;
                }

                // Delivery time analysis
                if (deliveredAt && orderDate) {
                    const deliveryTimeMinutes = Math.round((deliveredAt.getTime() - orderDate.getTime()) / 60000);
                    if (deliveryTimeMinutes > 0 && deliveryTimeMinutes < 300) {
                        deliveryTimes.push(deliveryTimeMinutes);

                        if (!vendorDeliveryTimes[vendorId]) {
                            vendorDeliveryTimes[vendorId] = [];
                        }
                        vendorDeliveryTimes[vendorId].push(deliveryTimeMinutes);

                        if (!areaDeliveryTimes[areaKey]) {
                            areaDeliveryTimes[areaKey] = [];
                        }
                        areaDeliveryTimes[areaKey].push(deliveryTimeMinutes);
                    }
                }
            } else if (order.status === 'Cancelled') {
                totalCancellations++;
                vendorRevenueMap[vendorId].cancelledOrders++;
                vendorCancellations[vendorId].cancelled++;
                dailyCancellations[dayKey].cancelled++;

                const reason = order.cancellationReason || order.cancelReason || 'Not Specified';
                if (!cancellationReasons[reason]) {
                    cancellationReasons[reason] = 0;
                }
                cancellationReasons[reason]++;

                const hour = orderDate.getHours();
                if (!hourlyCancellations[hour]) {
                    hourlyCancellations[hour] = 0;
                }
                hourlyCancellations[hour]++;
            }
        });

        // Calculate averages for vendor revenue
        Object.values(vendorRevenueMap).forEach(vendor => {
            vendor.averageOrderValue = vendor.completedOrders > 0 
                ? Math.round(vendor.totalRevenue / vendor.completedOrders) 
                : 0;
            vendor.cancellationRate = vendor.totalOrders > 0 
                ? Math.round((vendor.cancelledOrders / vendor.totalOrders) * 100 * 10) / 10 
                : 0;
        });

        // Calculate averages for area revenue
        Object.values(areaRevenueMap).forEach(area => {
            area.averageOrderValue = area.totalOrders > 0 
                ? Math.round(area.totalRevenue / area.totalOrders) 
                : 0;
        });

        // Build peak hours data
        const peakHours: HourlyData[] = [];
        for (let h = 0; h < 24; h++) {
            const data = hourlyOrdersMap[h] || { count: 0, revenue: 0 };
            peakHours.push({
                hour: h,
                hourLabel: h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`,
                orderCount: data.count,
                revenue: Math.round(data.revenue)
            });
        }

        // Build day of week data
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const ordersByDayOfWeek: DayOfWeekData[] = dayNames.map((day, index) => {
            const data = dayOfWeekMap[index] || { count: 0, revenue: 0 };
            return {
                day,
                dayIndex: index,
                orderCount: data.count,
                revenue: Math.round(data.revenue)
            };
        });

        // Build customer retention data
        const customersList = Object.entries(customerOrdersMap);
        let oneOrder = 0, twoToFive = 0, sixToTen = 0, moreThanTen = 0;
        let returningCustomers = 0;

        customersList.forEach(([, data]) => {
            if (data.count === 1) oneOrder++;
            else if (data.count >= 2 && data.count <= 5) { twoToFive++; returningCustomers++; }
            else if (data.count >= 6 && data.count <= 10) { sixToTen++; returningCustomers++; }
            else if (data.count > 10) { moreThanTen++; returningCustomers++; }
        });

        const topCustomers = customersList
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10)
            .map(([customerId, data]) => ({
                customerId,
                customerName: customerLookup[customerId] || 'Unknown',
                totalOrders: data.count,
                totalSpent: Math.round(data.spent),
                lastOrderDate: data.lastOrder?.toISOString().split('T')[0] || 'N/A'
            }));

        const totalCustomersWithOrders = customersList.length;
        const avgOrdersPerCustomer = totalCustomersWithOrders > 0
            ? Math.round((customersList.reduce((sum, [, d]) => sum + d.count, 0) / totalCustomersWithOrders) * 10) / 10
            : 0;

        const customerRetention: CustomerRetention = {
            totalCustomers: customersSnapshot.size,
            newCustomers: totalCustomersWithOrders - returningCustomers,
            returningCustomers,
            retentionRate: totalCustomersWithOrders > 0 
                ? Math.round((returningCustomers / totalCustomersWithOrders) * 100 * 10) / 10 
                : 0,
            averageOrdersPerCustomer: avgOrdersPerCustomer,
            customersByOrderCount: { oneOrder, twoToFive, sixToTen, moreThanTen },
            topCustomers
        };

        // Build delivery time analysis
        const avgDeliveryTime = deliveryTimes.length > 0
            ? Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length)
            : 0;
        const fastestDelivery = deliveryTimes.length > 0 ? Math.min(...deliveryTimes) : 0;
        const slowestDelivery = deliveryTimes.length > 0 ? Math.max(...deliveryTimes) : 0;

        const deliveryTimeByVendor = Object.entries(vendorDeliveryTimes)
            .map(([vendorId, times]) => ({
                vendorId,
                vendorName: vendorLookup[vendorId] || 'Unknown',
                averageTime: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
                totalDeliveries: times.length
            }))
            .sort((a, b) => a.averageTime - b.averageTime)
            .slice(0, 10);

        const deliveryTimeByArea = Object.entries(areaDeliveryTimes)
            .map(([key, times]) => {
                const [area, pincode] = key.split('|');
                return {
                    area,
                    pincode,
                    averageTime: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
                    totalDeliveries: times.length
                };
            })
            .sort((a, b) => b.totalDeliveries - a.totalDeliveries)
            .slice(0, 10);

        // Delivery time distribution
        const timeRanges = [
            { range: '0-15 min', min: 0, max: 15, count: 0 },
            { range: '15-30 min', min: 15, max: 30, count: 0 },
            { range: '30-45 min', min: 30, max: 45, count: 0 },
            { range: '45-60 min', min: 45, max: 60, count: 0 },
            { range: '60+ min', min: 60, max: Infinity, count: 0 }
        ];
        deliveryTimes.forEach(time => {
            const range = timeRanges.find(r => time >= r.min && time < r.max);
            if (range) range.count++;
        });

        const deliveryTimeDistribution = timeRanges.map(r => ({
            range: r.range,
            count: r.count,
            percentage: deliveryTimes.length > 0 ? Math.round((r.count / deliveryTimes.length) * 100 * 10) / 10 : 0
        }));

        const deliveryTimeAnalysis: DeliveryTimeAnalysis = {
            averageDeliveryTime: avgDeliveryTime,
            fastestDelivery,
            slowestDelivery,
            deliveryTimeByVendor,
            deliveryTimeByArea,
            deliveryTimeDistribution
        };

        // Build cancellation analysis
        const cancellationsByReason = Object.entries(cancellationReasons)
            .map(([reason, count]) => ({
                reason,
                count,
                percentage: totalCancellations > 0 ? Math.round((count / totalCancellations) * 100 * 10) / 10 : 0
            }))
            .sort((a, b) => b.count - a.count);

        const cancellationsByVendor = Object.entries(vendorCancellations)
            .filter(([, data]) => data.cancelled > 0)
            .map(([vendorId, data]) => ({
                vendorId,
                vendorName: vendorLookup[vendorId] || 'Unknown',
                cancellations: data.cancelled,
                totalOrders: data.total,
                cancellationRate: Math.round((data.cancelled / data.total) * 100 * 10) / 10
            }))
            .sort((a, b) => b.cancellations - a.cancellations)
            .slice(0, 10);

        const cancellationsByHour: Array<{ hour: number; hourLabel: string; count: number }> = [];
        for (let h = 0; h < 24; h++) {
            cancellationsByHour.push({
                hour: h,
                hourLabel: h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`,
                count: hourlyCancellations[h] || 0
            });
        }

        const cancellationTrend = Object.entries(dailyCancellations)
            .map(([date, data]) => ({
                date,
                cancellations: data.cancelled,
                totalOrders: data.total,
                rate: data.total > 0 ? Math.round((data.cancelled / data.total) * 100 * 10) / 10 : 0
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30);

        const cancellationAnalysis: CancellationAnalysis = {
            totalCancellations,
            cancellationRate: totalOrders > 0 ? Math.round((totalCancellations / totalOrders) * 100 * 10) / 10 : 0,
            cancellationsByReason,
            cancellationsByVendor,
            cancellationsByHour,
            cancellationTrend
        };

        // Final reports data
        const reportsData: ReportsData = {
            revenueByVendor: Object.values(vendorRevenueMap)
                .sort((a, b) => b.totalRevenue - a.totalRevenue)
                .slice(0, 20),
            revenueByArea: Object.values(areaRevenueMap)
                .sort((a, b) => b.totalRevenue - a.totalRevenue)
                .slice(0, 15),
            peakHours,
            ordersByDayOfWeek,
            customerRetention,
            deliveryTimeAnalysis,
            cancellationAnalysis,
            dateRange: {
                start: thirtyDaysAgo.toISOString().split('T')[0],
                end: now.toISOString().split('T')[0]
            }
        };

        return NextResponse.json({ success: true, data: reportsData });
    } catch (error) {
        console.error('Reports fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch reports data' },
            { status: 500 }
        );
    }
}
