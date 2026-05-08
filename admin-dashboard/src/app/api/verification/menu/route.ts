import { NextResponse } from 'next/server';

// Menu verification has been moved to /api/menu-management
// These endpoints redirect for backward compatibility
export async function GET(request: Request) {
    const url = new URL(request.url);
    const newUrl = new URL('/api/menu-management', url.origin);
    newUrl.search = url.search;
    return NextResponse.redirect(newUrl, 308);
}

export async function PATCH(request: Request) {
    const url = new URL(request.url);
    const newUrl = new URL('/api/menu-management', url.origin);
    return NextResponse.redirect(newUrl, 308);
}
