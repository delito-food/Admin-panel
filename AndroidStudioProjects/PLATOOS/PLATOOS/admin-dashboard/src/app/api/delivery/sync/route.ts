import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Constants for delivery earnings calculation
const BASE_DELIVERY_FEE = 10; // ₹10 base
const PER_KM_RATE = 6.5; // ₹6.5 per km

/**
 * Sync/recalculate earnings for all delivery partners
 * This is useful when data is out of sync
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { deliveryPersonId } = body;

        // Get delivery partners to sync
        let deliveryPartnerIds: string[] = [];

        if (deliveryPersonId) {
            deliveryPartnerIds = [deliveryPersonId];
        } else {
            const deliverySnapshot = await db.collection(collections.deliveryPersons).get();
            deliveryPartnerIds = deliverySnapshot.docs.map(doc => doc.id);
        }

        const results: Array<{ id: string; success: boolean; earnings: number; deliveries: number }> = [];

        for (const dpId of deliveryPartnerIds) {
            try {
                let calculatedEarnings = 0;
                let deliveryCount = 0;
                let tips = 0;
                let codCollected = 0;

                // Calculate from deliveryTasks (primary source)
                const tasksSnapshot = await db.collection('deliveryTasks')
                    .where('deliveryPersonId', '==', dpId)
                    .where('status', '==', 'DELIVERED')
                    .get();

                tasksSnapshot.docs.forEach(doc => {
                    const task = doc.data();
                    const distanceKm = task.distanceKm || (task.deliveryDistanceMeters ?
                        (task.deliveryDistanceMeters || 0) / 1000 : 0);

                    const deliveryEarnings = task.deliveryEarnings || task.deliveryPersonEarnings ||
                        (distanceKm > 0 ? Math.round(BASE_DELIVERY_FEE + (distanceKm * PER_KM_RATE)) :
                        (task.deliveryFee || BASE_DELIVERY_FEE));

                    const tip = task.tip || 0;

                    calculatedEarnings += deliveryEarnings + tip;
                    tips += tip;
                    deliveryCount++;

                    // Track COD
                    if (task.paymentMode?.toUpperCase() === 'COD' && task.codCollected && !task.codSettled) {
                        codCollected += task.codAmount || task.orderTotal || 0;
                    }
                });

                // If no tasks found, try orders collection
                if (deliveryCount === 0) {
                    const ordersSnapshot = await db.collection(collections.orders)
                        .where('deliveryPersonId', '==', dpId)
                        .get();

                    ordersSnapshot.docs.forEach(doc => {
                        const order = doc.data();
                        const status = order.status?.toLowerCase() || '';

                        if (status !== 'delivered' && status !== 'completed') return;

                        const distanceKm = order.distanceKm || 0;
                        const deliveryPersonEarnings = order.deliveryPersonEarnings ||
                            (distanceKm > 0 ? Math.round(BASE_DELIVERY_FEE + (distanceKm * PER_KM_RATE)) :
                            (order.deliveryFee || BASE_DELIVERY_FEE));

                        const tip = order.tip || 0;

                        calculatedEarnings += deliveryPersonEarnings + tip;
                        tips += tip;
                        deliveryCount++;
                    });
                }

                // Get current delivery person data
                const deliveryPersonRef = db.collection(collections.deliveryPersons).doc(dpId);
                const deliveryPersonDoc = await deliveryPersonRef.get();
                const currentData = deliveryPersonDoc.data() || {};

                // Only update if we found data
                if (deliveryCount > 0) {
                    const paidAmount = currentData.paidAmount || 0;

                    await deliveryPersonRef.update({
                        totalEarnings: calculatedEarnings,
                        totalDeliveries: deliveryCount,
                        // Keep codCollected if it's higher (might have been set elsewhere)
                        codCollected: Math.max(codCollected, currentData.codCollected || 0),
                        updatedAt: Timestamp.now(),
                    });

                    results.push({
                        id: dpId,
                        success: true,
                        earnings: calculatedEarnings,
                        deliveries: deliveryCount,
                    });
                } else {
                    results.push({
                        id: dpId,
                        success: true,
                        earnings: 0,
                        deliveries: 0,
                    });
                }
            } catch (error) {
                console.error(`Error syncing earnings for ${dpId}:`, error);
                results.push({
                    id: dpId,
                    success: false,
                    earnings: 0,
                    deliveries: 0,
                });
            }
        }

        return NextResponse.json({
            success: true,
            message: `Synced ${results.filter(r => r.success).length}/${results.length} delivery partners`,
            results,
        });
    } catch (error) {
        console.error('Delivery earnings sync error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to sync delivery earnings' },
            { status: 500 }
        );
    }
}

