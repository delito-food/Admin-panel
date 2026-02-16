import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Constants for delivery earnings calculation
const BASE_DELIVERY_FEE = 10; // ₹10 base
const PER_KM_RATE = 6.5; // ₹6.5 per km

export async function GET() {
    try {
        // Get all delivery partners
        const deliverySnapshot = await db.collection(collections.deliveryPersons).get();

        // Get all orders - check for delivered status
        const ordersSnapshot = await db.collection(collections.orders).get();

        // Get all delivery tasks (more reliable for delivery-specific data)
        const deliveryTasksSnapshot = await db.collection('deliveryTasks').get();

        // Get payout history
        const payoutsSnapshot = await db.collection('deliveryPayouts')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        // Calculate delivery partner earnings from BOTH orders and deliveryTasks
        const deliveryEarnings: Record<string, {
            totalEarnings: number;
            deliveryCount: number;
            incentives: number;
            tips: number;
            codCollected: number;
            codSettled: number;
            lastDeliveryDate: string | null;
            deliveryDetails: Array<{
                orderId: string;
                distanceKm: number;
                earnings: number;
                tip: number;
                date: string;
            }>;
        }> = {};

        // First, process deliveryTasks (more accurate for delivery person earnings)
        deliveryTasksSnapshot.docs.forEach(doc => {
            const task = doc.data();
            const deliveryPersonId = task.deliveryPersonId;
            const status = task.status?.toUpperCase() || '';

            if (!deliveryPersonId) return;
            if (status !== 'DELIVERED') return;

            if (!deliveryEarnings[deliveryPersonId]) {
                deliveryEarnings[deliveryPersonId] = {
                    totalEarnings: 0,
                    deliveryCount: 0,
                    incentives: 0,
                    tips: 0,
                    codCollected: 0,
                    codSettled: 0,
                    lastDeliveryDate: null,
                    deliveryDetails: [],
                };
            }

            // Calculate delivery earnings: Base ₹10 + ₹6.5/km
            const distanceKm = task.distanceKm || task.deliveryDistanceMeters ?
                (task.deliveryDistanceMeters || 0) / 1000 : 0;

            // Use pre-calculated earnings or calculate fresh
            const deliveryEarningsAmount = task.deliveryEarnings || task.deliveryPersonEarnings ||
                (distanceKm > 0 ? Math.round(BASE_DELIVERY_FEE + (distanceKm * PER_KM_RATE)) :
                (task.deliveryFee || BASE_DELIVERY_FEE));

            const tip = task.tip || 0;

            deliveryEarnings[deliveryPersonId].totalEarnings += deliveryEarningsAmount + tip;
            deliveryEarnings[deliveryPersonId].deliveryCount += 1;
            deliveryEarnings[deliveryPersonId].tips += tip;

            // Track COD
            if (task.paymentMode?.toUpperCase() === 'COD') {
                if (task.codCollected) {
                    deliveryEarnings[deliveryPersonId].codCollected += task.codAmount || task.orderTotal || 0;
                }
                if (task.codSettled) {
                    deliveryEarnings[deliveryPersonId].codSettled += task.codAmount || task.orderTotal || 0;
                }
            }

            // Track last delivery
            const taskDate = task.deliveredAt?.toDate?.() || task.createdAt?.toDate?.() || task.createdAt;
            if (taskDate) {
                const dateStr = taskDate instanceof Date
                    ? taskDate.toISOString()
                    : new Date(taskDate).toISOString();
                if (!deliveryEarnings[deliveryPersonId].lastDeliveryDate ||
                    dateStr > deliveryEarnings[deliveryPersonId].lastDeliveryDate!) {
                    deliveryEarnings[deliveryPersonId].lastDeliveryDate = dateStr;
                }

                deliveryEarnings[deliveryPersonId].deliveryDetails.push({
                    orderId: task.orderId || doc.id,
                    distanceKm: distanceKm,
                    earnings: deliveryEarningsAmount,
                    tip: tip,
                    date: dateStr,
                });
            }
        });

        // Fallback: Also check orders collection for any missing data
        const processedOrderIds = new Set(
            Object.values(deliveryEarnings).flatMap(e => e.deliveryDetails.map(d => d.orderId))
        );

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const deliveryPersonId = order.deliveryPersonId;
            const status = order.status?.toLowerCase() || '';

            if (!deliveryPersonId) return;
            if (status !== 'delivered' && status !== 'completed') return;
            if (processedOrderIds.has(doc.id)) return; // Already processed from tasks

            if (!deliveryEarnings[deliveryPersonId]) {
                deliveryEarnings[deliveryPersonId] = {
                    totalEarnings: 0,
                    deliveryCount: 0,
                    incentives: 0,
                    tips: 0,
                    codCollected: 0,
                    codSettled: 0,
                    lastDeliveryDate: null,
                    deliveryDetails: [],
                };
            }

            // Delivery person earnings (Base ₹10 + ₹6.5/km)
            const distanceKm = order.distanceKm || 0;
            const deliveryPersonEarnings = order.deliveryPersonEarnings ||
                (distanceKm > 0 ? Math.round(BASE_DELIVERY_FEE + (distanceKm * PER_KM_RATE)) :
                (order.deliveryFee || BASE_DELIVERY_FEE));

            const tip = order.tip || 0;

            deliveryEarnings[deliveryPersonId].totalEarnings += deliveryPersonEarnings + tip;
            deliveryEarnings[deliveryPersonId].deliveryCount += 1;
            deliveryEarnings[deliveryPersonId].tips += tip;

            // Track last delivery
            const orderDate = order.deliveredAt?.toDate?.() || order.createdAt?.toDate?.() || order.createdAt;
            if (orderDate) {
                const dateStr = orderDate instanceof Date
                    ? orderDate.toISOString()
                    : new Date(orderDate).toISOString();
                if (!deliveryEarnings[deliveryPersonId].lastDeliveryDate ||
                    dateStr > deliveryEarnings[deliveryPersonId].lastDeliveryDate!) {
                    deliveryEarnings[deliveryPersonId].lastDeliveryDate = dateStr;
                }
            }
        });

        // Process payout history
        const paidByPartner: Record<string, number> = {};
        const recentPayouts: Array<{
            payoutId: string;
            deliveryPersonId: string;
            deliveryPersonName: string;
            amount: number;
            method: string;
            status: string;
            createdAt: string;
            processedAt: string | null;
            transactionId: string | null;
            notes: string | null;
        }> = [];

        payoutsSnapshot.docs.forEach(doc => {
            const payout = doc.data();
            const deliveryPersonId = payout.deliveryPersonId;

            if (payout.status === 'completed' || payout.status === 'processed') {
                paidByPartner[deliveryPersonId] =
                    (paidByPartner[deliveryPersonId] || 0) + (payout.amount || 0);
            }

            recentPayouts.push({
                payoutId: doc.id,
                deliveryPersonId: payout.deliveryPersonId || '',
                deliveryPersonName: payout.deliveryPersonName || '',
                amount: payout.amount || 0,
                method: payout.method || 'Bank Transfer',
                status: payout.status || 'pending',
                createdAt: payout.createdAt?.toDate?.()?.toISOString() || '',
                processedAt: payout.processedAt?.toDate?.()?.toISOString() || null,
                transactionId: payout.transactionId || null,
                notes: payout.notes || null,
            });
        });

        // Build delivery partner payout data
        const deliveryPartners = deliverySnapshot.docs.map(doc => {
            const data = doc.data();
            const earnings = deliveryEarnings[doc.id] || {
                totalEarnings: 0,
                deliveryCount: 0,
                incentives: 0,
                tips: 0,
                codCollected: 0,
                codSettled: 0,
                lastDeliveryDate: null,
                deliveryDetails: [],
            };

            // Also check directly from delivery person document if deliveryTasks show 0
            const docTotalEarnings = data.totalEarnings || 0;
            const docTotalDeliveries = data.totalDeliveries || 0;

            // Use whichever is higher (Firestore doc or calculated)
            const calculatedTotalEarnings = earnings.totalEarnings + (data.incentives || 0);
            const totalEarnings = Math.max(calculatedTotalEarnings, docTotalEarnings);
            const deliveryCount = Math.max(earnings.deliveryCount, docTotalDeliveries);

            const paidAmount = paidByPartner[doc.id] || data.paidAmount || 0;
            const pendingAmount = Math.max(0, totalEarnings - paidAmount);

            // COD data from earnings or delivery person doc
            const codCollected = earnings.codCollected || data.codCollected || 0;
            const codSettled = earnings.codSettled || data.codSettled || 0;
            const codPending = Math.max(0, codCollected - codSettled);

            return {
                deliveryPersonId: doc.id,
                fullName: data.fullName || 'Unknown',
                profilePhotoUrl: data.profilePhotoUrl || '',
                phoneNumber: data.phoneNumber || '',
                email: data.email || '',
                city: data.city || '',
                isOnline: data.isOnline || false,
                isVerified: data.isVerified || false,
                bankDetails: data.bankDetails || null,
                upiId: data.upiId || null,
                // Earnings breakdown
                totalEarnings: totalEarnings,
                deliveryFees: Math.max(earnings.totalEarnings - earnings.tips, 0),
                tips: earnings.tips,
                incentives: data.incentives || earnings.incentives || 0,
                deliveryCount: deliveryCount,
                paidAmount: paidAmount,
                pendingAmount: pendingAmount,
                // COD tracking
                codCollected: codCollected,
                codSettled: codSettled,
                codPending: codPending,
                lastDeliveryDate: earnings.lastDeliveryDate,
                // Delivery details for breakdown
                recentDeliveries: earnings.deliveryDetails?.slice(0, 10) || [],
            };
        });

        // Sort by pending amount (highest first), then by name
        deliveryPartners.sort((a, b) => b.pendingAmount - a.pendingAmount || a.fullName.localeCompare(b.fullName));

        // Calculate summary
        const summary = {
            totalPendingPayouts: deliveryPartners.reduce((sum, d) => sum + d.pendingAmount, 0),
            totalPaidAmount: deliveryPartners.reduce((sum, d) => sum + d.paidAmount, 0),
            totalEarnings: deliveryPartners.reduce((sum, d) => sum + d.totalEarnings, 0),
            totalTips: deliveryPartners.reduce((sum, d) => sum + d.tips, 0),
            totalDeliveryFees: deliveryPartners.reduce((sum, d) => sum + d.deliveryFees, 0),
            totalDeliveries: deliveryPartners.reduce((sum, d) => sum + d.deliveryCount, 0),
            totalCodCollected: deliveryPartners.reduce((sum, d) => sum + d.codCollected, 0),
            totalCodSettled: deliveryPartners.reduce((sum, d) => sum + d.codSettled, 0),
            totalCodPending: deliveryPartners.reduce((sum, d) => sum + d.codPending, 0),
            partnersWithPending: deliveryPartners.filter(d => d.pendingAmount > 0).length,
            activePartners: deliveryPartners.filter(d => d.deliveryCount > 0).length,
        };

        return NextResponse.json({
            success: true,
            data: {
                deliveryPartners,
                recentPayouts,
                summary,
            }
        });
    } catch (error) {
        console.error('Delivery payouts fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch delivery payouts' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { deliveryPersonId, deliveryPersonName, amount, method, transactionId, notes } = body;

        if (!deliveryPersonId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Delivery person ID and valid amount required' },
                { status: 400 }
            );
        }

        // Create payout record
        const payoutRef = await db.collection('deliveryPayouts').add({
            deliveryPersonId,
            deliveryPersonName: deliveryPersonName || '',
            amount,
            method: method || 'Bank Transfer',
            status: 'completed',
            transactionId: transactionId || null,
            notes: notes || null,
            createdAt: Timestamp.now(),
            processedAt: Timestamp.now(),
        });

        // Update delivery person's paid amount
        const deliveryPersonRef = db.collection(collections.deliveryPersons).doc(deliveryPersonId);
        const deliveryPersonDoc = await deliveryPersonRef.get();
        const currentData = deliveryPersonDoc.data() || {};

        const newPaidAmount = (currentData.paidAmount || 0) + amount;
        const totalEarnings = currentData.totalEarnings || 0;
        const newPendingPayout = Math.max(0, totalEarnings - newPaidAmount);

        // Calculate totalEarnings if not set (sync from deliveryTasks)
        let updateData: Record<string, unknown> = {
            paidAmount: newPaidAmount,
            pendingPayout: newPendingPayout,
            lastPayoutAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        // If totalEarnings is 0, calculate from deliveryTasks and orders
        if (!currentData.totalEarnings || currentData.totalEarnings <= 0) {
            let calculatedEarnings = 0;
            let deliveryCount = 0;
            let tips = 0;

            // First try deliveryTasks (more accurate)
            const tasksSnapshot = await db.collection('deliveryTasks')
                .where('deliveryPersonId', '==', deliveryPersonId)
                .where('status', '==', 'DELIVERED')
                .get();

            tasksSnapshot.docs.forEach(doc => {
                const task = doc.data();
                const distanceKm = task.distanceKm || task.deliveryDistanceMeters ?
                    (task.deliveryDistanceMeters || 0) / 1000 : 0;
                const deliveryEarnings = task.deliveryEarnings || task.deliveryPersonEarnings ||
                    (distanceKm > 0 ? Math.round(BASE_DELIVERY_FEE + (distanceKm * PER_KM_RATE)) :
                    (task.deliveryFee || BASE_DELIVERY_FEE));
                const tip = task.tip || 0;

                calculatedEarnings += deliveryEarnings + tip;
                tips += tip;
                deliveryCount++;
            });

            // Fallback to orders if no tasks found
            if (deliveryCount === 0) {
                const ordersSnapshot = await db.collection(collections.orders)
                    .where('deliveryPersonId', '==', deliveryPersonId)
                    .where('status', 'in', ['delivered', 'completed', 'Delivered', 'Completed', 'DELIVERED'])
                    .get();

                ordersSnapshot.docs.forEach(doc => {
                    const order = doc.data();
                    const deliveryPersonEarnings = order.deliveryPersonEarnings ||
                        (order.distanceKm ? Math.round(BASE_DELIVERY_FEE + (order.distanceKm * PER_KM_RATE)) : (order.deliveryFee || BASE_DELIVERY_FEE));
                    const tip = order.tip || 0;
                    calculatedEarnings += deliveryPersonEarnings + tip;
                    tips += tip;
                    deliveryCount++;
                });
            }

            if (calculatedEarnings > 0) {
                updateData.totalEarnings = calculatedEarnings;
                updateData.totalDeliveries = deliveryCount;
                // Recalculate pending payout with new total
                updateData.pendingPayout = Math.max(0, calculatedEarnings - newPaidAmount);
            }
        }

        await deliveryPersonRef.update(updateData);

        return NextResponse.json({
            success: true,
            message: `Payout of ₹${amount} processed successfully`,
            payoutId: payoutRef.id,
            newPaidAmount,
            newPendingPayout: updateData.pendingPayout,
        });
    } catch (error) {
        console.error('Delivery payout processing error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process payout' },
            { status: 500 }
        );
    }
}
