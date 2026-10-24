/**
 * "Is this rider busy right now?" — answered from live delivery tasks.
 *
 * WHY THIS EXISTS
 * ---------------
 * The panel used to read `deliveryPersons.isOnDelivery`. That flag is written in
 * exactly one place — the manual-assignment route — and nothing in the rider app
 * or the backend ever cleared it, so every rider an admin had assigned by hand
 * showed "On Delivery" forever, even after the delivery was completed, and could
 * never be manually assigned again.
 *
 * The honest signal is the same one the backend's expiry sweep uses
 * (functions/orderLifecycle.js): a delivery task in a non-terminal status. The
 * rider app moves its own task to DELIVERED / CANCELLED, so this can never get
 * stuck the way a flag nobody owns can.
 *
 * Read-only, except for healStaleRiderFlags(), which only clears flags that
 * provably point at nothing, inside a transaction.
 */
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/** Mirrors DeliveryTaskRepository's activeTaskStatuses in the shared Kotlin module. */
export const ACTIVE_TASK_STATUSES = [
    'ASSIGNED',
    'ACCEPTED',
    'EN_ROUTE_TO_PICKUP',
    'ARRIVED_AT_PICKUP',
    'PICKED_UP',
    'EN_ROUTE_TO_CUSTOMER',
    'ARRIVED_AT_CUSTOMER',
] as const;

/** Statuses where the food is already with the rider. */
export const PICKED_UP_TASK_STATUSES = ['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'ARRIVED_AT_CUSTOMER'];

/** Order statuses that end an order. Keep in sync with functions/orderLifecycle.js. */
export const TERMINAL_ORDER_STATUSES = [
    'Delivered', 'Completed', 'delivered', 'completed',
    'Cancelled', 'Declined', 'Not Responded', 'Cancelled by Admin',
    'Restaurant did not respond', 'Expired',
];

export function isTerminalOrderStatus(status: unknown): boolean {
    return TERMINAL_ORDER_STATUSES.includes(String(status || '').trim());
}

export interface LiveJob {
    taskId: string;
    orderId: string;
    deliveryPersonId: string;
    deliveryPersonName: string;
    status: string;
    createdAtMs: number;
}

function millis(v: unknown): number {
    if (v && typeof (v as Timestamp).toMillis === 'function') return (v as Timestamp).toMillis();
    if (v instanceof Date) return v.getTime();
    return 0;
}

export function toLiveJob(doc: FirebaseFirestore.QueryDocumentSnapshot): LiveJob {
    const d = doc.data();
    return {
        taskId: doc.id,
        orderId: String(d.orderId || ''),
        deliveryPersonId: String(d.deliveryPersonId || ''),
        deliveryPersonName: String(d.deliveryPersonName || ''),
        status: String(d.status || ''),
        createdAtMs: millis(d.createdAt),
    };
}

/** Indexes live jobs; when one key has several, the newest wins. */
export function indexLiveJobs(jobs: LiveJob[]) {
    const byRider = new Map<string, LiveJob>();
    const byOrder = new Map<string, LiveJob>();
    for (const j of jobs) {
        if (j.deliveryPersonId) {
            const prev = byRider.get(j.deliveryPersonId);
            if (!prev || j.createdAtMs > prev.createdAtMs) byRider.set(j.deliveryPersonId, j);
        }
        if (j.orderId) {
            const prev = byOrder.get(j.orderId);
            if (!prev || j.createdAtMs > prev.createdAtMs) byOrder.set(j.orderId, j);
        }
    }
    return { byRider, byOrder };
}

/** One query, single-field index only (no composite index needed). */
export async function getLiveJobs() {
    const snap = await db.collection(collections.deliveryTasks)
        .where('status', 'in', [...ACTIVE_TASK_STATUSES])
        .get();
    return indexLiveJobs(snap.docs.map(toLiveJob));
}

/**
 * Does `rider.currentOrderId` still mean "this rider is on that order"?
 * Read inside a transaction (reads only — call it before any tx write).
 *
 * False when the order is finished or gone, OR when the order's live delivery
 * task belongs to a DIFFERENT rider and none belongs to this one. The second case
 * is what the old reassign bug left behind: the previous rider kept
 * currentOrderId=X while someone else delivered X, so they stayed "busy" (and got
 * no offers) until X finished. It is safe during the rider app's accept window —
 * the app writes currentOrderId a moment before it creates its task, but an order
 * that already has another rider's live task cannot be legitimately accepted.
 */
export async function riderStillOnOrder(
    tx: FirebaseFirestore.Transaction,
    riderId: string,
    orderId: string
): Promise<boolean> {
    const orderSnap = await tx.get(db.collection(collections.orders).doc(orderId));
    if (!orderSnap.exists || isTerminalOrderStatus(orderSnap.get('status'))) return false;

    const tasks = await tx.get(db.collection(collections.deliveryTasks).where('orderId', '==', orderId));
    const live = tasks.docs.filter(d =>
        (ACTIVE_TASK_STATUSES as readonly string[]).includes(String(d.get('status') || '')));
    const mine = live.some(d => String(d.get('deliveryPersonId') || '') === riderId);
    const someoneElses = live.some(d => String(d.get('deliveryPersonId') || '') !== riderId);
    if (!mine && someoneElses) return false;
    return true;
}

interface RiderFlagRow {
    id: string;
    isOnDelivery?: unknown;
    currentOrderId?: unknown;
    isSuspended?: unknown;
}

/**
 * Clears rider flags that no longer describe anything real:
 *   - `isOnDelivery: true` with no live task          → isOnDelivery=false
 *   - `currentOrderId` pointing at a finished/missing order, or at an order another
 *     rider is now delivering, with no live task      → currentOrderId=null, isAvailable=true
 *
 * The second one matters beyond the panel: functions/deliveryPush.js skips any
 * rider whose `currentOrderId` is set, so a stale one silently stops that rider
 * from ever being offered an order again.
 *
 * `byRider` must come from a getLiveJobs() call made just before. Each fix then
 * re-reads the rider INSIDE a transaction and only clears `currentOrderId` when
 * the order it names is finished or gone — so a rider who accepts a new order in
 * the meantime is never touched (the app writes currentOrderId a moment BEFORE it
 * creates the task, and that order is not finished).
 *
 * Never throws; returns how many riders were fixed.
 */
export async function healStaleRiderFlags(
    riders: RiderFlagRow[],
    byRider: Map<string, LiveJob>
): Promise<number> {
    const suspects = riders.filter(r =>
        !byRider.has(r.id) && (r.isOnDelivery === true || (typeof r.currentOrderId === 'string' && r.currentOrderId))
    );
    if (suspects.length === 0) return 0;

    let fixed = 0;
    await Promise.allSettled(suspects.slice(0, 50).map(async (r) => {
        try {
            const changed = await db.runTransaction(async (tx) => {
                const riderRef = db.collection(collections.deliveryPersons).doc(r.id);
                const riderSnap = await tx.get(riderRef);
                if (!riderSnap.exists) return false;
                const rider = riderSnap.data() || {};

                const update: Record<string, unknown> = {};
                if (rider.isOnDelivery === true) update.isOnDelivery = false;

                const cur = typeof rider.currentOrderId === 'string' ? rider.currentOrderId : '';
                if (cur) {
                    const finished = !(await riderStillOnOrder(tx, r.id, cur));
                    if (finished) {
                        update.currentOrderId = null;
                        update.isOnDelivery = false;
                        // A suspended rider stays unavailable — that is the suspension.
                        if (rider.isSuspended !== true) update.isAvailable = true;
                    }
                }

                if (Object.keys(update).length === 0) return false;
                update.updatedAt = Timestamp.now();
                update.staleFlagsClearedAt = Timestamp.now();
                tx.update(riderRef, update);
                return true;
            });
            if (changed) fixed++;
        } catch (e) {
            console.error(`[rider-jobs] heal failed for ${r.id}:`, e);
        }
    }));
    if (fixed) console.log(`[rider-jobs] cleared stale busy flags on ${fixed} rider(s)`);
    return fixed;
}
