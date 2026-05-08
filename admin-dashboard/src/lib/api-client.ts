/**
 * Authenticated fetch wrapper for API calls.
 * Automatically attaches the Firebase ID token to every request.
 */

import { auth } from '@/lib/firebase';

export async function authenticatedFetch(
    url: string,
    options: RequestInit = {}
): Promise<Response> {
    const headers = new Headers(options.headers);

    // Attach Firebase ID token if user is signed in
    if (auth) {
        try {
            const user = auth.currentUser;
            if (user) {
                const token = await user.getIdToken();
                headers.set('Authorization', `Bearer ${token}`);
            }
        } catch (e) {
            console.warn('[authenticatedFetch] Failed to get ID token:', e);
        }
    }

    return fetch(url, { ...options, headers });
}

/**
 * Monkey-patch global fetch for /api/* calls to auto-attach auth tokens.
 * This ensures ALL fetch('/api/...') calls from any page component are authenticated,
 * even if they don't explicitly use authenticatedFetch.
 *
 * Call this once from your root layout/provider.
 */
let patched = false;
export function patchGlobalFetch() {
    if (patched || typeof window === 'undefined') return;
    patched = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

        // Only patch /api/* calls (our own backend)
        if (url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/')) {
            if (auth?.currentUser) {
                try {
                    const token = await auth.currentUser.getIdToken();
                    const headers = new Headers(init?.headers);
                    if (!headers.has('Authorization')) {
                        headers.set('Authorization', `Bearer ${token}`);
                    }
                    return originalFetch(input, { ...init, headers });
                } catch {
                    // Fall through to original fetch
                }
            }
        }

        return originalFetch(input, init);
    };
}
