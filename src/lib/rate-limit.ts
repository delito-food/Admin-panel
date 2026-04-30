/**
 * Simple in-memory sliding-window rate limiter for API routes.
 * For production scale, consider Upstash Redis or @vercel/edge rate limiting.
 */

interface RateLimitEntry {
    timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Clean up old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        entry.timestamps = entry.timestamps.filter(t => now - t < 120_000);
        if (entry.timestamps.length === 0) store.delete(key);
    }
}, 300_000);

/**
 * Check if a request should be rate-limited.
 * @param identifier - Unique key (e.g., IP address or user ID)
 * @param maxRequests - Maximum number of requests allowed in the window
 * @param windowMs - Time window in milliseconds (default: 60 seconds)
 * @returns { limited: boolean, remaining: number, retryAfterMs: number }
 */
export function rateLimit(
    identifier: string,
    maxRequests: number = 10,
    windowMs: number = 60_000
): { limited: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    let entry = store.get(identifier);

    if (!entry) {
        entry = { timestamps: [] };
        store.set(identifier, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
        const oldestInWindow = entry.timestamps[0];
        const retryAfterMs = windowMs - (now - oldestInWindow);
        return { limited: true, remaining: 0, retryAfterMs };
    }

    entry.timestamps.push(now);
    return {
        limited: false,
        remaining: maxRequests - entry.timestamps.length,
        retryAfterMs: 0,
    };
}

/**
 * Extract client IP from request headers (works on Vercel)
 */
export function getClientIp(request: Request): string {
    return (
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'
    );
}

