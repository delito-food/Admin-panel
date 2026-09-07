/**
 * Route guard for /api/* handlers.
 *
 * middleware.ts runs on the Edge runtime, where firebase-admin cannot run, so
 * it can only check that an Authorization header is *present*. Real
 * verification has to happen in the Node runtime — that is, here, in the route
 * itself. Wrapping is how every route gets it without 57 copies of the same
 * six lines:
 *
 *     async function handleGET(request: Request) { ... }
 *     export const GET = withAdmin(handleGET);
 *
 * The wrapper is signature-transparent. Next's second argument (the `{ params }`
 * context for dynamic segments) is passed straight through, and the verified
 * caller arrives as a third argument for handlers that want to record who
 * issued a document — handlers that don't care simply omit it.
 */

import { requireAdmin, unauthorizedResponse, forbiddenResponse, type AdminResult } from './api-auth';

type GuardedHandler<Req extends Request, Ctx> = (
    request: Req,
    context: Ctx,
    auth: AdminResult
) => Promise<Response> | Response;

/**
 * Require a verified Firebase ID token belonging to an admin.
 *
 * 401 — token missing, malformed, or not verifiable against this project.
 * 403 — token is valid, but the user is not an admin.
 */
export function withAdmin<Req extends Request = Request, Ctx = unknown>(
    handler: GuardedHandler<Req, Ctx>
) {
    return async function guarded(request: Req, context: Ctx): Promise<Response> {
        const result = await requireAdmin(request);

        if (!result.authenticated) {
            return unauthorizedResponse(result.error);
        }
        if (!result.isAdmin) {
            return forbiddenResponse();
        }

        return handler(request, context, result);
    };
}
