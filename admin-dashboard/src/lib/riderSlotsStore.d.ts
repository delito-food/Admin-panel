/**
 * Type declarations for riderSlotsStore.js — a byte-for-byte copy of
 * functions/riderSlotsStore.js (the Firestore side of rider slots). Keep in sync:
 *     cp functions/riderSlotsStore.js admin-dashboard/src/lib/riderSlotsStore.js
 */
import type { SlotConfig } from './riderSlotsCore';

export interface SlotDeps {
    db: {
        collection: (name: string) => FirebaseFirestore.CollectionReference;
        getAll: (...refs: FirebaseFirestore.DocumentReference[]) => Promise<FirebaseFirestore.DocumentSnapshot[]>;
        runTransaction: <T>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>) => Promise<T>;
    };
    Timestamp: { fromMillis: (ms: number) => FirebaseFirestore.Timestamp };
    nowMs: () => number;
    messaging: () => { sendEach: (messages: unknown[]) => Promise<{ successCount: number }> };
    log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export interface SlotResult {
    success: boolean;
    code?: string;
    bookingId?: string;
    status?: string;
    strike?: boolean;
}

export interface BookOptions {
    byAdmin?: boolean;
    adminId?: string;
    cfg?: SlotConfig;
    reason?: string;
}

export const C: Readonly<Record<'TEMPLATES' | 'SLOTS' | 'BOOKINGS' | 'STATE' | 'META' | 'LOGS' | 'RIDERS' | 'TASKS', string>>;
export const EARLY_MS: number;
export function loadConfig(deps: SlotDeps): Promise<SlotConfig>;
export function book(deps: SlotDeps, uid: string, slotId: string, opts?: BookOptions): Promise<SlotResult>;
export function cancel(deps: SlotDeps, uid: string, bookingId: string, opts?: BookOptions): Promise<SlotResult>;
export function recomputeState(deps: SlotDeps, riderId: string, extra?: Record<string, unknown>): Promise<void>;
export function cancelFutureBookings(deps: SlotDeps, riderId: string, reason: string): Promise<number>;
export function generateSlots(deps: SlotDeps, dates: string[], onlyTemplateId?: string | null): Promise<number>;
