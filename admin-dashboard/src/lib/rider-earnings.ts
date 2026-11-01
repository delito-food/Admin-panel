/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What each delivery partner has earned — the panel's version of the rider
 * app's own figure.
 *
 * Mirrors shared/RiderEarnings.kt so the dashboard ranks riders by the same
 * money the rider sees in the app:
 *
 *   per delivery  = orders.deliveryPersonEarnings          (canonical, incl. surge share)
 *                 → else the task's deliveryPersonEarnings / deliveryFee
 *                 → else priced from the distance
 *                 → else the ₹15 floor (a completed delivery is never worth ₹0)
 *   + tip         = the task's tip, else the order's
 *   + incentives  = deliveryPersons.totalIncentiveEarned   (ladder / gig bonuses)
 *
 * WHO delivered comes from the DELIVERED delivery task, not the order: the
 * order's deliveryPersonId is missing on some assignment paths and can still
 * name the first rider after a reassignment. Fulfilled orders with no
 * delivered task fall back to the rider named on the order.
 */

// Fallback pricing, same as lib/order-breakdown.ts (only used when nothing was stored).
const BASE_RIDER_PAY = 10;
const PER_KM_RIDER_PAY = 6.5;
const MIN_RIDER_PAY = 15;

const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function millis(v: any): number {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v._seconds !== undefined) return v._seconds * 1000;
    if (v instanceof Date) return v.getTime();
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
}

/** RiderEarnings.resolve() — never returns zero. */
export function resolveRiderPay(input: {
    orderEarnings?: unknown;
    taskEarnings?: unknown;
    orderDistanceKm?: unknown;
    taskDistanceMeters?: unknown;
}): number {
    const orderEarnings = num(input.orderEarnings);
    if (orderEarnings > 0) return orderEarnings;
    const taskEarnings = num(input.taskEarnings);
    if (taskEarnings > 0) return taskEarnings;
    const km = num(input.orderDistanceKm) > 0 ? num(input.orderDistanceKm) : num(input.taskDistanceMeters) / 1000;
    if (km > 0) return Math.max(MIN_RIDER_PAY, Math.round((BASE_RIDER_PAY + km * PER_KM_RIDER_PAY) * 10) / 10);
    return MIN_RIDER_PAY;
}

export interface RiderEarningsRow {
    riderId: string;
    name: string;
    deliveries: number;
    /** Per-delivery pay, surge share included. */
    deliveryPay: number;
    tips: number;
    /** Ladder / gig bonuses credited to the rider (all time). */
    incentives: number;
    /** deliveryPay + tips + incentives. */
    total: number;
    rating: number;
    lastDeliveredAt: string | null;
}

const DONE_TASK = new Set(['DELIVERED', 'COMPLETED']);

/**
 * Every rider's all-time earnings.
 *
 * @param tasks        deliveryTasks rows (with `id`)
 * @param orders       orders rows (with `id`)
 * @param riders       deliveryPersons rows (with `id`)
 * @param isFulfilled  the dashboard's "this order counts as done" rule
 */
export function computeRiderEarnings(
    tasks: any[],
    orders: any[],
    riders: any[],
    isFulfilled: (order: any) => boolean
): RiderEarningsRow[] {
    const ordersById = new Map<string, any>(orders.map(o => [String(o.id), o]));
    const ridersById = new Map<string, any>(riders.map(r => [String(r.id), r]));

    // One delivered task per order — the newest, if a retry left two behind.
    const taskByOrder = new Map<string, any>();
    for (const t of tasks) {
        if (!t?.deliveryPersonId) continue;
        if (!DONE_TASK.has(String(t.status || '').toUpperCase())) continue;
        const key = String(t.orderId || `task:${t.id}`);
        const prev = taskByOrder.get(key);
        const at = millis(t.deliveredAt) || millis(t.completedAt) || millis(t.createdAt);
        if (!prev || at >= prev.__at) taskByOrder.set(key, { ...t, __at: at });
    }

    const rows = new Map<string, RiderEarningsRow>();
    const rowFor = (riderId: string, fallbackName: string) => {
        let row = rows.get(riderId);
        if (!row) {
            const rider = ridersById.get(riderId);
            row = {
                riderId,
                name: String(rider?.fullName || rider?.name || fallbackName || 'Unknown'),
                deliveries: 0, deliveryPay: 0, tips: 0, incentives: 0, total: 0,
                rating: num(rider?.rating),
                lastDeliveredAt: null,
            };
            rows.set(riderId, row);
        }
        return row;
    };
    const touch = (row: RiderEarningsRow, ms: number) => {
        if (ms > 0) {
            const iso = new Date(ms).toISOString();
            if (!row.lastDeliveredAt || iso > row.lastDeliveredAt) row.lastDeliveredAt = iso;
        }
    };

    // 1. Delivered tasks — who actually made the delivery.
    for (const [key, t] of taskByOrder) {
        const order = key.startsWith('task:') ? undefined : ordersById.get(key);
        const row = rowFor(String(t.deliveryPersonId), String(t.deliveryPersonName || ''));
        row.deliveries += 1;
        row.deliveryPay += resolveRiderPay({
            orderEarnings: order?.deliveryPersonEarnings,
            taskEarnings: num(t.deliveryPersonEarnings) > 0 ? t.deliveryPersonEarnings : (num(t.deliveryEarnings) > 0 ? t.deliveryEarnings : t.deliveryFee),
            orderDistanceKm: order?.distanceKm,
            taskDistanceMeters: t.deliveryDistanceMeters,
        });
        row.tips += num(t.tip) > 0 ? num(t.tip) : num(order?.tip);
        touch(row, t.__at);
    }

    // 2. Fulfilled orders with no delivered task — credit the rider on the order.
    for (const o of orders) {
        if (taskByOrder.has(String(o.id))) continue;
        const riderId = o.deliveryPersonId || o.deliveryPartnerId;
        if (!riderId || !isFulfilled(o)) continue;
        const row = rowFor(String(riderId), String(o.deliveryPersonName || o.deliveryPartnerName || ''));
        row.deliveries += 1;
        row.deliveryPay += resolveRiderPay({ orderEarnings: o.deliveryPersonEarnings, orderDistanceKm: o.distanceKm });
        row.tips += num(o.tip);
        touch(row, millis(o.deliveredAt) || millis(o.createdAt));
    }

    // 3. Incentives live on the rider document; include riders with only a bonus.
    for (const r of riders) {
        const incentive = num(r.totalIncentiveEarned);
        if (incentive > 0) rowFor(String(r.id), '').incentives = incentive;
    }

    return Array.from(rows.values()).map(row => ({
        ...row,
        deliveryPay: r2(row.deliveryPay),
        tips: r2(row.tips),
        incentives: r2(row.incentives),
        total: r2(row.deliveryPay + row.tips + row.incentives),
    }));
}
