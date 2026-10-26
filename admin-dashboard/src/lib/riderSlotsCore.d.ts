/**
 * Type declarations for riderSlotsCore.js.
 *
 * The implementation is a byte-for-byte copy of functions/riderSlotsCore.js so the
 * admin panel and the Cloud Functions apply the same slot rules. If you change one,
 * copy it to the other:
 *     cp functions/riderSlotsCore.js admin-dashboard/src/lib/riderSlotsCore.js
 */

export type SlotMode = 'off' | 'soft' | 'hard';

export interface SlotConfig {
    mode: SlotMode;
    pilotPincodes: string[];
    bookingOpensAt: string;
    allowTomorrow: boolean;
    cancelCutoffMin: number;
    checkInGraceMin: number;
    maxPerDay: number;
    strikeLimit: number;
    strikeWindowDays: number;
    blockDays: number;
    autoOfflineMin: number;
    hardFallback: boolean;
    openToAllAfterAttempts: number;
    minRemainingMin: number;
    reminderMin: number;
}

export interface SlotTemplate {
    pincode: string;
    label: string;
    labelHi: string;
    start: string;
    end: string;
    capacity: number;
    daysOfWeek: number[];
    isPeak: boolean;
    active: boolean;
}

export const IST_OFFSET_MS: number;
export const MIN_MS: number;
export const DAY_MS: number;
export const STATUS: Readonly<Record<
    'BOOKED' | 'ACTIVE' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'LATE_CANCEL' | 'ADMIN_CANCELLED' | 'NOT_TRACKED',
    string
>>;
export const LIVE_STATUSES: readonly string[];
export const SLOT_STATUS: Readonly<Record<'OPEN' | 'CLOSED' | 'CANCELLED', string>>;
export const MODES: readonly SlotMode[];
export const DEFAULT_CONFIG: Readonly<SlotConfig>;

export function parseHHMM(s: unknown): number | null;
export function fmtHHMM(minutes: number): string;
export function fmt12(hhmmOrMinutes: string | number): string;
export function istDate(ms: number): string;
export function istMinuteOfDay(ms: number): number;
export function isDateString(s: unknown): boolean;
export function istMidnightMs(dateStr: string): number;
export function addDays(dateStr: string, n: number): string;
export function compactDate(dateStr: string): string;
export function isoWeekday(dateStr: string): number;
export function slotWindow(dateStr: string, start: string, end: string): { startMs: number; endMs: number } | null;
export function slotIdFor(dateStr: string, pincode: string, templateId: string): string;
export function bookingIdFor(slotId: string, riderId: string): string;
export function toMs(v: unknown): number | null;
export function normalizeConfig(raw: unknown): SlotConfig;
export function modeFor(cfg: SlotConfig, pincode: unknown): SlotMode;
export function validateTemplate(input: unknown): { ok: true; value: SlotTemplate } | { ok: false; error: string };
export function templateRuns(template: Partial<SlotTemplate>, dateStr: string): boolean;
export function templatesOverlap(a: Partial<SlotTemplate>, b: Partial<SlotTemplate>): boolean;
export function isLive(b: { status?: string } | null | undefined): boolean;
export function pushText(kind: string, lang: string, vars?: Record<string, string>): { title: string; message: string } | null;
