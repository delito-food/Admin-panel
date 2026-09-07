/**
 * Dates, tax periods and financial years — all in Asia/Kolkata.
 *
 * Delito operates in IST. Vercel runs in UTC. Every period boundary computed
 * with `new Date(y, m, 1)` or `setHours(0,0,0,0)` on a UTC host is therefore
 * 5 hours 30 minutes early, which pushed orders placed between 00:00 and 05:30
 * IST into the previous month's commission invoice and the previous month's
 * GSTR-1. Nothing in this file reads the host timezone.
 */

/** IST is UTC+05:30, with no daylight saving. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface Period {
    /** Inclusive start, as a UTC instant. */
    start: Date;
    /** Inclusive end, as a UTC instant. */
    end: Date;
}

/** Any Firestore timestamp, ISO string or Date → a UTC instant. */
export function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

    const v = value as { toDate?: () => Date; _seconds?: number; seconds?: number };
    if (typeof v.toDate === 'function') {
        const d = v.toDate();
        return isNaN(d.getTime()) ? null : d;
    }
    const seconds = v._seconds ?? v.seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);

    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/** The calendar parts of an instant as they read on a clock in India. */
export function istParts(instant: Date): { year: number; month: number; day: number; hour: number; minute: number } {
    const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1, // 1-indexed
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
    };
}

/** The UTC instant of a wall-clock time in India. */
export function istInstant(
    year: number, month: number, day: number,
    hour = 0, minute = 0, second = 0, ms = 0
): Date {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - IST_OFFSET_MS);
}

/** 00:00:00.000 → 23:59:59.999 IST on the given calendar day. */
export function istDayBounds(year: number, month: number, day: number): Period {
    return {
        start: istInstant(year, month, day, 0, 0, 0, 0),
        end: istInstant(year, month, day, 23, 59, 59, 999),
    };
}

/** Parse "YYYY-MM-DD" as an IST calendar day. */
export function istDayBoundsFromString(iso: string): Period | null {
    const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return istDayBounds(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
}

/** The whole of an IST calendar month, from "YYYY-MM". */
export function istMonthBounds(month: string): Period | null {
    const m = month.trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const monthNum = parseInt(m[2], 10);
    if (monthNum < 1 || monthNum > 12) return null;

    const start = istInstant(year, monthNum, 1, 0, 0, 0, 0);
    // Day 0 of the next month is the last day of this one.
    const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const end = istInstant(year, monthNum, lastDay, 23, 59, 59, 999);
    return { start, end };
}

/** Days in an IST calendar month. */
export function daysInMonth(year: number, monthNum: number): number {
    return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

export interface FinancialYear {
    /** First calendar year of the FY — 2026 for FY 2026-27. */
    startYear: number;
    /** "26-27", as it appears in an invoice serial. */
    label: string;
    /** "2026-27", for headings. */
    longLabel: string;
    period: Period;
}

/**
 * The Indian financial year an instant falls in: 1 April → 31 March.
 *
 * A GST invoice serial must be unique and consecutive *within* a financial
 * year, which is why this exists rather than `getFullYear()`.
 */
export function financialYearOf(instant: Date): FinancialYear {
    const { year, month } = istParts(instant);
    const startYear = month >= 4 ? year : year - 1;
    return financialYearFrom(startYear);
}

export function financialYearFrom(startYear: number): FinancialYear {
    const endYear = startYear + 1;
    return {
        startYear,
        label: `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`,
        longLabel: `${startYear}-${String(endYear).slice(-2)}`,
        period: {
            start: istInstant(startYear, 4, 1, 0, 0, 0, 0),
            end: istInstant(endYear, 3, 31, 23, 59, 59, 999),
        },
    };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** "05 Sep 2026" — as the invoice prints it. */
export function formatIstDate(instant: Date): string {
    const { year, month, day } = istParts(instant);
    return `${String(day).padStart(2, '0')} ${MONTHS_SHORT[month - 1]} ${year}`;
}

/** "05:22 PM" IST. */
export function formatIstTime(instant: Date): string {
    const { hour, minute } = istParts(instant);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${String(h12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "2026-09" — the tax period key for an instant. */
export function istMonthKey(instant: Date): string {
    const { year, month } = istParts(instant);
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** "September 2026". */
export function formatMonthLong(year: number, monthNum: number): string {
    return `${MONTHS_LONG[monthNum - 1]} ${year}`;
}

export function monthShortName(monthNum: number): string {
    return MONTHS_SHORT[monthNum - 1];
}

/** Is this instant inside the period? Both ends inclusive. */
export function withinPeriod(instant: Date, period: Period): boolean {
    const t = instant.getTime();
    return t >= period.start.getTime() && t <= period.end.getTime();
}

// ── Relative periods, in IST ──────────────────────────────────────────────
//
// Dashboards and reports repeatedly needed "today", "this week", "this month".
// Each site was computing them with `new Date()` plus `setHours(0,0,0,0)`,
// which on a UTC host starts the day at 05:30 IST — so the first five and a
// half hours of trading were reported against the previous day.

/** The IST calendar day an instant falls on. */
export function istToday(now: Date = new Date()): { year: number; month: number; day: number } {
    const { year, month, day } = istParts(now);
    return { year, month, day };
}

/** 00:00:00.000 → 23:59:59.999 IST today. */
export function istTodayBounds(now: Date = new Date()): Period {
    const { year, month, day } = istToday(now);
    return istDayBounds(year, month, day);
}

/** Start of the IST day `daysAgo` days back. */
export function istDaysAgoStart(daysAgo: number, now: Date = new Date()): Date {
    const todayStart = istTodayBounds(now).start;
    return new Date(todayStart.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

/** The IST calendar month containing `now`. */
export function istCurrentMonthBounds(now: Date = new Date()): Period {
    const { year, month } = istParts(now);
    return istMonthBounds(`${year}-${String(month).padStart(2, '0')}`)!;
}

/** The IST calendar month `monthsBack` months before `now`. */
export function istMonthBoundsOffset(monthsBack: number, now: Date = new Date()): Period {
    const { year, month } = istParts(now);
    let y = year;
    let m = month - monthsBack;
    while (m <= 0) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    return istMonthBounds(`${y}-${String(m).padStart(2, '0')}`)!;
}

/**
 * The Indian financial quarter an instant falls in.
 * Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar (of the FY that opened
 * the previous April).
 */
export function istFinancialQuarter(now: Date = new Date()): { period: Period; quarter: string; label: string } {
    const { year, month } = istParts(now);
    const fy = financialYearOf(now);

    let startMonth: number;
    let quarterNo: number;
    if (month >= 4 && month <= 6) { startMonth = 4; quarterNo = 1; }
    else if (month >= 7 && month <= 9) { startMonth = 7; quarterNo = 2; }
    else if (month >= 10 && month <= 12) { startMonth = 10; quarterNo = 3; }
    else { startMonth = 1; quarterNo = 4; }

    // Q4 is Jan–Mar, which falls in the calendar year AFTER the FY opened,
    // so the quarter always sits inside a single calendar year even though the
    // financial year it belongs to does not.
    const endMonth = startMonth + 2;
    const lastDay = daysInMonth(year, endMonth);

    return {
        period: {
            start: istInstant(year, startMonth, 1, 0, 0, 0, 0),
            end: istInstant(year, endMonth, lastDay, 23, 59, 59, 999),
        },
        quarter: `Q${quarterNo}`,
        label: `Q${quarterNo} FY${fy.longLabel}`,
    };
}
