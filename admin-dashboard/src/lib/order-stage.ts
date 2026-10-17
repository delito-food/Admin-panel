/**
 * order-stage.ts — what stage an order is REALLY in, for the admin panel.
 *
 * TypeScript mirror of functions/orderStage.js (customerStageOf / opsStageOf /
 * promisedDeliveryAt). The mapping table is pinned by
 * functions/test/fixtures/orderStageTable.json; scripts/check-order-stage.mjs runs
 * the same rows against this file. Change a row in one place → change all three
 * (the third is OrderProgress.stageOf() in the customer app).
 *
 * WHY THE ADMIN PANEL NEEDS THIS
 * ------------------------------
 * The vendor app only writes Pending → Accepted → Prepared. "Preparing" is legacy
 * and never written now, so every filter, stat card and badge keyed on it read 0.
 * "Sent for delivery" is written when the rider SEARCH starts (and again when a
 * rider accepts), so it is not "on the way". And orders.pickedUpAt is stamped by
 * the shared assignment code the moment a rider ACCEPTS, so a timeline built on
 * it showed food picked up that was still in the kitchen. The rider's real
 * progress is on the delivery task. This file merges the two honestly.
 */

export type CustomerStage =
    | 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'RIDER_ASSIGNED'
    | 'PICKED_UP' | 'ARRIVING' | 'DELIVERED' | 'CANCELLED';

export type OpsStage =
    | 'AWAITING_VENDOR' | 'PREPARING' | 'FOOD_READY' | 'SEARCHING_RIDER'
    | 'RIDER_TO_RESTAURANT' | 'RIDER_AT_RESTAURANT' | 'OUT_FOR_DELIVERY'
    | 'AT_CUSTOMER' | 'DELIVERED' | 'NOT_RESPONDED' | 'NO_RIDER' | 'DECLINED'
    | 'CANCELLED' | 'UNKNOWN';

/** The handful of buckets the Orders page filters and counts by. */
export type OpsGroup = 'awaiting' | 'kitchen' | 'pickup' | 'onTheWay' | 'delivered' | 'issues';

export const CANCELLED_STATUSES = [
    'Cancelled', 'Declined', 'Not Responded', 'Cancelled by Admin',
    'Restaurant did not respond', 'Expired',
];

const PRE_PICKUP_TASK = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP'];
const POST_PICKUP_TASK = ['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER'];

const norm = (s: unknown) => String(s ?? '').trim();
const normTask = (s: unknown) => norm(s).toUpperCase();

export function customerStageOf(orderStatus: unknown, taskStatus: unknown, pickupPinVerified?: boolean): CustomerStage {
    const order = norm(orderStatus);
    const task = normTask(taskStatus);

    if (CANCELLED_STATUSES.includes(order) || task === 'CANCELLED') return 'CANCELLED';
    if (order === 'Delivered' || task === 'DELIVERED') return 'DELIVERED';
    if (task === 'ARRIVED_AT_CUSTOMER') return 'ARRIVING';
    if (POST_PICKUP_TASK.includes(task)) return 'PICKED_UP';
    if (pickupPinVerified === true || order === 'Picked Up') return 'PICKED_UP';
    if (PRE_PICKUP_TASK.includes(task)) return 'RIDER_ASSIGNED';

    switch (order) {
        case 'Preparing':
        case 'Prepared':
        case 'Ready for Pickup':
        case 'Sent for delivery':
            return 'PREPARING';
        case 'Accepted':
            return 'CONFIRMED';
        default:
            return 'PLACED';
    }
}

export function opsStageOf(orderStatus: unknown, taskStatus: unknown, pickupPinVerified?: boolean): OpsStage {
    const order = norm(orderStatus);
    const task = normTask(taskStatus);

    if (order === 'Not Responded' || order === 'Restaurant did not respond') return 'NOT_RESPONDED';
    if (order === 'Expired') return 'NO_RIDER';
    if (order === 'Declined') return 'DECLINED';
    if (order === 'Cancelled' || order === 'Cancelled by Admin') return 'CANCELLED';
    if (order === 'Delivered' || task === 'DELIVERED') return 'DELIVERED';

    if (task === 'ARRIVED_AT_CUSTOMER') return 'AT_CUSTOMER';
    if (POST_PICKUP_TASK.includes(task)) return 'OUT_FOR_DELIVERY';
    if (pickupPinVerified === true || order === 'Picked Up') return 'OUT_FOR_DELIVERY';
    if (task === 'ARRIVED_AT_PICKUP') return 'RIDER_AT_RESTAURANT';
    if (PRE_PICKUP_TASK.includes(task)) return 'RIDER_TO_RESTAURANT';

    switch (order) {
        case 'Pending': return 'AWAITING_VENDOR';
        case 'Accepted':
        case 'Preparing': return 'PREPARING';
        case 'Prepared':
        case 'Ready for Pickup': return 'FOOD_READY';
        case 'Sent for delivery': return 'SEARCHING_RIDER';
        default: return order ? 'UNKNOWN' : 'AWAITING_VENDOR';
    }
}

export const OPS_STAGE_META: Record<OpsStage, { label: string; group: OpsGroup; color: string }> = {
    AWAITING_VENDOR:     { label: 'Awaiting vendor',          group: 'awaiting',  color: '#D97706' },
    PREPARING:           { label: 'Preparing',                group: 'kitchen',   color: '#FF9904' },
    FOOD_READY:          { label: 'Food ready · no rider',    group: 'pickup',    color: '#0EA5E9' },
    SEARCHING_RIDER:     { label: 'Searching for rider',      group: 'pickup',    color: '#8B5CF6' },
    RIDER_TO_RESTAURANT: { label: 'Rider → restaurant',       group: 'pickup',    color: '#3B82F6' },
    RIDER_AT_RESTAURANT: { label: 'Rider at restaurant',      group: 'pickup',    color: '#2563EB' },
    OUT_FOR_DELIVERY:    { label: 'Out for delivery',         group: 'onTheWay',  color: '#F4511E' },
    AT_CUSTOMER:         { label: 'At customer',              group: 'onTheWay',  color: '#EA580C' },
    DELIVERED:           { label: 'Delivered',                group: 'delivered', color: '#10B981' },
    NOT_RESPONDED:       { label: 'Not responded',            group: 'issues',    color: '#E9190C' },
    NO_RIDER:            { label: 'No rider found',           group: 'issues',    color: '#9333EA' },
    DECLINED:            { label: 'Declined by vendor',       group: 'issues',    color: '#DC2626' },
    CANCELLED:           { label: 'Cancelled',                group: 'issues',    color: '#B91C1C' },
    UNKNOWN:             { label: 'Unknown status',           group: 'issues',    color: '#6B7280' },
};

export const OPS_GROUPS: { key: OpsGroup; label: string }[] = [
    { key: 'awaiting',  label: 'Awaiting vendor' },
    { key: 'kitchen',   label: 'Preparing' },
    { key: 'pickup',    label: 'Awaiting pickup' },
    { key: 'onTheWay',  label: 'Out for delivery' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'issues',    label: 'Cancelled / issues' },
];

/** Label for an ops stage; adds "· food not ready" when a rider is waiting on the kitchen. */
export function opsStageLabel(stage: OpsStage, foodReady?: boolean): string {
    const base = OPS_STAGE_META[stage]?.label ?? stage;
    if ((stage === 'RIDER_TO_RESTAURANT' || stage === 'RIDER_AT_RESTAURANT' || stage === 'SEARCHING_RIDER') && foodReady === false) {
        return `${base} · cooking`;
    }
    return base;
}

/* ── Time ─────────────────────────────────────────────────────────────── */

const MIN = 60_000;
const DEFAULT_PREP_MIN = 15;

/** Same formula as functions/orderStage.js travelMinutes(). */
export function travelMinutes(distanceKm: unknown): number {
    const km = Number(distanceKm);
    if (!(km > 0)) return 15;
    return Math.min(60, Math.max(8, Math.round(km * 3 + 5)));
}

/** acceptedAt + committed prep + travel. Null until accepted. */
export function promisedDeliveryMs(acceptedAtIso: string | null | undefined, prepMinutes: unknown, distanceKm: unknown): number | null {
    if (!acceptedAtIso) return null;
    const acc = Date.parse(acceptedAtIso);
    if (isNaN(acc)) return null;
    const prep = Number(prepMinutes) > 0 ? Number(prepMinutes) : DEFAULT_PREP_MIN;
    return acc + prep * MIN + travelMinutes(distanceKm) * MIN;
}

/** Minutes between two ISO strings, or null. */
export function minutesBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
    if (!fromIso || !toIso) return null;
    const a = Date.parse(fromIso);
    const b = Date.parse(toIso);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / MIN);
}
