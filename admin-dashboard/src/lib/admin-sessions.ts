/**
 * Admin login sessions — "where am I signed in?" and per-device sign-out.
 *
 * Firebase Auth has no revocable per-device session: a refresh token can only
 * be revoked for *every* device at once. So the panel keeps its own record of
 * each sign-in, the browser sends that record's id on every /api call
 * (X-Admin-Session), and the API guard refuses calls from a session that has
 * been signed out or revoked. The browser holding that session receives
 * 401 SESSION_REVOKED and signs itself out.
 *
 * Storage: admins/{uid}/sessions/{sessionId}   (admin SDK only — no client rules)
 *   status          'active' | 'signed_out' | 'revoked'
 *   device          { browser, os, type, model?, label }
 *   ip, location    { city, region, country }   — from Vercel's geo headers
 *   createdAt, lastActiveAt, endedAt, endedBy { sessionId, label }
 *
 * "Sign out everywhere" also revokes the Firebase refresh tokens. That is
 * enforced by comparing the ID token's auth_time with the user's
 * tokensValidAfterTime, so it holds even for a caller that omits the header.
 */

import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { auth, db } from './firebase-admin';

export const SESSION_HEADER = 'x-admin-session';
export const SESSION_REVOKED_CODE = 'SESSION_REVOKED';

/** How many past sessions to keep per admin; older ended ones are pruned. */
const MAX_SESSIONS_KEPT = 100;

export type SessionStatus = 'active' | 'signed_out' | 'revoked';
export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface DeviceInfo {
    browser: string;
    os: string;
    type: DeviceType;
    model?: string;
    label: string;
}

export interface SessionLocation {
    city?: string;
    region?: string;
    country?: string;
}

/** Extra detail the browser volunteers (User-Agent Client Hints etc.). */
export interface ClientHints {
    platform?: string;
    platformVersion?: string;
    model?: string;
    mobile?: boolean;
    brands?: string[];
    timezone?: string;
    screen?: string;
    language?: string;
}

/** Shape returned to the dashboard. Timestamps are epoch millis. */
export interface SessionView {
    id: string;
    status: SessionStatus;
    current: boolean;
    device: DeviceInfo;
    ip: string | null;
    location: SessionLocation;
    timezone: string | null;
    createdAt: number | null;
    lastActiveAt: number | null;
    endedAt: number | null;
    endedBy: { sessionId?: string; label?: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function sessionsCollection(uid: string) {
    return db.collection('admins').doc(uid).collection('sessions');
}

/** Session ids are server-issued UUIDs; reject anything else before touching Firestore. */
export function isValidSessionId(id: unknown): id is string {
    return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

function clip(v: unknown, max = 80): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim().slice(0, max);
    return s || undefined;
}

/** Firestore rejects `undefined`; drop those keys (recursively for plain objects). */
function compact<T extends Record<string, unknown>>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype) {
            out[k] = compact(v as Record<string, unknown>);
        } else {
            out[k] = v;
        }
    }
    return out as T;
}

function millis(v: unknown): number | null {
    if (v instanceof Timestamp) return v.toMillis();
    if (v && typeof v === 'object' && 'toMillis' in v && typeof (v as Timestamp).toMillis === 'function') {
        return (v as Timestamp).toMillis();
    }
    return null;
}

export function sanitizeHints(raw: unknown): ClientHints {
    if (!raw || typeof raw !== 'object') return {};
    const r = raw as Record<string, unknown>;
    return {
        platform: clip(r.platform, 40),
        platformVersion: clip(r.platformVersion, 20),
        model: clip(r.model, 60),
        mobile: typeof r.mobile === 'boolean' ? r.mobile : undefined,
        brands: Array.isArray(r.brands)
            ? r.brands.map((b) => clip(b, 40)).filter((b): b is string => !!b).slice(0, 6)
            : undefined,
        timezone: clip(r.timezone, 60),
        screen: clip(r.screen, 20),
        language: clip(r.language, 20),
    };
}

// ── Device + location ─────────────────────────────────────────────────────

/** Turn a User-Agent (plus optional client hints) into "Chrome on Windows 11". */
export function describeDevice(ua: string, hints: ClientHints = {}): DeviceInfo {
    const u = ua || '';

    let browser = 'Unknown browser';
    if (/Edg(A|iOS)?\//.test(u)) browser = 'Edge';
    else if (/OPR\/|Opera/.test(u)) browser = 'Opera';
    else if (/SamsungBrowser\//.test(u)) browser = 'Samsung Internet';
    else if (/FxiOS\/|Firefox\//.test(u)) browser = 'Firefox';
    else if (/CriOS\/|Chrome\//.test(u)) browser = 'Chrome';
    else if (/Version\/[\d.]+.*Safari\//.test(u)) browser = 'Safari';
    if (hints.brands?.some((b) => /brave/i.test(b))) browser = 'Brave';

    const hintMajor = hints.platformVersion ? parseInt(hints.platformVersion.split('.')[0], 10) : NaN;

    let os = 'Unknown OS';
    let m: RegExpMatchArray | null;
    if (/iPad/.test(u)) {
        m = u.match(/OS (\d+)[_.](\d+)/);
        os = m ? `iPadOS ${m[1]}` : 'iPadOS';
    } else if (/iPhone|iPod/.test(u)) {
        m = u.match(/OS (\d+)[_.](\d+)/);
        os = m ? `iOS ${m[1]}` : 'iOS';
    } else if (/Android/.test(u)) {
        m = u.match(/Android (\d+(?:\.\d+)?)/);
        const v = !Number.isNaN(hintMajor) && hints.platform === 'Android' ? String(hintMajor) : m?.[1];
        os = v ? `Android ${v}` : 'Android';
    } else if (/Windows NT/.test(u) || hints.platform === 'Windows') {
        // Browsers freeze the UA at "Windows NT 10.0"; client hints tell 11 apart (platformVersion ≥ 13).
        os = !Number.isNaN(hintMajor) && hints.platform === 'Windows'
            ? (hintMajor >= 13 ? 'Windows 11' : 'Windows 10')
            : 'Windows';
    } else if (/CrOS/.test(u)) {
        os = 'ChromeOS';
    } else if (/Mac OS X|Macintosh/.test(u)) {
        os = 'macOS';
    } else if (/Linux/.test(u)) {
        os = 'Linux';
    }

    let type: DeviceType = 'unknown';
    if (/iPad|Tablet/.test(u) || (/Android/.test(u) && !/Mobile/.test(u))) type = 'tablet';
    else if (hints.mobile === true || /Mobi|iPhone|iPod|Android/.test(u)) type = 'mobile';
    else if (u) type = 'desktop';

    // Android model: client hints are exact; the UA is often reduced to "K".
    let model = hints.model;
    if (!model && /Android/.test(u)) {
        m = u.match(/Android [\d.]+; ([^;)]+?)(?: Build\/|\)|;)/);
        if (m && m[1] && m[1].trim() !== 'K') model = m[1].trim();
    }
    if (!model && /iPhone/.test(u)) model = 'iPhone';
    if (!model && /iPad/.test(u)) model = 'iPad';
    model = clip(model, 60);

    const label = `${browser} on ${os}` + (model && !os.toLowerCase().startsWith(model.toLowerCase()) ? ` · ${model}` : '');
    return compact({ browser, os, type, model, label });
}

function decodeHeader(v: string | null): string | undefined {
    if (!v) return undefined;
    try {
        return clip(decodeURIComponent(v), 80);
    } catch {
        return clip(v, 80);
    }
}

/** IP, approximate location and UA for the request. Location needs Vercel's geo headers. */
export function requestMeta(request: Request) {
    const h = request.headers;
    const ip = clip(h.get('x-forwarded-for')?.split(',')[0], 64) || clip(h.get('x-real-ip'), 64);
    const location: SessionLocation = compact({
        city: decodeHeader(h.get('x-vercel-ip-city')),
        region: decodeHeader(h.get('x-vercel-ip-country-region')),
        country: decodeHeader(h.get('x-vercel-ip-country')),
    });
    const userAgent = (h.get('user-agent') || '').slice(0, 400);
    return { ip, location, userAgent };
}

// ── Status lookups used by the API guard ──────────────────────────────────

const STATUS_TTL = 10_000;
const statusCache = new Map<string, { status: SessionStatus | 'missing'; expiresAt: number }>();

export async function getSessionStatus(uid: string, sessionId: string): Promise<SessionStatus | 'missing'> {
    if (!isValidSessionId(sessionId)) return 'missing';
    const key = `${uid}:${sessionId}`;
    const now = Date.now();
    const hit = statusCache.get(key);
    if (hit && now < hit.expiresAt) return hit.status;

    const snap = await sessionsCollection(uid).doc(sessionId).get();
    const status: SessionStatus | 'missing' = snap.exists
        ? ((snap.data()?.status as SessionStatus) || 'active')
        : 'missing';
    statusCache.set(key, { status, expiresAt: now + STATUS_TTL });
    if (statusCache.size > 2000) statusCache.clear();
    return status;
}

function forgetSessionStatus(uid: string, sessionId?: string) {
    if (sessionId) statusCache.delete(`${uid}:${sessionId}`);
    else for (const k of statusCache.keys()) if (k.startsWith(`${uid}:`)) statusCache.delete(k);
}

const validAfterCache = new Map<string, { value: number; expiresAt: number }>();

/** Epoch ms before which this user's sign-ins are void (set by "sign out everywhere"). */
async function tokensValidAfter(uid: string): Promise<number> {
    const now = Date.now();
    const hit = validAfterCache.get(uid);
    if (hit && now < hit.expiresAt) return hit.value;
    const user = await auth.getUser(uid);
    const value = user.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) || 0 : 0;
    validAfterCache.set(uid, { value, expiresAt: now + 60_000 });
    return value;
}

/**
 * Should this already-authorised admin call be refused because its session
 * was ended? Fails open on lookup errors (logged) so a Firestore hiccup can't
 * lock every admin out of the panel.
 */
export async function isCallerSessionRevoked(
    request: Request,
    caller: { uid?: string; authTime?: number },
    options: { skipSessionCheck?: boolean } = {}
): Promise<boolean> {
    if (!caller.uid || caller.uid === 'dev-user') return false;
    try {
        // 1. "Sign out everywhere" — independent of the session header.
        if (caller.authTime) {
            const validAfter = await tokensValidAfter(caller.uid);
            if (validAfter && caller.authTime * 1000 < validAfter - 1000) return true;
        }

        if (options.skipSessionCheck) return false;

        // 2. Per-device sign-out.
        const sessionId = request.headers.get(SESSION_HEADER);
        if (!sessionId) return false; // scripts / tabs opened before this shipped
        const status = await getSessionStatus(caller.uid, sessionId);
        return status !== 'active';
    } catch (err) {
        console.error('[Admin Sessions] session check failed (allowing):', err instanceof Error ? err.message : err);
        return false;
    }
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function createSession(uid: string, email: string | undefined, request: Request, hints: ClientHints) {
    const id = randomUUID();
    const meta = requestMeta(request);
    const now = Timestamp.now();

    await sessionsCollection(uid).doc(id).set(compact({
        uid,
        email,
        status: 'active' as SessionStatus,
        device: describeDevice(meta.userAgent, hints),
        userAgent: meta.userAgent,
        ip: meta.ip,
        location: meta.location,
        timezone: hints.timezone,
        screen: hints.screen,
        language: hints.language,
        createdAt: now,
        lastActiveAt: now,
    }));

    pruneOldSessions(uid).catch((err) =>
        console.warn('[Admin Sessions] prune failed:', err instanceof Error ? err.message : err)
    );
    return id;
}

async function pruneOldSessions(uid: string) {
    const old = await sessionsCollection(uid)
        .orderBy('createdAt', 'desc')
        .offset(MAX_SESSIONS_KEPT)
        .limit(200)
        .get();
    const ended = old.docs.filter((d) => d.data().status !== 'active');
    if (ended.length === 0) return;
    const batch = db.batch();
    ended.forEach((d) => batch.delete(d.ref));
    await batch.commit();
}

/** Bump lastActiveAt (and IP/location, which change as people move networks). */
export async function touchSession(uid: string, sessionId: string, request: Request): Promise<boolean> {
    if (!isValidSessionId(sessionId)) return false;
    const meta = requestMeta(request);
    try {
        await sessionsCollection(uid).doc(sessionId).update(compact({
            lastActiveAt: Timestamp.now(),
            ip: meta.ip,
            location: Object.keys(meta.location).length ? meta.location : undefined,
        }));
        return true;
    } catch {
        return false; // NOT_FOUND
    }
}

async function labelOf(uid: string, sessionId: string | null): Promise<{ sessionId?: string; label?: string } | null> {
    if (!sessionId || !isValidSessionId(sessionId)) return null;
    try {
        const snap = await sessionsCollection(uid).doc(sessionId).get();
        return compact({ sessionId, label: (snap.data()?.device as DeviceInfo | undefined)?.label });
    } catch {
        return { sessionId };
    }
}

/** End one session. Returns false if it doesn't exist or was already ended. */
export async function endSession(
    uid: string,
    sessionId: string,
    status: Exclude<SessionStatus, 'active'>,
    endedBySessionId: string | null = null
): Promise<boolean> {
    if (!isValidSessionId(sessionId)) return false;
    const ref = sessionsCollection(uid).doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.status !== 'active') return false;

    const endedBy = status === 'revoked' ? await labelOf(uid, endedBySessionId) : null;
    await ref.update(compact({ status, endedAt: Timestamp.now(), endedBy: endedBy ?? undefined }));
    forgetSessionStatus(uid, sessionId);
    return true;
}

/**
 * Revoke every active session except `keepSessionId` (pass null to revoke all).
 * `endedBySessionId` is recorded as who did it. Returns how many were ended.
 */
export async function revokeOtherSessions(
    uid: string,
    keepSessionId: string | null,
    endedBySessionId: string | null = keepSessionId
): Promise<number> {
    const active = await sessionsCollection(uid).where('status', '==', 'active').get();
    const targets = active.docs.filter((d) => d.id !== keepSessionId);
    if (targets.length === 0) return 0;

    const endedBy = await labelOf(uid, endedBySessionId);
    const now = Timestamp.now();
    const batch = db.batch();
    targets.forEach((d) => batch.update(d.ref, compact({ status: 'revoked', endedAt: now, endedBy: endedBy ?? undefined })));
    await batch.commit();
    forgetSessionStatus(uid);
    return targets.length;
}

/**
 * Hard sign-out on every device, this one included: revokes Firebase refresh
 * tokens (so even a copied token stops working) and marks all sessions revoked.
 */
export async function signOutEverywhere(uid: string, bySessionId: string | null): Promise<number> {
    await auth.revokeRefreshTokens(uid);
    validAfterCache.delete(uid);
    return revokeOtherSessions(uid, null, bySessionId);
}

export async function listSessions(uid: string, currentSessionId: string | null, limit = 50): Promise<SessionView[]> {
    const snap = await sessionsCollection(uid).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => {
        const x = d.data();
        const endedBy = x.endedBy as SessionView['endedBy'] | undefined;
        return {
            id: d.id,
            status: (x.status as SessionStatus) || 'active',
            current: d.id === currentSessionId,
            device: (x.device as DeviceInfo) || { browser: 'Unknown browser', os: 'Unknown OS', type: 'unknown', label: 'Unknown device' },
            ip: (x.ip as string) || null,
            location: (x.location as SessionLocation) || {},
            timezone: (x.timezone as string) || null,
            createdAt: millis(x.createdAt),
            lastActiveAt: millis(x.lastActiveAt),
            endedAt: millis(x.endedAt),
            endedBy: endedBy ?? null,
        };
    });
}
