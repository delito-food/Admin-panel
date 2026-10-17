import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { mapTicket } from '@/lib/support-tickets';

/**
 * Rider support tickets (raised from the delivery app's Help & support screen).
 *
 * Collection: supportTickets/{ticketId}, with a messages/{messageId} subcollection.
 * Riders create tickets and messages through the Firestore SDK (see firestore.rules,
 * match /supportTickets); the panel reads and replies through these routes with the
 * Admin SDK.
 *
 * GET /api/support-tickets  — list + summary
 */



async function handleGET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const rawLimit = parseInt(searchParams.get('limit') || '500', 10);
        const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 500, 2000);

        const snap = await db.collection('supportTickets').orderBy('createdAt', 'desc').limit(limit).get();
        const tickets = snap.docs.map(doc => mapTicket(doc.id, doc.data()));

        const summary = {
            total: tickets.length,
            open: tickets.filter(t => t.status === 'OPEN').length,
            inReview: tickets.filter(t => t.status === 'IN_REVIEW').length,
            resolved: tickets.filter(t => t.status === 'RESOLVED').length,
            callbacks: tickets.filter(t => t.callbackRequested && t.status !== 'RESOLVED').length,
            awaitingReply: tickets.filter(t => t.status !== 'RESOLVED' && t.lastMessageFrom === 'rider').length,
        };

        return NextResponse.json({ success: true, data: { tickets, summary } });
    } catch (error) {
        console.error('Support tickets fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch support tickets' }, { status: 500 });
    }
}

export const GET = withAdmin(handleGET);
