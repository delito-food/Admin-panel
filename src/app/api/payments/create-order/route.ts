import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

interface CreateOrderRequest {
    orderId: string;
    amount: number;
    currency?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerName?: string;
}

/**
 * POST /api/payments/create-order
 * Creates a Razorpay order server-side so amount cannot be tampered on client.
 */
export async function POST(request: Request) {
    // Rate limit: 10 requests per minute per IP
    const ip = getClientIp(request);
    const rl = rateLimit(`create-order:${ip}`, 10, 60_000);
    if (rl.limited) {
        return NextResponse.json(
            { success: false, error: 'Too many requests. Please wait before trying again.' },
            { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
        );
    }

    try {
        const body: CreateOrderRequest = await request.json();
        const { orderId, amount, currency = 'INR', customerEmail, customerPhone, customerName } = body;

        if (!orderId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Valid orderId and amount are required' },
                { status: 400 }
            );
        }

        // Verify order exists and amount matches server-side
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderDoc.data() || {};
        const serverTotal = orderData.total || 0;

        // CRITICAL: Validate amount matches to prevent tampering (₹1 tolerance for rounding)
        if (Math.abs(serverTotal - amount) > 1) {
            console.error(`Amount mismatch! Client: ${amount}, Server: ${serverTotal}, Order: ${orderId}`);
            return NextResponse.json(
                { success: false, error: 'Amount mismatch detected. Please refresh and try again.' },
                { status: 400 }
            );
        }

        // Idempotency: return existing order if already created
        if (orderData.razorpayOrderId) {
            return NextResponse.json({
                success: true,
                razorpayOrderId: orderData.razorpayOrderId,
                amount: serverTotal,
                currency,
                message: 'Existing Razorpay order returned',
            });
        }

        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            const mockOrderId = 'order_test_' + Date.now();
            await orderRef.update({
                razorpayOrderId: mockOrderId,
                paymentStatus: 'Pending',
                updatedAt: Timestamp.now(),
            });
            return NextResponse.json({
                success: true,
                razorpayOrderId: mockOrderId,
                amount: serverTotal,
                currency,
                message: 'Test mode — mock order created',
            });
        }

        // Create order via Razorpay API
        const amountPaise = Math.round(serverTotal * 100);

        const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
            },
            body: JSON.stringify({
                amount: amountPaise,
                currency,
                receipt: orderId,
                notes: {
                    orderId,
                    customerName: customerName || '',
                    customerEmail: customerEmail || '',
                    customerPhone: customerPhone || '',
                },
            }),
        });

        const razorpayResult = await razorpayResponse.json();

        if (!razorpayResponse.ok) {
            console.error('Razorpay order creation failed:', razorpayResult);
            return NextResponse.json(
                { success: false, error: razorpayResult.error?.description || 'Failed to create payment order' },
                { status: 400 }
            );
        }

        // Store Razorpay order ID in Firestore
        await orderRef.update({
            razorpayOrderId: razorpayResult.id,
            paymentStatus: 'Pending',
            updatedAt: Timestamp.now(),
        });

        // Log transaction
        await db.collection('paymentTransactions').add({
            type: 'order_created',
            orderId,
            razorpayOrderId: razorpayResult.id,
            amount: serverTotal,
            amountPaise,
            currency,
            status: 'created',
            createdAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            razorpayOrderId: razorpayResult.id,
            amount: serverTotal,
            currency,
        });
    } catch (error) {
        console.error('Create order error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to create payment order' },
            { status: 500 }
        );
    }
}
