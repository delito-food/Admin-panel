/**
 * POST   /api/orders/fulfilled-mark   { orderId, note? }  → count the order as fulfilled
 * DELETE /api/orders/fulfilled-mark?orderId=…             → remove the marker
 *
 * Only writes adminFulfilledMarks/{orderId}. The order document itself is
 * never touched — see src/lib/fulfilled-marks.ts.
 */
import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { db, collections } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import { FULFILLED_MARKS_COLLECTION, invalidateFulfilledMarks } from '@/lib/fulfilled-marks';

const ALREADY_FULFILLED = ['delivered', 'completed'];

async function handlePOST(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const body = await request.json().catch(() => ({}));
        const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
        if (!orderId) {
            return NextResponse.json({ success: false, error: 'Order ID required' }, { status: 400 });
        }

        const orderSnap = await db.collection(collections.orders).doc(orderId).get();
        if (!orderSnap.exists) {
            return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
        }
        const status = String(orderSnap.data()?.status || '');
        if (ALREADY_FULFILLED.includes(status.toLowerCase())) {
            return NextResponse.json({ success: false, error: 'This order is already Delivered — no marker needed' }, { status: 400 });
        }

        await db.collection(FULFILLED_MARKS_COLLECTION).doc(orderId).set({
            orderId,
            note,
            statusWhenMarked: status,
            markedBy: auth.email || auth.uid || 'admin',
            markedByUid: auth.uid || '',
            markedAt: Timestamp.now(),
        });
        invalidateFulfilledMarks();

        return NextResponse.json({ success: true, message: 'Order will be counted as fulfilled. Nothing on the order was changed.' });
    } catch (error) {
        console.error('Fulfilled mark error:', error);
        return NextResponse.json({ success: false, error: 'Failed to mark order' }, { status: 500 });
    }
}

async function handleDELETE(request: Request) {
    try {
        const orderId = (new URL(request.url).searchParams.get('orderId') || '').trim();
        if (!orderId) {
            return NextResponse.json({ success: false, error: 'Order ID required' }, { status: 400 });
        }
        await db.collection(FULFILLED_MARKS_COLLECTION).doc(orderId).delete();
        invalidateFulfilledMarks();
        return NextResponse.json({ success: true, message: 'Marker removed — the order is counted by its own status again.' });
    } catch (error) {
        console.error('Fulfilled unmark error:', error);
        return NextResponse.json({ success: false, error: 'Failed to remove marker' }, { status: 500 });
    }
}

export const POST = withAdmin(handlePOST);
export const DELETE = withAdmin(handleDELETE);
