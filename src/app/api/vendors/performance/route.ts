import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';

export async function GET() {
    try {
        // Get all vendors
        const vendorsSnapshot = await db.collection(collections.vendors).get();
        
        // Get all orders
        const ordersSnapshot = await db.collection(collections.orders).get();
        
        // Build vendor performance data
        const vendorPerformance: Record<string, {
            totalOrders: number;
            completedOrders: number;
            cancelledOrders: number;
            totalRevenue: number;
            totalRatings: number;
            ratingSum: number;
            pendingOrders: number;
            preparingOrders: number;
            avgPreparationTime: number;
            preparationTimeSum: number;
            prepTimeCount: number;
        }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const vendorId = order.vendorId;
            if (!vendorId) return;

            if (!vendorPerformance[vendorId]) {
                vendorPerformance[vendorId] = {
                    totalOrders: 0,
                    completedOrders: 0,
                    cancelledOrders: 0,
                    totalRevenue: 0,
                    totalRatings: 0,
                    ratingSum: 0,
                    pendingOrders: 0,
                    preparingOrders: 0,
                    avgPreparationTime: 0,
                    preparationTimeSum: 0,
                    prepTimeCount: 0,
                };
            }

            vendorPerformance[vendorId].totalOrders += 1;

            const status = order.status?.toLowerCase() || '';
            if (status === 'delivered' || status === 'completed') {
                vendorPerformance[vendorId].completedOrders += 1;
                vendorPerformance[vendorId].totalRevenue += (order.subtotal || order.total || 0);
                
                // Calculate preparation time if available
                if (order.preparationTime) {
                    vendorPerformance[vendorId].preparationTimeSum += order.preparationTime;
                    vendorPerformance[vendorId].prepTimeCount += 1;
                }
            } else if (status === 'cancelled') {
                vendorPerformance[vendorId].cancelledOrders += 1;
            } else if (status === 'pending' || status === 'placed') {
                vendorPerformance[vendorId].pendingOrders += 1;
            } else if (status === 'preparing' || status === 'accepted') {
                vendorPerformance[vendorId].preparingOrders += 1;
            }

            // Track ratings
            if (order.vendorRating) {
                vendorPerformance[vendorId].ratingSum += order.vendorRating;
                vendorPerformance[vendorId].totalRatings += 1;
            }
        });

        // Build vendor list with performance data
        const vendors = vendorsSnapshot.docs.map(doc => {
            const data = doc.data();
            const perf = vendorPerformance[doc.id] || {
                totalOrders: 0,
                completedOrders: 0,
                cancelledOrders: 0,
                totalRevenue: 0,
                totalRatings: 0,
                ratingSum: 0,
                pendingOrders: 0,
                preparingOrders: 0,
                preparationTimeSum: 0,
                prepTimeCount: 0,
            };

            const cancellationRate = perf.totalOrders > 0 
                ? Math.round((perf.cancelledOrders / perf.totalOrders) * 100 * 10) / 10 
                : 0;
            
            const avgRating = perf.totalRatings > 0 
                ? Math.round((perf.ratingSum / perf.totalRatings) * 10) / 10 
                : data.rating || 0;

            const avgPrepTime = perf.prepTimeCount > 0
                ? Math.round(perf.preparationTimeSum / perf.prepTimeCount)
                : data.averageDeliveryTime || 30;

            const completionRate = perf.totalOrders > 0
                ? Math.round((perf.completedOrders / perf.totalOrders) * 100 * 10) / 10
                : 0;

            return {
                vendorId: doc.id,
                shopName: data.shopName || data.fullName || 'Unknown',
                fullName: data.fullName || '',
                shopImageUrl: data.shopImageUrl || data.profileImageUrl || '',
                city: data.city || '',
                pincode: data.pincode || '',
                isOnline: data.isOnline || false,
                isVerified: data.isVerified || false,
                cuisineTypes: data.cuisineTypes || [],
                // Performance metrics
                totalOrders: perf.totalOrders,
                completedOrders: perf.completedOrders,
                cancelledOrders: perf.cancelledOrders,
                pendingOrders: perf.pendingOrders,
                preparingOrders: perf.preparingOrders,
                totalRevenue: perf.totalRevenue,
                avgRating: avgRating,
                totalRatings: perf.totalRatings,
                cancellationRate: cancellationRate,
                completionRate: completionRate,
                avgPreparationTime: avgPrepTime,
                // Commission info
                commissionRate: data.commissionRate || 15, // Default 15%
                customCommission: data.customCommission || false,
            };
        });

        // Sort by total revenue
        vendors.sort((a, b) => b.totalRevenue - a.totalRevenue);

        // Calculate summary stats
        const summary = {
            totalVendors: vendors.length,
            activeVendors: vendors.filter(v => v.isOnline).length,
            totalRevenue: vendors.reduce((sum, v) => sum + v.totalRevenue, 0),
            totalOrders: vendors.reduce((sum, v) => sum + v.totalOrders, 0),
            avgCancellationRate: vendors.length > 0
                ? Math.round((vendors.reduce((sum, v) => sum + v.cancellationRate, 0) / vendors.length) * 10) / 10
                : 0,
            avgRating: vendors.length > 0
                ? Math.round((vendors.reduce((sum, v) => sum + v.avgRating, 0) / vendors.length) * 10) / 10
                : 0,
        };

        return NextResponse.json({ 
            success: true, 
            data: {
                vendors,
                summary
            }
        });
    } catch (error) {
        console.error('Vendor performance fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch vendor performance' },
            { status: 500 }
        );
    }
}
