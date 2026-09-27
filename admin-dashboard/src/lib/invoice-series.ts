/**
 * Invoice serial numbering.
 *
 * Rule 46 of the CGST Rules requires a serial that is consecutive, unique
 * within a financial year, and at most 16 characters of letters, digits,
 * hyphen and slash. Independent series are kept, each with its own counter
 * per financial year:
 *
 *   INV-2026-000079    customer tax invoice          (15 chars)
 *   DLT-COM-2608-070   commission invoice, Aug 2026  (16 chars)
 *   DCN/26-27/000004   credit note against a customer invoice
 *   DDN/26-27/000001   debit note raising a customer invoice
 *   DCC/26-27/000001   credit note against a commission invoice
 *   DCD/26-27/000001   debit note raising a commission invoice
 *
 * ── Continuation of the original series (27 Sep 2026) ──
 *
 * The CA's filed position as on 31 July 2026 was INV-2026-000078 and
 * DLT-COM-2607-069. Customer and commission invoices after that continue the
 * SAME format and the SAME numbering (079…, 070…), not the DLT/26-27 and
 * DCM/26-27 series that Phase 2 introduced. The year in INV-2026 is the
 * first year of the financial year (FY 2026-27), and the counters are still
 * the FY-scoped ones, so a fresh series starts on 1 April each year.
 * See INVOICE_CONTINUATION.md and scripts/renumber-invoice-series.js.
 *
 * A number is allocated only inside the transaction that writes the document
 * claiming it, so the series cannot develop holes.
 */

import { financialYearOf, financialYearFrom, type FinancialYear } from './fiscal';

export type SeriesKey =
    | 'invoice'
    | 'creditNote'
    | 'debitNote'
    | 'commission'
    | 'commissionCreditNote'
    | 'commissionDebitNote';

interface SeriesSpec {
    prefix: string;
    /** Counter document id stem — the financial year is appended. */
    counterStem: string;
    collection: string;
    label: string;
}

export const SERIES: Record<SeriesKey, SeriesSpec> = {
    // Customer invoices continue the original INV-<FY start year>-nnnnnn series.
    invoice: { prefix: 'INV', counterStem: 'inv', collection: 'invoices', label: 'Tax Invoice' },
    creditNote: { prefix: 'DCN', counterStem: 'cn', collection: 'creditNotes', label: 'Credit Note' },
    // Commission invoices continue the original DLT-COM-<YYMM>-nnn series.
    commission: { prefix: 'DLT-COM', counterStem: 'com', collection: 'commissionInvoices', label: 'Tax Invoice' },
    commissionCreditNote: { prefix: 'DCC', counterStem: 'comcn', collection: 'commissionCreditNotes', label: 'Credit Note' },
    // Debit notes raise the value of an already-issued invoice (s.34(3)).
    // Needed because commission was UNDER-invoiced: the app withheld on the
    // pre-discount item total while the invoice billed the post-discount one.
    debitNote: { prefix: 'DDN', counterStem: 'dn', collection: 'debitNotes', label: 'Debit Note' },
    commissionDebitNote: { prefix: 'DCD', counterStem: 'comdn', collection: 'commissionDebitNotes', label: 'Debit Note' },
};

const SEQUENCE_PAD = 6;

/**
 * The financial year whose invoice and commission counters must be set by
 * scripts/renumber-invoice-series.js before the dashboard may draw from them.
 * Until that script has run, the FY counters still hold the count of the
 * retired DLT/ and DCM/ series, and drawing from them would re-use numbers
 * the CA already has. Later financial years start fresh and are not gated.
 */
export const CONTINUATION_FY = '26-27';

/** Throws if this counter has not yet been continued from the CA position. */
export function assertCounterContinued(series: SeriesKey, fyLabel: string, counterData: Record<string, unknown> | undefined): void {
    if ((series === 'invoice' || series === 'commission') && fyLabel === CONTINUATION_FY && !counterData?.continuedFrom) {
        throw new Error(
            'Invoice numbering is paused until the series is continued from the CA position. ' +
            'Run: node scripts/renumber-invoice-series.js --confirm'
        );
    }
}

/**
 * Customer invoice: "INV-2026-000079" (year = first year of the FY).
 * Commission invoice: "DLT-COM-2608-070" (YYMM = billing month; pass it as
 * `billingMonth` in "YYYY-MM" form — falls back to the FY start year + "04").
 * Everything else: "DCN/26-27/000004".
 */
export function formatSerial(
    series: SeriesKey,
    fyLabel: string,
    sequence: number,
    billingMonth?: string
): string {
    if (series === 'invoice') {
        return `${SERIES.invoice.prefix}-20${fyLabel.slice(0, 2)}-${String(sequence).padStart(SEQUENCE_PAD, '0')}`;
    }
    if (series === 'commission') {
        const m = billingMonth?.match(/^(\d{4})-(\d{2})$/);
        const yymm = m ? `${m[1].slice(-2)}${m[2]}` : `${fyLabel.slice(0, 2)}04`;
        return `${SERIES.commission.prefix}-${yymm}-${String(sequence).padStart(3, '0')}`;
    }
    return `${SERIES[series].prefix}/${fyLabel}/${String(sequence).padStart(SEQUENCE_PAD, '0')}`;
}

/** "counters/inv_26-27" */
export function counterDocId(series: SeriesKey, fyLabel: string): string {
    return `${SERIES[series].counterStem}_${fyLabel}`;
}

/** Pull the financial year and sequence back out of a serial. */
export function parseSerial(serial?: string | null): { series: SeriesKey | null; fyLabel: string; sequence: number } | null {
    if (!serial) return null;
    const s = serial.trim().toUpperCase();

    // INV-2026-000079 → customer invoice, FY 26-27
    const inv = s.match(/^INV-(\d{4})-(\d+)$/);
    if (inv) {
        const y = parseInt(inv[1], 10);
        return { series: 'invoice', fyLabel: `${String(y).slice(-2)}-${String(y + 1).slice(-2)}`, sequence: parseInt(inv[2], 10) };
    }
    // DLT-COM-2608-070 → commission invoice; FY from the billing month
    const com = s.match(/^DLT-COM-(\d{2})(\d{2})-(\d+)$/);
    if (com) {
        const y = 2000 + parseInt(com[1], 10);
        const startYear = parseInt(com[2], 10) >= 4 ? y : y - 1;
        return { series: 'commission', fyLabel: `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`, sequence: parseInt(com[3], 10) };
    }

    const m = s.match(/^([A-Z]{3})\/(\d{2}-\d{2})\/(\d+)$/);
    if (!m) return null;
    // DLT/… and DCM/… were the Phase-2 prefixes for invoices and commission
    // invoices; they are retired but still recognised.
    const retired: Record<string, SeriesKey> = { DLT: 'invoice', DCM: 'commission' };
    const entry = (Object.entries(SERIES) as Array<[SeriesKey, SeriesSpec]>)
        .find(([, spec]) => spec.prefix === m[1]);
    return { series: entry ? entry[0] : (retired[m[1]] ?? null), fyLabel: m[2], sequence: parseInt(m[3], 10) };
}

/**
 * Does this serial belong to the legacy, pre-Phase-2 numbering?
 *
 * NOTE: since the continuation (Sep 2026) new invoices use the same INV- and
 * DLT-COM- formats again, so a match here only means "original format", not
 * "closed series". Kept for older callers and scripts.
 *
 * Legacy customer invoices are INV-2026-000042 (and DELITO-INV-… before that);
 * legacy commission invoices are DLT-COM-2602-014. Those series are closed —
 * nothing new is drawn from them — but existing documents keep their numbers,
 * so both forms have to remain recognisable.
 */
export function isLegacySerial(serial?: string | null): boolean {
    if (!serial) return false;
    const s = serial.trim().toUpperCase();
    return /^(DELITO[-_\s]*)?INV-\d{4}-\d+/.test(s) || /^DLT-COM-\d{4}-\d+/.test(s);
}

/** The financial year a document dated at this instant belongs to. */
export function financialYearForDate(instant: Date): FinancialYear {
    return financialYearOf(instant);
}

export { financialYearFrom };
export type { FinancialYear };
