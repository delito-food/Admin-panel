import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Get all delivery partners
        const deliverySnapshot = await db.collection(collections.deliveryPersons).get();
        
        // Get all orders
        const ordersSnapshot = await db.collection(collections.orders).get();
        
        // Build delivery partner performance data
        const deliveryPerformance: Record<string, {
            totalDeliveries: number;
            completedDeliveries: number;
            cancelledDeliveries: number;
            pendingDeliveries: number;
            totalEarnings: number;
            deliveryTimeSum: number;
            deliveryTimeCount: number;
            ratingSum: number;
            ratingCount: number;
            codCollected: number;
            codSettled: number;
            lastDeliveryDate: string | null;
        }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const deliveryPersonId = order.deliveryPersonId;
            if (!deliveryPersonId) return;

            if (!deliveryPerformance[deliveryPersonId]) {
                deliveryPerformance[deliveryPersonId] = {
                    totalDeliveries: 0,
                    completedDeliveries: 0,
                    cancelledDeliveries: 0,
                    pendingDeliveries: 0,
                    totalEarnings: 0,
                    deliveryTimeSum: 0,
                    deliveryTimeCount: 0,
                    ratingSum: 0,
                    ratingCount: 0,
                    codCollected: 0,
                    codSettled: 0,
                    lastDeliveryDate: null,
                };
            }

            deliveryPerformance[deliveryPersonId].totalDeliveries += 1;

            const status = order.status?.toLowerCase() || '';
            if (status === 'delivered' || status === 'completed') {
                deliveryPerformance[deliveryPersonId].completedDeliveries += 1;
                deliveryPerformance[deliveryPersonId].totalEarnings += (order.deliveryFee || 0);

                // Track COD collection
                if (order.paymentMode?.toLowerCase() === 'cod' || order.paymentMode?.toLowerCase() === 'cash') {
                    deliveryPerformance[deliveryPersonId].codCollected += (order.total || 0);
                }

                // Track delivery time
                if (order.actualDeliveryTime) {
                    deliveryPerformance[deliveryPersonId].deliveryTimeSum += order.actualDeliveryTime;
                    deliveryPerformance[deliveryPersonId].deliveryTimeCount += 1;
                }

                // Track delivery date
                const orderDate = order.deliveredAt?.toDate?.() || order.createdAt?.toDate?.() || order.createdAt;
                if (orderDate) {
                    const dateStr = orderDate instanceof Date 
                        ? orderDate.toISOString() 
                        : new Date(orderDate).toISOString();
                    if (!deliveryPerformance[deliveryPersonId].lastDeliveryDate || 
                        dateStr > deliveryPerformance[deliveryPersonId].lastDeliveryDate!) {
                        deliveryPerformance[deliveryPersonId].lastDeliveryDate = dateStr;
                    }
                }
            } else if (status === 'cancelled') {
                deliveryPerformance[deliveryPersonId].cancelledDeliveries += 1;
            } else if (status === 'out_for_delivery' || status === 'picked_up') {
                deliveryPerformance[deliveryPersonId].pendingDeliveries += 1;
            }

            // Track ratings
            if (order.deliveryRating) {
                deliveryPerformance[deliveryPersonId].ratingSum += order.deliveryRating;
                deliveryPerformance[deliveryPersonId].ratingCount += 1;
            }
        });

        // Build delivery partner list with performance data
        const deliveryPartners = deliverySnapshot.docs.map(doc => {
            const data = doc.data();
            const perf = deliveryPerformance[doc.id] || {
                totalDeliveries: 0,
                completedDeliveries: 0,
                cancelledDeliveries: 0,
                pendingDeliveries: 0,
                totalEarnings: 0,
                deliveryTimeSum: 0,
                deliveryTimeCount: 0,
                ratingSum: 0,
                ratingCount: 0,
                codCollected: 0,
                codSettled: 0,
                lastDeliveryDate: null,
            };

            const successRate = perf.totalDeliveries > 0 
                ? Math.round((perf.completedDeliveries / perf.totalDeliveries) * 100 * 10) / 10 
                : 0;

            const avgDeliveryTime = perf.deliveryTimeCount > 0
                ? Math.round(perf.deliveryTimeSum / perf.deliveryTimeCount)
                : 0;

            const avgRating = perf.ratingCount > 0
                ? Math.round((perf.ratingSum / perf.ratingCount) * 10) / 10
                : data.rating || 0;

            // COD data from Firestore or calculated
            const codCollected = data.codCollected || perf.codCollected || 0;
            const codSettled = data.codSettled || perf.codSettled || 0;
            const codPending = codCollected - codSettled;

            return {
                deliveryPersonId: doc.id,
                fullName: data.fullName || 'Unknown',
                profilePhotoUrl: data.profilePhotoUrl || '',
                phoneNumber: data.phoneNumber || '',
                email: data.email || '',
                city: data.city || '',
                vehicleType: data.vehicleType || '',
                vehicleNumber: data.vehicleNumber || '',
                isOnline: data.isOnline || false,
                isOnDelivery: data.isOnDelivery || false,
                isVerified: data.isVerified || false,
                // Performance metrics
                totalDeliveries: perf.totalDeliveries || data.totalDeliveries || 0,
                completedDeliveries: perf.completedDeliveries,
                cancelledDeliveries: perf.cancelledDeliveries,
                pendingDeliveries: perf.pendingDeliveries,
                successRate: successRate,
                avgDeliveryTime: avgDeliveryTime,
                avgRating: avgRating,
                totalRatings: perf.ratingCount,
                totalEarnings: perf.totalEarnings || data.totalEarnings || 0,
                // COD tracking
                codCollected: codCollected,
                codSettled: codSettled,
                codPending: codPending,
                lastDeliveryDate: perf.lastDeliveryDate,
            };
        });

        // Sort by total deliveries
        deliveryPartners.sort((a, b) => b.totalDeliveries - a.totalDeliveries);

        // Calculate summary stats
        const summary = {
            totalPartners: deliveryPartners.length,
            activePartners: deliveryPartners.filter(d => d.isOnline).length,
            onDelivery: deliveryPartners.filter(d => d.isOnDelivery).length,
            totalDeliveries: deliveryPartners.reduce((sum, d) => sum + d.totalDeliveries, 0),
            avgSuccessRate: deliveryPartners.length > 0
                ? Math.round((deliveryPartners.reduce((sum, d) => sum + d.successRate, 0) / deliveryPartners.length) * 10) / 10
                : 0,
            avgRating: deliveryPartners.length > 0
                ? Math.round((deliveryPartners.reduce((sum, d) => sum + d.avgRating, 0) / deliveryPartners.length) * 10) / 10
                : 0,
            totalCodPending: deliveryPartners.reduce((sum, d) => sum + d.codPending, 0),
        };

        return NextResponse.json({
            success: true,
            data: {
                deliveryPartners,
                summary,
            }
        });
    } catch (error) {
        console.error('Delivery performance fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch delivery performance' },
            { status: 500 }
        );
    }
}
