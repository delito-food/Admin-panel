import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth } from '@/lib/api-auth';
import { withAdmin } from '@/lib/api-guard';
import { postLedgerEntry, type LedgerPartyType } from '@/lib/ledger';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

/**
 * POST /api/payouts/reconcile
 * Reconciles payout statuses by polling Razorpay for any payouts stuck in 'processing'.
 * Call this periodically or via admin dashboard button.
 */
async function handlePOST(request: Request) {
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

                        // A payout completed here is real money leaving, so it
                        // needs a ledger row exactly as one confirmed by hand
                        // does. Without this, reconciled payouts were invisible
                        // to the balance and the vendor looked owed twice.
                        const paidTo = data.vendorId || data.deliveryPersonId;
                        if (paidTo) {
                            await postLedgerEntry({
                                partyType: (data.vendorId ? 'vendor' : 'deliveryPartner') as LedgerPartyType,
                                partyId: paidTo,
                                entryType: 'PAYOUT',
                                amount: -Math.abs(Number(data.amount) || 0),
                                sourceType: 'payout',
                                sourceId: doc.id,
                                description: `Payout reconciled with RazorpayX (${razorpayPayoutId})`,
                                createdBy: 'reconcile',
                            });
                        }
                        reconciled++;
                    } else if (newStatus === 'reversed' || newStatus === 'cancelled') {
                        await doc.ref.update({
                            status: newStatus,
                            razorpayPayoutStatus: newStatus,
                            reconciledAt: Timestamp.now(),
                        });

                        // A reversed or cancelled payout gives the money back to
                        // the party's balance. The ledger row is the record; the
                        // counter on the recipient document is only a cache, and
                        // it is now updated inside a transaction rather than by a
                        // read-modify-write that could lose a concurrent change.
                        const recipientId = data.vendorId || data.deliveryPersonId;
                        const recipientCollection = data.vendorId ? 'vendors' : 'deliveryPersons';
                        const reversedAmount = Math.abs(Number(data.amount) || 0);
                        if (recipientId && reversedAmount > 0) {
                            await postLedgerEntry({
                                partyType: (data.vendorId ? 'vendor' : 'deliveryPartner') as LedgerPartyType,
                                partyId: recipientId,
                                entryType: 'ADJUSTMENT',
                                amount: reversedAmount,
                                sourceType: 'payout',
                                sourceId: `${doc.id}_reversal`,
                                description: `Payout ${newStatus} by RazorpayX (${razorpayPayoutId}) — amount returned to balance`,
                                createdBy: 'reconcile',
                            });

                            const recipientRef = db.collection(recipientCollection).doc(recipientId);
                            await db.runTransaction(async (tx) => {
                                const snap = await tx.get(recipientRef);
                                const current = Number(snap.data()?.paidAmount) || 0;
                                tx.update(recipientRef, {
                                    paidAmount: Math.max(0, Math.round((current - reversedAmount) * 100) / 100),
                                    updatedAt: Timestamp.now(),
                                });
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

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const POST = withAdmin(handlePOST);
