import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware — runs before every request, on the Edge runtime.
 *
 * This is a CHEAP PRE-CHECK ONLY. The Edge runtime cannot run firebase-admin,
 * so a token cannot be verified here. Real verification and admin
 * authorisation happen in the Node runtime, in the route itself, via the
 * `withAdmin()` wrapper in lib/api-guard.ts — every /api route is wrapped.
 *
 * Do not treat a request that reaches a route handler as authenticated. Until
 * October 2026 that was exactly the mistake: middleware checked only that an
 * Authorization header existed, and almost no route verified it, so
 * `Authorization: Bearer anything` reached Firestore with admin credentials.
 */
export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (!pathname.startsWith('/api/')) {
        return NextResponse.next();
    }

    // Routes that legitimately do not carry an admin bearer token.
    //
    //   webhooks/razorpay      — authenticated by webhook signature
    //   payments/create-order  — called by the Android customer app
    //   payments/verify        — called by the Android customer app
    //
    // These three are NOT wrapped in withAdmin(). They authenticate by their
    // own means and must keep doing so; see PaymentManager.kt for the callers.
    const publicRoutes = [
        '/api/webhooks/razorpay',
        '/api/payments/create-order',
        '/api/payments/verify',
    ];
    if (publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))) {
        return NextResponse.next();
    }

    // Development convenience, gated on both a development build and an
    // explicit opt-in. NODE_ENV is always 'production' on Vercel, so this
    // cannot be reached from a deployment.
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_API_AUTH === 'true') {
        return NextResponse.next();
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json(
            { success: false, error: 'Unauthorized — missing authentication token' },
            { status: 401 }
        );
    }

    // Header present. The route handler verifies it for real.
    return NextResponse.next();
}

export const config = {
    matcher: '/api/:path*',
};
