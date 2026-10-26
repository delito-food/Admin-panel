/**
 * riderSlotsCore.js — rider slot booking, pure logic.
 *
 * No Firestore, no admin SDK, no I/O, so every rule here is unit-tested
 * (test/riderSlots.test.js) and the admin dashboard can run the exact same code.
 *
 * KEEP IN SYNC: admin-dashboard/src/lib/riderSlotsCore.js is a byte-for-byte copy.
 *     cp functions/riderSlotsCore.js admin-dashboard/src/lib/riderSlotsCore.js
 *
 * TIME
 * ----
 * Every wall-clock time (template "11:00", booking opens "06:00", slot dates) is
 * India time. Functions run in UTC, so IST is applied explicitly. India has no
 * daylight saving, so a fixed +05:30 offset is exact.
 *
 * A slot whose end is <= its start runs past midnight and belongs to the date it
 * STARTS on (23:00–02:00 on the 26th ends at 02:00 on the 27th) — the same rule as
 * scheduleEngine.slotWraps for vendor hours.
 */

'use strict';

const IST_OFFSET_MS = 330 * 60 * 1000;
const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;

/** Booking statuses. BOOKED/ACTIVE are "live"; everything else is final. */
const STATUS = Object.freeze({
  BOOKED: 'BOOKED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCELLED: 'CANCELLED',
  LATE_CANCEL: 'LATE_CANCEL',
  ADMIN_CANCELLED: 'ADMIN_CANCELLED',
  NOT_TRACKED: 'NOT_TRACKED',
});
const LIVE_STATUSES = Object.freeze([STATUS.BOOKED, STATUS.ACTIVE]);

const SLOT_STATUS = Object.freeze({ OPEN: 'OPEN', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED' });

const MODES = Object.freeze(['off', 'soft', 'hard']);

/** Two booked slots closer than this are treated as one continuous shift. */
const CHAIN_GAP_MS = 10 * MIN_MS;

/**
 * A slot that ended longer ago than this is no longer "being tracked": the tick was
 * not running (mode off, outage). It is closed without a strike, because the rider
 * could not have been warned and nothing measured whether they turned up.
 */
const TRACKING_WINDOW_MS = 30 * MIN_MS;

const DEFAULT_CONFIG = Object.freeze({
  mode: 'off',
  pilotPincodes: [],
  bookingOpensAt: '06:00',
  allowTomorrow: false,
  cancelCutoffMin: 60,
  checkInGraceMin: 15,
  maxPerDay: 3,
  strikeLimit: 3,
  strikeWindowDays: 7,
  blockDays: 2,
  autoOfflineMin: 10,
  hardFallback: true,
  openToAllAfterAttempts: 2,
  minRemainingMin: 60,
  reminderMin: 15,
});

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function intIn(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < lo || n > hi) return def;
  return n;
}

/** "6:00" / "06:00" / "23:59" → minutes after midnight. Anything else → null. */
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fmtHHMM(minutes) {
  const m = ((Number(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "11:00" → "11:00 AM", "15:30" → "3:30 PM" (for push text). */
function fmt12(hhmmOrMinutes) {
  const m = typeof hhmmOrMinutes === 'number' ? hhmmOrMinutes : parseHHMM(hhmmOrMinutes);
  if (m == null) return '';
  const h24 = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** IST calendar date of an instant: "2026-10-26". */
function istDate(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes after IST midnight for an instant. */
function istMinuteOfDay(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function isDateString(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** UTC instant of IST midnight that starts `dateStr`. */
function istMidnightMs(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

function addDays(dateStr, n) {
  return istDate(istMidnightMs(dateStr) + n * DAY_MS);
}

function compactDate(dateStr) {
  return String(dateStr).replace(/-/g, '');
}

/** ISO weekday of an IST date: Monday = 1 … Sunday = 7. */
function isoWeekday(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

/** Absolute start/end of a slot on an IST date. null for bad input. */
function slotWindow(dateStr, startHHMM, endHHMM) {
  if (!isDateString(dateStr)) return null;
  const s = parseHHMM(startHHMM);
  const e = parseHHMM(endHHMM);
  if (s == null || e == null || s === e) return null;
  const base = istMidnightMs(dateStr);
  const startMs = base + s * MIN_MS;
  const endMs = base + (e > s ? e : e + 1440) * MIN_MS;
  return { startMs, endMs };
}

/** Firestore-safe id fragment. */
function idPart(v) {
  return String(v == null ? '' : v).trim().replace(/[^A-Za-z0-9-]/g, '-');
}

function slotIdFor(dateStr, pincode, templateId) {
  return `${compactDate(dateStr)}_${idPart(pincode)}_${idPart(templateId)}`;
}

function bookingIdFor(slotId, riderId) {
  return `${slotId}_${idPart(riderId)}`;
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000 + Math.round((v._nanoseconds || 0) / 1e6);
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
  return null;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/**
 * Reads the slot fields of config/appFeatures. Every value is bound-checked and
 * falls back to its default, and the mode falls back to "off" — an unreadable or
 * malformed config can never switch enforcement on.
 */
function normalizeConfig(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.includes(d.riderSlotMode) ? d.riderSlotMode : 'off';
  const pilots = Array.isArray(d.riderSlotPilotPincodes)
    ? [...new Set(d.riderSlotPilotPincodes.map((p) => String(p == null ? '' : p).trim()).filter(Boolean))].slice(0, 200)
    : [];
  const opens = parseHHMM(d.slotBookingOpensAt) == null ? DEFAULT_CONFIG.bookingOpensAt : fmtHHMM(parseHHMM(d.slotBookingOpensAt));
  return {
    mode,
    pilotPincodes: pilots,
    bookingOpensAt: opens,
    allowTomorrow: d.slotAllowTomorrow === true,
    cancelCutoffMin: intIn(d.slotCancelCutoffMin, 0, 720, DEFAULT_CONFIG.cancelCutoffMin),
    checkInGraceMin: intIn(d.slotCheckInGraceMin, 5, 120, DEFAULT_CONFIG.checkInGraceMin),
    maxPerDay: intIn(d.slotMaxPerDay, 1, 6, DEFAULT_CONFIG.maxPerDay),
    strikeLimit: intIn(d.slotStrikeLimit, 1, 20, DEFAULT_CONFIG.strikeLimit),
    strikeWindowDays: intIn(d.slotStrikeWindowDays, 1, 60, DEFAULT_CONFIG.strikeWindowDays),
    blockDays: intIn(d.slotBlockDays, 0, 30, DEFAULT_CONFIG.blockDays),
    autoOfflineMin: intIn(d.slotAutoOfflineMin, 0, 120, DEFAULT_CONFIG.autoOfflineMin),
    hardFallback: d.slotHardFallback !== false,
    openToAllAfterAttempts: intIn(d.slotOpenToAllAfterAttempts, 0, 20, DEFAULT_CONFIG.openToAllAfterAttempts),
    minRemainingMin: intIn(d.slotMinRemainingMin, 0, 600, DEFAULT_CONFIG.minRemainingMin),
    reminderMin: intIn(d.slotReminderMin, 5, 120, DEFAULT_CONFIG.reminderMin),
  };
}

/** The mode that applies in one pincode ("off" outside the pilot list). */
function modeFor(cfg, pincode) {
  if (!cfg || cfg.mode === 'off') return 'off';
  const p = String(pincode == null ? '' : pincode).trim();
  if (cfg.pilotPincodes && cfg.pilotPincodes.length > 0 && !cfg.pilotPincodes.includes(p)) return 'off';
  return cfg.mode;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

function cleanStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * Validates an admin-entered template. Returns { ok, value } or { ok:false, error }.
 * Never trusts the client: every field is rebuilt from scratch.
 */
function validateTemplate(input) {
  const t = input && typeof input === 'object' ? input : {};
  const pincode = cleanStr(t.pincode, 12);
  if (!/^[0-9A-Za-z-]{3,12}$/.test(pincode)) return { ok: false, error: 'Enter a valid pincode' };
  const s = parseHHMM(t.start);
  const e = parseHHMM(t.end);
  if (s == null || e == null) return { ok: false, error: 'Start and end must be times like 11:00' };
  if (s === e) return { ok: false, error: 'Start and end cannot be the same' };
  const length = e > s ? e - s : e + 1440 - s;
  if (length < 30) return { ok: false, error: 'A slot must be at least 30 minutes' };
  if (length > 12 * 60) return { ok: false, error: 'A slot can be at most 12 hours' };
  const capacity = Number(t.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return { ok: false, error: 'Riders per slot must be 1–500' };
  let days = Array.isArray(t.daysOfWeek)
    ? [...new Set(t.daysOfWeek.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6, 7];
  if (days.length === 0) return { ok: false, error: 'Pick at least one day' };
  return {
    ok: true,
    value: {
      pincode,
      label: cleanStr(t.label, 30),
      labelHi: cleanStr(t.labelHi, 30),
      start: fmtHHMM(s),
      end: fmtHHMM(e),
      capacity,
      daysOfWeek: days,
      isPeak: t.isPeak === true,
      active: t.active !== false,
    },
  };
}

function templateRuns(template, dateStr) {
  if (!template || template.active === false) return false;
  const days = Array.isArray(template.daysOfWeek) && template.daysOfWeek.length ? template.daysOfWeek : [1, 2, 3, 4, 5, 6, 7];
  return days.includes(isoWeekday(dateStr));
}

/**
 * Do two templates of the same pincode overlap on a day they both run?
 * Used for a warning in the admin panel (overlapping slots are allowed — a rider
 * just cannot book both).
 */
function templatesOverlap(a, b) {
  if (!a || !b || a.pincode !== b.pincode) return false;
  const da = a.daysOfWeek && a.daysOfWeek.length ? a.daysOfWeek : [1, 2, 3, 4, 5, 6, 7];
  const db = b.daysOfWeek && b.daysOfWeek.length ? b.daysOfWeek : [1, 2, 3, 4, 5, 6, 7];
  if (!da.some((d) => db.includes(d))) return false;
  const span = (t) => {
    const s = parseHHMM(t.start);
    const e = parseHHMM(t.end);
    return [s, e > s ? e : e + 1440];
  };
  const [as, ae] = span(a);
  const [bs, be] = span(b);
  return [-1440, 0, 1440].some((shift) => as < be + shift && bs + shift < ae);
}

/** The slot document generated from a template for one date (no timestamps). */
function slotFromTemplate(templateId, template, dateStr) {
  const w = slotWindow(dateStr, template.start, template.end);
  if (!w) return null;
  return {
    slotId: slotIdFor(dateStr, template.pincode, templateId),
    date: dateStr,
    pincode: template.pincode,
    templateId,
    label: template.label || '',
    labelHi: template.labelHi || '',
    start: template.start,
    end: template.end,
    isPeak: template.isPeak === true,
    capacity: template.capacity,
    startMs: w.startMs,
    endMs: w.endMs,
  };
}

/* ------------------------------------------------------------------ */
/* Booking rules                                                       */
/* ------------------------------------------------------------------ */

/** When booking opens for a slot that starts on `slotDate`. */
function bookingOpensMs(slotDate, cfg) {
  const opens = parseHHMM(cfg.bookingOpensAt);
  const day = cfg.allowTomorrow ? addDays(slotDate, -1) : slotDate;
  return istMidnightMs(day) + (opens == null ? 360 : opens) * MIN_MS;
}

function isLive(b) {
  return b && LIVE_STATUSES.includes(b.status);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Can this rider book this slot right now?
 *
 * @param p.nowMs
 * @param p.cfg            normalizeConfig() output
 * @param p.rider          deliveryPersons data (or null when missing)
 * @param p.slot           { date, pincode, status, capacity, bookedCount, startMs, endMs }
 * @param p.existing       this rider's booking doc for this slot, if any
 * @param p.riderBookings  the rider's other bookings [{ id, status, date, startMs, endMs }]
 * @param p.state          riderSlotState data, if any { blockedUntilMs }
 * @returns {{ok:true}|{ok:false, code:string}}
 */
function canBook(p) {
  const { nowMs, cfg, rider, slot, existing, state } = p;
  const no = (code) => ({ ok: false, code });
  if (!rider) return no('not-rider');
  if (rider.isSuspended === true) return no('suspended');
  if (rider.isVerified !== true) return no('unverified');
  if (rider.hasBankDetails !== true) return no('no-bank');
  if (!slot) return no('slot-closed');
  if (modeFor(cfg, slot.pincode) === 'off') return no('mode-off');
  if (String(rider.pincode == null ? '' : rider.pincode).trim() !== String(slot.pincode)) return no('pincode-mismatch');
  const blockedUntil = state ? toMs(state.blockedUntil) : null;
  if (blockedUntil && blockedUntil > nowMs) return no('blocked');
  if (slot.status !== SLOT_STATUS.OPEN) return no('slot-closed');
  if (!(slot.endMs > nowMs)) return no('slot-ended');
  if (slot.startMs <= nowMs && slot.endMs - nowMs < cfg.minRemainingMin * MIN_MS) return no('too-late');
  if (nowMs < bookingOpensMs(slot.date, cfg)) return no('not-open-yet');
  if (existing && isLive(existing)) return no('already-booked');
  if (!(Number(slot.bookedCount) < Number(slot.capacity))) return no('full');

  const others = (p.riderBookings || []).filter((b) => isLive(b) && b.id !== (existing && existing.id));
  if (others.filter((b) => b.date === slot.date).length >= cfg.maxPerDay) return no('max-per-day');
  if (others.some((b) => overlaps(b.startMs, b.endMs, slot.startMs, slot.endMs))) return no('overlap');
  return { ok: true };
}

/**
 * Cancelling a booking: free before the cutoff, a strike after it, impossible once
 * the slot has started (by then it is attendance, not a booking).
 */
function cancelOutcome({ nowMs, cfg, booking }) {
  if (!booking || booking.status !== STATUS.BOOKED) return { ok: false, code: 'not-booked' };
  if (booking.startMs <= nowMs) return { ok: false, code: 'started' };
  const late = booking.startMs - nowMs < cfg.cancelCutoffMin * MIN_MS;
  return { ok: true, status: late ? STATUS.LATE_CANCEL : STATUS.CANCELLED, strike: late };
}

/* ------------------------------------------------------------------ */
/* Strikes                                                             */
/* ------------------------------------------------------------------ */

function pruneStrikes(strikesMs, nowMs, cfg) {
  const since = nowMs - cfg.strikeWindowDays * DAY_MS;
  return (Array.isArray(strikesMs) ? strikesMs : []).map(toMs).filter((t) => t != null && t > since && t <= nowMs + MIN_MS);
}

/**
 * Adds one strike. Reaching the limit blocks booking for `blockDays` and clears the
 * strikes, so the next strike starts a fresh count instead of re-blocking at once.
 */
function applyStrike(state, nowMs, cfg) {
  const strikes = pruneStrikes(state && state.strikes, nowMs, cfg);
  strikes.push(nowMs);
  const currentBlock = state ? toMs(state.blockedUntil) : null;
  if (strikes.length >= cfg.strikeLimit && cfg.blockDays > 0) {
    const until = nowMs + cfg.blockDays * DAY_MS;
    return { strikes: [], blockedUntilMs: Math.max(until, currentBlock || 0), newlyBlocked: true };
  }
  return { strikes, blockedUntilMs: currentBlock && currentBlock > nowMs ? currentBlock : null, newlyBlocked: false };
}

/* ------------------------------------------------------------------ */
/* The rider's slot window                                             */
/* ------------------------------------------------------------------ */

/**
 * From a rider's live bookings, the current-or-next continuous shift.
 *
 * Stored as riderSlotState.activeFrom / activeUntil. Dispatch, the app and the
 * security rules all ask the same question — "activeFrom <= now < activeUntil" —
 * so a slot counts from its first second even if the 5-minute tick has not run
 * yet, and stops counting at its end even if the tick is late.
 */
function computeWindow(bookings, nowMs) {
  const live = (bookings || [])
    .filter((b) => isLive(b) && b.endMs > nowMs && b.startMs < b.endMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (live.length === 0) return { activeFromMs: null, activeUntilMs: null, slotIds: [], nextStartMs: null };
  let from = live[0].startMs;
  let until = live[0].endMs;
  const ids = [live[0].slotId || live[0].id];
  let i = 1;
  for (; i < live.length; i++) {
    if (live[i].startMs <= until + CHAIN_GAP_MS) {
      until = Math.max(until, live[i].endMs);
      ids.push(live[i].slotId || live[i].id);
    } else break;
  }
  return { activeFromMs: from, activeUntilMs: until, slotIds: ids, nextStartMs: i < live.length ? live[i].startMs : null };
}

/** Is the stored window active at `nowMs`? `earlyMs` lets a rider in a little before. */
function windowActive(state, nowMs, earlyMs = 0, graceMs = 0) {
  if (!state) return false;
  const from = toMs(state.activeFrom);
  const until = toMs(state.activeUntil);
  if (from == null || until == null) return false;
  return from - earlyMs <= nowMs && nowMs < until + graceMs;
}

/* ------------------------------------------------------------------ */
/* Attendance tick                                                     */
/* ------------------------------------------------------------------ */

/**
 * What the 5-minute tick should do with one live booking.
 *
 * @param b      { status, startMs, endMs, bookedAtMs, checkedInAtMs, noShowMarked,
 *                 reminderSent, startNudgeSent, lastSampleMs, onlineMinutes }
 * @param online is the rider online right now
 * @returns {{ update: object|null, strike: boolean, push: string|null }}
 *   update uses plain values; the caller converts *Ms fields to Timestamps.
 */
function tickDecision(b, online, nowMs, cfg) {
  const out = { update: null, strike: false, push: null };
  const set = (k, v) => { out.update = out.update || {}; out.update[k] = v; };
  const graceBase = Math.max(b.startMs, b.bookedAtMs || 0);
  const graceEnd = graceBase + cfg.checkInGraceMin * MIN_MS;

  // 1. Finished.
  if (b.endMs <= nowMs) {
    const tracked = nowMs - b.endMs <= TRACKING_WINDOW_MS;
    if (b.checkedInAtMs) {
      set('status', STATUS.COMPLETED);
    } else if (tracked) {
      set('status', STATUS.NO_SHOW);
      // Normally the strike was added at the grace mark. If the tick never got
      // there (slot shorter than the grace, or booked in the last minutes) add it now.
      if (!b.noShowMarked) { set('noShowMarked', true); out.strike = true; }
    } else {
      set('status', STATUS.NOT_TRACKED);
    }
    set('finalizedAtMs', nowMs);
    return out;
  }

  // 2. Running.
  if (b.startMs <= nowMs) {
    if (online) {
      if (!b.checkedInAtMs) {
        set('checkedInAtMs', nowMs);
        if (b.noShowMarked) set('late', true);
      }
      if (b.status !== STATUS.ACTIVE) set('status', STATUS.ACTIVE);
      const from = Math.max(b.startMs, b.lastSampleMs || b.startMs);
      const add = Math.min(10, Math.max(0, Math.round((nowMs - from) / MIN_MS)));
      // First sample after check-in counts from now; afterwards, time since the last sample.
      const minutes = b.lastSampleMs ? add : 0;
      if (minutes > 0) set('onlineMinutes', (Number(b.onlineMinutes) || 0) + minutes);
      set('lastSampleMs', nowMs);
      return out;
    }
    // Offline. Any minutes since the last sample are not counted.
    if (b.lastSampleMs) set('lastSampleMs', null);
    if (!b.checkedInAtMs && !b.noShowMarked && nowMs >= graceEnd) {
      // Only strike while the slot is actually being watched.
      if (nowMs - graceEnd <= TRACKING_WINDOW_MS) {
        set('noShowMarked', true);
        out.strike = true;
        out.push = 'slot_no_show';
      } else {
        set('noShowMarked', true);
      }
      return out;
    }
    if (!b.checkedInAtMs && !b.startNudgeSent && nowMs < graceEnd) {
      set('startNudgeSent', true);
      out.push = 'slot_started';
    }
    return out;
  }

  // 3. Upcoming.
  if (!b.reminderSent && b.startMs - nowMs <= cfg.reminderMin * MIN_MS) {
    set('reminderSent', true);
    // A rider who booked only minutes ago does not need a reminder.
    if (!(b.bookedAtMs && nowMs - b.bookedAtMs < 5 * MIN_MS)) out.push = 'slot_reminder';
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Rider-facing text                                                   */
/* ------------------------------------------------------------------ */

/** Push text in the rider's language. `v` = { start, end, date, until } as "11:00". */
function pushText(kind, lang, v = {}) {
  const hi = lang === 'hi';
  const range = `${fmt12(v.start)} – ${fmt12(v.end)}`;
  switch (kind) {
    case 'slots_open':
      return hi
        ? { title: 'स्लॉट बुकिंग खुल गई', message: 'ऐप खोलें और अपना स्लॉट बुक करें।' }
        : { title: 'Slot booking is open', message: 'Open the app and book your slot for today.' };
    case 'slot_reminder':
      return hi
        ? { title: `स्लॉट ${fmt12(v.start)} बजे शुरू होगा`, message: `आपका स्लॉट ${range}। ऑनलाइन हो जाएं।` }
        : { title: `Your slot starts at ${fmt12(v.start)}`, message: `Slot ${range}. Go online to get orders.` };
    case 'slot_started':
      return hi
        ? { title: 'आपका स्लॉट शुरू हो गया', message: `स्लॉट ${range}। अभी ऑनलाइन हों, नहीं तो यह छूट जाएगा।` }
        : { title: 'Your slot has started', message: `Slot ${range}. Go online now or it counts as missed.` };
    case 'slot_no_show':
      return hi
        ? { title: 'स्लॉट छूट गया', message: `आप ${range} स्लॉट में ऑनलाइन नहीं हुए। इसे 1 स्ट्राइक गिना गया।` }
        : { title: 'Slot missed', message: `You didn't go online for your ${range} slot. This counts as 1 strike.` };
    case 'slot_blocked':
      return hi
        ? { title: 'स्लॉट बुकिंग रुकी', message: `बहुत स्लॉट छूटे। ${v.until || ''} तक बुकिंग नहीं होगी।` }
        : { title: 'Slot booking paused', message: `Too many missed slots. You can book again after ${v.until || 'a few days'}.` };
    case 'slot_ended':
      return hi
        ? { title: 'आप ऑफ़लाइन हैं', message: 'स्लॉट खत्म हो गया। ऑर्डर पाने के लिए अगला स्लॉट बुक करें।' }
        : { title: "You're offline", message: 'Your slot has ended. Book a slot to keep getting orders.' };
    case 'slot_cancelled':
      return hi
        ? { title: 'स्लॉट रद्द हुआ', message: `${range} स्लॉट रद्द कर दिया गया है। कोई स्ट्राइक नहीं लगी।` }
        : { title: 'Slot cancelled', message: `Your ${range} slot was cancelled by Delito. No strike.` };
    default:
      return null;
  }
}

module.exports = {
  IST_OFFSET_MS,
  MIN_MS,
  DAY_MS,
  STATUS,
  LIVE_STATUSES,
  SLOT_STATUS,
  MODES,
  CHAIN_GAP_MS,
  TRACKING_WINDOW_MS,
  DEFAULT_CONFIG,
  parseHHMM,
  fmtHHMM,
  fmt12,
  istDate,
  istMinuteOfDay,
  isDateString,
  istMidnightMs,
  addDays,
  compactDate,
  isoWeekday,
  slotWindow,
  slotIdFor,
  bookingIdFor,
  toMs,
  normalizeConfig,
  modeFor,
  validateTemplate,
  templateRuns,
  templatesOverlap,
  slotFromTemplate,
  bookingOpensMs,
  isLive,
  canBook,
  cancelOutcome,
  pruneStrikes,
  applyStrike,
  computeWindow,
  windowActive,
  tickDecision,
  pushText,
};
