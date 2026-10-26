import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { db, sendPushNotification } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import * as core from '@/lib/riderSlotsCore';
import * as store from '@/lib/riderSlotsStore';
import type { SlotDeps } from '@/lib/riderSlotsStore';

/**
 * Rider slot booking — /api/delivery/slots
 *
 * Riders book through the bookRiderSlot / cancelRiderSlot Cloud Functions. This
 * route is the admin side, and books/cancels through the SAME code
 * (lib/riderSlotsStore.js is a copy of functions/riderSlotsStore.js), so capacity
 * counts, rider shift windows and strikes never drift between the two.
 *
 *   GET  ?view=board&date=YYYY-MM-DD[&pincode=]   slots + bookings for a day, templates, settings
 *   GET  ?view=attendance&from=&to=               per-rider attendance (max 31 days)
 *   POST { action, ... }                          see handlePOST
 */

const TEMPLATES = 'slotTemplates';
const SLOTS = 'riderSlots';
const BOOKINGS = 'slotBookings';
const STATE = 'riderSlotState';
const LOGS = 'slotLogs';
const RIDERS = 'deliveryPersons';

class BadRequest extends Error {}

/** Shared-store dependencies. The panel's db.getAll takes an ARRAY; the store passes refs one by one. */
function deps(): SlotDeps {
    return {
        db: {
            collection: (name: string) => db.collection(name),
            getAll: (...refs: FirebaseFirestore.DocumentReference[]) => db.getAll(refs),
            runTransaction: <T,>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>) => db.runTransaction(fn),
        },
        Timestamp,
        nowMs: () => Date.now(),
        messaging: () => getMessaging() as unknown as ReturnType<SlotDeps['messaging']>,
        log: console,
    };
}

function who(auth: AdminResult): string {
    return auth?.email || auth?.uid || 'admin';
}

async function log(action: string, auth: AdminResult, data: Record<string, unknown>) {
    try {
        await db.collection(LOGS).add({ action, by: who(auth), data, at: Timestamp.now() });
    } catch (e) {
        console.error('[slots] audit log failed', e);
    }
}

function iso(v: unknown): string | null {
    const ms = core.toMs(v);
    return ms == null ? null : new Date(ms).toISOString();
}

function str(v: unknown, max = 200): string {
    return String(v ?? '').trim().slice(0, max);
}

function fail(error: unknown) {
    if (error instanceof BadRequest) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('[slots] error', error);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}

const CODE_TEXT: Record<string, string> = {
    'not-rider': 'Rider not found',
    'slot-closed': 'This slot is closed or cancelled',
    'slot-ended': 'This slot has already ended',
    'already-booked': 'This rider already has this slot',
    overlap: 'This rider has another slot at the same time',
    'not-booked': 'This booking is not active',
};

/* ------------------------------------------------------------------ */
/* GET                                                                 */
/* ------------------------------------------------------------------ */

async function readConfig() {
    const snap = await db.collection('config').doc('appFeatures').get();
    return core.normalizeConfig(snap.exists ? snap.data() : {});
}

async function listTemplates() {
    const snap = await db.collection(TEMPLATES).get();
    const list = snap.docs.map((d) => {
        const t = d.data() || {};
        return {
            id: d.id,
            pincode: String(t.pincode ?? ''),
            label: String(t.label ?? ''),
            labelHi: String(t.labelHi ?? ''),
            start: String(t.start ?? ''),
            end: String(t.end ?? ''),
            capacity: Number(t.capacity) || 0,
            daysOfWeek: Array.isArray(t.daysOfWeek) ? t.daysOfWeek.map(Number) : [1, 2, 3, 4, 5, 6, 7],
            isPeak: t.isPeak === true,
            active: t.active !== false,
            updatedAt: iso(t.updatedAt),
            updatedBy: t.updatedBy ? String(t.updatedBy) : null,
            overlapsWith: [] as string[],
        };
    });
    for (const a of list) {
        if (!a.active) continue;
        a.overlapsWith = list.filter((b) => b.id !== a.id && b.active && core.templatesOverlap(a, b)).map((b) => b.id);
    }
    list.sort((a, b) => a.pincode.localeCompare(b.pincode) || a.start.localeCompare(b.start));
    return list;
}

async function board(date: string, pincode: string) {
    const nowMs = Date.now();
    const [cfg, templates, slotSnap, bookingSnap] = await Promise.all([
        readConfig(),
        listTemplates(),
        db.collection(SLOTS).where('date', '==', date).get(),
        db.collection(BOOKINGS).where('date', '==', date).get(),
    ]);

    const riderIds = [...new Set(bookingSnap.docs.map((d) => String(d.get('riderId') || '')).filter(Boolean))];
    const riderSnaps = riderIds.length ? await db.getAll(riderIds.map((id) => db.collection(RIDERS).doc(id))) : [];
    const riders = new Map<string, FirebaseFirestore.DocumentData>(
        riderSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() || {}] as [string, FirebaseFirestore.DocumentData])
    );

    const bookingsBySlot = new Map<string, unknown[]>();
    for (const d of bookingSnap.docs) {
        const b = d.data() || {};
        const r: FirebaseFirestore.DocumentData = riders.get(String(b.riderId)) || {};
        const row = {
            id: d.id,
            riderId: String(b.riderId || ''),
            riderName: String(r.fullName || b.riderName || ''),
            riderPhone: String(r.phoneNumber || b.riderPhone || ''),
            riderOnline: r.isOnline === true,
            status: String(b.status || ''),
            bookedBy: String(b.bookedBy || 'rider'),
            bookedAt: iso(b.bookedAt),
            checkedInAt: iso(b.checkedInAt),
            late: b.late === true,
            noShowMarked: b.noShowMarked === true,
            onlineMinutes: Number(b.onlineMinutes) || 0,
            deliveriesInSlot: b.deliveriesInSlot == null ? null : Number(b.deliveriesInSlot),
            cancelledAt: iso(b.cancelledAt),
            cancelReason: b.cancelReason ? String(b.cancelReason) : null,
        };
        const key = String(b.slotId || '');
        if (!bookingsBySlot.has(key)) bookingsBySlot.set(key, []);
        bookingsBySlot.get(key)!.push(row);
    }

    const slots = slotSnap.docs
        .map((d) => {
            const s = d.data() || {};
            const startMs = core.toMs(s.startAt) || 0;
            const endMs = core.toMs(s.endAt) || 0;
            return {
                id: d.id,
                date: String(s.date || ''),
                pincode: String(s.pincode || ''),
                templateId: String(s.templateId || ''),
                label: String(s.label || ''),
                start: String(s.start || ''),
                end: String(s.end || ''),
                startAt: new Date(startMs).toISOString(),
                endAt: new Date(endMs).toISOString(),
                capacity: Number(s.capacity) || 0,
                bookedCount: Number(s.bookedCount) || 0,
                capacityOverridden: s.capacityOverridden === true,
                status: String(s.status || 'OPEN'),
                isPeak: s.isPeak === true,
                phase: endMs <= nowMs ? 'ended' : startMs <= nowMs ? 'running' : 'upcoming',
                bookings: bookingsBySlot.get(d.id) || [],
            };
        })
        .filter((s) => !pincode || s.pincode === pincode)
        .sort((a, b) => a.pincode.localeCompare(b.pincode) || a.startAt.localeCompare(b.startAt));

    const pincodes = [...new Set([...templates.map((t) => t.pincode), ...slots.map((s) => s.pincode)])].sort();
    return { date, today: core.istDate(nowMs), config: cfg, templates, pincodes, slots };
}

async function attendance(from: string, to: string) {
    const snap = await db.collection(BOOKINGS).where('date', '>=', from).where('date', '<=', to).limit(10000).get();
    type Row = {
        riderId: string; riderName: string; riderPhone: string; pincode: string;
        booked: number; completed: number; noShow: number; late: number; lateCancel: number;
        cancelled: number; adminCancelled: number; upcoming: number;
        onlineMinutes: number; deliveries: number;
        strikes: number; blockedUntil: string | null;
    };
    const rows = new Map<string, Row>();
    for (const d of snap.docs) {
        const b = d.data() || {};
        const id = String(b.riderId || '');
        if (!id) continue;
        if (!rows.has(id)) {
            rows.set(id, {
                riderId: id, riderName: String(b.riderName || ''), riderPhone: String(b.riderPhone || ''), pincode: String(b.pincode || ''),
                booked: 0, completed: 0, noShow: 0, late: 0, lateCancel: 0, cancelled: 0, adminCancelled: 0, upcoming: 0,
                onlineMinutes: 0, deliveries: 0, strikes: 0, blockedUntil: null,
            });
        }
        const r = rows.get(id)!;
        r.booked++;
        switch (String(b.status)) {
            case 'COMPLETED': r.completed++; break;
            case 'NO_SHOW': r.noShow++; break;
            case 'LATE_CANCEL': r.lateCancel++; break;
            case 'CANCELLED': r.cancelled++; break;
            case 'ADMIN_CANCELLED': r.adminCancelled++; break;
            case 'BOOKED': case 'ACTIVE': r.upcoming++; break;
            default: break;
        }
        if (b.late === true) r.late++;
        r.onlineMinutes += Number(b.onlineMinutes) || 0;
        r.deliveries += Number(b.deliveriesInSlot) || 0;
    }
    const ids = [...rows.keys()];
    const nowMs = Date.now();
    if (ids.length) {
        const [states, riders] = await Promise.all([
            db.getAll(ids.map((id) => db.collection(STATE).doc(id))),
            db.getAll(ids.map((id) => db.collection(RIDERS).doc(id))),
        ]);
        states.forEach((s) => {
            const r = rows.get(s.id);
            if (!r || !s.exists) return;
            const d = s.data() || {};
            const cfgWindow = 7 * 24 * 3600 * 1000;
            r.strikes = Array.isArray(d.strikes) ? d.strikes.filter((t: unknown) => (core.toMs(t) || 0) > nowMs - cfgWindow).length : 0;
            const until = core.toMs(d.blockedUntil);
            r.blockedUntil = until && until > nowMs ? new Date(until).toISOString() : null;
        });
        riders.forEach((s) => {
            const r = rows.get(s.id);
            if (!r || !s.exists) return;
            const d = s.data() || {};
            r.riderName = String(d.fullName || r.riderName);
            r.riderPhone = String(d.phoneNumber || r.riderPhone);
        });
    }
    return {
        from, to,
        truncated: snap.size >= 10000,
        riders: [...rows.values()].sort((a, b) => b.noShow - a.noShow || b.booked - a.booked),
    };
}

async function handleGET(request: Request) {
    try {
        const url = new URL(request.url);
        const view = url.searchParams.get('view') || 'board';
        const today = core.istDate(Date.now());
        if (view === 'attendance') {
            const from = url.searchParams.get('from') || core.addDays(today, -6);
            const to = url.searchParams.get('to') || today;
            if (!core.isDateString(from) || !core.isDateString(to) || from > to) throw new BadRequest('Pick a valid date range');
            if (core.istMidnightMs(to) - core.istMidnightMs(from) > 31 * core.DAY_MS) throw new BadRequest('Pick at most 31 days');
            return NextResponse.json({ success: true, data: await attendance(from, to) });
        }
        const date = url.searchParams.get('date') || today;
        if (!core.isDateString(date)) throw new BadRequest('Invalid date');
        const pincode = str(url.searchParams.get('pincode'), 12);
        return NextResponse.json({ success: true, data: await board(date, pincode) });
    } catch (e) {
        return fail(e);
    }
}

/* ------------------------------------------------------------------ */
/* POST                                                                */
/* ------------------------------------------------------------------ */

/** Pushes "your slot was cancelled" to a rider, in their language. Never throws. */
async function notifyCancelled(riderId: string, start: string, end: string) {
    try {
        const r = await db.collection(RIDERS).doc(riderId).get();
        const lang = r.exists && r.get('preferredLanguage') === 'hi' ? 'hi' : 'en';
        const text = core.pushText('slot_cancelled', lang, { start, end });
        if (text) await sendPushNotification('delivery', riderId, text.title, text.message, { type: 'slot_cancelled', notifKey: `slot_cancelled_${riderId}_${start}` });
    } catch (e) {
        console.warn('[slots] cancel push failed', e);
    }
}

type ValidTemplate = Extract<ReturnType<typeof core.validateTemplate>, { ok: true }>;

/**
 * Brings today's and tomorrow's slots of one template in line with it.
 *
 * Nobody booked → the slot simply follows the shift: new hours, name, capacity —
 * even when its OLD hours have already started or passed (that was the bug where
 * editing a shift left today's slot on the old time).
 * Riders booked → they keep the hours they booked; only the name/tag change, and
 * capacity never drops below the booked count. Those days are returned in `kept`
 * so the panel can say so; remove the riders on the Board and save again to move them.
 * Cancelled slots are left alone.
 */
async function syncTemplateSlots(templateId: string, t: ValidTemplate) {
    const nowMs = Date.now();
    const today = core.istDate(nowMs);
    const dates = [today, core.addDays(today, 1)];
    let updated = 0;
    const kept: { date: string; booked: number; start: string; end: string }[] = [];
    for (const date of dates) {
        const ref = db.collection(SLOTS).doc(core.slotIdFor(date, t.value.pincode, templateId));
        const changed = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) return false;
            const s = snap.data() || {};
            if (s.status === 'CANCELLED') return false;
            const startMs = core.toMs(s.startAt) || 0;
            const booked = Number(s.bookedCount) || 0;
            const runs = t.value.active && core.templateRuns(t.value, date);
            const update: Record<string, unknown> = {
                label: t.value.label,
                labelHi: t.value.labelHi,
                isPeak: t.value.isPeak,
                updatedAt: Timestamp.now(),
            };
            if (booked === 0) {
                const w = core.slotWindow(date, t.value.start, t.value.end);
                if (w) {
                    update.start = t.value.start;
                    update.end = t.value.end;
                    update.startAt = Timestamp.fromMillis(w.startMs);
                    update.endAt = Timestamp.fromMillis(w.endMs);
                }
                if (s.capacityOverridden !== true) update.capacity = t.value.capacity;
                // Only reopen what this sync closed — never a slot an admin closed by hand.
                if (!runs && s.status === 'OPEN') { update.status = 'CLOSED'; update.closedBy = 'template'; }
                if (runs && s.status === 'CLOSED' && s.closedBy === 'template') { update.status = 'OPEN'; update.closedBy = null; }
            } else {
                if (s.capacityOverridden !== true && startMs > nowMs) update.capacity = Math.max(t.value.capacity, booked);
                if (String(s.start || '') !== t.value.start || String(s.end || '') !== t.value.end) {
                    kept.push({ date, booked, start: String(s.start || ''), end: String(s.end || '') });
                }
            }
            tx.update(ref, update);
            return true;
        });
        if (changed) updated++;
    }
    const created = t.value.active ? await store.generateSlots(deps(), dates, templateId) : 0;
    return { updated, created, kept };
}

async function findRider(input: string): Promise<string | null> {
    const raw = str(input, 60);
    if (!raw) return null;
    if (/^[A-Za-z0-9]{20,40}$/.test(raw)) {
        const d = await db.collection(RIDERS).doc(raw).get();
        if (d.exists) return d.id;
    }
    const digits = raw.replace(/\D/g, '');
    const ten = digits.slice(-10);
    if (ten.length !== 10) return null;
    for (const v of [ten, `+91${ten}`, `91${ten}`, `+91 ${ten}`]) {
        const q = await db.collection(RIDERS).where('phoneNumber', '==', v).limit(1).get();
        if (!q.empty) return q.docs[0].id;
    }
    return null;
}

const SETTING_FIELDS: Record<string, keyof ReturnType<typeof core.normalizeConfig>> = {
    riderSlotMode: 'mode',
    riderSlotPilotPincodes: 'pilotPincodes',
    slotBookingOpensAt: 'bookingOpensAt',
    slotAllowTomorrow: 'allowTomorrow',
    slotCancelCutoffMin: 'cancelCutoffMin',
    slotCheckInGraceMin: 'checkInGraceMin',
    slotMaxPerDay: 'maxPerDay',
    slotStrikeLimit: 'strikeLimit',
    slotBlockDays: 'blockDays',
    slotAutoOfflineMin: 'autoOfflineMin',
    slotHardFallback: 'hardFallback',
    slotOpenToAllAfterAttempts: 'openToAllAfterAttempts',
};

async function handlePOST(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const action = String(body.action || '');
        const d = deps();
        const cfg = await readConfig();

        switch (action) {
            case 'saveTemplate': {
                const v = core.validateTemplate(body.template);
                if (!v.ok) throw new BadRequest(v.error);
                const id = str(body.id, 60);
                const ref = id ? db.collection(TEMPLATES).doc(id) : db.collection(TEMPLATES).doc();
                if (id) {
                    const cur = await ref.get();
                    if (!cur.exists) throw new BadRequest('Slot template not found');
                    if (String(cur.get('pincode') || '') !== v.value.pincode) {
                        throw new BadRequest('The pincode of a slot cannot be changed. Create a new slot for the other pincode.');
                    }
                }
                await ref.set({
                    ...v.value,
                    updatedAt: Timestamp.now(),
                    updatedBy: who(auth),
                    ...(id ? {} : { createdAt: Timestamp.now() }),
                }, { merge: true });
                const sync = await syncTemplateSlots(ref.id, v);
                await log(id ? 'template-update' : 'template-create', auth, { templateId: ref.id, ...v.value, ...sync });
                return NextResponse.json({ success: true, data: { id: ref.id, ...sync } });
            }

            case 'deleteTemplate': {
                // Soft delete: stops new days being generated and closes upcoming
                // slots nobody has booked. Booked slots stay so riders keep their hours;
                // cancel them from the board if needed.
                const id = str(body.id, 60);
                const ref = db.collection(TEMPLATES).doc(id);
                const cur = await ref.get();
                if (!id || !cur.exists) throw new BadRequest('Slot template not found');
                await ref.set({ active: false, updatedAt: Timestamp.now(), updatedBy: who(auth) }, { merge: true });
                const v = core.validateTemplate({ ...(cur.data() || {}), active: false });
                const sync = v.ok ? await syncTemplateSlots(id, v) : { updated: 0, created: 0 };
                await log('template-disable', auth, { templateId: id, ...sync });
                return NextResponse.json({ success: true, data: sync });
            }

            case 'setCapacity': {
                const slotId = str(body.slotId, 160);
                const capacity = Number(body.capacity);
                if (!Number.isInteger(capacity) || capacity < 0 || capacity > 500) throw new BadRequest('Riders per slot must be 0–500');
                const ref = db.collection(SLOTS).doc(slotId);
                await db.runTransaction(async (tx) => {
                    const s = await tx.get(ref);
                    if (!s.exists) throw new BadRequest('Slot not found');
                    const booked = Number(s.get('bookedCount')) || 0;
                    if (capacity < booked) throw new BadRequest(`${booked} riders have booked this slot — capacity cannot go below that`);
                    tx.update(ref, { capacity, capacityOverridden: true, updatedAt: Timestamp.now() });
                });
                await log('capacity', auth, { slotId, capacity });
                return NextResponse.json({ success: true });
            }

            case 'setSlotStatus': {
                const slotId = str(body.slotId, 160);
                const status = String(body.status);
                if (status !== 'OPEN' && status !== 'CLOSED') throw new BadRequest('Invalid status');
                const ref = db.collection(SLOTS).doc(slotId);
                await db.runTransaction(async (tx) => {
                    const s = await tx.get(ref);
                    if (!s.exists) throw new BadRequest('Slot not found');
                    if (s.get('status') === 'CANCELLED') throw new BadRequest('A cancelled slot cannot be reopened');
                    tx.update(ref, { status, closedBy: status === 'CLOSED' ? 'admin' : null, updatedAt: Timestamp.now() });
                });
                await log(status === 'OPEN' ? 'slot-open' : 'slot-close', auth, { slotId });
                return NextResponse.json({ success: true });
            }

            case 'cancelSlot': {
                const slotId = str(body.slotId, 160);
                const reason = str(body.reason, 120) || 'Cancelled by Delito';
                const ref = db.collection(SLOTS).doc(slotId);
                const s = await ref.get();
                if (!s.exists) throw new BadRequest('Slot not found');
                if ((core.toMs(s.get('endAt')) || 0) <= Date.now()) throw new BadRequest('This slot has already ended');
                await ref.update({ status: 'CANCELLED', updatedAt: Timestamp.now() });
                const live = await db.collection(BOOKINGS).where('slotId', '==', slotId).where('status', 'in', ['BOOKED', 'ACTIVE']).get();
                let cancelled = 0;
                for (const b of live.docs) {
                    const riderId = String(b.get('riderId') || '');
                    const res = await store.cancel(d, riderId, b.id, { byAdmin: true, adminId: who(auth), cfg, reason });
                    if (res.success) {
                        cancelled++;
                        await notifyCancelled(riderId, String(s.get('start') || ''), String(s.get('end') || ''));
                    }
                }
                await log('slot-cancel', auth, { slotId, reason, cancelled });
                return NextResponse.json({ success: true, data: { cancelled } });
            }

            case 'addRider': {
                const slotId = str(body.slotId, 160);
                const riderId = await findRider(String(body.rider || ''));
                if (!riderId) throw new BadRequest('No rider found with that phone number or ID');
                const res = await store.book(d, riderId, slotId, { byAdmin: true, adminId: who(auth), cfg });
                if (!res.success) throw new BadRequest(CODE_TEXT[res.code || ''] || `Could not add rider (${res.code})`);
                await log('rider-add', auth, { slotId, riderId });
                return NextResponse.json({ success: true, data: { riderId } });
            }

            case 'removeBooking': {
                const bookingId = str(body.bookingId, 220);
                const b = await db.collection(BOOKINGS).doc(bookingId).get();
                if (!b.exists) throw new BadRequest('Booking not found');
                const riderId = String(b.get('riderId') || '');
                const res = await store.cancel(d, riderId, bookingId, { byAdmin: true, adminId: who(auth), cfg, reason: str(body.reason, 120) || 'Removed by Delito' });
                if (!res.success) throw new BadRequest(CODE_TEXT[res.code || ''] || `Could not remove (${res.code})`);
                await notifyCancelled(riderId, String(b.get('start') || ''), String(b.get('end') || ''));
                await log('rider-remove', auth, { bookingId, riderId });
                return NextResponse.json({ success: true });
            }

            case 'clearStrikes': {
                const riderId = str(body.riderId, 60);
                if (!riderId) throw new BadRequest('Rider missing');
                await db.collection(STATE).doc(riderId).set({ strikes: [], blockedUntil: null, updatedAt: Timestamp.now() }, { merge: true });
                await log('strikes-clear', auth, { riderId });
                return NextResponse.json({ success: true });
            }

            case 'generateNow': {
                const today = core.istDate(Date.now());
                const created = await store.generateSlots(d, [today, core.addDays(today, 1)]);
                await log('generate', auth, { created });
                return NextResponse.json({ success: true, data: { created } });
            }

            case 'saveSettings': {
                const input = (body.settings && typeof body.settings === 'object' ? body.settings : {}) as Record<string, unknown>;
                // Normalise exactly the way every reader does, then store the normalised
                // values — what the panel shows is what the apps and functions will use.
                const merged: Record<string, unknown> = {};
                for (const key of Object.keys(SETTING_FIELDS)) {
                    if (key in input) merged[key] = input[key];
                }
                if ('riderSlotMode' in merged && !['off', 'soft', 'hard'].includes(String(merged.riderSlotMode))) {
                    throw new BadRequest('Mode must be off, soft or hard');
                }
                if ('slotBookingOpensAt' in merged && core.parseHHMM(merged.slotBookingOpensAt) == null) {
                    throw new BadRequest('Booking opens at must be a time like 06:00');
                }
                if ('riderSlotPilotPincodes' in merged && !Array.isArray(merged.riderSlotPilotPincodes)) {
                    throw new BadRequest('Pilot pincodes must be a list');
                }
                const current = await db.collection('config').doc('appFeatures').get();
                const next = core.normalizeConfig({ ...(current.exists ? current.data() : {}), ...merged });
                const write: Record<string, unknown> = {};
                for (const [key, field] of Object.entries(SETTING_FIELDS)) write[key] = next[field];
                await db.collection('config').doc('appFeatures').set(write, { merge: true });
                await log('settings', auth, write);
                return NextResponse.json({ success: true, data: { config: next } });
            }

            default:
                throw new BadRequest('Unknown action');
        }
    } catch (e) {
        return fail(e);
    }
}

export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
