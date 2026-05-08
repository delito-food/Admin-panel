import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth, unauthorizedResponse, checkRateLimit, rateLimitedResponse } from '@/lib/api-auth';

/**
 * POST /api/orders/cancel
 * Admin cancels an order at any stage.
 * - Sets order status to "Cancelled by Admin"
 * - Cancels associated delivery task
 * - Auto-initiates refund if payment was online & paid
 * - Creates a cancellation record for audit trail
 */
export async function POST(request: Request) {
    try {
        // Auth check
        const authResult = await verifyApiAuth(request);
        if (!authResult.authenticated) {
            return unauthorizedResponse(authResult.error);
        }

        // Rate limit: 10 cancels per minute per user
        const rl = checkRateLimit(`cancel:${authResult.uid}`, 10, 60_000);
        if (!rl.allowed) return rateLimitedResponse();

        const body = await request.json();
        const { orderId, reason, adminId } = body;

        if (!orderId) {
            return NextResponse.json(
                { success: false, error: 'Order ID is required' },
                { status: 400 }
            );
        }

        // 1. Get the order
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderDoc.data()!;
        const currentStatus = orderData.status || '';

        // Check if already cancelled/delivered
        if (currentStatus === 'Delivered' || currentStatus === 'Completed') {
            return NextResponse.json(
                { success: false, error: 'Cannot cancel a delivered/completed order. Process a refund instead.' },
                { status: 400 }
            );
        }

        if (currentStatus === 'Cancelled' || currentStatus === 'Cancelled by Admin') {
            return NextResponse.json(
                { success: false, error: 'Order is already cancelled' },
                { status: 400 }
            );
        }

        const batch = db.batch();

        // 2. Update order status
        batch.update(orderRef, {
            status: 'Cancelled by Admin',
            cancelledByAdmin: true,
            adminCancellationReason: reason || 'Cancelled by admin due to technical reasons',
            cancelledAt: Timestamp.now(),
            cancelledBy: adminId || 'admin',
            updatedAt: Timestamp.now(),
        });

        // 3. Cancel associated delivery tasks
        const tasksSnapshot = await db.collection(collections.deliveryTasks)
            .where('orderId', '==', orderId)
            .get();

        let deliveryPersonId: string | null = null;

        tasksSnapshot.docs.forEach(taskDoc => {
            const taskData = taskDoc.data();
            deliveryPersonId = taskData.deliveryPersonId || null;

            batch.update(taskDoc.ref, {
                status: 'CANCELLED',
                cancelledByAdmin: true,
                cancellationReason: reason || 'Order cancelled by admin',
                cancelledAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
        });

        // 4. If a delivery person was assigned, free them up
        if (deliveryPersonId || orderData.deliveryPersonId) {
            const dpId = deliveryPersonId || orderData.deliveryPersonId;
            const dpRef = db.collection(collections.deliveryPersons).doc(dpId);
            const dpDoc = await dpRef.get();

            if (dpDoc.exists) {
                const dpData = dpDoc.data()!;
                // Only update if they're currently on this order
                if (dpData.currentOrderId === orderId) {
                    batch.update(dpRef, {
                        currentOrderId: null,
                        isAvailable: true,
                        updatedAt: Timestamp.now(),
                    });
                }
            }
        }

        // 5. Cancel any pending delivery requests for this order
        const pendingRequests = await db.collection('pendingDeliveryRequests')
            .where('orderId', '==', orderId)
            .get();

        pendingRequests.docs.forEach(reqDoc => {
            batch.update(reqDoc.ref, {
                status: 'CANCELLED',
                cancelledByAdmin: true,
                updatedAt: Timestamp.now(),
            });
        });

        // 5b. Cancel any pending referral associated with this order
        const referralSnapshot = await db.collection('referrals')
            .where('orderId', '==', orderId)
            .where('status', '==', 'pending')
            .get();

        referralSnapshot.docs.forEach(refDoc => {
            batch.update(refDoc.ref, {
                status: 'cancelled',
                cancelledByAdmin: true,
                completedAt: Timestamp.now(),
            });
        });

        // Commit all batch updates
        await batch.commit();

        // 6. Handle refund for online payments
        let refundResult = null;
        const paymentMode = (orderData.paymentMode || '').toLowerCase();
        const paymentStatus = (orderData.paymentStatus || '').toLowerCase();
        const isOnlinePayment = paymentMode === 'online' || paymentMode === 'razorpay' || paymentMode === 'upi';
        const isPaid = paymentStatus === 'paid' || paymentStatus === 'success' || paymentStatus === 'completed';

        if (isOnlinePayment && isPaid) {
            // Set refund fields on the order for apps to detect
            await orderRef.update({
                refundStatus: 'PENDING',
                refundAmount: orderData.total || 0,
                refundRequestedAt: Timestamp.now(),
                refundReason: `Order cancelled by admin: ${reason || 'Technical reasons'}`,
            });

            // Auto-initiate full refund via API
            try {
                const refundResponse = await fetch(new URL('/api/refunds', request.url).toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderId,
                        amount: orderData.total || 0,
                        reason: `Admin cancelled order: ${reason || 'Technical reasons'}`,
                        refundType: 'full',
                    }),
                });

                refundResult = await refundResponse.json();
            } catch (refundError) {
                console.error('Auto-refund failed:', refundError);
                // Don't fail the cancellation, just log the refund error
                refundResult = { success: false, error: 'Auto-refund failed. Process manually.' };
            }
        }

        // Invalidate caches
        invalidateCache(collections.orders);
        invalidateCache(collections.deliveryTasks);
        invalidateCache('pendingDeliveryRequests');

        return NextResponse.json({
            success: true,
            message: 'Order cancelled by admin successfully',
            data: {
                orderId,
                previousStatus: currentStatus,
                newStatus: 'Cancelled by Admin',
                deliveryTasksCancelled: tasksSnapshot.docs.length,
                refundInitiated: isOnlinePayment && isPaid,
                refundResult,
            },
        });
    } catch (error) {
        console.error('Admin cancel order error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to cancel order' },
            { status: 500 }
        );
    }
}



