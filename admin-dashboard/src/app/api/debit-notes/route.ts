/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Debit notes — GSTR-1 Table 9B documents that RAISE an issued invoice.
 *
 * GET  /api/debit-notes?target=commission
 * POST /api/debit-notes  { target, invoiceDocId, additionalTaxableValue, reasonCode }
 *
 * Credit notes reverse value; these add it. The Phase 4 restatement needs them
 * because commission was under-invoiced — more was withheld from each
 * restaurant than the monthly invoice documented, so the difference was
 * supplied without a document and its output tax was never declared.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { checkRateLimit, rateLimitedResponse, type AdminResult } from '@/lib/api-auth';
import {
    COMMISSION_DEBIT_NOTES_COLLECTION,
    DEBIT_NOTES_COLLECTION,
    DEBIT_NOTE_REASONS,
    issueDebitNote,
    type DebitNoteReasonCode,
    type DebitNoteTarget,
} from '@/lib/debit-note';
import { istDayBoundsFromString, toDate } from '@/lib/fiscal';

const VALID_REASONS = Object.keys(DEBIT_NOTE_REASONS) as DebitNoteReasonCode[];
const VALID_TARGETS: DebitNoteTarget[] = ['customer', 'commission'];

function collectionFor(target: DebitNoteTarget): string {
    return target === 'commission' ? COMMISSION_DEBIT_NOTES_COLLECTION : DEBIT_NOTES_COLLECTION;
}

async function handleGET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const target = (searchParams.get('target') || 'commission') as DebitNoteTarget;
        if (!VALID_TARGETS.includes(target)) {
            return NextResponse.json(
                { success: false, error: `target must be one of: ${VALID_TARGETS.join(', ')}` },
                { status: 400 }
            );
        }

        const from = searchParams.get('from');
        const to = searchParams.get('to');

        const snap = await db.collection(collectionFor(target)).get();
        let notes = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);

        if (from) {
            const b = istDayBoundsFromString(from);
            if (b) notes = notes.filter((n) => { const d = toDate(n.debitNoteDate); return d ? d >= b.start : false; });
        }
        if (to) {
            const b = istDayBoundsFromString(to);
            if (b) notes = notes.filter((n) => { const d = toDate(n.debitNoteDate); return d ? d <= b.end : false; });
        }

        notes.sort((a, b) => (b.sequence || 0) - (a.sequence || 0));

        const r2 = (n: number) => Math.round(n * 100) / 100;
        const totals = notes.reduce(
            (acc, n) => ({
                count: acc.count + 1,
                taxableValue: r2(acc.taxableValue + (n.totals?.taxableValue || 0)),
                totalTax: r2(acc.totalTax + (n.totals?.totalTax || 0)),
                debitValue: r2(acc.debitValue + (n.totals?.debitValue || 0)),
            }),
            { count: 0, taxableValue: 0, totalTax: 0, debitValue: 0 }
        );

        return NextResponse.json({ success: true, data: { notes, totals, reasons: DEBIT_NOTE_REASONS } });
    } catch (error) {
        console.error('Debit note fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to load debit notes' }, { status: 500 });
    }
}

async function handlePOST(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const rl = checkRateLimit(`debit-notes:${auth.uid}`, 20, 60_000);
        if (!rl.allowed) return rateLimitedResponse();

        const body = await request.json();
        const target: DebitNoteTarget = body?.target || 'commission';
        const invoiceDocId: string = body?.invoiceDocId;
        const additionalTaxableValue = Number(body?.additionalTaxableValue);
        const reasonCode: DebitNoteReasonCode = body?.reasonCode;

        if (!VALID_TARGETS.includes(target)) {
            return NextResponse.json({ success: false, error: `target must be one of: ${VALID_TARGETS.join(', ')}` }, { status: 400 });
        }
        if (!invoiceDocId) {
            return NextResponse.json({ success: false, error: 'invoiceDocId is required' }, { status: 400 });
        }
        if (!VALID_REASONS.includes(reasonCode)) {
            return NextResponse.json({ success: false, error: `reasonCode must be one of: ${VALID_REASONS.join(', ')}` }, { status: 400 });
        }
        if (!Number.isFinite(additionalTaxableValue) || additionalTaxableValue <= 0) {
            return NextResponse.json({ success: false, error: 'additionalTaxableValue must be greater than zero' }, { status: 400 });
        }

        const result = await issueDebitNote({
            target,
            invoiceDocId,
            additionalTaxableValue,
            reasonCode,
            reason: body?.reason,
            interState: body?.interState === true,
            issuedBy: auth.email || auth.uid || 'unknown',
            idempotencyKey: body?.idempotencyKey || invoiceDocId,
        });

        if (!result.ok) {
            const status = result.code === 'INVALID_AMOUNT' ? 400 : 409;
            return NextResponse.json({ success: false, error: result.reason, code: result.code }, { status });
        }

        return NextResponse.json({
            success: true,
            data: result.debitNote,
            alreadyExisted: result.alreadyExisted,
            message: result.alreadyExisted
                ? `Debit note ${result.debitNote.debitNoteNumber} already existed for this invoice.`
                : `Debit note ${result.debitNote.debitNoteNumber} issued against ${result.debitNote.originalInvoiceNumber}.`,
        });
    } catch (error) {
        console.error('Debit note issue error:', error);
        const message = error instanceof Error ? error.message : 'Failed to issue debit note';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
