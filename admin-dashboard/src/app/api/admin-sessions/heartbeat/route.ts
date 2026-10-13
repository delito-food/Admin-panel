import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import { touchSession, SESSION_HEADER } from '@/lib/admin-sessions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin-sessions/heartbeat
 * Keeps "last active" fresh for this device. The guard has already refused
 * the call (401 SESSION_REVOKED) if this device was signed out remotely.
 */
async function handlePOST(request: Request, _context: unknown, caller: AdminResult) {
    const sessionId = request.headers.get(SESSION_HEADER);
    if (!sessionId) {
        return NextResponse.json({ success: false, error: 'No session', code: 'SESSION_MISSING' }, { status: 400 });
    }
    const ok = await touchSession(caller.uid!, sessionId, request);
    if (!ok) {
        return NextResponse.json({ success: false, error: 'Unknown session', code: 'SESSION_MISSING' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
}

export const POST = withAdmin(handlePOST);
