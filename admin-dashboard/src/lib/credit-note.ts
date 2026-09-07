/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Credit notes.
 *
 * Section 34 of the CGST Act: where a supply is cancelled, refunded, or the
 * value revised downward after a tax invoice has been issued, the supplier
 * issues a credit note carrying its own consecutive serial and referencing the
 * original invoice. That is what reverses the output tax already declared.
 *
 * Before this existed an order could be invoiced and then refunded with nothing
 * to reverse it, so GST was declared and paid on supplies that had been undone.
 *
 * A tax invoice is immutable, so a credit note never edits one. It is a new
 * document that points at the original, and the amount credited is accumulated
 * on the invoice record so the total can never exceed what was invoiced.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { counterDocId, formatSerial, SERIES } from './invoice-series';
import { financialYearOf } from './fiscal';
import { splitTax } from './gst';
import type { Component, InvoiceLine } from './pricing-engine';
import type { Party, StoredInvoice, TaxSummaryRowV2 } from './invoice-document';
import { INVOICE_SCHEMA_VERSION } from './invoice-document';

export const CREDIT_NOTES_COLLECTION = 'creditNotes';
const INVOICES_COLLECTION = 'invoices';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Why the supply was reversed. Printed on the note and filed in GSTR-1 9B. */
export type CreditNoteReasonCode =
    | 'ORDER_CANCELLED'
    | 'FULL_REFUND'
    | 'PARTIAL_REFUND'
    | 'QUALITY_COMPLAINT'
    | 'PRICE_CORRECTION'
    | 'OTHER';

export const CREDIT_NOTE_REASONS: Record<CreditNoteReasonCode, string> = {
    ORDER_CANCELLED: 'Order cancelled after invoicing',
    FULL_REFUND: 'Full refund issued to customer',
    PARTIAL_REFUND: 'Partial refund issued to customer',
    QUALITY_COMPLAINT: 'Quality complaint resolved by credit',
    PRICE_CORRECTION: 'Price corrected after invoicing',
    OTHER: 'Other',
};

export interface StoredCreditNote {
    schemaVersion: number;
    documentType: 'CREDIT_NOTE';

    creditNoteNumber: string;
    series: string;
    sequence: number;
    financialYear: string;
    creditNoteDate: string;
    issuedAt: string;
    issuedBy: string;

    /** Mandatory link back to the document being reversed. */
    originalInvoiceNumber: string;
    originalInvoiceDate: string;
    orderId: string;

    reasonCode: CreditNoteReasonCode;
    reason: string;
    /** FULL reverses the whole invoice; PARTIAL reverses a share of it. */
    scope: 'FULL' | 'PARTIAL';
    /** Set when the credit note was raised by a refund. */
    refundId: string;

    supplier: Party;
    recipient: Party;
    restaurant: StoredInvoice['restaurant'];
    placeOfSupply: string;
    placeOfSupplyCode: string;
    isInterState: boolean;

    lines: InvoiceLine[];
    components: Component[];
    taxSummary: TaxSummaryRowV2[];
    totals: {
        taxableValue: number;
        cgst: number;
        sgst: number;
        igst: number;
        totalTax: number;
        roundOff: number;
        /** The gross amount credited — what the customer gets back. */
        creditValue: number;
    };
}

/**
 * Scale an invoice's components down to the amount being credited.
 *
 * A partial credit is apportioned across the components in the ratio they
 * appear on the invoice, so the reversal carries the same rate mix as the
 * supply it reverses. Tax is re-split from the scaled figure rather than
 * scaled independently, so the heads always sum back.
 */
export function reverseComponents(
    components: Component[],
    ratio: number,
    interState: boolean
): { components: Component[]; taxableValue: number; cgst: number; sgst: number; igst: number; totalTax: number } {
    const scaled: Component[] = components.map((c) => {
        const taxableValue = r2(c.taxableValue * ratio);
        const tax = r2(c.totalTax * ratio);
        const split = splitTax(tax, interState);
        return {
            ...c,
            grossTaxableValue: r2(c.grossTaxableValue * ratio),
            discountOnTaxableValue: r2(c.discountOnTaxableValue * ratio),
            taxableValue,
            cgst: split.cgst,
            sgst: split.sgst,
            igst: split.igst,
            totalTax: split.total,
            total: r2(taxableValue + split.total),
        };
    });

    const taxableValue = r2(scaled.reduce((s, c) => s + c.taxableValue, 0));
    const cgst = r2(scaled.reduce((s, c) => s + c.cgst, 0));
    const sgst = r2(scaled.reduce((s, c) => s + c.sgst, 0));
    const igst = r2(scaled.reduce((s, c) => s + c.igst, 0));
    return { components: scaled, taxableValue, cgst, sgst, igst, totalTax: r2(cgst + sgst + igst) };
}

/**
 * The figures a credit note will carry, without issuing one.
 *
 * Separated out so the arithmetic can be tested without Firestore, and so
 * the UI can show what a credit will look like before it is committed.
 */
export function computeReversal(
    components: Component[],
    creditValue: number,
    invoiceValue: number,
    interState: boolean
) {
    const ratio = invoiceValue > 0 ? creditValue / invoiceValue : 0;
    const reversed = reverseComponents(components, ratio, interState);
    const roundOff = r2(creditValue - (reversed.taxableValue + reversed.totalTax));
    const scope: 'FULL' | 'PARTIAL' = Math.abs(creditValue - invoiceValue) < 0.01 ? 'FULL' : 'PARTIAL';
    return { ...reversed, roundOff, scope, ratio };
}

export interface IssueCreditNoteInput {
    orderId: string;
    /** Gross amount to credit, inclusive of tax. Capped at what remains. */
    amount: number;
    reasonCode: CreditNoteReasonCode;
    reason?: string;
    /** Refund that caused this. Also the idempotency key — a retried refund
     *  must not produce a second credit note. */
    refundId?: string;
    issuedBy: string;
}

export type IssueCreditNoteResult =
    | { ok: true; creditNote: StoredCreditNote; alreadyExisted: boolean }
    | { ok: false; reason: string; code: 'NO_INVOICE' | 'OVER_CREDIT' | 'INVALID_AMOUNT' | 'LEGACY_INVOICE' };

/** Deterministic document id, so a replayed refund cannot double-credit. */
export function creditNoteDocId(orderId: string, refundId?: string): string {
    return refundId ? `cn_${refundId}` : `cn_${orderId}_${Date.now()}`;
}

/**
 * Issue a credit note against an order's tax invoice.
 *
 * Everything happens in one transaction: the serial is allocated, the note is
 * written, and the credited total on the invoice is advanced together. If any
 * part fails the counter never moved and no partial state remains.
 */
export async function issueCreditNote(input: IssueCreditNoteInput): Promise<IssueCreditNoteResult> {
    const { orderId, amount, reasonCode, reason, refundId, issuedBy } = input;

    if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, reason: 'Credit amount must be greater than zero', code: 'INVALID_AMOUNT' };
    }

    const invoiceRef = db.collection(INVOICES_COLLECTION).doc(orderId);
    const noteRef = db.collection(CREDIT_NOTES_COLLECTION).doc(creditNoteDocId(orderId, refundId));

    const now = new Date();
    const fy = financialYearOf(now);
    const counterRef = db.collection('counters').doc(counterDocId('creditNote', fy.label));

    return db.runTransaction(async (tx) => {
        // Idempotency first — a retried refund returns the note it already made.
        const existingNote = await tx.get(noteRef);
        if (existingNote.exists && existingNote.data()?.creditNoteNumber) {
            return { ok: true as const, creditNote: existingNote.data() as StoredCreditNote, alreadyExisted: true };
        }

        const invoiceSnap = await tx.get(invoiceRef);
        if (!invoiceSnap.exists || !invoiceSnap.data()?.invoiceNumber) {
            return {
                ok: false as const,
                reason: 'No tax invoice has been issued for this order, so there is nothing to reverse.',
                code: 'NO_INVOICE' as const,
            };
        }

        const invoice = invoiceSnap.data() as any;
        if (invoice.schemaVersion !== INVOICE_SCHEMA_VERSION) {
            return {
                ok: false as const,
                reason: 'This order carries a legacy invoice serial with no stored document. Download the invoice once to upgrade the record, then raise the credit note.',
                code: 'LEGACY_INVOICE' as const,
            };
        }

        const stored = invoice as StoredInvoice;
        const invoiceValue = r2(stored.totals.invoiceValue);
        const alreadyCredited = r2(Number(invoice.creditedTotal) || 0);
        const remaining = r2(invoiceValue - alreadyCredited);

        if (remaining <= 0) {
            return {
                ok: false as const,
                reason: `Invoice ${stored.invoiceNumber} has already been fully credited (₹${alreadyCredited.toFixed(2)} of ₹${invoiceValue.toFixed(2)}).`,
                code: 'OVER_CREDIT' as const,
            };
        }
        if (amount > remaining + 0.01) {
            return {
                ok: false as const,
                reason: `Cannot credit ₹${amount.toFixed(2)} — only ₹${remaining.toFixed(2)} of invoice ${stored.invoiceNumber} remains uncredited.`,
                code: 'OVER_CREDIT' as const,
            };
        }

        const creditValue = Math.min(r2(amount), remaining);
        const ratio = invoiceValue > 0 ? creditValue / invoiceValue : 0;
        const scope: 'FULL' | 'PARTIAL' = Math.abs(creditValue - invoiceValue) < 0.01 ? 'FULL' : 'PARTIAL';

        // The credit note's own parts must foot to the amount credited, the
        // same rule the invoice is held to.
        const reversed = computeReversal(stored.components, creditValue, invoiceValue, stored.isInterState);
        const roundOff = reversed.roundOff;

        const counterSnap = await tx.get(counterRef);
        let current: number;
        if (!counterSnap.exists) {
            current = 0;
        } else {
            const raw = counterSnap.data()?.lastNumber;
            if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                throw new Error('Credit note counter is unreadable — refusing to allocate a number');
            }
            current = raw;
        }

        const sequence = current + 1;
        const creditNoteNumber = formatSerial('creditNote', fy.label, sequence);
        const issuedAt = Timestamp.now();

        const note: StoredCreditNote = {
            schemaVersion: INVOICE_SCHEMA_VERSION,
            documentType: 'CREDIT_NOTE',
            creditNoteNumber,
            series: SERIES.creditNote.prefix,
            sequence,
            financialYear: fy.label,
            creditNoteDate: issuedAt.toDate().toISOString(),
            issuedAt: issuedAt.toDate().toISOString(),
            issuedBy,

            originalInvoiceNumber: stored.invoiceNumber,
            originalInvoiceDate: stored.invoiceDate,
            orderId,

            reasonCode,
            reason: reason || CREDIT_NOTE_REASONS[reasonCode],
            scope,
            refundId: refundId || '',

            supplier: stored.supplier,
            recipient: stored.recipient,
            restaurant: stored.restaurant,
            placeOfSupply: stored.placeOfSupply,
            placeOfSupplyCode: stored.placeOfSupplyCode,
            isInterState: stored.isInterState,

            lines: scope === 'FULL'
                ? stored.lines
                : stored.lines.map((l) => ({ ...l, taxableValue: r2(l.taxableValue * ratio), total: r2(l.total * ratio) })),
            components: reversed.components,
            taxSummary: reversed.components.map((c) => ({
                description: c.label,
                hsn: c.hsn,
                ratePercent: c.ratePercent,
                cgstRate: c.igst > 0 ? 0 : c.ratePercent / 2,
                cgst: c.cgst,
                sgstRate: c.igst > 0 ? 0 : c.ratePercent / 2,
                sgst: c.sgst,
                igstRate: c.igst > 0 ? c.ratePercent : 0,
                igst: c.igst,
                taxableValue: c.taxableValue,
                totalTax: c.totalTax,
            })),
            totals: {
                taxableValue: reversed.taxableValue,
                cgst: reversed.cgst,
                sgst: reversed.sgst,
                igst: reversed.igst,
                totalTax: reversed.totalTax,
                roundOff,
                creditValue,
            },
        };

        tx.set(counterRef, {
            lastNumber: sequence,
            series: SERIES.creditNote.prefix,
            financialYear: fy.label,
            updatedAt: issuedAt,
        }, { merge: true });

        tx.set(noteRef, { ...note, issuedAtTs: issuedAt }, { merge: true });

        // Advance the credited total on the invoice so the cap holds under
        // concurrency — the invoice was read in this transaction, so a
        // simultaneous credit note conflicts and retries rather than
        // over-crediting.
        tx.set(invoiceRef, {
            creditedTotal: r2(alreadyCredited + creditValue),
            creditNoteNumbers: [...(invoice.creditNoteNumbers || []), creditNoteNumber],
            fullyCredited: scope === 'FULL' || r2(alreadyCredited + creditValue) >= invoiceValue - 0.01,
        }, { merge: true });

        return { ok: true as const, creditNote: note, alreadyExisted: false };
    });
}

/** How much of an order's invoice has already been credited. */
export async function creditedTotalFor(orderId: string): Promise<{ invoiceValue: number; credited: number; remaining: number } | null> {
    const snap = await db.collection(INVOICES_COLLECTION).doc(orderId).get();
    if (!snap.exists || !snap.data()?.invoiceNumber) return null;
    const data = snap.data() as any;
    const invoiceValue = r2(Number(data?.totals?.invoiceValue) || 0);
    const credited = r2(Number(data.creditedTotal) || 0);
    return { invoiceValue, credited, remaining: r2(invoiceValue - credited) };
}
