import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware — runs before every request.
 *
 * Security rules:
 * 1. All /api/* routes require Authorization: Bearer <token> header
 *    (except in development with SKIP_API_AUTH=true)
 * 2. Unauthenticated page access redirects to /login (handled client-side by DashboardLayout)
 *
 * Note: Full token verification happens in the API route handlers via verifyApiAuth().
 * This middleware provides a fast first-pass check (presence of the header).
 */
export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Only protect /api/* routes
    if (pathname.startsWith('/api/')) {
        // Exempt routes that don't use Bearer tokens:
        // - Razorpay webhooks (authenticated via webhook signature, not Bearer)
        // - Payment create-order & verify (called from Android app without admin token)
        const publicRoutes = [
            '/api/webhooks/razorpay',
            '/api/payments/create-order',
            '/api/payments/verify',
        ];
        if (publicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))) {
            return NextResponse.next();
        }

        // Skip auth header check in development if SKIP_API_AUTH is set
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

        // Token is present — let the route handler verify it fully
        return NextResponse.next();
    }

    return NextResponse.next();
}

// Run middleware only on API routes
export const config = {
    matcher: '/api/:path*',
};

