import { NextResponse } from 'next/server';
import { db, collections, sendPushNotification } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth } from '@/lib/api-auth';
import { withAdmin } from '@/lib/api-guard';
import { postLedgerEntry, type LedgerPartyType } from '@/lib/ledger';

/**
 * Generates a system transaction ID: PLT-YYYYMMDD-XXXXXXXX
 */
function generateTransactionId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(16).substring(2, 10).toUpperCase();
    return `PLT${date}${rand}`;
}

/** GET — pending refunds for cancelled orders (Razorpay customer refunds, unchanged) */
async function handleGET(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    try {
        const ordersSnapshot = await db.collection(collections.orders)
            .where('paymentMode', '==', 'Online').where('paymentStatus', '==', 'Paid').get();
        const pendingRefunds: Array<{
            orderId: string; customerId: string; customerName: string; customerPhone: string;
            total: number; status: string; razorpayPaymentId: string; refundStatus: string;
            cancelledAt: string | null; cancellationReason: string; cancelledBy: string;
        }> = [];
        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const status = order.status?.toLowerCase() || '';
            if (['cancelled', 'not_responded', 'declined', 'expired'].includes(status)) {
                const refundStatus = order.refundStatus || '';
                if (!['REFUNDED', 'COMPLETED', 'SUCCESS', 'FULL_REFUNDED'].includes(refundStatus)) {
                    pendingRefunds.push({
                        orderId: doc.id, customerId: order.customerId || '',
                        customerName: order.customerName || 'Unknown', customerPhone: order.customerPhone || '',
                        total: order.total || 0, status: order.status || '',
                        razorpayPaymentId: order.razorpayPaymentId || '',
                        refundStatus: refundStatus || 'PENDING',
                        cancelledAt: order.cancelledAt?.toDate?.()?.toISOString() || null,
                        cancellationReason: order.cancellationReason || '', cancelledBy: order.cancelledBy || '',
                    });
                }
            }
        });
        pendingRefunds.sort((a, b) => {
            if (!a.cancelledAt) return 1; if (!b.cancelledAt) return -1;
            return new Date(b.cancelledAt).getTime() - new Date(a.cancelledAt).getTime();
        });
        return NextResponse.json({ success: true, data: {
            pendingRefunds,
            summary: { totalPendingRefunds: pendingRefunds.length, totalAmount: pendingRefunds.reduce((s, r) => s + r.total, 0),
                cancelled: pendingRefunds.filter(r => r.status.toLowerCase() === 'cancelled').length,
                notResponded: pendingRefunds.filter(r => r.status.toLowerCase() === 'not_responded').length },
        }});
    } catch (error) {
        console.error('Pending refunds fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch pending refunds' }, { status: 500 });
    }
}

/**
 * POST /api/payouts — Issue payout (admin has initiated manual NEFT/UPI/Cash transfer)
 * Status = "issued". paidAmount is NOT updated yet — happens on confirmation.
 */
async function handlePOST(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    try {
        const body = await request.json();
        const { recipientType, recipientId, recipientName, amount, method, notes, adminName } = body;
        if (!recipientId || !amount || amount <= 0 || !recipientType)
            return NextResponse.json({ success: false, error: 'recipientId, recipientType, amount are required' }, { status: 400 });
        if (!['NEFT', 'IMPS', 'UPI', 'Cash'].includes(method))
            return NextResponse.json({ success: false, error: 'method must be NEFT, IMPS, UPI, or Cash' }, { status: 400 });

        const recipientCollection = recipientType === 'vendor' ? collections.vendors : collections.deliveryPersons;
        const recipientDoc = await db.collection(recipientCollection).doc(recipientId).get();
        if (!recipientDoc.exists) return NextResponse.json({ success: false, error: 'Recipient not found' }, { status: 404 });

        const payoutCollection = recipientType === 'vendor' ? 'vendorPayouts' : 'deliveryPayouts';
        const recipientIdField = recipientType === 'vendor' ? 'vendorId' : 'deliveryPersonId';
        const recipientNameField = recipientType === 'vendor' ? 'vendorName' : 'deliveryPersonName';

        // ── DUPLICATE PREVENTION ──
        // Block if there's already an active "issued" (unconfirmed) payout for this recipient
        const existingIssued = await db.collection(payoutCollection)
            .where(recipientIdField, '==', recipientId)
            .where('status', '==', 'issued')
            .limit(1)
            .get();
        if (!existingIssued.empty) {
            const existing = existingIssued.docs[0].data();
            return NextResponse.json({
                success: false,
                error: `There is already a pending unconfirmed payout of ₹${existing.amount} for this recipient (Payout ID: ${existingIssued.docs[0].id}). Please confirm or cancel it before issuing a new one.`,
                existingPayoutId: existingIssued.docs[0].id,
            }, { status: 409 });
        }

        const payoutRef = await db.collection(payoutCollection).add({
            [recipientIdField]: recipientId,
            [recipientNameField]: recipientName,
            amount: Math.round(amount * 100) / 100,
            method,
            status: 'issued',
            transactionId: null,
            notes: notes || null,
            issuedBy: adminName || 'Delito Admin',
            issuedAt: Timestamp.now(),
            createdAt: Timestamp.now(),
            confirmedAt: null,
            processedAt: null,
        });

        // Notify recipient that payout has been initiated
        try {
            await db.collection('notifications').add({
                userId: recipientId,
                type: 'payout_initiated',
                title: '🏦 Payout Initiated – Delito',
                body: `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} payout has been initiated via ${method}. You will receive it shortly.`,
                payoutId: payoutRef.id,
                amount,
                recipientType,
                isRead: false,
                createdAt: Timestamp.now(),
            });
            await sendPushNotification(
                recipientType as 'vendor' | 'delivery',
                recipientId,
                '🏦 Payout Initiated – Delito',
                `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} payout has been initiated via ${method}. You will receive it shortly.`,
                { type: 'payout_initiated', payoutId: payoutRef.id, amount: String(amount) }
            );
        } catch (notifErr) {
            console.warn('Notification creation failed (non-fatal):', notifErr);
        }

        return NextResponse.json({
            success: true,
            message: `Payout of ₹${amount} issued to ${recipientName}. Mark as completed once transfer succeeds.`,
            payoutId: payoutRef.id, status: 'issued',
        });
    } catch (error) {
        console.error('Payout issue error:', error);
        return NextResponse.json({ success: false, error: 'Failed to issue payout' }, { status: 500 });
    }
}

/**
 * PUT /api/payouts — Confirm payout is complete.
 * Generates system transaction ID. Updates paidAmount on recipient.
 * Vendor/delivery person will see receipt after this.
 */
async function handlePUT(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    try {
        const body = await request.json();
        const { payoutId, recipientType, actualTransactionId, adminName, notes } = body;
        if (!payoutId || !recipientType)
            return NextResponse.json({ success: false, error: 'payoutId and recipientType required' }, { status: 400 });

        const payoutCollection = recipientType === 'vendor' ? 'vendorPayouts' : 'deliveryPayouts';
        const payoutRef = db.collection(payoutCollection).doc(payoutId);
        const payoutDoc = await payoutRef.get();
        if (!payoutDoc.exists) return NextResponse.json({ success: false, error: 'Payout not found' }, { status: 404 });

        const payoutData = payoutDoc.data()!;
        if (payoutData.status === 'completed')
            return NextResponse.json({ success: false, error: 'Payout already confirmed' }, { status: 409 });
        if (payoutData.status !== 'issued')
            return NextResponse.json({ success: false, error: `Cannot confirm payout with status: ${payoutData.status}` }, { status: 400 });

        const txnId = actualTransactionId?.trim() || generateTransactionId();
        const amount = payoutData.amount as number;

        const recipientCollection = recipientType === 'vendor' ? collections.vendors : collections.deliveryPersons;
        const recipientIdField = recipientType === 'vendor' ? 'vendorId' : 'deliveryPersonId';
        const recipientId = payoutData[recipientIdField] as string;

        // Read the recipient doc first so its cached counter can be compared
        // against the ledger below.
        const recipientDoc = await db.collection(recipientCollection).doc(recipientId).get();
        const recipientDocData = recipientDoc.data() || {};
        const currentPaid = (recipientDocData.paidAmount as number) || 0;

        // Mark payout as completed
        await payoutRef.update({
            status: 'completed',
            transactionId: txnId,
            confirmedBy: adminName || 'Delito Admin',
            confirmedAt: Timestamp.now(),
            processedAt: Timestamp.now(),
            notes: notes || payoutData.notes || null,
        });

        // Sum of ALL completed records (including the one just confirmed above)
        const allCompletedSnap = await db.collection(payoutCollection)
            .where(recipientIdField, '==', recipientId)
            .where('status', '==', 'completed')
            .get();
        const collectionSum = Math.round(
            allCompletedSnap.docs.reduce((sum, d) => sum + ((d.data().amount as number) || 0), 0) * 100
        ) / 100;

        // The payout is now a ledger row. Posting is idempotent on the payout
        // id, so confirming twice cannot debit twice.
        try {
            await postLedgerEntry({
                partyType: (recipientType === 'vendor' ? 'vendor' : 'deliveryPartner') as LedgerPartyType,
                partyId: recipientId,
                entryType: 'PAYOUT',
                amount: -Math.abs(amount),
                sourceType: 'payout',
                sourceId: payoutId,
                description: `Payout confirmed, txn ${txnId}`,
                createdBy: adminName || 'Delito Admin',
            });
        } catch (err) {
            console.error('[payouts] ledger post failed for payout', payoutId, err);
        }

        // The sum of completed payout records is the deterministic figure, so
        // the cached counter is set FROM it rather than to whichever of the two
        // happened to be larger. Math.max() here silently preserved a stale
        // counter, which then read back as money already paid.
        const newPaidAmount = collectionSum;
        const cacheGap = Math.round((currentPaid + amount - collectionSum) * 100) / 100;
        if (Math.abs(cacheGap) >= 0.01) {
            console.warn(
                `[payouts] ${recipientType} ${recipientId}: cached paidAmount was out by ₹${cacheGap.toFixed(2)} ` +
                `(cache ${(currentPaid + amount).toFixed(2)} vs payouts collection ${collectionSum.toFixed(2)}). ` +
                'Reset from the payouts collection. Payments predating the collection must be backfilled ' +
                'into the ledger with scripts/backfill-ledger.js.'
            );
        }

        // Compute updated pendingPayout from already-fetched doc data — no extra read needed
        const totalEarnings = (recipientDocData.totalEarnings as number) || 0;
        const totalCommission = (recipientDocData.totalCommission as number) || 0;
        const netEarnings = totalEarnings - totalCommission;
        const newPendingPayout = Math.max(0, Math.round((netEarnings - newPaidAmount) * 100) / 100);

        await db.collection(recipientCollection).doc(recipientId).update({
            paidAmount: newPaidAmount,
            pendingPayout: newPendingPayout,
            lastPayoutAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        // ── Send in-app notification to recipient ──
        try {
            await db.collection('notifications').add({
                userId: recipientId,
                type: 'payout_received',
                title: '💰 Payment Received – Delito',
                body: `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been credited to your account.\nTransaction ID: ${txnId}`,
                payoutId,
                amount,
                transactionId: txnId,
                recipientType,
                isRead: false,
                createdAt: Timestamp.now(),
            });
            await sendPushNotification(
                recipientType as 'vendor' | 'delivery',
                recipientId,
                '💰 Payment Received – Delito',
                `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been credited to your account. TXN: ${txnId}`,
                { type: 'payout_received', payoutId, amount: String(amount), transactionId: txnId }
            );
        } catch (notifErr) {
            console.warn('Notification creation failed (non-fatal):', notifErr);
        }

        return NextResponse.json({ success: true, message: `Payout confirmed. TXN: ${txnId}`, transactionId: txnId, payoutId, status: 'completed' });
    } catch (error) {
        console.error('Payout confirm error:', error);
        return NextResponse.json({ success: false, error: 'Failed to confirm payout' }, { status: 500 });
    }
}

/** DELETE /api/payouts — Cancel an issued (not yet confirmed) payout */
async function handleDELETE(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
    try {
        const body = await request.json();
        const { payoutId, recipientType, reason } = body;
        if (!payoutId || !recipientType)
            return NextResponse.json({ success: false, error: 'payoutId and recipientType required' }, { status: 400 });

        const payoutCollection = recipientType === 'vendor' ? 'vendorPayouts' : 'deliveryPayouts';
        const payoutRef = db.collection(payoutCollection).doc(payoutId);
        const payoutDoc = await payoutRef.get();
        if (!payoutDoc.exists) return NextResponse.json({ success: false, error: 'Payout not found' }, { status: 404 });
        if (payoutDoc.data()!.status === 'completed')
            return NextResponse.json({ success: false, error: 'Cannot cancel a completed payout' }, { status: 409 });

        await payoutRef.update({ status: 'cancelled', cancelReason: reason || 'Cancelled by admin', cancelledAt: Timestamp.now() });
        return NextResponse.json({ success: true, message: 'Payout cancelled' });
    } catch (error) {
        console.error('Payout cancel error:', error);
        return NextResponse.json({ success: false, error: 'Failed to cancel payout' }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
export const PUT = withAdmin(handlePUT);
export const DELETE = withAdmin(handleDELETE);
