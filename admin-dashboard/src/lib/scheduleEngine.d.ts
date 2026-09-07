/**
 * Type declarations for scheduleEngine.js.
 *
 * The implementation is a byte-for-byte copy of functions/scheduleEngine.js so the
 * admin dashboard and the Cloud Function scheduler always agree. If you change one,
 * copy it to the other:
 *     cp functions/scheduleEngine.js admin-dashboard/src/lib/scheduleEngine.js
 */

export interface TimeSlot { open: string; close: string; }
export interface DayHours { isOpen: boolean; slots?: TimeSlot[]; openTime?: string; closeTime?: string; }
export type BusinessHoursMap = Record<string, DayHours>;

export interface ScheduleResult {
    shouldBeOpen: boolean;
    reason: string;
    nextTransitionAt: Date | null;
}

export interface VendorWriteDecision {
    kind: 'adapter' | 'revert' | 'reconcile';
    update: Record<string, unknown>;
}

export function evaluateSchedule(vendor: unknown, now: Date): ScheduleResult;
export function validateBusinessHours(hours: unknown): { valid: boolean; errors: string[] };
export function isValidTimezone(tz: string): boolean;
export function withLegacyMirror(hours: BusinessHoursMap): BusinessHoursMap;
export function slotsForDay(dayConfig: DayHours | null): { open: number; close: number }[];
export function parseHHmm(s: string): number | null;
export function minutesToHHmm(mins: number): string;

/**
 * Lowercases day keys before lookup. Vendor app v2.5 writes "Monday"; everything
 * that reads the map expects "monday". Call this on any businessHours map that
 * came out of Firestore before indexing into it.
 */
export function normaliseHourKeys(hours: unknown): BusinessHoursMap;

/** Pure decision for the vendors/{id} onWrite trigger. Server-side only. */
export function decideVendorWrite(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    now: Date
): VendorWriteDecision | null;

/** The reason a vendor cannot be open at all, or null if nothing blocks them. */
export function blockingReason(vendor: Record<string, unknown>): string | null;

/**
 * True if this vendor's verification does not block trading.
 *
 * Accepts BOTH 'approved' (what api/verification/vendors writes, and what the
 * vendor app checks) and 'verified' (what this engine used to require, and which
 * nothing has ever written). An absent or empty status does not block.
 */
export function isVerifiedStatus(status: string | null | undefined): boolean;

export const DAYS: string[];
export const REASON: Record<string, string>;
export const TICK_MINUTES: number;
export const DEFAULT_TZ: string;
export const MAX_SLOTS_PER_DAY: number;
export const WATCHED_FIELDS: string[];
export const FORCE_OPEN_MAX_MINUTES: number;
export const OVERRIDE_FALLBACK_MINUTES: number;
export const VERIFIED_STATUSES: string[];
