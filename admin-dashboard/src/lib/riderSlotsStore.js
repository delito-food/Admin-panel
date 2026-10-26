/**
 * Rider slot booking — Firestore reads and writes, with every dependency passed in.
 *
 * No firebase-functions / firebase-admin import here on purpose: the Cloud
 * Functions (riderSlots.js) and the admin dashboard (its /api/delivery/slots route)
 * run this SAME file, so a booking made from the panel follows exactly the rules a
 * rider's booking does.
 *
 * KEEP IN SYNC: admin-dashboard/src/lib/riderSlotsStore.js is a byte-for-byte copy.
 *     cp functions/riderSlotsStore.js admin-dashboard/src/lib/riderSlotsStore.js
 *     cp functions/riderSlotsCore.js  admin-dashboard/src/lib/riderSlotsCore.js
 *
 * deps = { db, Timestamp, nowMs(), messaging(), log }
 *   db         Admin SDK Firestore (or the test fake)
 *   Timestamp  firebase-admin Timestamp (fromMillis)
 *   messaging  () => Admin SDK Messaging (sendEach); only the tick sends pushes
 */

'use strict';

const core = require('./riderSlotsCore');

const { STATUS, LIVE_STATUSES, SLOT_STATUS, MIN_MS } = core;

const C = Object.freeze({
  TEMPLATES: 'slotTemplates',
  SLOTS: 'riderSlots',
  BOOKINGS: 'slotBookings',
  STATE: 'riderSlotState',
  META: 'riderSlotMeta',
  LOGS: 'slotLogs',
  RIDERS: 'deliveryPersons',
  TASKS: 'deliveryTasks',
});

/** How early a rider may be online / accept for a shift that is about to start. */
const EARLY_MS = 20 * MIN_MS;

const FINAL_FROM_TICK = [STATUS.COMPLETED, STATUS.NO_SHOW, STATUS.NOT_TRACKED];

/* ------------------------------------------------------------------ */
/* Helpers (deps always passed in)                                    */
/* ------------------------------------------------------------------ */

function ts(deps, ms) {
  return ms == null ? null : deps.Timestamp.fromMillis(ms);
}

async function loadConfig(deps) {
  try {
    const snap = await deps.db.collection('config').doc('appFeatures').get();
    return core.normalizeConfig(snap.exists ? snap.data() : {});
  } catch (e) {
    deps.log.error('[slots] config read failed — treating as off', e);
    return core.normalizeConfig({});
  }
}

function slotView(snap) {
  const d = snap.data() || {};
  return {
    ...d,
    id: snap.id,
    startMs: core.toMs(d.startAt),
    endMs: core.toMs(d.endAt),
    capacity: Number(d.capacity) || 0,
    bookedCount: Number(d.bookedCount) || 0,
  };
}

function bookingView(snap) {
  const d = snap.data() || {};
  return {
    ...d,
    id: snap.id,
    ref: snap.ref,
    startMs: core.toMs(d.startAt),
    endMs: core.toMs(d.endAt),
    bookedAtMs: core.toMs(d.bookedAt),
    checkedInAtMs: core.toMs(d.checkedInAt),
    lastSampleMs: core.toMs(d.lastSampleAt),
  };
}

function liveBookingsQuery(deps, riderId) {
  return deps.db.collection(C.BOOKINGS)
    .where('riderId', '==', riderId)
    .where('status', 'in', LIVE_STATUSES);
}

/** riderSlotState fields for a window, as Firestore values. */
function windowFields(deps, w, nowMs) {
  return {
    activeFrom: ts(deps, w.activeFromMs),
    activeUntil: ts(deps, w.activeUntilMs),
    activeSlotIds: w.slotIds,
    nextStartAt: ts(deps, w.nextStartMs),
    updatedAt: ts(deps, nowMs),
  };
}

async function writeLog(deps, entry) {
  try {
    await deps.db.collection(C.LOGS).add({ ...entry, at: ts(deps, deps.nowMs()) });
  } catch (e) {
    deps.log.error('[slots] log write failed', e);
  }
}

/* ------------------------------------------------------------------ */
/* Book / cancel                                                       */
/* ------------------------------------------------------------------ */

const fail = (code) => ({ success: false, code });

async function book(deps, uid, slotId, opts = {}) {
  if (!uid) return fail('not-rider');
  if (typeof slotId !== 'string' || !/^[A-Za-z0-9_-]{5,160}$/.test(slotId)) return fail('slot-closed');
  const cfg = opts.cfg || (await loadConfig(deps));
  if (cfg.mode === 'off' && !opts.byAdmin) return fail('mode-off');

  const { db } = deps;
  const nowMs = deps.nowMs();
  const slotRef = db.collection(C.SLOTS).doc(slotId);
  const bookingId = core.bookingIdFor(slotId, uid);
  const bookingRef = db.collection(C.BOOKINGS).doc(bookingId);
  const riderRef = db.collection(C.RIDERS).doc(uid);
  const stateRef = db.collection(C.STATE).doc(uid);

  const result = await db.runTransaction(async (tx) => {
    // Reads one at a time: a transaction must not race its own first read.
    const slotSnap = await tx.get(slotRef);
    const bookingSnap = await tx.get(bookingRef);
    const riderSnap = await tx.get(riderRef);
    const stateSnap = await tx.get(stateRef);
    const liveSnap = await tx.get(liveBookingsQuery(deps, uid));

    const rider = riderSnap.exists ? riderSnap.data() : null;
    const slot = slotSnap.exists ? slotView(slotSnap) : null;
    const existing = bookingSnap.exists ? bookingView(bookingSnap) : null;
    const state = stateSnap.exists ? stateSnap.data() : null;
    const live = liveSnap.docs.map(bookingView);

    let decision;
    if (opts.byAdmin) {
      // Admin "add rider": skips the booking window, capacity and the rider's own
      // gates (verified, bank, block), but never double-books or overlaps.
      decision = !rider ? fail('not-rider')
        : !slot || slot.status === SLOT_STATUS.CANCELLED ? fail('slot-closed')
        : !(slot.endMs > nowMs) ? fail('slot-ended')
        : existing && core.isLive(existing) ? fail('already-booked')
        : live.some((b) => b.id !== bookingId && b.startMs < slot.endMs && slot.startMs < b.endMs) ? fail('overlap')
        : { ok: true };
      if (decision.ok === undefined) return decision;
    } else {
      decision = core.canBook({ nowMs, cfg, rider, slot, existing, riderBookings: live, state });
      if (!decision.ok) return fail(decision.code);
    }

    const booking = {
      slotId,
      riderId: uid,
      riderName: String((rider && rider.fullName) || ''),
      riderPhone: String((rider && rider.phoneNumber) || ''),
      pincode: slot.pincode,
      date: slot.date,
      label: slot.label || '',
      labelHi: slot.labelHi || '',
      start: slot.start || '',
      end: slot.end || '',
      startAt: ts(deps, slot.startMs),
      endAt: ts(deps, slot.endMs),
      status: STATUS.BOOKED,
      bookedAt: ts(deps, nowMs),
      bookedBy: opts.byAdmin ? `admin:${opts.adminId || 'admin'}` : 'rider',
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      checkedInAt: null,
      late: false,
      onlineMinutes: 0,
      lastSampleAt: null,
      deliveriesInSlot: null,
      noShowMarked: false,
      strikeAdded: false,
      reminderSent: false,
      startNudgeSent: false,
      finalizedAt: null,
    };
    tx.set(bookingRef, booking);
    tx.update(slotRef, { bookedCount: slot.bookedCount + 1, updatedAt: ts(deps, nowMs) });

    const w = core.computeWindow(
      [...live.filter((b) => b.id !== bookingId), { id: bookingId, slotId, status: STATUS.BOOKED, startMs: slot.startMs, endMs: slot.endMs }],
      nowMs
    );
    tx.set(stateRef, { riderId: uid, ...windowFields(deps, w, nowMs) }, { merge: true });
    return { success: true, bookingId, slotId, serverNowMs: nowMs };
  });

  return result;
}

async function cancel(deps, uid, bookingId, opts = {}) {
  if (!uid) return fail('not-rider');
  if (typeof bookingId !== 'string' || !/^[A-Za-z0-9_-]{5,220}$/.test(bookingId)) return fail('not-booked');
  const cfg = opts.cfg || (await loadConfig(deps));
  const { db } = deps;
  const nowMs = deps.nowMs();
  const bookingRef = db.collection(C.BOOKINGS).doc(bookingId);
  const stateRef = db.collection(C.STATE).doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) return fail('not-booked');
    const booking = bookingView(bookingSnap);
    if (booking.riderId !== uid) return fail('not-booked');
    const slotRef = db.collection(C.SLOTS).doc(String(booking.slotId || ''));
    const slotSnap = await tx.get(slotRef);
    const stateSnap = await tx.get(stateRef);
    const liveSnap = await tx.get(liveBookingsQuery(deps, uid));

    let outcome;
    if (opts.byAdmin) {
      outcome = core.isLive(booking) ? { ok: true, status: STATUS.ADMIN_CANCELLED, strike: false } : fail('not-booked');
      if (outcome.ok === undefined) return outcome;
    } else {
      outcome = core.cancelOutcome({ nowMs, cfg, booking });
      if (!outcome.ok) return fail(outcome.code);
    }

    tx.update(bookingRef, {
      status: outcome.status,
      cancelledAt: ts(deps, nowMs),
      cancelledBy: opts.byAdmin ? `admin:${opts.adminId || 'admin'}` : 'rider',
      cancelReason: opts.reason || null,
      strikeAdded: outcome.strike === true,
    });
    if (slotSnap.exists) {
      const n = Number(slotSnap.data().bookedCount) || 0;
      tx.update(slotRef, { bookedCount: Math.max(0, n - 1), updatedAt: ts(deps, nowMs) });
    }

    const live = liveSnap.docs.map(bookingView).filter((b) => b.id !== bookingId);
    const stateUpdate = { riderId: uid, ...windowFields(deps, core.computeWindow(live, nowMs), nowMs) };
    let newlyBlocked = false;
    let blockedUntilMs = null;
    if (outcome.strike) {
      const s = core.applyStrike(stateSnap.exists ? stateSnap.data() : null, nowMs, cfg);
      stateUpdate.strikes = s.strikes.map((m) => ts(deps, m));
      stateUpdate.blockedUntil = ts(deps, s.blockedUntilMs);
      newlyBlocked = s.newlyBlocked;
      blockedUntilMs = s.blockedUntilMs;
    }
    tx.set(stateRef, stateUpdate, { merge: true });
    return { success: true, status: outcome.status, strike: outcome.strike === true, newlyBlocked, blockedUntilMs };
  });

  if (result.success && result.newlyBlocked) {
    await cancelFutureBookings(deps, uid, 'blocked').catch((e) => deps.log.error('[slots] block cleanup failed', e));
    await writeLog(deps, { action: 'blocked', riderId: uid, reason: 'late cancels', blockedUntil: ts(deps, result.blockedUntilMs) });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* State helpers                                                       */
/* ------------------------------------------------------------------ */

/** Rebuilds riderSlotState's window from the rider's live bookings. */
async function recomputeState(deps, riderId, extra = {}) {
  const nowMs = deps.nowMs();
  const stateRef = deps.db.collection(C.STATE).doc(riderId);
  await deps.db.runTransaction(async (tx) => {
    const stateSnap = await tx.get(stateRef);
    const liveSnap = await tx.get(liveBookingsQuery(deps, riderId));
    const w = core.computeWindow(liveSnap.docs.map(bookingView), nowMs);
    if (!stateSnap.exists && w.activeFromMs == null && Object.keys(extra).length === 0) return;
    tx.set(stateRef, { riderId, ...windowFields(deps, w, nowMs), ...extra }, { merge: true });
  });
}

async function addStrike(deps, riderId, cfg) {
  const nowMs = deps.nowMs();
  const stateRef = deps.db.collection(C.STATE).doc(riderId);
  return deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef);
    const s = core.applyStrike(snap.exists ? snap.data() : null, nowMs, cfg);
    tx.set(stateRef, {
      riderId,
      strikes: s.strikes.map((m) => ts(deps, m)),
      blockedUntil: ts(deps, s.blockedUntilMs),
      updatedAt: ts(deps, nowMs),
    }, { merge: true });
    return s;
  });
}

/**
 * Cancels a rider's not-yet-started bookings (block, suspension). No strike.
 * @returns number cancelled
 */
async function cancelFutureBookings(deps, riderId, reason) {
  const nowMs = deps.nowMs();
  const snap = await liveBookingsQuery(deps, riderId).get();
  let n = 0;
  for (const doc of snap.docs) {
    const b = bookingView(doc);
    if (b.status !== STATUS.BOOKED || !(b.startMs > nowMs)) continue;
    const done = await deps.db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.data().status !== STATUS.BOOKED) return false;
      const slotRef = deps.db.collection(C.SLOTS).doc(String(b.slotId || ''));
      const slotSnap = await tx.get(slotRef);
      tx.update(doc.ref, {
        status: STATUS.ADMIN_CANCELLED,
        cancelledAt: ts(deps, nowMs),
        cancelledBy: 'system',
        cancelReason: reason,
      });
      if (slotSnap.exists) {
        tx.update(slotRef, { bookedCount: Math.max(0, (Number(slotSnap.data().bookedCount) || 0) - 1), updatedAt: ts(deps, nowMs) });
      }
      return true;
    });
    if (done) n++;
  }
  await recomputeState(deps, riderId);
  return n;
}

/* ------------------------------------------------------------------ */
/* Slot generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Creates the riderSlots documents for `dates` from active templates.
 * CREATE-ONLY: an existing slot (with bookings, or a per-day capacity override) is
 * never touched, so running this any number of times is safe.
 */
async function generateSlots(deps, dates, onlyTemplateId = null) {
  const nowMs = deps.nowMs();
  const snap = await deps.db.collection(C.TEMPLATES).get();
  let created = 0;
  for (const doc of snap.docs) {
    if (onlyTemplateId && doc.id !== onlyTemplateId) continue;
    const t = doc.data() || {};
    const valid = core.validateTemplate(t);
    if (!valid.ok || !valid.value.active) continue;
    for (const date of dates) {
      if (!core.templateRuns(valid.value, date)) continue;
      const s = core.slotFromTemplate(doc.id, valid.value, date);
      if (!s || s.endMs <= nowMs) continue;
      const ref = deps.db.collection(C.SLOTS).doc(s.slotId);
      const made = await deps.db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (cur.exists) return false;
        tx.create(ref, {
          date: s.date,
          pincode: s.pincode,
          templateId: s.templateId,
          label: s.label,
          labelHi: s.labelHi,
          start: s.start,
          end: s.end,
          isPeak: s.isPeak,
          startAt: ts(deps, s.startMs),
          endAt: ts(deps, s.endMs),
          capacity: s.capacity,
          bookedCount: 0,
          status: SLOT_STATUS.OPEN,
          capacityOverridden: false,
          createdAt: ts(deps, nowMs),
          updatedAt: ts(deps, nowMs),
        });
        return true;
      });
      if (made) created++;
    }
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

const PUSH_TTL_MS = {
  slots_open: 3 * 60 * 60 * 1000,
  slot_reminder: 20 * MIN_MS,
  slot_started: 20 * MIN_MS,
};

/**
 * Sends slot pushes. NORMAL priority on purpose: offers depend on the app's
 * high-priority FCM budget, which Android throttles, and none of these is urgent.
 * Data-only, with title/message, so MyFirebaseMessagingService shows them through
 * its existing generic path (older app builds show them too, they just open Home).
 *
 * @param items [{ rider: {fcmToken, preferredLanguage}, kind, vars, key }]
 */
async function sendPushes(deps, items) {
  const messages = [];
  for (const it of items) {
    const token = it.rider && it.rider.fcmToken;
    if (!token) continue;
    const text = core.pushText(it.kind, it.rider.preferredLanguage === 'hi' ? 'hi' : 'en', it.vars || {});
    if (!text) continue;
    messages.push({
      token,
      data: { type: it.kind, title: text.title, message: text.message, notifKey: String(it.key || it.kind) },
      android: { priority: 'normal', ttl: PUSH_TTL_MS[it.kind] || 60 * MIN_MS },
    });
  }
  let sent = 0;
  for (let i = 0; i < messages.length; i += 500) {
    try {
      const res = await deps.messaging().sendEach(messages.slice(i, i + 500));
      sent += res.successCount || 0;
    } catch (e) {
      deps.log.error('[slots] push batch failed', e);
    }
  }
  return sent;
}

/* ------------------------------------------------------------------ */
/* Tick                                                                */
/* ------------------------------------------------------------------ */

const TICK_KEY_MAP = { checkedInAtMs: 'checkedInAt', finalizedAtMs: 'finalizedAt', lastSampleMs: 'lastSampleAt' };

function toFirestoreUpdate(deps, update) {
  const out = {};
  for (const [k, v] of Object.entries(update)) {
    if (TICK_KEY_MAP[k]) out[TICK_KEY_MAP[k]] = v == null ? null : ts(deps, v);
    else out[k] = v;
  }
  return out;
}

async function getDocsById(deps, collection, ids) {
  const map = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const refs = list.slice(i, i + 100).map((id) => deps.db.collection(collection).doc(id));
    const snaps = await deps.db.getAll(...refs);
    snaps.forEach((s) => { if (s.exists) map.set(s.id, s.data()); });
  }
  return map;
}

async function countDeliveries(deps, riderId, startMs, endMs) {
  try {
    const snap = await deps.db.collection(C.TASKS)
      .where('deliveryPersonId', '==', riderId)
      .where('deliveredAt', '>=', ts(deps, startMs))
      .where('deliveredAt', '<', ts(deps, endMs))
      .get();
    return snap.docs.filter((d) => String(d.get('status') || '').toUpperCase() === 'DELIVERED').length;
  } catch (e) {
    deps.log.warn('[slots] delivery count failed (index building?)', e && e.message);
    return null;
  }
}

/** Claims a once-per-key job on riderSlotMeta/state. True for the first caller only. */
async function claimOnce(deps, field, value) {
  const ref = deps.db.collection(C.META).doc('state');
  return deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()[field] === value) return false;
    tx.set(ref, { [field]: value, [`${field}At`]: ts(deps, deps.nowMs()) }, { merge: true });
    return true;
  });
}

async function tick(deps) {
  const nowMs = deps.nowMs();
  const cfg = await loadConfig(deps);
  const summary = { mode: cfg.mode, generated: 0, processed: 0, strikes: 0, blocked: 0, pushes: 0, autoOffline: 0, openPush: 0 };
  if (cfg.mode === 'off') return summary;
  const today = core.istDate(nowMs);

  // 1. Make sure today's and tomorrow's slots exist (once an hour).
  try {
    const hourKey = `${today}T${Math.floor(core.istMinuteOfDay(nowMs) / 60)}`;
    if (await claimOnce(deps, 'lastGenerateKey', hourKey)) {
      summary.generated = await generateSlots(deps, [today, core.addDays(today, 1)]);
    }
  } catch (e) {
    deps.log.error('[slots] generation failed', e);
  }

  // 2. Live bookings that start within the reminder window or have started.
  const bookingSnap = await deps.db.collection(C.BOOKINGS)
    .where('status', 'in', LIVE_STATUSES)
    .where('startAt', '<=', ts(deps, nowMs + (cfg.reminderMin + 1) * MIN_MS))
    .limit(3000)
    .get();
  const bookings = bookingSnap.docs.map(bookingView);
  const riders = await getDocsById(deps, C.RIDERS, bookings.map((b) => b.riderId));
  const pushes = [];
  const finished = new Set();
  const newlyBlocked = new Map();

  for (const b of bookings) {
    const rider = riders.get(b.riderId) || null;
    const online = !!(rider && rider.isOnline === true);
    const tracked = core.modeFor(cfg, b.pincode) !== 'off';
    const dec = core.tickDecision(b, online, nowMs, cfg);
    if (!dec.update) continue;

    const update = toFirestoreUpdate(deps, dec.update);
    if (FINAL_FROM_TICK.includes(update.status) && update.status !== STATUS.NOT_TRACKED) {
      update.deliveriesInSlot = await countDeliveries(deps, b.riderId, b.startMs, b.endMs);
    }
    const strike = dec.strike && tracked;
    if (strike) update.strikeAdded = true;

    let applied = false;
    try {
      applied = await deps.db.runTransaction(async (tx) => {
        const fresh = await tx.get(b.ref);
        // Cancelled / finalized by someone else since the query: leave it alone.
        if (!fresh.exists || !LIVE_STATUSES.includes(fresh.data().status)) return false;
        tx.update(b.ref, update);
        return true;
      });
    } catch (e) {
      deps.log.error(`[slots] tick update failed for ${b.id}`, e);
    }
    if (!applied) continue;
    summary.processed++;

    if (FINAL_FROM_TICK.includes(update.status)) finished.add(b.riderId);
    const vars = { start: b.start, end: b.end, date: b.date };
    if (strike) {
      summary.strikes++;
      try {
        const s = await addStrike(deps, b.riderId, cfg);
        if (s.newlyBlocked) newlyBlocked.set(b.riderId, s.blockedUntilMs);
      } catch (e) {
        deps.log.error(`[slots] strike failed for ${b.riderId}`, e);
      }
    }
    if (dec.push && tracked && rider) pushes.push({ rider, kind: dec.push, vars, key: `${dec.push}_${b.id}` });
  }

  // 3. Blocks: cancel the rider's upcoming bookings and tell them.
  for (const [riderId, untilMs] of newlyBlocked) {
    summary.blocked++;
    try {
      await cancelFutureBookings(deps, riderId, 'blocked');
    } catch (e) {
      deps.log.error(`[slots] block cleanup failed for ${riderId}`, e);
    }
    await writeLog(deps, { action: 'blocked', riderId, reason: 'missed slots', blockedUntil: ts(deps, untilMs) });
    const rider = riders.get(riderId);
    if (rider) {
      const until = untilMs ? new Date(untilMs + core.IST_OFFSET_MS).toISOString().slice(0, 10) : '';
      pushes.push({ rider, kind: 'slot_blocked', vars: { until }, key: `slot_blocked_${riderId}` });
    }
  }

  // 4. Riders whose slot just ended: move their window on, remember when it ended.
  for (const riderId of finished) {
    try {
      const ended = bookings.filter((b) => b.riderId === riderId && b.endMs <= nowMs).map((b) => b.endMs);
      const extra = ended.length ? { lastEndedAt: ts(deps, Math.max(...ended)) } : {};
      await recomputeState(deps, riderId, extra);
    } catch (e) {
      deps.log.error(`[slots] state recompute failed for ${riderId}`, e);
    }
  }

  // 5. Strict mode only (hard + no fallback): riders online without a shift go offline.
  if (cfg.mode === 'hard' && !cfg.hardFallback) {
    try {
      summary.autoOffline = await autoOffline(deps, cfg, nowMs, pushes);
    } catch (e) {
      deps.log.error('[slots] auto-offline failed', e);
    }
  }

  // 6. Morning "booking is open" push, once a day.
  try {
    summary.openPush = await maybeSendOpenPush(deps, cfg, nowMs, today);
  } catch (e) {
    deps.log.error('[slots] open push failed', e);
  }

  summary.pushes = await sendPushes(deps, pushes);
  deps.log.info(`[slots] tick ${JSON.stringify(summary)}`);
  return summary;
}

async function autoOffline(deps, cfg, nowMs, pushes) {
  const snap = await deps.db.collection(C.RIDERS).where('isOnline', '==', true).get();
  const candidates = snap.docs.filter((d) => {
    const r = d.data() || {};
    return core.modeFor(cfg, r.pincode) === 'hard' && !r.currentOrderId;
  });
  if (!candidates.length) return 0;
  const states = await getDocsById(deps, C.STATE, candidates.map((d) => d.id));
  let n = 0;
  for (const doc of candidates) {
    const state = states.get(doc.id) || null;
    if (core.windowActive(state, nowMs, EARLY_MS)) continue;
    const lastEnded = state ? core.toMs(state.lastEndedAt) : null;
    if (lastEnded && nowMs - lastEnded < cfg.autoOfflineMin * MIN_MS) continue;
    const ok = await deps.db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const r = fresh.exists ? fresh.data() : null;
      // Never during a delivery, and only if still online.
      if (!r || r.isOnline !== true || r.currentOrderId) return false;
      tx.update(doc.ref, { isOnline: false, updatedAt: ts(deps, nowMs), slotAutoOfflineAt: ts(deps, nowMs) });
      return true;
    });
    if (ok) {
      n++;
      pushes.push({ rider: doc.data(), kind: 'slot_ended', vars: {}, key: `slot_ended_${doc.id}` });
    }
  }
  return n;
}

async function maybeSendOpenPush(deps, cfg, nowMs, today) {
  const opens = core.parseHHMM(cfg.bookingOpensAt);
  const minute = core.istMinuteOfDay(nowMs);
  if (opens == null || minute < opens || minute >= opens + 180) return 0;
  if (!(await claimOnce(deps, 'lastOpenPushDate', today))) return 0;

  const slotSnap = await deps.db.collection(C.SLOTS).where('date', '==', today).get();
  const pincodes = new Set();
  slotSnap.docs.forEach((d) => {
    const s = slotView(d);
    if (s.status === SLOT_STATUS.OPEN && s.bookedCount < s.capacity && s.endMs > nowMs && core.modeFor(cfg, s.pincode) !== 'off') {
      pincodes.add(String(s.pincode));
    }
  });
  const items = [];
  for (const pincode of pincodes) {
    const riders = await deps.db.collection(C.RIDERS).where('pincode', '==', pincode).get();
    riders.docs.forEach((d) => {
      const r = d.data() || {};
      if (r.isVerified === true && r.isSuspended !== true && r.fcmToken) {
        items.push({ rider: r, kind: 'slots_open', vars: {}, key: `slots_open_${today}` });
      }
    });
  }
  return sendPushes(deps, items);
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * Who should be offered a new delivery request, given slots.
 *
 * Only does anything in HARD mode for the request's pincode:
 *  - Riders on a shift right now, who could take the order, get it first.
 *  - If there are none (or the order has already been offered
 *    `openToAllAfterAttempts` times) and `slotHardFallback` is on, the request is
 *    marked `slotFallback: true` and goes to every online rider — so a booking
 *    mistake never turns into "no rider, order cancelled". The app and the
 *    Firestore rules read the same flag.
 *
 * @param codLimit number, or an async function returning it (only called in hard mode)
 * @returns null (no restriction) or { restrictTo: Set<riderId>, reason }
 */
async function decideOfferAudience(deps, requestRef, req, codLimit = 300) {
  const cfg = await loadConfig(deps);
  const pincode = String((req && req.vendorPincode) || '').trim();
  if (!pincode || core.modeFor(cfg, pincode) !== 'hard') return null;
  const nowMs = deps.nowMs();
  // Read lazily so the common case (mode off) costs one config read and nothing else.
  const limit = typeof codLimit === 'function' ? await codLimit() : codLimit;
  const codMax = typeof limit === 'number' && Number.isFinite(limit) ? limit : 300;

  const snap = await deps.db.collection(C.RIDERS)
    .where('pincode', '==', pincode)
    .where('isOnline', '==', true)
    .get();
  const free = snap.docs.filter((d) => {
    const r = d.data() || {};
    return r.isAvailable !== false && r.isVerified !== false && !r.currentOrderId && (Number(r.codCollected) || 0) <= codMax;
  }).map((d) => d.id);
  const states = await getDocsById(deps, C.STATE, free);
  const onShift = free.filter((id) => core.windowActive(states.get(id), nowMs));

  let attempts = 0;
  if (cfg.openToAllAfterAttempts > 0 && req.orderId) {
    try {
      const order = await deps.db.collection('orders').doc(String(req.orderId)).get();
      attempts = Number(order.exists && order.get('deliveryBroadcastAttempts')) || 0;
    } catch (e) {
      deps.log.warn('[slots] attempts read failed', e && e.message);
    }
  }
  const openToAll = cfg.openToAllAfterAttempts > 0 && attempts > cfg.openToAllAfterAttempts;

  if (onShift.length > 0 && !openToAll) {
    return { restrictTo: new Set(onShift), reason: 'slot' };
  }
  if (cfg.hardFallback) {
    await requestRef.update({
      slotFallback: true,
      slotFallbackReason: onShift.length > 0 ? 'retry' : 'no-slot-rider',
    });
    return null;
  }
  return { restrictTo: new Set(onShift), reason: 'no-fallback' };
}

module.exports = {
  C,
  EARLY_MS,
  loadConfig,
  book,
  cancel,
  tick,
  recomputeState,
  addStrike,
  cancelFutureBookings,
  generateSlots,
  sendPushes,
  decideOfferAudience,
};
