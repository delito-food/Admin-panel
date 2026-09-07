/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Debit notes.
 *
 * Section 34(3): where the taxable value or tax charged on an invoice is found
 * to be LESS than what was actually payable, the supplier issues a debit note
 * with its own consecutive serial, referencing the original invoice.
 *
 * Phase 3 built credit notes, which reverse value. This is the other direction,
 * and Phase 4 needs it: commission was under-invoiced. The app withheld
 * `vendorPlatformCut`, computed on the PRE-discount item total, while the
 * monthly commission invoice billed 15% of the POST-discount total. On a ₹500
 * order sold at ₹400 the restaurant was charged ₹75 and invoiced ₹60. The
 * shortfall is value supplied but never documented, so output tax on it was
 * never declared — and the remedy for that is a debit note, not a credit note.
 *
 * As with credit notes, the original invoice is never edited. A new document
 * points at it, and the raised total accumulates on the invoice record.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { counterDocId, formatSerial, SERIES, type SeriesKey } from './invoice-series';
import { financialYearOf } from './fiscal';
import { splitTax, RATE } from './gst';
import { COMMISSION_INVOICES_COLLECTION } from './invoice-constants';

export const DEBIT_NOTES_COLLECTION = 'debitNotes';
export const COMMISSION_DEBIT_NOTES_COLLECTION = 'commissionDebitNotes';

const r2 = (n: number) => Math.round(n * 100) / 100;

export type DebitNoteReasonCode =
    | 'COMMISSION_BASE_CORRECTION'
    | 'PRICE_CORRECTION'
    | 'TAX_SHORTFALL'
    | 'OTHER';

export const DEBIT_NOTE_REASONS: Record<DebitNoteReasonCode, string> = {
    COMMISSION_BASE_CORRECTION:
        'Commission recomputed on the pre-discount item total, matching the amount actually withheld',
    PRICE_CORRECTION: 'Price corrected upward after invoicing',
    TAX_SHORTFALL: 'Tax charged was less than payable',
    OTHER: 'Other',
};

/** Which kind of invoice is being raised. */
export type DebitNoteTarget = 'customer' | 'commission';

interface TargetSpec {
    series: SeriesKey;
    collection: string;
    invoiceCollection: string;
    numberField: string;
    dateField: string;
    ratePercent: number;
}

const TARGETS: Record<DebitNoteTarget, TargetSpec> = {
    customer: {
        series: 'debitNote',
        collection: DEBIT_NOTES_COLLECTION,
        invoiceCollection: 'invoices',
        numberField: 'invoiceNumber',
        dateField: 'invoiceDate',
        ratePercent: RATE.FOOD,
    },
    commission: {
        series: 'commissionDebitNote',
        collection: COMMISSION_DEBIT_NOTES_COLLECTION,
        invoiceCollection: COMMISSION_INVOICES_COLLECTION,
        numberField: 'invoiceNumber',
        dateField: 'issuedAt',
        ratePercent: RATE.COMMISSION,
    },
};

export interface StoredDebitNote {
    schemaVersion: number;
    documentType: 'DEBIT_NOTE';
    target: DebitNoteTarget;

    debitNoteNumber: string;
    series: string;
    sequence: number;
    financialYear: string;
    debitNoteDate: string;
    issuedAt: string;
    issuedBy: string;

    /** Mandatory link back to the document being raised. */
    originalInvoiceNumber: string;
    originalInvoiceDate: string;
    /** Document id of the invoice — order id, or vendorId_YYYY-MM. */
    originalInvoiceId: string;
    vendorId: string;
    billingMonth: string;

    reasonCode: DebitNoteReasonCode;
    reason: string;

    ratePercent: number;
    totals: {
        /** Additional taxable value now being charged. */
        taxableValue: number;
        cgst: number;
        sgst: number;
        igst: number;
        totalTax: number;
        /** taxableValue + totalTax. */
        debitValue: number;
    };
}

/**
 * The figures a debit note will carry, without issuing one.
 *
 * Pure, so the arithmetic is testable and the UI can preview a correction
 * before it is committed.
 */
export function computeDebitNote(
    additionalTaxableValue: number,
    ratePercent: number,
    interState: boolean
): StoredDebitNote['totals'] {
    const taxableValue = r2(additionalTaxableValue);
    const tax = r2((taxableValue * ratePercent) / 100);
    const split = splitTax(tax, interState);
    return {
        taxableValue,
        cgst: split.cgst,
        sgst: split.sgst,
        igst: split.igst,
        totalTax: split.total,
        debitValue: r2(taxableValue + split.total),
    };
}

export interface IssueDebitNoteInput {
    target: DebitNoteTarget;
    /** Order id for a customer invoice, or `vendorId_YYYY-MM` for a commission one. */
    invoiceDocId: string;
    /** The additional taxable value, exclusive of tax. */
    additionalTaxableValue: number;
    reasonCode: DebitNoteReasonCode;
    reason?: string;
    interState?: boolean;
    issuedBy: string;
    /** Makes the write idempotent. Defaults to the invoice id. */
    idempotencyKey?: string;
}

export type IssueDebitNoteResult =
    | { ok: true; debitNote: StoredDebitNote; alreadyExisted: boolean }
    | { ok: false; reason: string; code: 'NO_INVOICE' | 'INVALID_AMOUNT' };

export function debitNoteDocId(target: DebitNoteTarget, key: string): string {
    return `dn_${target}_${key}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * Issue a debit note against an already-issued invoice.
 *
 * Serial, document and the raised total on the invoice all move in one
 * transaction, so a failed write leaves the counter untouched. Idempotent on
 * the key, so a re-run of the Phase 4 restatement cannot double-charge.
 */
export async function issueDebitNote(input: IssueDebitNoteInput): Promise<IssueDebitNoteResult> {
    const spec = TARGETS[input.target];
    if (!Number.isFinite(input.additionalTaxableValue) || input.additionalTaxableValue <= 0) {
        return { ok: false, reason: 'Additional taxable value must be greater than zero', code: 'INVALID_AMOUNT' };
    }

    const invoiceRef = db.collection(spec.invoiceCollection).doc(input.invoiceDocId);
    const noteRef = db.collection(spec.collection)
        .doc(debitNoteDocId(input.target, input.idempotencyKey || input.invoiceDocId));

    const now = new Date();
    const fy = financialYearOf(now);
    const counterRef = db.collection('counters').doc(counterDocId(spec.series, fy.label));

    return db.runTransaction(async (tx) => {
        const existing = await tx.get(noteRef);
        if (existing.exists && existing.data()?.debitNoteNumber) {
            return { ok: true as const, debitNote: existing.data() as StoredDebitNote, alreadyExisted: true };
        }

        const invoiceSnap = await tx.get(invoiceRef);
        if (!invoiceSnap.exists || !invoiceSnap.data()?.[spec.numberField]) {
            return {
                ok: false as const,
                reason: 'No invoice has been issued for this reference, so there is nothing to raise.',
                code: 'NO_INVOICE' as const,
            };
        }
        const invoice = invoiceSnap.data() as any;

        const counterSnap = await tx.get(counterRef);
        let current: number;
        if (!counterSnap.exists) {
            current = 0;
        } else {
            const raw = counterSnap.data()?.lastNumber;
            if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                throw new Error('Debit note counter is unreadable — refusing to allocate a number');
            }
            current = raw;
        }

        const sequence = current + 1;
        const debitNoteNumber = formatSerial(spec.series, fy.label, sequence);
        const issuedAtTs = Timestamp.now();

        const rawDate = invoice[spec.dateField];
        const originalInvoiceDate = typeof rawDate?.toDate === 'function'
            ? rawDate.toDate().toISOString()
            : (typeof rawDate === 'string' ? rawDate : '');

        const note: StoredDebitNote = {
            schemaVersion: 2,
            documentType: 'DEBIT_NOTE',
            target: input.target,
            debitNoteNumber,
            series: SERIES[spec.series].prefix,
            sequence,
            financialYear: fy.label,
            debitNoteDate: issuedAtTs.toDate().toISOString(),
            issuedAt: issuedAtTs.toDate().toISOString(),
            issuedBy: input.issuedBy,

            originalInvoiceNumber: String(invoice[spec.numberField]),
            originalInvoiceDate,
            originalInvoiceId: input.invoiceDocId,
            vendorId: String(invoice.vendorId || ''),
            billingMonth: String(invoice.month || ''),

            reasonCode: input.reasonCode,
            reason: input.reason || DEBIT_NOTE_REASONS[input.reasonCode],

            ratePercent: spec.ratePercent,
            totals: computeDebitNote(input.additionalTaxableValue, spec.ratePercent, input.interState === true),
        };

        tx.set(counterRef, {
            lastNumber: sequence,
            series: SERIES[spec.series].prefix,
            financialYear: fy.label,
            updatedAt: issuedAtTs,
        }, { merge: true });

        tx.set(noteRef, { ...note, issuedAtTs }, { merge: true });

        // Record on the invoice that it has been raised, so the position of any
        // document can be read without scanning the notes collection.
        tx.set(invoiceRef, {
            debitedTotal: r2((Number(invoice.debitedTotal) || 0) + note.totals.debitValue),
            debitNoteNumbers: [...(invoice.debitNoteNumbers || []), debitNoteNumber],
        }, { merge: true });

        return { ok: true as const, debitNote: note, alreadyExisted: false };
    });
}
