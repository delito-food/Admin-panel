import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * POST /api/payments/cod-qr
 * Creates a Razorpay Payment Link for COD collection.
 * Called by the delivery app — keeps secret off the device.
 * Body: { orderId, amount, deliveryPersonId }
 * Returns: { paymentLinkId, shortUrl, expiresAt }
 */
export async function POST(req: Request) {
    try {
        // Read credentials at request time (not module load time) so Vercel env vars are available
        const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
        const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            console.error('[cod-qr] Razorpay credentials missing from environment');
            return NextResponse.json({ success: false, error: 'Payment gateway not configured on server' }, { status: 500 });
        }

        const AUTH = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

        const { orderId, amount, deliveryPersonId } = await req.json();
        if (!orderId || !amount || amount <= 0 || !deliveryPersonId) {
            return NextResponse.json({ success: false, error: 'orderId, amount and deliveryPersonId required' }, { status: 400 });
        }

        const expireBy = Math.floor(Date.now() / 1000) + 15 * 60; // 15 min

        const rzpRes = await fetch('https://api.razorpay.com/v1/payment_links', {
            method: 'POST',
            headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: Math.round(amount * 100), // paise
                currency: 'INR',
                accept_partial: false,
                expire_by: expireBy,
                description: `COD - Order #${orderId.slice(-8).toUpperCase()}`,
                notify: { sms: false, email: false },
                reminder_enable: false,
                notes: { orderId, deliveryPersonId, type: 'cod_qr' },
            }),
        });

        const data = await rzpRes.json();
        if (!rzpRes.ok) {
            const errMsg = data?.error?.description || JSON.stringify(data);
            return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
        }

        // Store in Firestore — webhook will mark it paid, app listens in real time
        await db.collection('codQrPayments').doc(data.id).set({
            paymentLinkId: data.id,
            orderId,
            deliveryPersonId,
            amount,
            amountPaise: Math.round(amount * 100),
            status: 'pending',
            shortUrl: data.short_url,
            expiresAt: Timestamp.fromMillis(expireBy * 1000),
            createdAt: Timestamp.now(),
            paymentId: null,
        });

        return NextResponse.json({ success: true, paymentLinkId: data.id, shortUrl: data.short_url, expiresAt: expireBy });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

