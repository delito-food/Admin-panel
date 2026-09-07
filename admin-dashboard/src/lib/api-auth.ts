/**
 * Server-side API authentication and authorisation.
 *
 * Two separate questions, deliberately kept apart:
 *
 *   verifyApiAuth()  — is this a real Firebase ID token from this project?
 *   requireAdmin()   — and does the person behind it administer Delito?
 *
 * Every /api/* route must pass BOTH. Routes get this by being wrapped in
 * `withAdmin()` (see lib/api-guard.ts); middleware.ts only does a cheap
 * header pre-check, because the Edge runtime cannot run firebase-admin.
 */

import { auth, db } from './firebase-admin';

export interface AuthResult {
    authenticated: boolean;
    uid?: string;
    email?: string;
    error?: string;
}

export interface AdminResult extends AuthResult {
    /** True only when the caller is authorised to act as an admin. */
    isAdmin: boolean;
    /** How the caller was authorised — recorded on writes for the audit trail. */
    grantedBy?: 'claim' | 'admins-collection' | 'env-allowlist' | 'bootstrap';
}

/**
 * Development-only escape hatch.
 *
 * Requires BOTH a development build and an explicit opt-in, so it can never be
 * reached from a Vercel deployment (where NODE_ENV is always 'production').
 */
function devBypassEnabled(): boolean {
    return process.env.NODE_ENV === 'development' && process.env.SKIP_API_AUTH === 'true';
}

/**
 * Verify the Firebase ID token from the request's Authorization header.
 * Expected header format: "Bearer <idToken>"
 */
export async function verifyApiAuth(request: Request): Promise<AuthResult> {
    try {
        const authHeader = request.headers.get('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            if (devBypassEnabled()) {
                return { authenticated: true, uid: 'dev-user', email: 'dev@delito.in' };
            }
            return { authenticated: false, error: 'Missing or invalid Authorization header' };
        }

        const idToken = authHeader.slice(7); // Remove "Bearer "

        if (!idToken || idToken.length < 50) {
            return { authenticated: false, error: 'Invalid token format' };
        }

        const decodedToken = await auth.verifyIdToken(idToken);

        return {
            authenticated: true,
            uid: decodedToken.uid,
            email: decodedToken.email,
        };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';

        // A misconfigured server must fail closed in production. Previously this
        // branch let any caller through whenever Firebase Admin failed to start.
        if (msg.includes('Firebase not initialized')) {
            if (devBypassEnabled()) {
                console.warn('[API Auth] Firebase Admin not configured — allowing (development + SKIP_API_AUTH)');
                return { authenticated: true, uid: 'dev-user', email: 'dev@delito.in' };
            }
            console.error('[API Auth] Firebase Admin is not configured — rejecting request');
            return { authenticated: false, error: 'Authentication unavailable' };
        }

        console.error('[API Auth] Token verification failed:', msg);
        return { authenticated: false, error: 'Invalid or expired token' };
    }
}

// ── Admin authorisation ───────────────────────────────────────────────────

/** uid → { isAdmin, grantedBy, expiresAt }. Keeps admin checks off the hot path. */
const adminCache = new Map<string, { isAdmin: boolean; grantedBy?: AdminResult['grantedBy']; expiresAt: number }>();
const ADMIN_CACHE_TTL = 60_000;

/** Cached "is the admins collection empty?" probe — see the bootstrap note below. */
let adminsCollectionEmpty: { value: boolean; expiresAt: number } | null = null;

function envAllowlist(): string[] {
    return (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
}

/**
 * Is this verified user allowed to administer Delito?
 *
 * Checked in order:
 *   1. a custom claim `admin: true` on the token,
 *   2. a document in the `admins` collection (what scripts/create-admin.ts writes),
 *   3. the ADMIN_EMAILS environment allowlist.
 *
 * Bootstrap: if the `admins` collection is completely empty and no allowlist is
 * configured, any verified user is allowed through and the fact is logged loudly.
 * This exists so enabling authorisation can never lock the only admin out of the
 * panel; it closes itself permanently the moment one admin document exists.
 */
async function isAdminUser(uid: string, email?: string): Promise<{ isAdmin: boolean; grantedBy?: AdminResult['grantedBy'] }> {
    const now = Date.now();
    const cached = adminCache.get(uid);
    if (cached && now < cached.expiresAt) {
        return { isAdmin: cached.isAdmin, grantedBy: cached.grantedBy };
    }

    let isAdmin = false;
    let grantedBy: AdminResult['grantedBy'];

    // 1. Custom claim
    try {
        const user = await auth.getUser(uid);
        if (user.customClaims?.admin === true) {
            isAdmin = true;
            grantedBy = 'claim';
        }
    } catch {
        // Fall through to the other checks.
    }

    // 2. admins collection
    if (!isAdmin) {
        try {
            const doc = await db.collection('admins').doc(uid).get();
            if (doc.exists && doc.data()?.disabled !== true) {
                isAdmin = true;
                grantedBy = 'admins-collection';
            }
        } catch (err) {
            console.error('[API Auth] admins lookup failed:', err instanceof Error ? err.message : err);
        }
    }

    // 3. Environment allowlist
    if (!isAdmin && email && envAllowlist().includes(email.toLowerCase())) {
        isAdmin = true;
        grantedBy = 'env-allowlist';
    }

    // 4. Bootstrap — only while no admin has been provisioned anywhere.
    if (!isAdmin && envAllowlist().length === 0) {
        try {
            if (!adminsCollectionEmpty || now >= adminsCollectionEmpty.expiresAt) {
                const probe = await db.collection('admins').limit(1).get();
                adminsCollectionEmpty = { value: probe.empty, expiresAt: now + ADMIN_CACHE_TTL };
            }
            if (adminsCollectionEmpty.value) {
                console.error(
                    `[API Auth] BOOTSTRAP: no admins are provisioned, so verified user ${email || uid} was allowed. ` +
                    'Run scripts/create-admin.ts or set ADMIN_EMAILS to close this.'
                );
                isAdmin = true;
                grantedBy = 'bootstrap';
            }
        } catch (err) {
            console.error('[API Auth] admins probe failed:', err instanceof Error ? err.message : err);
        }
    }

    adminCache.set(uid, { isAdmin, grantedBy, expiresAt: now + ADMIN_CACHE_TTL });
    return { isAdmin, grantedBy };
}

/**
 * Verify the token AND confirm admin authorisation. This is what every
 * /api/* route runs before doing any work.
 */
export async function requireAdmin(request: Request): Promise<AdminResult> {
    const authResult = await verifyApiAuth(request);
    if (!authResult.authenticated || !authResult.uid) {
        return { ...authResult, isAdmin: false };
    }

    if (devBypassEnabled() && authResult.uid === 'dev-user') {
        return { ...authResult, isAdmin: true, grantedBy: 'bootstrap' };
    }

    const { isAdmin, grantedBy } = await isAdminUser(authResult.uid, authResult.email);
    if (!isAdmin) {
        console.warn(`[API Auth] Rejected non-admin ${authResult.email || authResult.uid} for ${new URL(request.url).pathname}`);
    }
    return { ...authResult, isAdmin, grantedBy };
}

/** Drop a user from the admin cache — call after granting or revoking access. */
export function invalidateAdminCache(uid?: string) {
    if (uid) adminCache.delete(uid);
    else adminCache.clear();
    adminsCollectionEmpty = null;
}

// ── Responses ─────────────────────────────────────────────────────────────

/** 401 — we don't know who you are. */
export function unauthorizedResponse(message?: string) {
    return new Response(
        JSON.stringify({ success: false, error: message || 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
}

/** 403 — we know who you are, and you may not do this. */
export function forbiddenResponse(message?: string) {
    return new Response(
        JSON.stringify({ success: false, error: message || 'Admin access required' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
}

/**
 * Simple rate limiter using in-memory store.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
    identifier: string,
    maxRequests: number = 100,
    windowMs: number = 60_000
): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const entry = rateLimitStore.get(identifier);

    if (!entry || now > entry.resetAt) {
        rateLimitStore.set(identifier, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: maxRequests - 1 };
    }

    entry.count++;
    if (entry.count > maxRequests) {
        return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: maxRequests - entry.count };
}

export function rateLimitedResponse() {
    return new Response(
        JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
}

// Cleanup old entries every 5 minutes
if (typeof setInterval !== 'undefined') {
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of rateLimitStore.entries()) {
            if (now > entry.resetAt) {
                rateLimitStore.delete(key);
            }
        }
    }, 300_000);
}
