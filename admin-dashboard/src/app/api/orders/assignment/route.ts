import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import {
    ACTIVE_TASK_STATUSES,
    PICKED_UP_TASK_STATUSES,
    getLiveJobs,
    healStaleRiderFlags,
    isTerminalOrderStatus,
    riderStillOnOrder,
} from '@/lib/rider-jobs';

/*
 * MANUAL ORDER ASSIGNMENT
 *
 * What changed (2026-10-24) and why — every item was a live bug:
 *
 *  1. "Busy forever". Busy used to be `deliveryPersons.isOnDelivery`, a flag only
 *     this route ever wrote and nothing ever cleared. Busy now comes from live
 *     delivery tasks (lib/rider-jobs.ts), and stale flags are cleared on read.
 *  2. Reassign looked for an existing task with status 'EN_ROUTE', which does not
 *     exist. A task in EN_ROUTE_TO_PICKUP / ARRIVED_AT_PICKUP / … was missed and a
 *     SECOND live task was created for the same order.
 *  3. The task's `deliveryFee` was copied from `order.deliveryFee` — the CUSTOMER's
 *     charge, ₹0 on free-delivery orders. It now carries rider pay, resolved the
 *     same way the rider app does (shared/RiderEarnings.kt).
 *  4. A PENDING broadcast for the order kept ringing other riders after the admin
 *     assigned it; one of them could accept and hijack the order. Pending offers
 *     are now cancelled (which also stops their phones ringing, via
 *     functions/deliveryPush.onDeliveryRequestResolved).
 *  5. The previous rider on a reassigned order was left with isAvailable=false and
 *     so never received another offer. They are now freed properly.
 *  6. Reassign rewrote the old rider's task in place, so the new rider inherited
 *     the old rider's timestamps. The old task is now CANCELLED and a fresh one is
 *     created, exactly as the rider app's own accept path does.
 *  7. Nothing stopped assigning a rider who was already on another order, an order
 *     that was already delivered/cancelled, or reassigning food that was already
 *     picked up. All are now refused with a clear message.
 *  8. The task was missing fields the rider app relies on (delivery OTP, vendor
 *     phone, "order for someone else" recipient details).
 *  9. Unassign only cancelled ASSIGNED/ACCEPTED tasks, leaving an en-route task live
 *     on the rider's phone, and never set the rider available again.
 *
 * All writes for one assign/unassign happen in a single transaction.
 */

class AssignError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

const PENDING_REQUESTS = 'pendingDeliveryRequests';

/** Rider pay — mirrors shared/RiderEarnings.forOrder. Never the customer's deliveryFee, never 0. */
function riderPayFor(order: FirebaseFirestore.DocumentData): number {
    const stamped = Number(order.deliveryPersonEarnings || 0);
    if (stamped > 0) return stamped;
    const km = Number(order.distanceKm || 0);
    if (km > 0) return Math.max(15, Math.round((10 + km * 6.5) * 10) / 10);
    return 15;
}

function isCod(paymentMode: unknown): boolean {
    const m = String(paymentMode || '').trim().toLowerCase();
    return m === 'cod' || m === 'cash' || m === 'cash on delivery';
}

/** Same 4-digit range as DeliveryTaskRepository.generateDeliveryOTP. */
function deliveryOtp(): string {
    return String(1000 + Math.floor(Math.random() * 9000));
}

function shortId(id: string): string {
    return `#${id.slice(-6).toUpperCase()}`;
}

function errorResponse(error: unknown, fallback: string) {
    if (error instanceof AssignError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error(fallback, error);
    return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

function invalidateAssignmentCaches() {
    invalidateCache(collections.orders);
    invalidateCache(collections.deliveryPersons);
    invalidateCache(collections.deliveryTasks);
}

// Get available delivery partners and unassigned orders
async function handleGET() {
    try {
        const [ordersSnapshot, deliverySnapshot, live] = await Promise.all([
            db.collection(collections.orders).orderBy('createdAt', 'desc').limit(100).get(),
            db.collection(collections.deliveryPersons).where('isVerified', '==', true).get(),
            getLiveJobs(),
        ]);

        // Build orders list
        const orders = ordersSnapshot.docs
            .filter(doc => {
                const order = doc.data();
                const status = order.status?.toLowerCase()?.replace(/\s+/g, '_') || '';
                // Only include "Sent for Delivery" orders for manual assignment
                // These are orders that vendors have prepared and are ready for delivery
                return status === 'sent_for_delivery' || status === 'sentfordelivery' ||
                       status === 'sent for delivery' || status === 'ready_for_pickup' ||
                       status === 'prepared';
            })
            .map(doc => {
                const order = doc.data();
                // Assignment comes from the LIVE task, not order.deliveryPersonId: that
                // field is sticky (nothing clears it when a task is cancelled), so an
                // order whose rider dropped off still looked assigned and could not be
                // given to anyone else.
                const job = live.byOrder.get(doc.id);
                return {
                    orderId: doc.id,
                    vendorId: order.vendorId || '',
                    vendorName: order.vendorName || 'Unknown Vendor',
                    vendorAddress: order.vendorAddress || order.pickupAddress || '',
                    customerId: order.customerId || '',
                    customerName: order.customerName || 'Unknown Customer',
                    customerPhone: order.customerPhone || '',
                    deliveryAddress: order.deliveryAddress || '',
                    status: order.status || 'pending',
                    total: order.total || 0,
                    paymentMode: order.paymentMode || '',
                    itemCount: order.items?.length || 0,
                    itemNames: order.items?.map((i: { name: string }) => i.name).join(', ') || '',
                    createdAt: order.createdAt?.toDate?.()?.toISOString() || '',
                    // Current assignment
                    deliveryPersonId: job ? job.deliveryPersonId : null,
                    deliveryPersonName: job ? (job.deliveryPersonName || order.deliveryPersonName || 'Delivery partner') : null,
                    isAssigned: !!job,
                    taskStatus: job ? job.status : null,
                    isPickedUp: job ? PICKED_UP_TASK_STATUSES.includes(job.status) : false,
                };
            });

        // Build delivery partners list with current status
        const deliveryPartners = deliverySnapshot.docs.map(doc => {
            const data = doc.data();
            const job = live.byRider.get(doc.id);
            return {
                deliveryPersonId: doc.id,
                fullName: data.fullName || 'Unknown',
                profilePhotoUrl: data.profilePhotoUrl || data.profileImageUrl || '',
                phoneNumber: data.phoneNumber || '',
                city: data.city || '',
                vehicleType: data.vehicleType || '',
                isOnline: data.isOnline || false,
                isSuspended: data.isSuspended === true,
                // Busy = has a live delivery task. See lib/rider-jobs.ts.
                isOnDelivery: !!job,
                currentOrderId: job ? job.orderId : null,
                activeTaskStatus: job ? job.status : null,
                rating: data.rating || 0,
                totalDeliveries: data.totalDeliveries || 0,
            };
        });

        // Sort: online first, then not on delivery, then by rating
        deliveryPartners.sort((a, b) => {
            if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
            if (a.isOnDelivery !== b.isOnDelivery) return a.isOnDelivery ? 1 : -1;
            return b.rating - a.rating;
        });

        // Clear flags left behind by earlier manual assignments, so the other panel
        // pages and the backend's offer filter stop treating these riders as busy.
        const healed = await healStaleRiderFlags(
            deliverySnapshot.docs.map(d => ({ id: d.id, ...d.data() })),
            live.byRider
        );
        if (healed) invalidateCache(collections.deliveryPersons);

        return NextResponse.json({
            success: true,
            data: {
                orders,
                deliveryPartners,
                summary: {
                    totalPendingOrders: orders.filter(o => !o.isAssigned).length,
                    totalAssignedOrders: orders.filter(o => o.isAssigned).length,
                    onlinePartners: deliveryPartners.filter(d => d.isOnline).length,
                    availablePartners: deliveryPartners.filter(d => d.isOnline && !d.isOnDelivery && !d.isSuspended).length,
                }
            }
        });
    } catch (error) {
        console.error('Order assignment fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch assignment data' },
            { status: 500 }
        );
    }
}

// Assign (or reassign) an order to a delivery partner
async function handlePOST(request: Request, _context: unknown, auth: AdminResult) {
    try {
        const body = await request.json();
        const { orderId, deliveryPersonId, deliveryPersonName, deliveryPersonPhone, reason } = body;

        if (!orderId || !deliveryPersonId) {
            return NextResponse.json(
                { success: false, error: 'Order ID and Delivery Person ID required' },
                { status: 400 }
            );
        }

        // Fast, index-free busy check against every live task. The transaction below
        // re-checks the rider document itself, so a race cannot double-book them.
        const live = await getLiveJobs();
        const riderJob = live.byRider.get(deliveryPersonId);
        if (riderJob && riderJob.orderId !== orderId) {
            throw new AssignError(409, `This rider is already on order ${shortId(riderJob.orderId)}. Assign someone who is free.`);
        }

        const assignedBy = auth?.uid ? `admin:${auth.uid}` : 'admin';
        const reasonText = String(reason || 'Manual assignment by admin').slice(0, 300);

        const outcome = await db.runTransaction(async (tx) => {
            const orderRef = db.collection(collections.orders).doc(orderId);
            const riderRef = db.collection(collections.deliveryPersons).doc(deliveryPersonId);

            // ---- reads (all before any write) ----
            const orderSnap = await tx.get(orderRef);
            if (!orderSnap.exists) throw new AssignError(404, 'Order not found');
            const order = orderSnap.data() || {};

            if (isTerminalOrderStatus(order.status)) {
                throw new AssignError(409, `Order is "${order.status}" — it can't be assigned.`);
            }

            const riderSnap = await tx.get(riderRef);
            if (!riderSnap.exists) throw new AssignError(404, 'Delivery partner not found');
            const rider = riderSnap.data() || {};
            if (rider.isVerified !== true) throw new AssignError(409, 'This delivery partner is not verified yet.');
            if (rider.isSuspended === true) throw new AssignError(409, 'This delivery partner is suspended.');

            const taskSnap = await tx.get(
                db.collection(collections.deliveryTasks).where('orderId', '==', orderId)
            );
            const liveTasks = taskSnap.docs.filter(d =>
                (ACTIVE_TASK_STATUSES as readonly string[]).includes(String(d.get('status') || ''))
            );

            if (liveTasks.some(d => d.get('deliveryPersonId') === deliveryPersonId)) {
                return { alreadyAssigned: true as const };
            }
            const pickedUp = liveTasks.find(d => PICKED_UP_TASK_STATUSES.includes(String(d.get('status'))));
            if (pickedUp) {
                throw new AssignError(409,
                    `${pickedUp.get('deliveryPersonName') || 'The current rider'} has already picked this order up — it can't be reassigned now.`);
            }

            // The rider doc is the in-transaction guard against double-booking.
            const riderCurrent = typeof rider.currentOrderId === 'string' ? rider.currentOrderId : '';
            // A currentOrderId left behind by an old reassign (another rider is now on
            // that order) does not block — see riderStillOnOrder.
            if (riderCurrent && riderCurrent !== orderId && await riderStillOnOrder(tx, deliveryPersonId, riderCurrent)) {
                throw new AssignError(409, `This rider is already on order ${shortId(riderCurrent)}. Assign someone who is free.`);
            }

            // Everyone who was on this order before, so they can be freed.
            const previousRiderIds = new Set<string>();
            liveTasks.forEach(d => { const id = d.get('deliveryPersonId'); if (id) previousRiderIds.add(String(id)); });
            if (order.deliveryPersonId) previousRiderIds.add(String(order.deliveryPersonId));
            previousRiderIds.delete(deliveryPersonId);
            const previousRiders = await Promise.all(
                [...previousRiderIds].map(id => tx.get(db.collection(collections.deliveryPersons).doc(id)))
            );

            const requestSnap = await tx.get(
                db.collection(PENDING_REQUESTS).where('orderId', '==', orderId)
            );

            let vendorPhone = '';
            if (order.vendorId) {
                const vendorSnap = await tx.get(db.collection(collections.vendors).doc(String(order.vendorId)));
                vendorPhone = vendorSnap.exists ? String(vendorSnap.get('phoneNumber') || '') : '';
            }

            // ---- writes ----
            const now = Timestamp.now();
            const name = String(rider.fullName || deliveryPersonName || '');
            const phone = String(rider.phoneNumber || deliveryPersonPhone || '');
            const pay = riderPayFor(order);
            const cod = isCod(order.paymentMode);

            // 1. Retire the old rider's task (if any). A fresh task is created below.
            liveTasks.forEach(d => tx.update(d.ref, {
                status: 'CANCELLED',
                cancelledAt: now,
                cancelledBy: 'admin',
                cancellationReason: 'Reassigned by admin',
                updatedAt: now,
            }));

            // 2. Stop any offer still ringing other riders' phones.
            requestSnap.docs
                .filter(d => String(d.get('status') || '').toUpperCase() === 'PENDING')
                .forEach(d => tx.update(d.ref, { status: 'CANCELLED', expiredAt: now, cancelledBy: 'admin' }));

            // 3. The new task — same shape the rider app's createDeliveryTask writes.
            const taskRef = db.collection(collections.deliveryTasks).doc();
            tx.set(taskRef, {
                taskId: taskRef.id,
                orderId,
                deliveryPersonId,
                deliveryPersonName: name,
                deliveryPersonPhone: phone,
                vendorId: order.vendorId || '',
                vendorName: order.vendorName || '',
                vendorAddress: order.vendorAddress || '',
                vendorLatitude: order.vendorLatitude || 0,
                vendorLongitude: order.vendorLongitude || 0,
                vendorPhone,
                customerId: order.customerId || '',
                customerName: order.customerName || '',
                customerAddress: order.deliveryAddress || '',
                customerLatitude: order.customerLatitude || 0,
                customerLongitude: order.customerLongitude || 0,
                customerPhone: order.customerPhone || '',
                isOrderForSomeoneElse: order.isOrderForSomeoneElse === true,
                recipientName: order.recipientName || '',
                recipientPhone: order.recipientPhone || '',
                recipientAddress: order.recipientAddress || '',
                recipientInstructions: order.recipientInstructions || '',
                status: 'ASSIGNED',
                orderTotal: order.total || 0,
                // RIDER pay under both keys, exactly like createDeliveryTask.
                deliveryFee: pay,
                deliveryPersonEarnings: pay,
                paymentMode: order.paymentMode || 'COD',
                itemsDescription: order.items?.map((i: { name: string }) => i.name).join(', ') || '',
                specialInstructions: order.deliveryInstructions || '',
                deliveryOtp: deliveryOtp(),
                codAmount: cod ? (order.total || 0) : 0,
                codCollected: false,
                codSettled: false,
                createdAt: now,
                assignedAt: now,
                assignedBy,
                updatedAt: now,
            });

            // 4. The order.
            tx.update(orderRef, {
                deliveryPersonId,
                deliveryPersonName: name,
                deliveryPersonPhone: phone,
                assignedAt: now,
                assignedBy,
                assignmentReason: reasonText,
                updatedAt: now,
            });

            // 5. The new rider is busy. currentOrderId + isAvailable are what the rider
            //    app and functions/deliveryPush.js read; isOnDelivery is kept for any
            //    older reader, and is now cleared again when the delivery ends.
            tx.update(riderRef, {
                currentOrderId: orderId,
                isAvailable: false,
                isOnDelivery: true,
                updatedAt: now,
            });

            // 6. Free whoever had it before — only if this order is what they're on.
            previousRiders.forEach(snap => {
                if (!snap.exists) return;
                const d = snap.data() || {};
                if (d.currentOrderId && d.currentOrderId !== orderId) return;
                const update: Record<string, unknown> = { currentOrderId: null, isOnDelivery: false, updatedAt: now };
                if (d.isSuspended !== true) update.isAvailable = true;
                tx.update(snap.ref, update);
            });

            // 7. Audit log.
            tx.set(db.collection('orderAssignmentLogs').doc(), {
                orderId,
                action: liveTasks.length ? 'reassign' : 'assign',
                previousDeliveryPersonId: [...previousRiderIds][0] || null,
                newDeliveryPersonId: deliveryPersonId,
                newDeliveryPersonName: name,
                taskId: taskRef.id,
                cancelledTaskIds: liveTasks.map(d => d.id),
                riderPay: pay,
                reason: reasonText,
                assignedBy,
                createdAt: now,
            });

            return { alreadyAssigned: false as const, name };
        });

        invalidateAssignmentCaches();

        if (outcome.alreadyAssigned) {
            return NextResponse.json({ success: true, message: 'Order is already assigned to this delivery partner' });
        }
        return NextResponse.json({
            success: true,
            message: `Order assigned to ${outcome.name || 'delivery partner'} successfully`,
        });
    } catch (error) {
        return errorResponse(error, 'Failed to assign order');
    }
}

// Unassign order from delivery partner
async function handleDELETE(request: Request, _context: unknown, auth: AdminResult) {
    try {
        const { searchParams } = new URL(request.url);
        const orderId = searchParams.get('orderId');

        if (!orderId) {
            return NextResponse.json(
                { success: false, error: 'Order ID required' },
                { status: 400 }
            );
        }

        const unassignedBy = auth?.uid ? `admin:${auth.uid}` : 'admin';

        await db.runTransaction(async (tx) => {
            const orderRef = db.collection(collections.orders).doc(orderId);
            const orderSnap = await tx.get(orderRef);
            if (!orderSnap.exists) throw new AssignError(404, 'Order not found');
            const order = orderSnap.data() || {};

            const taskSnap = await tx.get(
                db.collection(collections.deliveryTasks).where('orderId', '==', orderId)
            );
            const liveTasks = taskSnap.docs.filter(d =>
                (ACTIVE_TASK_STATUSES as readonly string[]).includes(String(d.get('status') || ''))
            );
            const pickedUp = liveTasks.find(d => PICKED_UP_TASK_STATUSES.includes(String(d.get('status'))));
            if (pickedUp) {
                throw new AssignError(409,
                    `${pickedUp.get('deliveryPersonName') || 'The rider'} has already picked this order up — it can't be unassigned now.`);
            }

            const riderIds = new Set<string>();
            liveTasks.forEach(d => { const id = d.get('deliveryPersonId'); if (id) riderIds.add(String(id)); });
            if (order.deliveryPersonId) riderIds.add(String(order.deliveryPersonId));
            const riders = await Promise.all(
                [...riderIds].map(id => tx.get(db.collection(collections.deliveryPersons).doc(id)))
            );

            const now = Timestamp.now();

            // Remove assignment from order
            tx.update(orderRef, {
                // Deleted, not nulled: the apps' Order model types these as non-null
                // strings, and a stored null would fail to deserialize there.
                deliveryPersonId: FieldValue.delete(),
                deliveryPersonName: FieldValue.delete(),
                deliveryPersonPhone: FieldValue.delete(),
                unassignedAt: now,
                unassignedBy,
                updatedAt: now,
            });

            // Cancel every live task for the order (not just ASSIGNED/ACCEPTED), so an
            // en-route task can't stay on the rider's phone.
            liveTasks.forEach(d => tx.update(d.ref, {
                status: 'CANCELLED',
                cancelledAt: now,
                cancelledBy: 'admin',
                cancellationReason: 'Order unassigned by admin',
                updatedAt: now,
            }));

            // Free the rider(s) — only if this order is what they're on.
            riders.forEach(snap => {
                if (!snap.exists) return;
                const d = snap.data() || {};
                if (d.currentOrderId && d.currentOrderId !== orderId) return;
                const update: Record<string, unknown> = { currentOrderId: null, isOnDelivery: false, updatedAt: now };
                if (d.isSuspended !== true) update.isAvailable = true;
                tx.update(snap.ref, update);
            });

            tx.set(db.collection('orderAssignmentLogs').doc(), {
                orderId,
                action: 'unassign',
                previousDeliveryPersonId: [...riderIds][0] || null,
                cancelledTaskIds: liveTasks.map(d => d.id),
                assignedBy: unassignedBy,
                createdAt: now,
            });
        });

        invalidateAssignmentCaches();

        return NextResponse.json({
            success: true,
            message: 'Order unassigned successfully',
        });
    } catch (error) {
        return errorResponse(error, 'Failed to unassign order');
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
export const DELETE = withAdmin(handleDELETE);
