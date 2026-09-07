import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guard';

// Menu verification has been moved to /api/menu-management
// These endpoints redirect for backward compatibility
async function handleGET(request: Request) {
    const url = new URL(request.url);
    const newUrl = new URL('/api/menu-management', url.origin);
    newUrl.search = url.search;
    return NextResponse.redirect(newUrl, 308);
}

async function handlePATCH(request: Request) {
    const url = new URL(request.url);
    const newUrl = new URL('/api/menu-management', url.origin);
    return NextResponse.redirect(newUrl, 308);
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
export const PATCH = withAdmin(handlePATCH);
