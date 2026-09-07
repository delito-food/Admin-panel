/**
 * Invoice serial numbering.
 *
 * Rule 46 of the CGST Rules requires a serial that is consecutive, unique
 * within a financial year, and at most 16 characters of letters, digits,
 * hyphen and slash. Four independent series are kept, each with its own
 * counter per financial year:
 *
 *   DLT/26-27/000137   customer tax invoice
 *   DCN/26-27/000004   credit note against a customer invoice
 *   DDN/26-27/000001   debit note raising a customer invoice
 *   DCM/26-27/000072   commission invoice to a restaurant
 *   DCC/26-27/000001   credit note against a commission invoice
 *   DCD/26-27/000001   debit note raising a commission invoice
 *
 * Each is exactly 16 characters. (An earlier draft used DLT/COM/26-27/0001 —
 * 18 characters, over the limit.)
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
    invoice: { prefix: 'DLT', counterStem: 'inv', collection: 'invoices', label: 'Tax Invoice' },
    creditNote: { prefix: 'DCN', counterStem: 'cn', collection: 'creditNotes', label: 'Credit Note' },
    commission: { prefix: 'DCM', counterStem: 'com', collection: 'commissionInvoices', label: 'Tax Invoice' },
    commissionCreditNote: { prefix: 'DCC', counterStem: 'comcn', collection: 'commissionCreditNotes', label: 'Credit Note' },
    // Debit notes raise the value of an already-issued invoice (s.34(3)).
    // Needed because commission was UNDER-invoiced: the app withheld on the
    // pre-discount item total while the invoice billed the post-discount one.
    debitNote: { prefix: 'DDN', counterStem: 'dn', collection: 'debitNotes', label: 'Debit Note' },
    commissionDebitNote: { prefix: 'DCD', counterStem: 'comdn', collection: 'commissionDebitNotes', label: 'Debit Note' },
};

const SEQUENCE_PAD = 6;

/** "DLT/26-27/000137" */
export function formatSerial(series: SeriesKey, fyLabel: string, sequence: number): string {
    return `${SERIES[series].prefix}/${fyLabel}/${String(sequence).padStart(SEQUENCE_PAD, '0')}`;
}

/** "counters/inv_26-27" */
export function counterDocId(series: SeriesKey, fyLabel: string): string {
    return `${SERIES[series].counterStem}_${fyLabel}`;
}

/** Pull the financial year and sequence back out of a serial. */
export function parseSerial(serial?: string | null): { series: SeriesKey | null; fyLabel: string; sequence: number } | null {
    if (!serial) return null;
    const m = serial.trim().toUpperCase().match(/^([A-Z]{3})\/(\d{2}-\d{2})\/(\d+)$/);
    if (!m) return null;
    const entry = (Object.entries(SERIES) as Array<[SeriesKey, SeriesSpec]>)
        .find(([, spec]) => spec.prefix === m[1]);
    return { series: entry ? entry[0] : null, fyLabel: m[2], sequence: parseInt(m[3], 10) };
}

/**
 * Does this serial belong to the legacy, pre-Phase-2 numbering?
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
