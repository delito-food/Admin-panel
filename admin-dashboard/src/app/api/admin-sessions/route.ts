import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guard';
import { checkRateLimit, rateLimitedResponse, type AdminResult } from '@/lib/api-auth';
import { createSession, listSessions, sanitizeHints, isValidSessionId, SESSION_HEADER } from '@/lib/admin-sessions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin-sessions
 * The caller's own sign-ins (newest first): active devices and recent history.
 */
async function handleGET(request: Request, _context: unknown, caller: AdminResult) {
    try {
        const header = request.headers.get(SESSION_HEADER);
        const currentSessionId = isValidSessionId(header) ? header : null;
        const sessions = await listSessions(caller.uid!, currentSessionId);
        return NextResponse.json({ success: true, data: { sessions, currentSessionId } });
    } catch (error) {
        console.error('[admin-sessions] list failed:', error);
        return NextResponse.json({ success: false, error: 'Could not load login activity' }, { status: 500 });
    }
}

/**
 * POST /api/admin-sessions   body: { hints?: ClientHints }
 * Register this browser as a new signed-in device. Returns { sessionId }.
 * Exempt from the per-session check — it is how a session comes to exist.
 */
async function handlePOST(request: Request, _context: unknown, caller: AdminResult) {
    const limit = checkRateLimit(`admin-session-register:${caller.uid}`, 30, 60 * 60_000);
    if (!limit.allowed) return rateLimitedResponse();

    try {
        let body: { hints?: unknown } = {};
        try {
            body = await request.json();
        } catch {
            // No body — hints are optional.
        }
        const sessionId = await createSession(caller.uid!, caller.email, request, sanitizeHints(body.hints));
        return NextResponse.json({ success: true, data: { sessionId } });
    } catch (error) {
        console.error('[admin-sessions] register failed:', error);
        return NextResponse.json({ success: false, error: 'Could not register session' }, { status: 500 });
    }
}

export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST, { skipSessionCheck: true });
