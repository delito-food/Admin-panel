import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';

/**
 * Surge charges — /api/surge
 *
 * Rules live in `surgeRules/{id}`. The customer app prices them into the order
 * (shared/SurgeRepository.kt + PricingCalculator), the rider app shows the bonus,
 * functions/riderPay.js keeps the rider's share when it restamps pay.
 *
 *   GET                         list every rule + whether it is live right now
 *   POST    { rule }            create
 *   PATCH   { id, rule }        edit
 *   PATCH   { id, action: 'start', minutes }   manual rule: run now for N minutes
 *   PATCH   { id, action: 'stop' }             stop (manual) / switch off (schedule)
 *   DELETE  ?id=                delete
 *
 * Every limit here is also enforced (clamped) by the apps, so a bad document can
 * never charge a customer more than MAX_FEE.
 */

const COLLECTION = 'surgeRules';
const LOGS = 'surgeRuleLogs';
const MAX_FEE = 100;
const TYPES = ['rain', 'demand', 'night', 'festival', 'custom'] as const;
const TRIGGERS = ['manual', 'schedule'] as const;
const ANIMATIONS = ['rain', 'redTint', 'night', 'confetti', 'none'] as const;

class BadRequest extends Error {}

type RuleInput = Record<string, unknown>;

function str(v: unknown, max: number): string {
    return String(v ?? '').trim().slice(0, max);
}

function numIn(v: unknown, lo: number, hi: number, field: string): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new BadRequest(`${field} must be between ${lo} and ${hi}`);
    return n;
}

function oneOf<T extends readonly string[]>(v: unknown, list: T, field: string): T[number] {
    const s = String(v ?? '');
    if (!(list as readonly string[]).includes(s)) throw new BadRequest(`Invalid ${field}`);
    return s as T[number];
}

/** Validates and normalises the editable fields. Never trusts the client. */
function clean(input: RuleInput) {
    const name = str(input.name, 40);
    if (!name) throw new BadRequest('Name is required');
    const zones = Array.isArray(input.zones)
        ? [...new Set(input.zones.map(z => str(z, 40)).filter(Boolean))].slice(0, 30)
        : [];
    const days = Array.isArray(input.days)
        ? [...new Set(input.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : [];
    return {
        name,
        type: oneOf(input.type ?? 'custom', TYPES, 'type'),
        trigger: oneOf(input.trigger ?? 'manual', TRIGGERS, 'trigger'),
        amount: Math.round(numIn(input.amount, 1, MAX_FEE, 'Surge fee') * 10) / 10,
        riderPercent: Math.round(numIn(input.riderPercent, 0, 100, 'Rider share')),
        animation: oneOf(input.animation ?? 'none', ANIMATIONS, 'animation'),
        message: str(input.message, 80),
        zones,
        startMinute: Math.round(numIn(input.startMinute ?? 0, 0, 1439, 'Start time')),
        endMinute: Math.round(numIn(input.endMinute ?? 0, 0, 1439, 'End time')),
        days,
        showRiderShare: input.showRiderShare !== false,
        enabled: input.enabled === true,
    };
}

/** Same rule as SurgeRepository.isLive, evaluated in IST. */
function isLive(d: FirebaseFirestore.DocumentData, nowMs: number): boolean {
    if (d.enabled !== true || !(Number(d.amount) > 0)) return false;
    if (d.trigger === 'manual') {
        const until = d.activeUntil?.toMillis?.() ?? 0;
        return until > nowMs;
    }
    if (d.trigger === 'schedule') {
        const ist = new Date(nowMs + 5.5 * 3600 * 1000);
        const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
        const today = ist.getUTCDay();
        const yesterday = (today + 6) % 7;
        const s = Number(d.startMinute) || 0;
        const e = Number(d.endMinute) || 0;
        const days: number[] = Array.isArray(d.days) ? d.days : [];
        const ok = (day: number) => days.length === 0 || days.includes(day);
        if (s === e) return false;
        return s < e
            ? minute >= s && minute < e && ok(today)
            : (minute >= s && ok(today)) || (minute < e && ok(yesterday));
    }
    return false;
}

function serialize(doc: FirebaseFirestore.DocumentSnapshot, nowMs: number) {
    const d = doc.data() || {};
    const amount = Number(d.amount) || 0;
    const riderPercent = Number(d.riderPercent) || 0;
    const riderShare = Math.round(amount * riderPercent / 10) / 10;
    return {
        id: doc.id,
        name: d.name || '',
        type: d.type || 'custom',
        trigger: d.trigger || 'manual',
        amount,
        riderPercent,
        riderShare,
        platformShare: Math.round((amount - riderShare) * 10) / 10,
        animation: d.animation || 'none',
        message: d.message || '',
        zones: Array.isArray(d.zones) ? d.zones : [],
        startMinute: Number(d.startMinute) || 0,
        endMinute: Number(d.endMinute) || 0,
        days: Array.isArray(d.days) ? d.days : [],
        showRiderShare: d.showRiderShare !== false,
        enabled: d.enabled === true,
        activeUntil: d.activeUntil?.toDate?.()?.toISOString?.() || null,
        live: isLive(d, nowMs),
        updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() || null,
        updatedBy: d.updatedBy || null,
    };
}

function who(auth: AdminResult): string {
    return auth?.email || auth?.uid || 'admin';
}

async function log(id: string, action: string, auth: AdminResult, data: Record<string, unknown>) {
    try {
        await db.collection(LOGS).add({ ruleId: id, action, by: who(auth), data, at: Timestamp.now() });
    } catch (e) {
        console.error('[surge] audit log failed', e);
    }
}

function fail(error: unknown) {
    if (error instanceof BadRequest) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('[surge] error', error);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}

async function handleGET() {
    try {
        const snap = await db.collection(COLLECTION).get();
        const now = Date.now();
        const rules = snap.docs.map(d => serialize(d, now)).sort((a, b) => a.name.localeCompare(b.name));
        return NextResponse.json({ success: true, data: { rules, serverTime: new Date(now).toISOString() } });
    } catch (e) {
        return fail(e);
    }
}

async function handlePOST(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const body = await request.json();
        const rule = clean(body?.rule || {});
        const now = Timestamp.now();
        const ref = await db.collection(COLLECTION).add({
            ...rule,
            activeUntil: null,
            createdAt: now,
            updatedAt: now,
            updatedBy: who(auth),
        });
        await log(ref.id, 'create', auth, rule);
        return NextResponse.json({ success: true, data: { id: ref.id } });
    } catch (e) {
        return fail(e);
    }
}

async function handlePATCH(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const body = await request.json();
        const id = str(body?.id, 100);
        if (!id) throw new BadRequest('Rule id is required');
        const ref = db.collection(COLLECTION).doc(id);
        const snap = await ref.get();
        if (!snap.exists) throw new BadRequest('Rule not found');
        const now = Timestamp.now();

        if (body.action === 'start') {
            const minutes = Math.round(numIn(body.minutes, 5, 24 * 60, 'Duration (minutes)'));
            const until = Timestamp.fromMillis(Date.now() + minutes * 60 * 1000);
            const update = snap.get('trigger') === 'manual'
                ? { enabled: true, activeUntil: until }
                : { enabled: true };
            await ref.update({ ...update, updatedAt: now, updatedBy: who(auth) });
            await log(id, 'start', auth, { minutes });
        } else if (body.action === 'stop') {
            await ref.update({ enabled: false, activeUntil: null, updatedAt: now, updatedBy: who(auth) });
            await log(id, 'stop', auth, {});
        } else {
            const rule = clean(body?.rule || {});
            // Switching a rule to "schedule" drops any running manual window.
            const extra = rule.trigger === 'schedule' ? { activeUntil: null } : {};
            await ref.update({ ...rule, ...extra, updatedAt: now, updatedBy: who(auth) });
            await log(id, 'edit', auth, rule);
        }
        const fresh = await ref.get();
        return NextResponse.json({ success: true, data: serialize(fresh, Date.now()) });
    } catch (e) {
        return fail(e);
    }
}

async function handleDELETE(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const id = str(new URL(request.url).searchParams.get('id'), 100);
        if (!id) throw new BadRequest('Rule id is required');
        await db.collection(COLLECTION).doc(id).delete();
        await log(id, 'delete', auth, {});
        return NextResponse.json({ success: true });
    } catch (e) {
        return fail(e);
    }
}

export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
export const PATCH = withAdmin(handlePATCH);
export const DELETE = withAdmin(handleDELETE);
