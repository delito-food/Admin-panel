import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth } from '@/lib/api-auth';

/**
 * GET /api/payout-disputes
 * Admin: list all open/resolved disputes
 */
export async function GET(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });

    try {
        const url = new URL(request.url);
        const status = url.searchParams.get('status') || 'open';

        let query = db.collection('payoutDisputes').orderBy('createdAt', 'desc').limit(100);
        if (status !== 'all') {
            query = db.collection('payoutDisputes').where('status', '==', status).orderBy('createdAt', 'desc').limit(100) as typeof query;
        }

        const snap = await query.get();
        const disputes = snap.docs.map(doc => {
            const d = doc.data();
            return {
                disputeId: doc.id,
                payoutId: d.payoutId || '',
                recipientType: d.recipientType || '',
                recipientId: d.recipientId || '',
                recipientName: d.recipientName || '',
                issue: d.issue || '',
                amount: d.amount || 0,
                status: d.status || 'open',
                adminNote: d.adminNote || null,
                resolvedBy: d.resolvedBy || null,
                createdAt: d.createdAt?.toDate?.()?.toISOString() || '',
                resolvedAt: d.resolvedAt?.toDate?.()?.toISOString() || null,
            };
        });

        return NextResponse.json({ success: true, data: disputes });
    } catch (error) {
        console.error('Dispute fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch disputes' }, { status: 500 });
    }
}

/**
 * POST /api/payout-disputes
 * Recipient (vendor/delivery) raises a dispute about a payout
 * This is called from the app via Firebase SDK directly (not this API)
 * But admin can also create one manually
 */
export async function POST(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });

    try {
        const body = await request.json();
        const { payoutId, recipientType, recipientId, recipientName, issue, amount } = body;

        if (!recipientId || !issue || !recipientType) {
            return NextResponse.json({ success: false, error: 'recipientId, recipientType, and issue are required' }, { status: 400 });
        }

        const ref = await db.collection('payoutDisputes').add({
            payoutId: payoutId || null,
            recipientType,
            recipientId,
            recipientName: recipientName || '',
            issue,
            amount: amount || 0,
            status: 'open',
            adminNote: null,
            resolvedBy: null,
            createdAt: Timestamp.now(),
            resolvedAt: null,
        });

        return NextResponse.json({ success: true, disputeId: ref.id, message: 'Dispute raised. Admin will review it shortly.' });
    } catch (error) {
        console.error('Dispute create error:', error);
        return NextResponse.json({ success: false, error: 'Failed to raise dispute' }, { status: 500 });
    }
}

/**
 * PUT /api/payout-disputes
 * Admin resolves a dispute
 */
export async function PUT(request: Request) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated) return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });

    try {
        const body = await request.json();
        const { disputeId, adminNote, resolvedBy } = body;

        if (!disputeId) return NextResponse.json({ success: false, error: 'disputeId required' }, { status: 400 });

        const ref = db.collection('payoutDisputes').doc(disputeId);
        const doc = await ref.get();
        if (!doc.exists) return NextResponse.json({ success: false, error: 'Dispute not found' }, { status: 404 });

        await ref.update({
            status: 'resolved',
            adminNote: adminNote || 'Resolved by admin',
            resolvedBy: resolvedBy || 'Admin',
            resolvedAt: Timestamp.now(),
        });

        // Notify the recipient via a notification doc
        const data = doc.data()!;
        try {
            const notifPayload = {
                userId: data.recipientId,
                type: 'payout_dispute_resolved',
                title: '✅ Payout Issue Resolved – Delito',
                body: adminNote || 'Your payout dispute has been reviewed and resolved by the Delito team.',
                message: adminNote || 'Your payout dispute has been resolved by Delito admin.',
                isRead: false,
                read: false,
                createdAt: Timestamp.now(),
            };
            // Write to unified notifications collection (read by all apps)
            await db.collection('notifications').add(notifPayload);
            // Also write to legacy per-role collections for backward compatibility
            const legacyCollection = data.recipientType === 'vendor' ? 'vendorNotifications' : 'deliveryNotifications';
            await db.collection(legacyCollection).add(notifPayload).catch(() => null);
        } catch (_) { /* non-critical */ }

        return NextResponse.json({ success: true, message: 'Dispute resolved' });
    } catch (error) {
        console.error('Dispute resolve error:', error);
        return NextResponse.json({ success: false, error: 'Failed to resolve dispute' }, { status: 500 });
    }
}

