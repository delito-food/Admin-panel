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

/**
 * Schedule inputs. A write that touches none of these cannot change the
 * evaluation, which is what makes the onWrite trigger safe against its own
 * output. `isOnline` is deliberately ABSENT — see decideVendorWrite().
 */
const WATCHED_FIELDS = [
    'businessHours', 'timezone', 'holidays', 'autoScheduleEnabled',
    'manualOverride', 'isSuspended', 'adminForceOffline', 'verificationStatus'
];

/**
 * Verification values that mean "this shop is allowed to trade".
 *
 * The scheduler originally tested `verificationStatus !== 'verified'` — but
 * nothing on this platform has ever written that string. The admin approval flow
 * writes 'approved' (admin-dashboard api/verification/vendors/route.ts) and the
 * vendor app gates its own UI on `verificationStatus == "approved"`
 * (HomeScreen.kt:572). 'verified' appeared only inside this engine.
 *
 * The consequence was severe and silent: EVERY vendor, including fully approved
 * ones actively taking orders, evaluated as UNVERIFIED. Enabling auto-schedule on
 * a healthy shop would have set it offline with nextTransitionAt: null — which
 * drops it out of the tick query, so it would never have come back on its own.
 *
 * Both spellings are accepted, so this cannot break again from either direction.
 */
const VERIFIED_STATUSES = ['approved', 'verified'];

/**
 * True if this vendor's verification does not block trading.
 * An absent or empty status is NOT treated as a block — same as before, so
 * documents that predate the verification flow keep working.
 */
function isVerifiedStatus(status) {
    if (!status) return true;
    return VERIFIED_STATUSES.includes(String(status).trim().toLowerCase());
}

/** Ceiling on a force-open produced by a bare app toggle. Errs toward closed. */
const FORCE_OPEN_MAX_MINUTES = 120;

/** Used when a toggle happens on a vendor with no resolvable next transition. */
const OVERRIDE_FALLBACK_MINUTES = 120;

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
 * Lowercases day keys before any lookup.
 *
 * WHY THIS EXISTS — vendor app v2.5 (versionCode 8, live on Play Store) builds
 * its businessHours map from listOf("Monday", "Tuesday", ...). Everything that
 * READS the map — this engine, the customer app, the admin console — looks up
 * lowercase. Every lookup missed, so the engine saw a vendor with no open slots
 * on any day and parked it on nextTransitionAt: null, which drops it out of the
 * tick query permanently. That is why the scheduler had never opened a shop.
 *
 * The repair is deliberately on the READ side. Rewriting the stored keys to
 * lowercase would work for the server and break v2.5's own hours dialog, which
 * reads them capitalised — every merchant's dialog would silently revert to
 * 09:00-21:00 defaults. So the stored document keeps whatever case it has, and
 * every consumer normalises on the way in.
 *
 * Lowercase wins on collision: it is what the server and the admin console
 * write, and therefore the more recently authoritative of the two.
 */
function normaliseHourKeys(hours) {
    if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return {};

    const out = {};
    for (const day of DAYS) {
        if (Object.prototype.hasOwnProperty.call(hours, day)) out[day] = hours[day];
    }
    for (const [key, value] of Object.entries(hours)) {
        const lower = String(key).trim().toLowerCase();
        if (!DAYS.includes(lower)) continue;
        if (Object.prototype.hasOwnProperty.call(out, lower)) continue;
        out[lower] = value;
    }
    return out;
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
    if (!isVerifiedStatus(v.verificationStatus)) {
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

    const hours = normaliseHourKeys(v.businessHours);

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
    // Without this, a capitalised map validates as { valid: true } because the
    // loop below finds nothing to check — garbage passes on its way to being
    // silently discarded by withLegacyMirror.
    hours = normaliseHourKeys(hours);

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
    // Given a capitalised map this used to return {} — and that empty object
    // replaced the vendor's stored hours. Normalise first.
    hours = normaliseHourKeys(hours);

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

    // KEY-CASE MIRROR — the same compatibility contract as openTime/closeTime
    // above, one level up. v2.5's BusinessHoursDialog reads hours["Monday"];
    // this engine, the customer app and the admin console read hours["monday"].
    // Emitting both keeps a vendor whose hours were edited server-side rendering
    // correctly in the app that is actually installed on their phone.
    //
    // Both names point at the SAME object, so the two can never drift apart.
    // Delete this loop, and the one in normaliseHourKeys, once v2.5 is retired.
    for (const day of DAYS) {
        if (out[day]) out[day.charAt(0).toUpperCase() + day.slice(1)] = out[day];
    }

    return out;
}

/* ------------------------------------------------------------------ */
/* onWrite decision — pure, so recursion can be unit-tested            */
/* ------------------------------------------------------------------ */

/**
 * Decides what (if anything) the vendors/{id} onWrite trigger should write back.
 *
 * Pure by design: the trigger writes to the very document that fires it, so the
 * termination argument has to be testable without Firestore. Feed this function's
 * own output back in as `after` and it must return null. See the recursion test.
 *
 * Timestamps come back as plain JS Dates; the caller converts them.
 *
 * TWO JOBS, in order:
 *
 *  A. MANUAL TOGGLE ADAPTER. Vendor app v2.5's Open/Closed switch writes
 *     `isOnline` straight to Firestore. For an auto-scheduled vendor the next
 *     tick would simply revert it, which reads to the merchant as "the app
 *     closed my shop by itself". Rather than requiring a new app build, a bare
 *     isOnline flip is translated into the manualOverride the vendor meant:
 *     off -> PAUSED until they would next open, on -> FORCE_OPEN, capped.
 *
 *     "Bare" is the crux: the adapter only runs when NO schedule input changed.
 *     An admin saving hours through the console also moves isOnline, and that
 *     must reconcile normally, not be mistaken for a merchant tapping a switch.
 *
 *  B. RECONCILE. A schedule input changed, so recompute isOnline / reason /
 *     nextTransitionAt. This is the original trigger behaviour, unchanged.
 *
 * @param {object|null} before  vendors/{id} before the write
 * @param {object|null} after   vendors/{id} after the write
 * @param {Date} now
 * @returns {{kind:'adapter'|'revert'|'reconcile', update:object}|null}
 * @throws whatever evaluateSchedule throws on a malformed document
 */
function decideVendorWrite(before, after, now) {
    if (!after) return null;
    const b = before || {};

    const scheduleInputChanged = WATCHED_FIELDS.some(
        k => JSON.stringify(b[k]) !== JSON.stringify(after[k])
    );

    /* ---- A. Manual toggle adapter ---- */
    if (!scheduleInputChanged) {
        const autoOn      = after.autoScheduleEnabled === true;
        const onlineDelta = (b.isOnline === true) !== (after.isOnline === true);
        const fromSelf    = after.statusChangedBy === 'scheduler' ||
                            after.statusChangedBy === 'adapter';

        // Nothing relevant moved. This is the loop guard: every write this
        // function produces lands here on its second pass and stops.
        if (!autoOn || !onlineDelta || fromSelf) return null;

        const wantOpen = after.isOnline === true;

        // A blocked vendor must never end up open, whoever flipped the switch.
        const blockedReason = blockingReason(after);
        if (blockedReason) {
            if (!wantOpen) return null;   // already where it should be
            return {
                kind: 'revert',
                update: {
                    isOnline: false,
                    scheduleReason: blockedReason,
                    statusChangedBy: 'adapter',
                    statusChangedAt: now
                }
            };
        }

        // Where would the schedule alone take this vendor next?
        const base = evaluateSchedule({ ...after, manualOverride: null }, now);
        let until = base.nextTransitionAt;

        if (!until || until.getTime() <= now.getTime()) {
            until = new Date(now.getTime() + OVERRIDE_FALLBACK_MINUTES * 60000);
        }
        if (wantOpen) {
            // Opening outside your hours should not silently run all night.
            const cap = new Date(now.getTime() + FORCE_OPEN_MAX_MINUTES * 60000);
            if (until.getTime() > cap.getTime()) until = cap;
        }

        return {
            kind: 'adapter',
            update: {
                manualOverride: {
                    mode: wantOpen ? 'FORCE_OPEN' : 'PAUSED',
                    until,
                    reason: 'toggled in vendor app',
                    setAt: now,
                    setBy: 'vendor'
                },
                isOnline: wantOpen,
                scheduleReason: wantOpen ? REASON.VENDOR_FORCED_OPEN : REASON.VENDOR_PAUSED,
                nextTransitionAt: until,
                statusChangedBy: 'adapter',
                statusChangedAt: now
            }
        };
    }

    /* ---- B. Reconcile ---- */
    const { shouldBeOpen, reason, nextTransitionAt } = evaluateSchedule(after, now);
    const update = { nextTransitionAt: nextTransitionAt || null };

    if (reason !== REASON.MANUAL_MODE) {
        // Never override an admin block.
        if (shouldBeOpen && (after.isSuspended === true || after.adminForceOffline === true)) {
            return null;
        }
        if ((after.isOnline === true) !== shouldBeOpen) {
            update.isOnline = shouldBeOpen;
            // MUST be stamped. Without it, this write looks like a bare isOnline
            // flip on the next pass and the adapter above converts a perfectly
            // ordinary scheduled opening into a FORCE_OPEN override — which then
            // suppresses the vendor's real hours until it expires.
            update.statusChangedBy = 'scheduler';
            update.statusChangedAt = now;
        }
        if (after.scheduleReason !== reason) update.scheduleReason = reason;
    }

    const currentPointer = toDate(after.nextTransitionAt);
    const pointerSame = currentPointer === null
        ? nextTransitionAt == null
        : nextTransitionAt != null && currentPointer.getTime() === nextTransitionAt.getTime();

    // Only the pointer in hand, and it is already right.
    if (Object.keys(update).length === 1 && pointerSame) return null;

    return { kind: 'reconcile', update };
}

/** The reason a vendor cannot be open at all, or null if nothing blocks them. */
function blockingReason(v) {
    if (v.isSuspended === true) return REASON.SUSPENDED;
    if (v.adminForceOffline === true) return REASON.ADMIN_FORCED;
    if (!isVerifiedStatus(v.verificationStatus)) return REASON.UNVERIFIED;
    return null;
}

module.exports = {
    evaluateSchedule,
    normaliseHourKeys,
    decideVendorWrite,
    isVerifiedStatus,
    VERIFIED_STATUSES,
    blockingReason,
    WATCHED_FIELDS,
    FORCE_OPEN_MAX_MINUTES,
    OVERRIDE_FALLBACK_MINUTES,
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
