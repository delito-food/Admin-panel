import { NextResponse } from 'next/server';
import { db, sendPushNotification } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import { iso, mapTicket } from '@/lib/support-tickets';

type Ctx = { params: Promise<{ ticketId: string }> };

const STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

/**
 * GET /api/support-tickets/[ticketId]
 *
 * Everything an agent needs to act without opening five other pages: the ticket,
 * the conversation, the rider's money position (cash held, pending payout, gig
 * bonus paid today), their recent payouts, and the related order if one was picked.
 */
async function handleGET(_request: Request, { params }: Ctx) {
    try {
        const { ticketId } = await params;
        const ref = db.collection('supportTickets').doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) {
            return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
        }
        const ticket = mapTicket(snap.id, snap.data()!);

        const [msgSnap, riderSnap, orderSnap, payoutSnap] = await Promise.all([
            ref.collection('messages').orderBy('at', 'asc').limit(200).get(),
            ticket.riderId ? db.collection('deliveryPersons').doc(ticket.riderId).get() : Promise.resolve(null),
            ticket.orderId ? db.collection('orders').doc(ticket.orderId).get() : Promise.resolve(null),
            ticket.riderId
                ? db.collection('deliveryPayouts').where('deliveryPersonId', '==', ticket.riderId).limit(30).get()
                : Promise.resolve(null),
        ]);

        const messages = msgSnap.docs.map(m => {
            const d = m.data();
            return {
                id: m.id,
                from: d.from === 'support' ? 'support' : 'rider',
                text: d.text || '',
                authorName: d.authorName || '',
                at: iso(d.at),
            };
        });

        const r = riderSnap && riderSnap.exists ? riderSnap.data()! : null;
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // yyyy-mm-dd
        const rider = r ? {
            name: r.fullName || ticket.riderName,
            phone: r.phoneNumber || ticket.riderPhone,
            pincode: r.pincode || '',
            isOnline: r.isOnline === true,
            isVerified: r.isVerified === true,
            totalDeliveries: r.totalDeliveries || 0,
            todayDeliveries: r.lastDeliveryDate === today ? (r.todayDeliveries || 0) : 0,
            codCollected: r.codCollected || 0,
            totalEarnings: r.totalEarnings || 0,
            paidAmount: r.paidAmount || 0,
            pendingPayout: r.pendingPayout || 0,
            totalIncentiveEarned: r.totalIncentiveEarned || 0,
            pendingIncentive: r.pendingIncentive || 0,
            gigPaidToday: r.gigPaidDate === today ? (r.gigPaidToday || 0) : 0,
            hasBankDetails: r.hasBankDetails === true,
            bankName: r.bankName || '',
            bankAccountLast4: typeof r.bankAccountNumber === 'string' ? r.bankAccountNumber.slice(-4) : '',
            upiId: r.upiId || '',
        } : null;

        const o = orderSnap && orderSnap.exists ? orderSnap.data()! : null;
        const order = o ? {
            orderId: ticket.orderId,
            status: o.status || '',
            vendorName: o.vendorName || '',
            customerName: o.customerName || '',
            deliveryAddress: o.deliveryAddress || '',
            total: o.total || 0,
            paymentMode: o.paymentMode || '',
            riderPay: o.deliveryPersonEarnings || 0,
            distanceKm: o.distanceKm || 0,
            createdAt: iso(o.createdAt),
            deliveredAt: iso(o.deliveredAt),
        } : null;

        const payouts = payoutSnap
            ? payoutSnap.docs
                .map(p => {
                    const d = p.data();
                    return {
                        payoutId: p.id,
                        amount: d.amount || 0,
                        method: d.method || '',
                        status: d.status || '',
                        transactionId: d.transactionId || '',
                        createdAt: iso(d.createdAt),
                        confirmedAt: iso(d.confirmedAt || d.completedAt),
                    };
                })
                .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
                .slice(0, 5)
            : [];

        return NextResponse.json({ success: true, data: { ticket, messages, rider, order, payouts } });
    } catch (error) {
        console.error('Support ticket detail error:', error);
        return NextResponse.json({ success: false, error: 'Failed to load ticket' }, { status: 500 });
    }
}

/**
 * POST /api/support-tickets/[ticketId]  { text }
 * Reply to the rider. Moves an OPEN ticket to IN_REVIEW and pushes to the rider.
 */
async function handlePOST(request: Request, { params }: Ctx, auth: AdminResult) {
    try {
        const { ticketId } = await params;
        const body = await request.json();
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return NextResponse.json({ success: false, error: 'Reply text is required' }, { status: 400 });
        if (text.length > 2000) return NextResponse.json({ success: false, error: 'Reply is too long' }, { status: 400 });

        const ref = db.collection('supportTickets').doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
        const t = snap.data()!;
        const now = Timestamp.now();

        await ref.collection('messages').add({
            from: 'support',
            text,
            authorName: 'Delito support',
            authorEmail: auth.email || '',
            at: now,
        });
        await ref.update({
            lastMessageAt: now,
            lastMessageFrom: 'support',
            unreadForRider: true,
            status: t.status === 'OPEN' ? 'IN_REVIEW' : t.status,
            updatedAt: now,
        });

        if (t.riderId) {
            await sendPushNotification(
                'delivery',
                t.riderId,
                `Support replied · ${t.ticketNumber || 'your ticket'}`,
                text.length > 140 ? text.slice(0, 137) + '…' : text,
                { type: 'support_reply', ticketId }
            );
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Support reply error:', error);
        return NextResponse.json({ success: false, error: 'Failed to send reply' }, { status: 500 });
    }
}

/**
 * PATCH /api/support-tickets/[ticketId]
 * { status?, priority?, adminNotes?, callbackDone? }
 */
async function handlePATCH(request: Request, { params }: Ctx, auth: AdminResult) {
    try {
        const { ticketId } = await params;
        const body = await request.json();
        const ref = db.collection('supportTickets').doc(ticketId);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
        const t = snap.data()!;
        const now = Timestamp.now();

        const update: Record<string, unknown> = { updatedAt: now };
        let notifyResolved = false;

        if (body.status !== undefined) {
            if (!STATUSES.includes(body.status)) {
                return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
            }
            update.status = body.status;
            if (body.status === 'RESOLVED' && t.status !== 'RESOLVED') {
                update.resolvedAt = now;
                update.resolvedBy = auth.email || 'admin';
                update.unreadForRider = true;
                notifyResolved = true;
            }
        }
        if (body.priority !== undefined) {
            if (!PRIORITIES.includes(body.priority)) {
                return NextResponse.json({ success: false, error: 'Invalid priority' }, { status: 400 });
            }
            update.priority = body.priority;
        }
        if (typeof body.adminNotes === 'string') update.adminNotes = body.adminNotes.slice(0, 4000);
        if (body.callbackDone === true) {
            update.callbackRequested = false;
            update.callbackDoneAt = now;
            update.callbackDoneBy = auth.email || 'admin';
        }

        await ref.update(update);

        if (notifyResolved && t.riderId) {
            await sendPushNotification(
                'delivery',
                t.riderId,
                `Ticket resolved · ${t.ticketNumber || ''}`.trim(),
                `Your "${t.categoryLabel || 'support'}" ticket has been marked resolved. Reply in the app if you still need help.`,
                { type: 'support_reply', ticketId }
            );
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Support ticket update error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update ticket' }, { status: 500 });
    }
}

export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
export const PATCH = withAdmin(handlePATCH);
