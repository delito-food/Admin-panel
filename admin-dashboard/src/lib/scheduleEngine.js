/**
 * scheduleEngine.js
 *
 * Pure, dependency-free business-hours evaluation.
 * No Firestore, no admin SDK, no I/O — so it is trivially unit-testable and can be
 * shared verbatim between the pubsub tick, the callables, and the admin dashboard.
 *
 * See VENDOR_APP_IMPLEMENTATION_PLAN.md Part 2.
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const REASON = {
    SUSPENDED:          'SUSPENDED',
    ADMIN_FORCED:       'ADMIN_FORCED',
    UNVERIFIED:         'UNVERIFIED',
    VENDOR_PAUSED:      'VENDOR_PAUSED',
    VENDOR_FORCED_OPEN: 'VENDOR_FORCED_OPEN',
    HOLIDAY:            'HOLIDAY',
    MANUAL_MODE:        'MANUAL_MODE',
    WITHIN_HOURS:       'WITHIN_HOURS',
    OUTSIDE_HOURS:      'OUTSIDE_HOURS'
};

const DEFAULT_TZ = 'Asia/Kolkata';

// Scheduler tick granularity. Openings are floored and closings are ceiled to this
// boundary so a shop is never LATE to open — see plan §2.3.
const TICK_MINUTES = 10;

/* ------------------------------------------------------------------ */
/* Timezone helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns the wall-clock parts of `date` as observed in `timeZone`.
 * Uses Intl only — no moment/luxon dependency.
 */
function zonedParts(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        weekday: 'short'
    });
    const parts = {};
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;

    // Intl returns hour "24" at midnight in some ICU versions; normalise to 0.
    const hour = parseInt(parts.hour, 10) % 24;

    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
        year:    parseInt(parts.year, 10),
        month:   parseInt(parts.month, 10),
        day:     parseInt(parts.day, 10),
        hour,
        minute:  parseInt(parts.minute, 10),
        second:  parseInt(parts.second, 10),
        weekday: weekdayMap[parts.weekday],
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        minutesOfDay: hour * 60 + parseInt(parts.minute, 10)
    };
}

/**
 * Offset of `timeZone` from UTC, in minutes, at the given instant.
 * Positive east of Greenwich (IST = +330).
 */
function tzOffsetMinutes(date, timeZone) {
    const p = zonedParts(date, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Builds a UTC Date from wall-clock components interpreted in `timeZone`.
 * Two-pass to settle DST boundaries (a no-op for Asia/Kolkata, correct elsewhere).
 */
function zonedTimeToUtc(year, month, day, minutesOfDay, timeZone) {
    const hour = Math.floor(minutesOfDay / 60);
    const minute = minutesOfDay % 60;
    let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    for (let i = 0; i < 2; i++) {
        const offset = tzOffsetMinutes(guess, timeZone);
        const corrected = new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offset * 60000);
        if (corrected.getTime() === guess.getTime()) break;
        guess = corrected;
    }
    return guess;
}

/** Adds `n` days to a {year, month, day} triple, returning a new triple. */
function addDays(ymd, n) {
    const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
    d.setUTCDate(d.getUTCDate() + n);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

function ymdKey(ymd) {
    return `${ymd.year}-${String(ymd.month).padStart(2, '0')}-${String(ymd.day).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Slot helpers                                                        */
/* ------------------------------------------------------------------ */

/** "HH:mm" -> minutes since midnight. Returns null when malformed. */
function parseHHmm(s) {
    if (typeof s !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
}

function minutesToHHmm(mins) {
    const m = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Normalises a day config to a slot array, accepting BOTH the legacy
 * { isOpen, openTime, closeTime } shape used by vendor app v2.5 and the new
 * { isOpen, slots: [...] } shape. This is what makes the migration non-breaking.
 */
function slotsForDay(dayConfig) {
    if (!dayConfig || dayConfig.isOpen === false) return [];

    if (Array.isArray(dayConfig.slots) && dayConfig.slots.length > 0) {
        return dayConfig.slots
            .map(s => ({ open: parseHHmm(s.open), close: parseHHmm(s.close) }))
            .filter(s => s.open !== null && s.close !== null);
    }

    // Legacy fallback
    const open = parseHHmm(dayConfig.openTime);
    const close = parseHHmm(dayConfig.closeTime);
    if (open === null || close === null) return [];
    return [{ open, close }];
}

/** A slot whose close is <= its open wraps past midnight into the next day. */
function slotWraps(slot) {
    return slot.close <= slot.open;
}

/* ------------------------------------------------------------------ */
/* Core evaluation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Decides whether a vendor should be open right now, why, and when the next
 * state change is due.
 *
 * Precedence is strict and ordered — see plan §2.2. Getting this order wrong is
 * how a cron ends up overriding an admin suspension.
 *
 * @param {object} vendor  raw vendors/{id} document data
 * @param {Date}   now
 * @returns {{shouldBeOpen: boolean, reason: string, nextTransitionAt: Date|null}}
 */
function evaluateSchedule(vendor, now) {
    const v = vendor || {};
    const tz = v.timezone || DEFAULT_TZ;

    // ---- 1. Suspended (admin) ----
    if (v.isSuspended === true) {
        return { shouldBeOpen: false, reason: REASON.SUSPENDED, nextTransitionAt: null };
    }

    // ---- 2. Admin forced offline ----
    if (v.adminForceOffline === true) {
        return { shouldBeOpen: false, reason: REASON.ADMIN_FORCED, nextTransitionAt: null };
    }

    // ---- 3. Not verified ----
    if (v.verificationStatus && v.verificationStatus !== 'verified') {
        return { shouldBeOpen: false, reason: REASON.UNVERIFIED, nextTransitionAt: null };
    }

    // ---- 4 & 5. Manual override, if unexpired ----
    const override = v.manualOverride;
    if (override && override.mode) {
        const until = toDate(override.until);
        const active = !until || until.getTime() > now.getTime();
        if (active) {
            if (override.mode === 'PAUSED') {
                return { shouldBeOpen: false, reason: REASON.VENDOR_PAUSED, nextTransitionAt: until || null };
            }
            if (override.mode === 'FORCE_OPEN') {
                return { shouldBeOpen: true, reason: REASON.VENDOR_FORCED_OPEN, nextTransitionAt: until || null };
            }
        }
        // Expired override falls through to the schedule below.
    }

    const nowParts = zonedParts(now, tz);

    // ---- 6. Holiday ----
    const holidays = Array.isArray(v.holidays) ? v.holidays : [];
    const todayKey = ymdKey(nowParts);
    if (holidays.includes(todayKey)) {
        const tomorrow = addDays(nowParts, 1);
        return {
            shouldBeOpen: false,
            reason: REASON.HOLIDAY,
            nextTransitionAt: zonedTimeToUtc(tomorrow.year, tomorrow.month, tomorrow.day, 0, tz)
        };
    }

    // ---- 7. Auto-schedule disabled: leave isOnline alone ----
    if (v.autoScheduleEnabled !== true) {
        return { shouldBeOpen: v.isOnline === true, reason: REASON.MANUAL_MODE, nextTransitionAt: null };
    }

    const hours = v.businessHours || {};

    // ---- 8. Inside a slot? ----
    // Check yesterday first, for a slot that wrapped past midnight into today.
    const yesterday = addDays(nowParts, -1);
    for (const slot of slotsForDay(hours[DAYS[yesterday.weekday]])) {
        if (slotWraps(slot) && nowParts.minutesOfDay < slot.close) {
            return {
                shouldBeOpen: true,
                reason: REASON.WITHIN_HOURS,
                nextTransitionAt: ceilToTick(
                    zonedTimeToUtc(nowParts.year, nowParts.month, nowParts.day, slot.close, tz)
                )
            };
        }
    }

    for (const slot of slotsForDay(hours[DAYS[nowParts.weekday]])) {
        const inSlot = slotWraps(slot)
            ? nowParts.minutesOfDay >= slot.open
            : nowParts.minutesOfDay >= slot.open && nowParts.minutesOfDay < slot.close;

        if (inSlot) {
            const closeDay = slotWraps(slot) ? addDays(nowParts, 1) : nowParts;
            return {
                shouldBeOpen: true,
                reason: REASON.WITHIN_HOURS,
                nextTransitionAt: ceilToTick(
                    zonedTimeToUtc(closeDay.year, closeDay.month, closeDay.day, slot.close, tz)
                )
            };
        }
    }

    // ---- 9. Closed. Find the next opening. ----
    return {
        shouldBeOpen: false,
        reason: REASON.OUTSIDE_HOURS,
        nextTransitionAt: findNextOpening(hours, holidays, nowParts, tz)
    };
}

/**
 * Scans forward up to 8 days for the next slot opening. 8 rather than 7 so a
 * vendor open exactly once a week still resolves on the wrap-around.
 * Returns null if the vendor has no open slots at all (never auto-opens).
 */
function findNextOpening(hours, holidays, nowParts, tz) {
    for (let offset = 0; offset <= 8; offset++) {
        const day = offset === 0 ? nowParts : addDays(nowParts, offset);
        if (holidays.includes(ymdKey(day))) continue;

        const slots = slotsForDay(hours[DAYS[day.weekday]])
            .slice()
            .sort((a, b) => a.open - b.open);

        for (const slot of slots) {
            if (offset === 0 && slot.open <= nowParts.minutesOfDay) continue;
            return floorToTick(zonedTimeToUtc(day.year, day.month, day.day, slot.open, tz));
        }
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Tick alignment                                                      */
/* ------------------------------------------------------------------ */
/*
 * The cron fires every TICK_MINUTES. If we scheduled a transition at 11:03 it
 * would not fire until 11:10 — the shop opens 7 minutes late and looks broken.
 * So: openings are floored (open slightly early, harmless) and closings are
 * ceiled (close slightly late, also harmless). Never the reverse.
 */

function floorToTick(date) {
    if (!date) return null;
    const ms = TICK_MINUTES * 60000;
    return new Date(Math.floor(date.getTime() / ms) * ms);
}

function ceilToTick(date) {
    if (!date) return null;
    const ms = TICK_MINUTES * 60000;
    return new Date(Math.ceil(date.getTime() / ms) * ms);
}

/** Accepts a Firestore Timestamp, a JS Date, millis, or an ISO string. */
function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
    return null;
}

/* ------------------------------------------------------------------ */
/* Validation (used by the callable and the admin API)                 */
/* ------------------------------------------------------------------ */

const MAX_SLOTS_PER_DAY = 3;
const MIN_SLOT_MINUTES = 30;

/**
 * Validates a businessHours map. Returns { valid, errors: string[] }.
 * Rejecting bad input here keeps garbage out of the scheduler, where it would
 * silently manifest as a shop that never opens.
 */
function validateBusinessHours(hours) {
    const errors = [];
    if (!hours || typeof hours !== 'object') {
        return { valid: false, errors: ['businessHours must be an object'] };
    }

    for (const day of DAYS) {
        const cfg = hours[day];
        if (!cfg) continue;
        if (cfg.isOpen === false) continue;

        const raw = Array.isArray(cfg.slots) ? cfg.slots : [];
        if (raw.length === 0) {
            if (!cfg.openTime || !cfg.closeTime) errors.push(`${day}: open but has no slots`);
            continue;
        }
        if (raw.length > MAX_SLOTS_PER_DAY) {
            errors.push(`${day}: ${raw.length} slots, maximum is ${MAX_SLOTS_PER_DAY}`);
        }

        const parsed = [];
        for (const s of raw) {
            const open = parseHHmm(s.open);
            const close = parseHHmm(s.close);

            // Report BOTH fields before bailing — a vendor fixing one typo only to
            // be told about the next one is a bad editing experience.
            if (open === null) errors.push(`${day}: invalid open time "${s.open}" (expected HH:mm)`);
            if (close === null) errors.push(`${day}: invalid close time "${s.close}" (expected HH:mm)`);
            if (open === null || close === null) continue;

            const duration = close > open ? close - open : (1440 - open) + close;
            if (duration < MIN_SLOT_MINUTES) {
                errors.push(`${day}: slot ${s.open}-${s.close} is ${duration}min, minimum is ${MIN_SLOT_MINUTES}min`);
            }
            parsed.push({ open, close, wraps: close <= open });
        }

        // Overlap check. Wrapping slots are exempt — only one is permitted per day
        // and by definition it runs to the end of the day.
        const sameDay = parsed.filter(p => !p.wraps).sort((a, b) => a.open - b.open);
        for (let i = 1; i < sameDay.length; i++) {
            if (sameDay[i].open < sameDay[i - 1].close) {
                errors.push(
                    `${day}: slots overlap (${minutesToHHmm(sameDay[i - 1].open)}-${minutesToHHmm(sameDay[i - 1].close)} ` +
                    `and ${minutesToHHmm(sameDay[i].open)}-${minutesToHHmm(sameDay[i].close)})`
                );
            }
        }
        if (parsed.filter(p => p.wraps).length > 1) {
            errors.push(`${day}: only one past-midnight slot is allowed per day`);
        }
    }

    return { valid: errors.length === 0, errors };
}

/** True if `tz` is a timezone this runtime's ICU recognises. */
function isValidTimezone(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Mirrors slots[] back onto the legacy openTime/closeTime fields.
 *
 * THIS IS THE COMPATIBILITY SHIM THAT KEEPS VENDOR APP v2.5 WORKING.
 * v2.5's BusinessHours data class (shared/Vendor.kt L77) only knows openTime and
 * closeTime. Drop these and its ProfileScreen dialog silently shows 09:00-21:00
 * defaults for every vendor. Keep writing them until v2.5 is fully retired.
 */
function withLegacyMirror(hours) {
    const out = {};
    for (const day of DAYS) {
        const cfg = hours[day];
        if (!cfg) continue;

        const slots = Array.isArray(cfg.slots) ? cfg.slots : [];
        if (slots.length === 0) {
            out[day] = { isOpen: cfg.isOpen === true, slots: [], openTime: cfg.openTime || '09:00', closeTime: cfg.closeTime || '21:00' };
            continue;
        }
        const sorted = slots.slice().sort((a, b) => (parseHHmm(a.open) || 0) - (parseHHmm(b.open) || 0));
        out[day] = {
            isOpen: cfg.isOpen === true,
            slots: sorted,
            openTime: sorted[0].open,                     // legacy: first opening
            closeTime: sorted[sorted.length - 1].close    // legacy: last closing
        };
    }
    return out;
}

module.exports = {
    evaluateSchedule,
    validateBusinessHours,
    isValidTimezone,
    withLegacyMirror,
    slotsForDay,
    parseHHmm,
    minutesToHHmm,
    zonedParts,
    zonedTimeToUtc,
    floorToTick,
    ceilToTick,
    toDate,
    findNextOpening,
    DAYS,
    REASON,
    TICK_MINUTES,
    DEFAULT_TZ,
    MAX_SLOTS_PER_DAY
};
