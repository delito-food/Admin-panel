import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Get all delivery partners
        const deliverySnapshot = await db.collection(collections.deliveryPersons).get();

        // Get all orders
        const ordersSnapshot = await db.collection(collections.orders).get();

        // Get payout history
        const payoutsSnapshot = await db.collection('deliveryPayouts')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        // Calculate delivery partner earnings
        const deliveryEarnings: Record<string, {
            totalEarnings: number;
            deliveryCount: number;
            incentives: number;
            lastDeliveryDate: string | null;
        }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const deliveryPersonId = order.deliveryPersonId;
            const status = order.status?.toLowerCase() || '';

            if (!deliveryPersonId) return;
            if (status !== 'delivered' && status !== 'completed') return;

            if (!deliveryEarnings[deliveryPersonId]) {
                deliveryEarnings[deliveryPersonId] = {
                    totalEarnings: 0,
                    deliveryCount: 0,
                    incentives: 0,
                    lastDeliveryDate: null,
                };
            }

            // Delivery person earnings (Base ₹10 + ₹6.5/km) - NOT the customer delivery fee
            // deliveryPersonEarnings is the correct field, fallback to calculating from distance
            const deliveryPersonEarnings = order.deliveryPersonEarnings ||
                (order.distanceKm ? Math.round(10 + (order.distanceKm * 6.5)) : (order.deliveryFee || 0));

            deliveryEarnings[deliveryPersonId].totalEarnings += deliveryPersonEarnings;
            deliveryEarnings[deliveryPersonId].deliveryCount += 1;

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
                lastDeliveryDate: null,
            };

            const totalEarnings = earnings.totalEarnings + (data.incentives || 0);
            const paidAmount = paidByPartner[doc.id] || data.paidAmount || 0;
            const pendingAmount = Math.max(0, totalEarnings - paidAmount);

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
                // Earnings
                totalEarnings: totalEarnings,
                deliveryFees: earnings.totalEarnings,
                incentives: data.incentives || earnings.incentives || 0,
                deliveryCount: earnings.deliveryCount || data.totalDeliveries || 0,
                paidAmount: paidAmount,
                pendingAmount: pendingAmount,
                lastDeliveryDate: earnings.lastDeliveryDate,
            };
        });

        // Sort by pending amount (highest first), then by name
        deliveryPartners.sort((a, b) => b.pendingAmount - a.pendingAmount || a.fullName.localeCompare(b.fullName));

        // Calculate summary
        const summary = {
            totalPendingPayouts: deliveryPartners.reduce((sum, d) => sum + d.pendingAmount, 0),
            totalPaidAmount: deliveryPartners.reduce((sum, d) => sum + d.paidAmount, 0),
            totalEarnings: deliveryPartners.reduce((sum, d) => sum + d.totalEarnings, 0),
            partnersWithPending: deliveryPartners.filter(d => d.pendingAmount > 0).length,
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

        // Calculate totalEarnings if not set (sync from deliveryTasks)
        let updateData: Record<string, unknown> = {
            paidAmount: (currentData.paidAmount || 0) + amount,
            lastPayoutAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        // If totalEarnings is 0, calculate from orders
        if (!currentData.totalEarnings || currentData.totalEarnings <= 0) {
            const ordersSnapshot = await db.collection(collections.orders)
                .where('deliveryPersonId', '==', deliveryPersonId)
                .where('status', 'in', ['delivered', 'completed', 'Delivered', 'Completed', 'DELIVERED'])
                .get();

            let calculatedEarnings = 0;
            let deliveryCount = 0;

            ordersSnapshot.docs.forEach(doc => {
                const order = doc.data();
                const deliveryPersonEarnings = order.deliveryPersonEarnings ||
                    (order.distanceKm ? Math.round(10 + (order.distanceKm * 6.5)) : (order.deliveryFee || 0));
                calculatedEarnings += deliveryPersonEarnings + (order.tip || 0);
                deliveryCount++;
            });

            if (calculatedEarnings > 0) {
                updateData.totalEarnings = calculatedEarnings;
                updateData.totalDeliveries = deliveryCount;
            }
        }

        await deliveryPersonRef.update(updateData);

        return NextResponse.json({
            success: true,
            message: `Payout of ₹${amount} processed successfully`,
            payoutId: payoutRef.id,
        });
    } catch (error) {
        console.error('Delivery payout processing error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process payout' },
            { status: 500 }
        );
    }
}
