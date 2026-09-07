import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

async function handleGET() {
    return NextResponse.json({ success: true, message: 'Auto-timeout endpoint placeholder' });
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
