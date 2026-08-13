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
 * Download a file from an authenticated /api/* endpoint.
 *
 * IMPORTANT: never use window.open()/anchor navigation for /api/* downloads.
 * A browser navigation cannot carry the Authorization header, so middleware.ts
 * rejects it with "Unauthorized — missing authentication token". This helper
 * fetches the file with the bearer token, then saves the resulting blob.
 *
 * The filename from the response's Content-Disposition header wins; otherwise
 * `fallbackName` is used.
 */
export async function downloadAuthenticatedFile(
    url: string,
    fallbackName: string
): Promise<void> {
    const res = await authenticatedFetch(url);

    if (!res.ok) {
        let message = `Download failed (${res.status})`;
        try {
            const body = await res.json();
            if (body?.error) message = body.error;
        } catch {
            // Response wasn't JSON — keep the generic message
        }
        throw new Error(message);
    }

    // Prefer the server-provided filename
    let filename = fallbackName;
    const disposition = res.headers.get('Content-Disposition');
    const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (match?.[1]) filename = decodeURIComponent(match[1]);

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
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
