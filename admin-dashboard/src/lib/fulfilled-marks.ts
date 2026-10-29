/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Count as fulfilled" markers.
 *
 * Some orders were really delivered but ended up with a non-delivered status —
 * mostly "Not Responded", from the expiry race described in FIX_NOT_RESPONDED.md.
 * An admin can mark such an order so the panel COUNTS it as fulfilled (order
 * stats, dashboard completed count and Delito earnings).
 *
 * The marker deliberately lives in its own collection, keyed by order id, and
 * never on the order document. Writing to orders/{id} would wake every trigger
 * and app listener on it (status guard, finance sync, vendor mirror, rider and
 * customer screens). Here nothing about the order changes: not its status, not
 * its refund, not the vendor or rider payout. Removing the marker undoes it
 * completely.
 */

import { cachedCollection, invalidateCacheWithDerived } from './firebase-admin';

export const FULFILLED_MARKS_COLLECTION = 'adminFulfilledMarks';

/** cachedQuery keys whose payload counts fulfilled orders. */
export const FULFILLED_DERIVED_KEYS = ['dashboard:summary'];

export interface FulfilledMark {
    orderId: string;
    markedAt: string | null;
    markedBy: string;
    note: string;
    /** The order's raw status when it was marked — for the audit trail. */
    statusWhenMarked: string;
}

function toIso(v: any): string | null {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Every marker, by order id. The collection is tiny — one doc per marked order. */
export async function loadFulfilledMarks(): Promise<Map<string, FulfilledMark>> {
    const docs = await cachedCollection(FULFILLED_MARKS_COLLECTION, 30_000);
    const map = new Map<string, FulfilledMark>();
    for (const d of docs) {
        map.set(d.id, {
            orderId: d.id,
            markedAt: toIso(d.markedAt),
            markedBy: String(d.markedBy || ''),
            note: String(d.note || ''),
            statusWhenMarked: String(d.statusWhenMarked || ''),
        });
    }
    return map;
}

export function invalidateFulfilledMarks(): void {
    invalidateCacheWithDerived(FULFILLED_MARKS_COLLECTION, FULFILLED_DERIVED_KEYS);
}

/** Delivered by status, or marked fulfilled by an admin. */
export function isFulfilledOrder(order: { id?: string; orderId?: string; status?: unknown }, marks: Map<string, FulfilledMark>): boolean {
    const s = String(order.status || '').trim().toLowerCase();
    if (s === 'delivered' || s === 'completed') return true;
    const id = order.id || order.orderId;
    return !!id && marks.has(id);
}
