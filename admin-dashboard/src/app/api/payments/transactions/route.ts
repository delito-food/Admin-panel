import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { verifyApiAuth } from '@/lib/api-auth';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

/**
 * GET /api/payments/transactions
 * Returns all payment transactions for admin monitoring.
 * Query params: ?limit=50&type=payment_captured&flagged=true
 */
export async function GET(request: Request) {
    // Authenticate admin
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) {
        return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
        const typeFilter = searchParams.get('type') || '';
        const flaggedOnly = searchParams.get('flagged') === 'true';

        let query = db.collection('paymentTransactions')
            .orderBy('createdAt', 'desc') as FirebaseFirestore.Query;

        if (typeFilter) {
            query = query.where('type', '==', typeFilter);
        }
        if (flaggedOnly) {
            query = query.where('flagged', '==', true);
        }

        const snapshot = await query.limit(limit).get();

        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
            };
        });

        // Summary stats
        const allSnapshot = await db.collection('paymentTransactions')
            .orderBy('createdAt', 'desc')
            .limit(1000)
            .get();

        const allTxns = allSnapshot.docs.map(d => d.data());
        const summary = {
            total: allTxns.length,
            captured: allTxns.filter(t => t.type === 'payment_captured').length,
            failed: allTxns.filter(t => t.type === 'payment_failed').length,
            refunded: allTxns.filter(t => t.type === 'refund_processed').length,
            flagged: allTxns.filter(t => t.flagged === true).length,
            verificationFailed: allTxns.filter(t => t.type === 'verification_failed').length,
        };

        return NextResponse.json({ success: true, data: { transactions, summary } });
    } catch (error) {
        console.error('Transactions fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch transactions' }, { status: 500 });
    }
}

/**
 * POST /api/payments/transactions
 * Admin action: capture an authorized payment, or fetch payment details from Razorpay.
 * Body: { action: 'capture' | 'fetch_status', razorpayPaymentId: string, amount?: number }
 */
export async function POST(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) {
        return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { action, razorpayPaymentId, amount } = body;

        if (!razorpayPaymentId) {
            return NextResponse.json({ success: false, error: 'razorpayPaymentId required' }, { status: 400 });
        }

        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            return NextResponse.json({ success: false, error: 'Razorpay credentials not configured' }, { status: 400 });
        }

        const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

        if (action === 'capture') {
            // Capture an authorized payment
            if (!amount || amount <= 0) {
                return NextResponse.json({ success: false, error: 'Amount required for capture' }, { status: 400 });
            }

            const response = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}/capture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
                body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR' }),
            });

            const result = await response.json();
            if (!response.ok) {
                return NextResponse.json({ success: false, error: result.error?.description || 'Capture failed' }, { status: 400 });
            }

            // Update Firestore order
            const ordersSnapshot = await db.collection(collections.orders)
                .where('razorpayPaymentId', '==', razorpayPaymentId)
                .limit(1)
                .get();

            if (!ordersSnapshot.empty) {
                await ordersSnapshot.docs[0].ref.update({
                    paymentStatus: 'Paid',
                    paymentCaptured: true,
                    paymentCapturedAt: new Date(),
                    updatedAt: new Date(),
                });
            }

            return NextResponse.json({ success: true, message: 'Payment captured', data: result });
        }

        if (action === 'fetch_status') {
            // Fetch payment details from Razorpay
            const response = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
                headers: { 'Authorization': authHeader },
            });

            const result = await response.json();
            if (!response.ok) {
                return NextResponse.json({ success: false, error: result.error?.description || 'Fetch failed' }, { status: 400 });
            }

            return NextResponse.json({ success: true, data: result });
        }

        return NextResponse.json({ success: false, error: 'Invalid action. Use capture or fetch_status.' }, { status: 400 });
    } catch (error) {
        console.error('Transaction action error:', error);
        return NextResponse.json({ success: false, error: 'Action failed' }, { status: 500 });
    }
}

