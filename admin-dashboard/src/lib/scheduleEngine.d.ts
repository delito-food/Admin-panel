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

export function evaluateSchedule(vendor: unknown, now: Date): ScheduleResult;
export function validateBusinessHours(hours: unknown): { valid: boolean; errors: string[] };
export function isValidTimezone(tz: string): boolean;
export function withLegacyMirror(hours: BusinessHoursMap): BusinessHoursMap;
export function slotsForDay(dayConfig: DayHours | null): { open: number; close: number }[];
export function parseHHmm(s: string): number | null;
export function minutesToHHmm(mins: number): string;

export const DAYS: string[];
export const REASON: Record<string, string>;
export const TICK_MINUTES: number;
export const DEFAULT_TZ: string;
export const MAX_SLOTS_PER_DAY: number;
