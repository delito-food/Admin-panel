/**
 * Browser half of admin login sessions (server half: lib/admin-sessions.ts).
 *
 * Each sign-in registers a session and keeps its id in localStorage. Every
 * /api call carries it as X-Admin-Session (see patchGlobalFetch), so the
 * server can refuse a device that was signed out from Login activity. When
 * that happens the response is 401 { code: "SESSION_REVOKED" }; we broadcast
 * SESSION_REVOKED_EVENT and the AuthProvider signs this browser out.
 */

import { auth } from '@/lib/firebase';

export const SESSION_HEADER = 'X-Admin-Session';
export const SESSION_REVOKED_EVENT = 'sangyaan:session-revoked';
export const HEARTBEAT_MS = 2 * 60_000;

const SESSION_KEY = 'sangyaan.adminSessionId';
const REASON_KEY = 'sangyaan.signOutReason';

// ── Storage (wrapped — private windows can throw) ─────────────────────────

export function getSessionId(): string | null {
    try {
        return window.localStorage.getItem(SESSION_KEY);
    } catch {
        return null;
    }
}

function setSessionId(id: string) {
    try {
        window.localStorage.setItem(SESSION_KEY, id);
    } catch {
        // Without storage the device simply isn't tracked — sign-in still works.
    }
}

export function clearSessionId() {
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch {
        // ignore
    }
}

/** Remember why we signed out, so the login page can explain it. */
export function rememberSignOutReason(reason: 'revoked') {
    try {
        window.sessionStorage.setItem(REASON_KEY, reason);
    } catch {
        // ignore
    }
}

/** Read-and-clear the reason left by rememberSignOutReason. */
export function takeSignOutReason(): string | null {
    try {
        const r = window.sessionStorage.getItem(REASON_KEY);
        if (r) window.sessionStorage.removeItem(REASON_KEY);
        return r;
    } catch {
        return null;
    }
}

// ── Revocation signal ─────────────────────────────────────────────────────

/** Inspect a 401 and, if it says this session was revoked, broadcast it. */
export function notifyIfSessionRevoked(res: Response) {
    if (res.status !== 401) return;
    res.clone()
        .json()
        .then((body) => {
            if (body?.code === 'SESSION_REVOKED') {
                window.dispatchEvent(new Event(SESSION_REVOKED_EVENT));
            }
        })
        .catch(() => {
            // Not JSON — not ours.
        });
}

async function sessionFetch(url: string, init: RequestInit = {}, withSession = true, timeoutMs = 10_000) {
    const headers = new Headers(init.headers);
    const user = auth?.currentUser;
    if (!user) throw new Error('Not signed in');
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    const sid = withSession ? getSessionId() : null;
    if (sid) headers.set(SESSION_HEADER, sid);
    else headers.delete(SESSION_HEADER);

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
        notifyIfSessionRevoked(res);
        return res;
    } finally {
        window.clearTimeout(timer);
    }
}

// ── Device description (User-Agent Client Hints where supported) ──────────

interface UADataLike {
    mobile?: boolean;
    platform?: string;
    brands?: { brand: string }[];
    getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

async function collectHints(): Promise<Record<string, unknown>> {
    const hints: Record<string, unknown> = {
        language: navigator.language,
        screen: `${window.screen.width}x${window.screen.height}`,
    };
    try {
        hints.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        // ignore
    }
    const uad = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
    if (uad) {
        hints.mobile = uad.mobile;
        hints.platform = uad.platform;
        hints.brands = uad.brands?.map((b) => b.brand);
        try {
            const hv = await uad.getHighEntropyValues?.(['platformVersion', 'model']);
            if (hv) {
                hints.platformVersion = hv.platformVersion;
                hints.model = hv.model;
            }
        } catch {
            // Permission policy can block high-entropy hints — the UA is enough.
        }
    }
    return hints;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

async function registerSession(): Promise<void> {
    clearSessionId();
    const res = await sessionFetch(
        '/api/admin-sessions',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hints: await collectHints() }),
        },
        false
    );
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    const id = body?.data?.sessionId;
    if (typeof id === 'string') setSessionId(id);
}

let inflight: Promise<void> | null = null;

/**
 * Register this device if it has no session yet, otherwise heartbeat it.
 * A revoked session comes back 401 SESSION_REVOKED → this device signs out.
 */
export function syncSession(): Promise<void> {
    if (!inflight) {
        inflight = (async () => {
            try {
                if (!getSessionId()) {
                    await registerSession();
                    return;
                }
                const res = await sessionFetch('/api/admin-sessions/heartbeat', { method: 'POST' });
                if (res.status === 400 || res.status === 404) {
                    // Server has no record of this id (e.g. storage restored) — start a fresh one.
                    await registerSession();
                }
            } catch {
                // Offline or token refresh failed — try again on the next beat.
            } finally {
                inflight = null;
            }
        })();
    }
    return inflight;
}

/** Mark this device as signed out before the normal sign-out. Never blocks for long. */
export async function endCurrentSession(): Promise<void> {
    if (!getSessionId()) return;
    try {
        await sessionFetch('/api/admin-sessions/signout', { method: 'POST' }, true, 2500);
    } catch {
        // Sign-out must still happen even if this fails.
    }
}
