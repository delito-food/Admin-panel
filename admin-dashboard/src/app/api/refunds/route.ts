import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth } from '@/lib/api-auth';

// Razorpay API configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

interface RefundRequest {
    orderId: string;
    complaintId?: string;
    amount: number;
    reason: string;
    refundType: 'full' | 'partial';
}

// Get refund history
export async function GET(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) {
        return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    try {
        const refundsSnapshot = await db.collection('refunds')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        const refunds = refundsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                refundId: doc.id,
                orderId: data.orderId || '',
                complaintId: data.complaintId || '',
                customerId: data.customerId || '',
                customerName: data.customerName || '',
                customerEmail: data.customerEmail || '',
                amount: data.amount || 0,
                originalAmount: data.originalAmount || 0,
                razorpayPaymentId: data.razorpayPaymentId || '',
                razorpayRefundId: data.razorpayRefundId || '',
                status: data.status || 'PENDING',
                reason: data.reason || '',
                refundType: data.refundType || 'full',
                processedBy: data.processedBy || '',
                createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
                processedAt: data.processedAt?.toDate?.()?.toISOString() || '',
                notes: data.notes || '',
            };
        });

        // Calculate summary
        const summary = {
            totalRefunds: refunds.length,
            totalAmount: refunds.filter(r => r.status === 'SUCCESS').reduce((sum, r) => sum + r.amount, 0),
            pending: refunds.filter(r => r.status === 'PENDING').length,
            successful: refunds.filter(r => r.status === 'SUCCESS').length,
            failed: refunds.filter(r => r.status === 'FAILED').length,
        };

        return NextResponse.json({
            success: true,
            data: {
                refunds,
                summary,
            }
        });
    } catch (error) {
        console.error('Refunds fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch refunds' },
            { status: 500 }
        );
    }
}

// Process refund via Razorpay
export async function POST(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) {
        return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    try {
        const body: RefundRequest = await request.json();
        const { orderId, complaintId, amount, reason, refundType } = body;

        if (!orderId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Order ID and valid amount required' },
                { status: 400 }
            );
        }

        // Idempotency: check if refund already exists for this order
        const existingRefund = await db.collection('refunds')
            .where('orderId', '==', orderId)
            .where('status', '==', 'SUCCESS')
            .limit(1)
            .get();

        if (!existingRefund.empty) {
            return NextResponse.json(
                { success: false, error: 'Refund already processed for this order' },
                { status: 409 }
            );
        }

        // Get order details
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderDoc.data() || {};
        const razorpayPaymentId = orderData.razorpayPaymentId;
        const orderTotal = orderData.total || 0;
        const paymentMode = orderData.paymentMode || '';

        // Check if online payment
        if (paymentMode !== 'Online' || !razorpayPaymentId) {
            // For COD orders, just mark as refunded without Razorpay
            const isFullRefund = amount >= orderTotal * 0.95; // 95% threshold for "full"
            const refundStatusLabel = isFullRefund ? 'FULL_REFUNDED' : 'HALF_REFUNDED';

            const refundRef = await db.collection('refunds').add({
                orderId,
                complaintId: complaintId || '',
                customerId: orderData.customerId || '',
                customerName: orderData.customerName || '',
                customerEmail: '',
                amount,
                originalAmount: orderTotal,
                razorpayPaymentId: '',
                razorpayRefundId: '',
                status: 'SUCCESS',
                reason: reason || 'Refund for COD order',
                refundType,
                processedBy: 'admin',
                notes: 'COD order - no payment to refund. Customer was not charged.',
                createdAt: Timestamp.now(),
                processedAt: Timestamp.now(),
            });

            // Update order status
            await orderRef.update({
                refundStatus: refundStatusLabel,
                refundAmount: amount,
                refundedAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Update complaint if exists
            if (complaintId) {
                await db.collection('complaints').doc(complaintId).update({
                    refundStatus: refundStatusLabel,
                    refundId: refundRef.id,
                    refundAmount: amount,
                    refundProcessedAt: Timestamp.now(),
                    status: 'REFUNDED',
                    updatedAt: Timestamp.now(),
                });
            }

            return NextResponse.json({
                success: true,
                message: `COD order marked as ${isFullRefund ? 'fully' : 'partially'} refunded`,
                refundId: refundRef.id,
            });
        }

        // Check if Razorpay credentials are configured
        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            // ⚠️ CRITICAL: Do NOT silently record as SUCCESS — money is NOT refunded!
            // Record as PENDING so admin knows action is needed.
            const refundRef = await db.collection('refunds').add({
                orderId,
                complaintId: complaintId || '',
                customerId: orderData.customerId || '',
                customerName: orderData.customerName || '',
                customerEmail: orderData.customerEmail || '',
                amount,
                originalAmount: orderTotal,
                razorpayPaymentId,
                razorpayRefundId: '',
                status: 'PENDING_MANUAL',
                reason: reason || 'Refund pending',
                refundType,
                processedBy: 'admin',
                notes: '⚠️ Razorpay API keys NOT configured on server. Customer has NOT been refunded. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel env vars, then retry this refund.',
                createdAt: Timestamp.now(),
            });

            // Mark order so it's visible as needing attention
            await orderRef.update({
                refundStatus: 'PENDING_MANUAL',
                refundAmount: amount,
                updatedAt: Timestamp.now(),
            });

            return NextResponse.json({
                success: false,
                error: '⚠️ RAZORPAY KEYS NOT CONFIGURED — Customer was NOT refunded. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel environment variables, then retry.',
                refundId: refundRef.id,
                needsRetry: true,
            }, { status: 503 });
        }

        // Process refund via Razorpay API
        const refundAmountPaise = Math.round(amount * 100); // Convert to paise

        // Check if payment needs to be captured first (authorized but not captured)
        // Fetch payment status from Razorpay
        const paymentStatusResponse = await fetch(
            `https://api.razorpay.com/v1/payments/${razorpayPaymentId}`,
            {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
                },
            }
        );

        const paymentDetails = await paymentStatusResponse.json();

        if (paymentDetails.status === 'authorized') {
            // Need to capture first before refunding
            console.log(`Payment ${razorpayPaymentId} is authorized — capturing before refund...`);
            const captureResponse = await fetch(
                `https://api.razorpay.com/v1/payments/${razorpayPaymentId}/capture`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
                    },
                    body: JSON.stringify({
                        amount: paymentDetails.amount, // capture full amount
                        currency: paymentDetails.currency || 'INR',
                    }),
                }
            );

            if (!captureResponse.ok) {
                const captureError = await captureResponse.json();
                return NextResponse.json(
                    { success: false, error: `Payment must be captured before refund. Capture failed: ${captureError.error?.description || 'Unknown'}` },
                    { status: 400 }
                );
            }
            console.log(`Payment ${razorpayPaymentId} captured successfully, proceeding with refund`);
        }

        const razorpayResponse = await fetch(
            `https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
                },
                body: JSON.stringify({
                    amount: refundAmountPaise,
                    notes: {
                        reason: reason || 'Customer refund',
                        orderId: orderId,
                        complaintId: complaintId || '',
                    },
                }),
            }
        );

        const razorpayResult = await razorpayResponse.json();

        if (!razorpayResponse.ok) {
            // Log failed refund attempt
            await db.collection('refunds').add({
                orderId,
                complaintId: complaintId || '',
                customerId: orderData.customerId || '',
                customerName: orderData.customerName || '',
                amount,
                originalAmount: orderTotal,
                razorpayPaymentId,
                razorpayRefundId: '',
                status: 'FAILED',
                reason: reason || 'Refund failed',
                refundType,
                processedBy: 'admin',
                errorMessage: razorpayResult.error?.description || 'Razorpay refund failed',
                createdAt: Timestamp.now(),
            });

            return NextResponse.json(
                {
                    success: false,
                    error: razorpayResult.error?.description || 'Razorpay refund failed'
                },
                { status: 400 }
            );
        }

        // Success - create refund record
        const isFullRefundRzp = amount >= orderTotal * 0.95;
        const refundStatusLabelRzp = isFullRefundRzp ? 'FULL_REFUNDED' : 'HALF_REFUNDED';

        const refundRef = await db.collection('refunds').add({
            orderId,
            complaintId: complaintId || '',
            customerId: orderData.customerId || '',
            customerName: orderData.customerName || '',
            customerEmail: orderData.customerEmail || '',
            amount,
            originalAmount: orderTotal,
            razorpayPaymentId,
            razorpayRefundId: razorpayResult.id,
            status: 'SUCCESS',
            reason: reason || 'Refund processed',
            refundType,
            processedBy: 'admin',
            razorpayResponse: razorpayResult,
            createdAt: Timestamp.now(),
            processedAt: Timestamp.now(),
        });

        // Update order status
        await orderRef.update({
            refundStatus: refundStatusLabelRzp,
            refundAmount: amount,
            refundId: razorpayResult.id,
            refundedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        // Update complaint if exists
        if (complaintId) {
            await db.collection('complaints').doc(complaintId).update({
                refundStatus: refundStatusLabelRzp,
                refundId: razorpayResult.id,
                refundAmount: amount,
                refundProcessedAt: Timestamp.now(),
                status: 'REFUNDED',
                updatedAt: Timestamp.now(),
            });
        }

        return NextResponse.json({
            success: true,
            message: `Refund of ₹${amount} processed successfully via Razorpay`,
            refundId: refundRef.id,
            razorpayRefundId: razorpayResult.id,
            mode: 'razorpay',
        });
    } catch (error) {
        console.error('Refund processing error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process refund' },
            { status: 500 }
        );
    }
}

/**
 * PUT: Retry a PENDING_MANUAL or old MANUAL_ refund via actual Razorpay API.
 * Also used to check Razorpay config health.
 *
 * Body: { action: 'retry', refundId: string }
 *   or  { action: 'health_check' }
 */
export async function PUT(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) {
        return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    try {
        const body = await request.json();

        // ── Health check: verify Razorpay keys are working ──
        if (body.action === 'health_check') {
            const hasKeyId = !!RAZORPAY_KEY_ID;
            const hasKeySecret = !!RAZORPAY_KEY_SECRET;
            const keyPrefix = RAZORPAY_KEY_ID?.substring(0, 12) || 'NOT_SET';
            let apiReachable = false;
            let apiMode = 'unknown';

            if (hasKeyId && hasKeySecret) {
                try {
                    const res = await fetch('https://api.razorpay.com/v1/payments?count=1', {
                        headers: {
                            'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
                        },
                    });
                    apiReachable = res.ok;
                    apiMode = RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? 'LIVE' : 'TEST';
                } catch {
                    apiReachable = false;
                }
            }

            // Count refunds that need attention
            const manualRefunds = await db.collection('refunds')
                .where('status', 'in', ['PENDING_MANUAL'])
                .get();

            const fakeSuccessRefunds = await db.collection('refunds')
                .where('razorpayRefundId', '>=', 'MANUAL_')
                .where('razorpayRefundId', '<', 'MANUAL_~')
                .get();

            return NextResponse.json({
                success: true,
                health: {
                    razorpayKeyId: hasKeyId,
                    razorpayKeySecret: hasKeySecret,
                    keyPrefix,
                    apiReachable,
                    apiMode,
                    pendingManualRefunds: manualRefunds.size,
                    fakeSuccessRefunds: fakeSuccessRefunds.size,
                    message: !hasKeyId || !hasKeySecret
                        ? '❌ Razorpay keys are NOT set. Go to Vercel → Settings → Environment Variables and add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Redeploy after adding.'
                        : apiReachable
                            ? `✅ Razorpay API is connected (${apiMode} mode). ${manualRefunds.size + fakeSuccessRefunds.size} refund(s) need retry.`
                            : '⚠️ Keys are set but API is not reachable. Check if keys are correct.',
                },
            });
        }

        // ── Retry a specific refund ──
        if (body.action === 'retry') {
            const { refundId } = body;
            if (!refundId) {
                return NextResponse.json({ success: false, error: 'refundId required' }, { status: 400 });
            }

            if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
                return NextResponse.json({
                    success: false,
                    error: 'Cannot retry — RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are still not set in Vercel env vars.',
                }, { status: 503 });
            }

            const refundDoc = await db.collection('refunds').doc(refundId).get();
            if (!refundDoc.exists) {
                return NextResponse.json({ success: false, error: 'Refund record not found' }, { status: 404 });
            }

            const refundData = refundDoc.data()!;
            const razorpayPaymentId = refundData.razorpayPaymentId;

            if (!razorpayPaymentId) {
                return NextResponse.json({ success: false, error: 'No Razorpay payment ID on this refund record — cannot process via Razorpay' }, { status: 400 });
            }

            // Check if already refunded on Razorpay (prevent double-refund)
            if (refundData.razorpayRefundId && !refundData.razorpayRefundId.startsWith('MANUAL_')) {
                return NextResponse.json({ success: false, error: `Already has a real Razorpay refund ID: ${refundData.razorpayRefundId}` }, { status: 409 });
            }

            const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

            // Check payment status — may need capture first
            const paymentRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
                headers: { 'Authorization': authHeader },
            });
            const paymentDetails = await paymentRes.json();

            if (!paymentRes.ok) {
                return NextResponse.json({ success: false, error: `Cannot fetch payment: ${paymentDetails.error?.description || 'Unknown'}` }, { status: 400 });
            }

            // Auto-capture if needed
            if (paymentDetails.status === 'authorized') {
                const captureRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}/capture`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
                    body: JSON.stringify({ amount: paymentDetails.amount, currency: paymentDetails.currency || 'INR' }),
                });
                if (!captureRes.ok) {
                    const captureErr = await captureRes.json();
                    return NextResponse.json({ success: false, error: `Capture failed: ${captureErr.error?.description || 'Unknown'}` }, { status: 400 });
                }
            }

            // Check if already refunded on Razorpay side
            if (paymentDetails.status === 'refunded') {
                // Already refunded — just update our records
                await db.collection('refunds').doc(refundId).update({
                    status: 'SUCCESS',
                    razorpayRefundId: 'ALREADY_REFUNDED_ON_RAZORPAY',
                    notes: `Payment was already fully refunded on Razorpay. Status synced at ${new Date().toISOString()}.`,
                    processedAt: Timestamp.now(),
                });
                return NextResponse.json({ success: true, message: 'Payment was already refunded on Razorpay. Records synced.' });
            }

            // Process the actual refund
            const refundAmountPaise = Math.round((refundData.amount || 0) * 100);
            const razorpayResponse = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
                body: JSON.stringify({
                    amount: refundAmountPaise,
                    notes: { reason: refundData.reason || 'Retry refund', orderId: refundData.orderId || '' },
                }),
            });

            const razorpayResult = await razorpayResponse.json();

            if (!razorpayResponse.ok) {
                await db.collection('refunds').doc(refundId).update({
                    status: 'FAILED',
                    errorMessage: razorpayResult.error?.description || 'Razorpay refund failed on retry',
                    lastRetryAt: Timestamp.now(),
                });
                return NextResponse.json({ success: false, error: razorpayResult.error?.description || 'Razorpay refund failed' }, { status: 400 });
            }

            // Success — update refund record
            const orderId = refundData.orderId;
            const amount = refundData.amount || 0;
            const originalAmount = refundData.originalAmount || 0;
            const isFullRefund = amount >= originalAmount * 0.95;
            const refundStatusLabel = isFullRefund ? 'FULL_REFUNDED' : 'HALF_REFUNDED';

            await db.collection('refunds').doc(refundId).update({
                status: 'SUCCESS',
                razorpayRefundId: razorpayResult.id,
                razorpayResponse: razorpayResult,
                notes: `Retry succeeded. Real Razorpay refund ID: ${razorpayResult.id}`,
                processedAt: Timestamp.now(),
            });

            // Update order
            if (orderId) {
                await db.collection(collections.orders).doc(orderId).update({
                    refundStatus: refundStatusLabel,
                    refundAmount: amount,
                    refundId: razorpayResult.id,
                    refundedAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                });
            }

            // Update complaint if linked
            if (refundData.complaintId) {
                try {
                    await db.collection('complaints').doc(refundData.complaintId).update({
                        refundStatus: refundStatusLabel,
                        refundId: razorpayResult.id,
                        refundAmount: amount,
                        refundProcessedAt: Timestamp.now(),
                        status: 'REFUNDED',
                        updatedAt: Timestamp.now(),
                    });
                } catch { /* complaint may not exist */ }
            }

            // Log transaction
            await db.collection('paymentTransactions').add({
                type: 'refund_processed',
                orderId: orderId || '',
                razorpayRefundId: razorpayResult.id,
                razorpayPaymentId,
                amount,
                status: 'refund_success',
                notes: 'Retry of PENDING_MANUAL refund',
                createdAt: Timestamp.now(),
            });

            return NextResponse.json({
                success: true,
                message: `✅ Refund of ₹${amount} successfully processed via Razorpay!`,
                razorpayRefundId: razorpayResult.id,
            });
        }

        return NextResponse.json({ success: false, error: 'Unknown action. Use retry or health_check.' }, { status: 400 });
    } catch (error) {
        console.error('Refund PUT error:', error);
        return NextResponse.json({ success: false, error: 'Failed to process request' }, { status: 500 });
    }
}
