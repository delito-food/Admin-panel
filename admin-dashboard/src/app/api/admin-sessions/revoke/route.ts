import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';
import {
    endSession,
    revokeOtherSessions,
    signOutEverywhere,
    isValidSessionId,
    SESSION_HEADER,
} from '@/lib/admin-sessions';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin-sessions/revoke
 *
 *   { sessionId: "…" }        sign out one other device
 *   { scope: "others" }       sign out every device except this one
 *   { scope: "everywhere" }   sign out every device including this one, and
 *                             revoke Firebase refresh tokens (hard kill)
 *
 * A revoked device is refused on its next API call and signs itself out.
 */
async function handlePOST(request: Request, _context: unknown, caller: AdminResult) {
    const uid = caller.uid!;
    const header = request.headers.get(SESSION_HEADER);
    const currentSessionId = isValidSessionId(header) ? header : null;

    let body: { sessionId?: unknown; scope?: unknown } = {};
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    try {
        if (body.scope === 'everywhere') {
            const count = await signOutEverywhere(uid, currentSessionId);
            console.warn(`[admin-sessions] ${caller.email || uid} signed out everywhere (${count} sessions)`);
            return NextResponse.json({ success: true, data: { revoked: count } });
        }

        if (body.scope === 'others') {
            const count = await revokeOtherSessions(uid, currentSessionId);
            return NextResponse.json({ success: true, data: { revoked: count } });
        }

        if (isValidSessionId(body.sessionId)) {
            if (body.sessionId === currentSessionId) {
                return NextResponse.json(
                    { success: false, error: 'That is this device — use Sign out instead.' },
                    { status: 400 }
                );
            }
            const ended = await endSession(uid, body.sessionId, 'revoked', currentSessionId);
            if (!ended) {
                return NextResponse.json(
                    { success: false, error: 'That device is already signed out.' },
                    { status: 404 }
                );
            }
            return NextResponse.json({ success: true, data: { revoked: 1 } });
        }

        return NextResponse.json(
            { success: false, error: 'Pass a sessionId, or scope "others" / "everywhere".' },
            { status: 400 }
        );
    } catch (error) {
        console.error('[admin-sessions] revoke failed:', error);
        return NextResponse.json({ success: false, error: 'Could not sign out the device' }, { status: 500 });
    }
}

export const POST = withAdmin(handlePOST);
