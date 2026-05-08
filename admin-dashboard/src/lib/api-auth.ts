/**
 * Server-side API authentication helper.
 * Verifies the Firebase ID token from the Authorization header.
 * All API routes should call verifyApiAuth() before processing.
 */

import { auth } from './firebase-admin';

export interface AuthResult {
    authenticated: boolean;
    uid?: string;
    email?: string;
    error?: string;
}

/**
 * Verify the Firebase ID token from the request's Authorization header.
 * Expected header format: "Bearer <idToken>"
 */
export async function verifyApiAuth(request: Request): Promise<AuthResult> {
    try {
        const authHeader = request.headers.get('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            // In development, allow unauthenticated access for easier testing
            if (process.env.NODE_ENV === 'development' && process.env.SKIP_API_AUTH === 'true') {
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
    } catch (error: any) {
        const msg = error?.message || 'Unknown error';
        if (msg.includes('Firebase not initialized')) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('[API Auth] Firebase Admin not configured — allowing in development');
                return { authenticated: true, uid: 'dev-user', email: 'dev@delito.in' };
            }
        }
        console.error('[API Auth] Token verification failed:', msg);
        return { authenticated: false, error: 'Invalid or expired token' };
    }
}

/**
 * Helper: returns a 401 JSON response
 */
export function unauthorizedResponse(message?: string) {
    return new Response(
        JSON.stringify({ success: false, error: message || 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
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
