import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import crypto from 'crypto';

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

/**
 * POST /api/webhooks/razorpay
 * Handles Razorpay webhook events for async payment reconciliation.
 * Configure this URL in Razorpay Dashboard → Webhooks:
 *   https://admin-panel-green-beta.vercel.app/api/webhooks/razorpay
 *
 * Events handled:
 *   - payment.authorized → auto-capture or mark as authorized
 *   - payment.captured → confirm payment in Firestore
 *   - payment.failed → mark order payment as failed
 *   - refund.created / refund.processed / refund.failed → update refund status
 *   - payout.processed / payout.reversed → update payout status
 */
export async function POST(request: Request) {
    try {
        const rawBody = await request.text();
        const signature = request.headers.get('x-razorpay-signature') || '';

        // Verify webhook signature
        if (RAZORPAY_WEBHOOK_SECRET) {
            const expectedSignature = crypto
                .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
                .update(rawBody)
                .digest('hex');

            // Use timing-safe comparison to prevent timing attacks
            const sigBuffer = Buffer.from(signature, 'utf8');
            const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
            if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
                console.error('Webhook signature verification FAILED');
                await logWebhookEvent('signature_failed', null, rawBody);
                return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
            }
        } else {
            // In production, REJECT unsigned webhooks — never trust unverified data
            if (process.env.NODE_ENV === 'production') {
                console.error('RAZORPAY_WEBHOOK_SECRET not set in PRODUCTION — rejecting webhook');
                await logWebhookEvent('rejected_no_secret', null, 'Webhook secret not configured in production');
                return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 });
            }
            console.warn('RAZORPAY_WEBHOOK_SECRET not set — skipping signature check (DEV MODE ONLY)');
        }

        const event = JSON.parse(rawBody);
        const eventType: string = event.event || '';
        const payload = event.payload || {};

        // Log every webhook event for audit
        await logWebhookEvent(eventType, event.account_id, JSON.stringify({ event: eventType, entity_id: payload?.payment?.entity?.id || payload?.refund?.entity?.id || '' }));

        switch (eventType) {
            case 'payment.authorized':
                await handlePaymentAuthorized(payload);
                break;
            case 'payment.captured':
                await handlePaymentCaptured(payload);
                break;
            case 'payment.failed':
                await handlePaymentFailed(payload);
                break;
            case 'refund.created':
            case 'refund.processed':
                await handleRefundProcessed(payload);
                break;
            case 'refund.failed':
                await handleRefundFailed(payload);
                break;
            case 'payout.processed':
                await handlePayoutProcessed(payload);
                break;
            case 'payout.reversed':
                await handlePayoutReversed(payload);
                break;
            case 'payment_link.paid':
                await handlePaymentLinkPaid(payload);
                break;
            default:
                console.log(`Unhandled webhook event: ${eventType}`);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Always return 200 to prevent Razorpay retries on processing errors
        // (we logged the event already)
        return NextResponse.json({ status: 'error_logged' });
    }
}

async function logWebhookEvent(eventType: string, accountId: string | null, summary: string) {
    try {
        await db.collection('webhookLogs').add({
            eventType,
            accountId: accountId || '',
            summary,
            processedAt: Timestamp.now(),
        });
    } catch (e) {
        console.error('Failed to log webhook event:', e);
    }
}

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;


async function handlePaymentAuthorized(payload: any) {
    const payment = payload?.payment?.entity;
    if (!payment) return;

    const orderId = payment.notes?.orderId || payment.notes?.order_id || '';
    if (!orderId) {
        console.warn('Payment authorized but no orderId in notes:', payment.id);
        return;
    }

    const orderRef = db.collection(collections.orders).doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return;

    // Auto-capture the payment if not already captured
    if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && payment.status === 'authorized') {
        try {
            console.log(`Auto-capturing payment ${payment.id} for order ${orderId}, amount: ${payment.amount}`);
            const captureResponse = await fetch(
                `https://api.razorpay.com/v1/payments/${payment.id}/capture`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
                    },
                    body: JSON.stringify({
                        amount: payment.amount,
                        currency: payment.currency || 'INR',
                    }),
                }
            );

            if (captureResponse.ok) {
                console.log(`Payment ${payment.id} auto-captured successfully`);
                await orderRef.update({
                    razorpayPaymentId: payment.id,
                    paymentStatus: 'Paid',
                    paymentCaptured: true,
                    paymentCapturedAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                });
            } else {
                const captureError = await captureResponse.json();
                console.error(`Auto-capture failed for ${payment.id}:`, captureError);
                // Still mark as authorized so admin can manually capture
                await orderRef.update({
                    razorpayPaymentId: payment.id,
                    paymentStatus: 'Authorized',
                    paymentCaptureError: captureError.error?.description || 'Auto-capture failed',
                    updatedAt: Timestamp.now(),
                });
            }
        } catch (captureError) {
            console.error(`Auto-capture exception for ${payment.id}:`, captureError);
            await orderRef.update({
                razorpayPaymentId: payment.id,
                paymentStatus: 'Authorized',
                updatedAt: Timestamp.now(),
            });
        }
    } else {
        // Razorpay keys not configured — just mark as authorized
        await orderRef.update({
            razorpayPaymentId: payment.id,
            paymentStatus: 'Authorized',
            updatedAt: Timestamp.now(),
        });
    }

    await db.collection('paymentTransactions').add({
        type: 'payment_authorized',
        orderId,
        razorpayPaymentId: payment.id,
        amount: payment.amount / 100,
        status: 'authorized',
        autoCaptureAttempted: true,
        createdAt: Timestamp.now(),
    });
}

async function handlePaymentCaptured(payload: any) {
    const payment = payload?.payment?.entity;
    if (!payment) return;

    const orderId = payment.notes?.orderId || payment.notes?.order_id || '';
    if (!orderId) return;

    const orderRef = db.collection(collections.orders).doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return;

    await orderRef.update({
        razorpayPaymentId: payment.id,
        paymentStatus: 'Paid',
        paymentCaptured: true,
        paymentCapturedAt: Timestamp.now(),
        paymentMethod: payment.method || '',
        updatedAt: Timestamp.now(),
    });

    await db.collection('paymentTransactions').add({
        type: 'payment_captured',
        orderId,
        razorpayPaymentId: payment.id,
        amount: payment.amount / 100,
        method: payment.method,
        status: 'captured',
        createdAt: Timestamp.now(),
    });
}

async function handlePaymentFailed(payload: any) {
    const payment = payload?.payment?.entity;
    if (!payment) return;

    const orderId = payment.notes?.orderId || payment.notes?.order_id || '';
    if (!orderId) return;

    const orderRef = db.collection(collections.orders).doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return;

    await orderRef.update({
        paymentStatus: 'Failed',
        paymentError: payment.error_description || 'Payment failed',
        updatedAt: Timestamp.now(),
    });

    await db.collection('paymentTransactions').add({
        type: 'payment_failed',
        orderId,
        razorpayPaymentId: payment.id,
        amount: payment.amount / 100,
        errorCode: payment.error_code || '',
        errorDescription: payment.error_description || '',
        status: 'failed',
        createdAt: Timestamp.now(),
    });
}

async function handleRefundProcessed(payload: any) {
    const refund = payload?.refund?.entity;
    if (!refund) return;

    // Find the refund record in our DB by razorpayRefundId
    const refundSnapshot = await db.collection('refunds')
        .where('razorpayRefundId', '==', refund.id)
        .limit(1)
        .get();

    if (!refundSnapshot.empty) {
        await refundSnapshot.docs[0].ref.update({
            status: 'SUCCESS',
            razorpayRefundStatus: refund.status,
            processedAt: Timestamp.now(),
        });
    }

    // Also update via payment ID (in case refund was initiated outside our system)
    const paymentId = refund.payment_id;
    if (paymentId) {
        const ordersSnapshot = await db.collection(collections.orders)
            .where('razorpayPaymentId', '==', paymentId)
            .limit(1)
            .get();

        if (!ordersSnapshot.empty) {
            const orderDoc = ordersSnapshot.docs[0];
            const orderData = orderDoc.data();
            const refundAmount = refund.amount / 100;
            const isFullRefund = refundAmount >= (orderData.total || 0) * 0.95;

            await orderDoc.ref.update({
                refundStatus: isFullRefund ? 'FULL_REFUNDED' : 'HALF_REFUNDED',
                refundAmount: refundAmount,
                refundId: refund.id,
                refundedAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
        }
    }

    await db.collection('paymentTransactions').add({
        type: 'refund_processed',
        razorpayRefundId: refund.id,
        razorpayPaymentId: refund.payment_id,
        amount: refund.amount / 100,
        status: 'refund_success',
        createdAt: Timestamp.now(),
    });
}

async function handleRefundFailed(payload: any) {
    const refund = payload?.refund?.entity;
    if (!refund) return;

    const refundSnapshot = await db.collection('refunds')
        .where('razorpayRefundId', '==', refund.id)
        .limit(1)
        .get();

    if (!refundSnapshot.empty) {
        await refundSnapshot.docs[0].ref.update({
            status: 'FAILED',
            razorpayRefundStatus: refund.status,
            failedAt: Timestamp.now(),
        });
    }

    await db.collection('paymentTransactions').add({
        type: 'refund_failed',
        razorpayRefundId: refund.id,
        razorpayPaymentId: refund.payment_id,
        amount: refund.amount / 100,
        status: 'refund_failed',
        createdAt: Timestamp.now(),
    });
}

async function handlePayoutProcessed(payload: any) {
    const payout = payload?.payout?.entity;
    if (!payout) return;

    // Find payout record by razorpayPayoutId
    for (const collection of ['vendorPayouts', 'deliveryPayouts']) {
        const snapshot = await db.collection(collection)
            .where('razorpayPayoutId', '==', payout.id)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            await snapshot.docs[0].ref.update({
                status: 'completed',
                razorpayPayoutStatus: payout.status,
                completedAt: Timestamp.now(),
            });
            break;
        }
    }

    await db.collection('paymentTransactions').add({
        type: 'payout_processed',
        razorpayPayoutId: payout.id,
        amount: payout.amount / 100,
        status: 'payout_success',
        createdAt: Timestamp.now(),
    });
}

async function handlePayoutReversed(payload: any) {
    const payout = payload?.payout?.entity;
    if (!payout) return;

    for (const collection of ['vendorPayouts', 'deliveryPayouts']) {
        const snapshot = await db.collection(collection)
            .where('razorpayPayoutId', '==', payout.id)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            const data = doc.data();

            await doc.ref.update({
                status: 'reversed',
                razorpayPayoutStatus: 'reversed',
                reversedAt: Timestamp.now(),
            });

            // Reverse the paid amount on the recipient
            const recipientId = data.vendorId || data.deliveryPersonId;
            const recipientCollection = data.vendorId ? collections.vendors : collections.deliveryPersons;
            if (recipientId) {
                const recipientDoc = await db.collection(recipientCollection).doc(recipientId).get();
                const recipientData = recipientDoc.data() || {};
                await db.collection(recipientCollection).doc(recipientId).update({
                    paidAmount: Math.max(0, (recipientData.paidAmount || 0) - (data.amount || 0)),
                    updatedAt: Timestamp.now(),
                });
            }
            break;
        }
    }

    await db.collection('paymentTransactions').add({
        type: 'payout_reversed',
        razorpayPayoutId: payout.id,
        amount: payout.amount / 100,
        status: 'payout_reversed',
        createdAt: Timestamp.now(),
    });
}

/**
 * Handles payment_link.paid — fires when a customer pays via a Razorpay payment link.
 * Used for COD QR payments — updates Firestore so the delivery app listener auto-detects.
 */
async function handlePaymentLinkPaid(payload: any) {
    const linkEntity = payload?.payment_link?.entity;
    const paymentEntity = payload?.payment?.entity;
    if (!linkEntity?.id) return;

    const paymentLinkId: string = linkEntity.id;
    const paymentId: string = paymentEntity?.id || linkEntity.payments?.[0]?.payment_id || '';
    const notes = linkEntity.notes || {};

    // Only handle COD QR payments (tagged in notes)
    if (notes.type !== 'cod_qr') return;

    const docRef = db.collection('codQrPayments').doc(paymentLinkId);
    const doc = await docRef.get();
    if (!doc.exists) return;

    // Mark as paid — delivery app Firestore listener picks this up in real time
    await docRef.update({
        status: 'paid',
        paymentId,
        paidAt: Timestamp.now(),
    });

    const data = doc.data()!;
    if (data.orderId) {
        try {
            await db.collection('orders').doc(data.orderId).update({
                codPaymentMethod: 'QR',
                codQrPaymentId: paymentId,
                qrReviewStatus: 'pending_review',
            });
        } catch (e) {
            console.error('Failed to update order with payment link info:', e);
        }
    }

    console.log(`✅ COD Payment Link paid: ${paymentLinkId} | order: ${data.orderId} | payment: ${paymentId}`);
}
