/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Credit notes — GSTR-1 Table 9B documents that reverse an issued tax invoice.
 *
 * GET  /api/credit-notes?orderId=…&from=YYYY-MM-DD&to=YYYY-MM-DD
 * POST /api/credit-notes  { orderId, amount, reasonCode, reason?, refundId? }
 *
 * Raising one is the only way to undo an invoice. Invoices are immutable, so a
 * cancellation or refund after invoicing does not edit the original — it issues
 * a new document pointing at it, which is what reverses the output tax.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { checkRateLimit, rateLimitedResponse, type AdminResult } from '@/lib/api-auth';
import {
    CREDIT_NOTES_COLLECTION,
    CREDIT_NOTE_REASONS,
    creditedTotalFor,
    issueCreditNote,
    type CreditNoteReasonCode,
} from '@/lib/credit-note';
import { istDayBoundsFromString, toDate } from '@/lib/fiscal';

const VALID_REASONS = Object.keys(CREDIT_NOTE_REASONS) as CreditNoteReasonCode[];

async function handleGET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orderId = searchParams.get('orderId');
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        // A single order: return its notes plus how much credit remains.
        if (orderId) {
            const snap = await db.collection(CREDIT_NOTES_COLLECTION).where('orderId', '==', orderId).get();
            const notes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const position = await creditedTotalFor(orderId);
            return NextResponse.json({ success: true, data: { notes, position, reasons: CREDIT_NOTE_REASONS } });
        }

        const snap = await db.collection(CREDIT_NOTES_COLLECTION).get();
        let notes = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);

        // Filtered on IST calendar days, like every other period in the system.
        if (from) {
            const bounds = istDayBoundsFromString(from);
            if (bounds) notes = notes.filter((n) => {
                const d = toDate(n.creditNoteDate);
                return d ? d >= bounds.start : false;
            });
        }
        if (to) {
            const bounds = istDayBoundsFromString(to);
            if (bounds) notes = notes.filter((n) => {
                const d = toDate(n.creditNoteDate);
                return d ? d <= bounds.end : false;
            });
        }

        notes.sort((a, b) => (b.sequence || 0) - (a.sequence || 0));

        const r2 = (n: number) => Math.round(n * 100) / 100;
        const totals = notes.reduce(
            (acc, n) => ({
                count: acc.count + 1,
                taxableValue: r2(acc.taxableValue + (n.totals?.taxableValue || 0)),
                totalTax: r2(acc.totalTax + (n.totals?.totalTax || 0)),
                creditValue: r2(acc.creditValue + (n.totals?.creditValue || 0)),
            }),
            { count: 0, taxableValue: 0, totalTax: 0, creditValue: 0 }
        );

        return NextResponse.json({ success: true, data: { notes, totals, reasons: CREDIT_NOTE_REASONS } });
    } catch (error) {
        console.error('Credit note fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to load credit notes' }, { status: 500 });
    }
}

async function handlePOST(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const rl = checkRateLimit(`credit-notes:${auth.uid}`, 20, 60_000);
        if (!rl.allowed) return rateLimitedResponse();

        const body = await request.json();
        const orderId: string = body?.orderId;
        const amount = Number(body?.amount);
        const reasonCode: CreditNoteReasonCode = body?.reasonCode;

        if (!orderId) {
            return NextResponse.json({ success: false, error: 'orderId is required' }, { status: 400 });
        }
        if (!VALID_REASONS.includes(reasonCode)) {
            return NextResponse.json(
                { success: false, error: `reasonCode must be one of: ${VALID_REASONS.join(', ')}` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return NextResponse.json({ success: false, error: 'amount must be greater than zero' }, { status: 400 });
        }

        const result = await issueCreditNote({
            orderId,
            amount,
            reasonCode,
            reason: body?.reason,
            refundId: body?.refundId,
            issuedBy: auth.email || auth.uid || 'unknown',
        });

        if (!result.ok) {
            // 409: the request was well formed but conflicts with the document
            // state — no invoice to reverse, or already fully credited.
            const status = result.code === 'INVALID_AMOUNT' ? 400 : 409;
            return NextResponse.json({ success: false, error: result.reason, code: result.code }, { status });
        }

        return NextResponse.json({
            success: true,
            data: result.creditNote,
            alreadyExisted: result.alreadyExisted,
            message: result.alreadyExisted
                ? `Credit note ${result.creditNote.creditNoteNumber} already existed for this refund.`
                : `Credit note ${result.creditNote.creditNoteNumber} issued against ${result.creditNote.originalInvoiceNumber}.`,
        });
    } catch (error) {
        console.error('Credit note issue error:', error);
        const message = error instanceof Error ? error.message : 'Failed to issue credit note';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
