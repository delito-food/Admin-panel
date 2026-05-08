import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth } from '@/lib/api-auth';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

/**
 * POST /api/payouts/reconcile
 * Reconciles payout statuses by polling Razorpay for any payouts stuck in 'processing'.
 * Call this periodically or via admin dashboard button.
 */
export async function POST(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) {
        return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    }

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        return NextResponse.json({
            success: false,
            error: 'RazorpayX credentials not configured. Cannot reconcile.',
        }, { status: 503 });
    }

    try {
        let reconciled = 0;
        let errors = 0;

        for (const collection of ['vendorPayouts', 'deliveryPayouts']) {
            const processingSnap = await db.collection(collection)
                .where('status', '==', 'processing')
                .get();

            for (const doc of processingSnap.docs) {
                const data = doc.data();
                const razorpayPayoutId = data.razorpayPayoutId;
                if (!razorpayPayoutId) continue;

                try {
                    const res = await fetch(`https://api.razorpay.com/v1/payouts/${razorpayPayoutId}`, {
                        headers: {
                            'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
                        },
                    });

                    if (!res.ok) {
                        errors++;
                        continue;
                    }

                    const payoutData = await res.json();
                    const newStatus = payoutData.status; // 'processed', 'reversed', 'cancelled', 'queued', 'processing'

                    if (newStatus === 'processed') {
                        await doc.ref.update({
                            status: 'completed',
                            razorpayPayoutStatus: newStatus,
                            completedAt: Timestamp.now(),
                            reconciledAt: Timestamp.now(),
                        });
                        reconciled++;
                    } else if (newStatus === 'reversed' || newStatus === 'cancelled') {
                        await doc.ref.update({
                            status: newStatus,
                            razorpayPayoutStatus: newStatus,
                            reconciledAt: Timestamp.now(),
                        });

                        // Reverse paidAmount if it was already credited
                        const recipientId = data.vendorId || data.deliveryPersonId;
                        const recipientCollection = data.vendorId ? 'vendors' : 'deliveryPersons';
                        if (recipientId) {
                            const recipientDoc = await db.collection(recipientCollection).doc(recipientId).get();
                            const recipientData = recipientDoc.data() || {};
                            await db.collection(recipientCollection).doc(recipientId).update({
                                paidAmount: Math.max(0, (recipientData.paidAmount || 0) - (data.amount || 0)),
                                updatedAt: Timestamp.now(),
                            });
                        }
                        reconciled++;
                    }
                    // If still 'processing' or 'queued', leave as is
                } catch {
                    errors++;
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: `Reconciled ${reconciled} payouts. ${errors} errors.`,
            reconciled,
            errors,
        });
    } catch (error) {
        console.error('Payout reconciliation error:', error);
        return NextResponse.json(
            { success: false, error: 'Reconciliation failed' },
            { status: 500 }
        );
    }
}

