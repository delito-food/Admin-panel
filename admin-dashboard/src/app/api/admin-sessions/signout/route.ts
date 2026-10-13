import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import { endSession, SESSION_HEADER } from '@/lib/admin-sessions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin-sessions/signout
 * Mark this device's session as signed out (called by the normal Sign out button).
 */
async function handlePOST(request: Request, _context: unknown, caller: AdminResult) {
    const sessionId = request.headers.get(SESSION_HEADER);
    if (!sessionId) return NextResponse.json({ success: true, data: { ended: false } });
    try {
        const ended = await endSession(caller.uid!, sessionId, 'signed_out');
        return NextResponse.json({ success: true, data: { ended } });
    } catch (error) {
        console.error('[admin-sessions] signout failed:', error);
        return NextResponse.json({ success: false, error: 'Could not end session' }, { status: 500 });
    }
}

export const POST = withAdmin(handlePOST, { skipSessionCheck: true });
