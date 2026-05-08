import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import crypto from 'crypto';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

interface VerifyRequest {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    orderId: string; // Firestore order ID
}

/**
 * POST /api/payments/verify
 * Verifies Razorpay payment signature server-side (HMAC-SHA256).
 * This MUST be called after successful checkout before confirming the order.
 */
export async function POST(request: Request) {
    // Rate limit: 10 requests per minute per IP
    const ip = getClientIp(request);
    const rl = rateLimit(`verify-payment:${ip}`, 10, 60_000);
    if (rl.limited) {
        return NextResponse.json(
            { success: false, error: 'Too many requests. Please wait.' },
            { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
        );
    }

    try {
        const body: VerifyRequest = await request.json();
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = body;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !orderId) {
            return NextResponse.json(
                { success: false, error: 'All payment fields are required' },
                { status: 400 }
            );
        }

        // Verify order exists
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderDoc.data() || {};

        // Verify the Razorpay order ID matches what we stored
        if (orderData.razorpayOrderId && orderData.razorpayOrderId !== razorpayOrderId) {
            console.error(`Order ID mismatch! Stored: ${orderData.razorpayOrderId}, Received: ${razorpayOrderId}`);
            return NextResponse.json(
                { success: false, error: 'Order ID mismatch — possible tampering detected' },
                { status: 400 }
            );
        }

        // Prevent double-verification
        if (orderData.paymentStatus === 'Paid' && orderData.paymentVerified === true) {
            return NextResponse.json({
                success: true,
                message: 'Payment already verified',
                alreadyVerified: true,
            });
        }

        let signatureValid = false;

        if (!RAZORPAY_KEY_SECRET) {
            // Test mode — accept all signatures but flag it
            console.warn('RAZORPAY_KEY_SECRET not set — skipping signature verification (TEST MODE)');
            signatureValid = true;
        } else {
            // CRITICAL: Verify HMAC-SHA256 signature
            const expectedSignature = crypto
                .createHmac('sha256', RAZORPAY_KEY_SECRET)
                .update(`${razorpayOrderId}|${razorpayPaymentId}`)
                .digest('hex');

            signatureValid = expectedSignature === razorpaySignature;
        }

        if (!signatureValid) {
            console.error(`Signature verification FAILED for order ${orderId}, payment ${razorpayPaymentId}`);

            // Log the failed attempt
            await db.collection('paymentTransactions').add({
                type: 'verification_failed',
                orderId,
                razorpayOrderId,
                razorpayPaymentId,
                status: 'signature_mismatch',
                flagged: true,
                createdAt: Timestamp.now(),
            });

            // Mark order as suspicious
            await orderRef.update({
                paymentStatus: 'Suspicious',
                paymentVerified: false,
                updatedAt: Timestamp.now(),
            });

            return NextResponse.json(
                { success: false, error: 'Payment signature verification failed' },
                { status: 400 }
            );
        }

        // Signature valid — update order
        await orderRef.update({
            razorpayPaymentId,
            razorpayOrderId,
            razorpaySignature,
            paymentStatus: 'Paid',
            paymentVerified: true,
            paymentVerifiedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        // Log successful verification
        await db.collection('paymentTransactions').add({
            type: 'payment_verified',
            orderId,
            razorpayOrderId,
            razorpayPaymentId,
            amount: orderData.total || 0,
            status: 'verified',
            createdAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            message: 'Payment verified successfully',
            paymentId: razorpayPaymentId,
        });
    } catch (error) {
        console.error('Payment verification error:', error);
        return NextResponse.json(
            { success: false, error: 'Payment verification failed' },
            { status: 500 }
        );
    }
}

