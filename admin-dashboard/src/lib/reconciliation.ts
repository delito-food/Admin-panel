/**
 * Reconciling the issued serials against what has actually been filed.
 *
 * The CA's position as at 31 July 2026:
 *
 *   INV-2026-000078    last customer food-delivery invoice
 *   DLT-COM-2607-069   last vendor commission invoice
 *
 * The counters at the time of the Phase 1 cutover stood at 136 and 71. So 58
 * customer serials and 2 commission serials exist beyond what the CA has seen,
 * and every one of them has to be explained as either a real document issued
 * after the cut-off, a serial burned by an abandoned preview (F-02), or a
 * failed write (F-01).
 *
 * Two findings matter more than the counts:
 *
 *   MISSED FROM THE FILING — a document DATED on or before the cut-off but
 *   NUMBERED above the CA's last serial. Because serials were allocated when
 *   someone first opened an invoice rather than when the order was billed,
 *   serial order does not follow invoice date, so this is expected to be
 *   non-empty. Each one belongs in a period that has already been filed.
 *
 *   ISSUED LATE WITHIN RANGE — a document numbered at or below the CA's last
 *   serial but dated after the cut-off. The mirror image, and direct evidence
 *   of the same defect.
 *
 * Everything here is pure so it can be tested without Firestore.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The position the CA has on record. */
export interface CaBaseline {
    /** IST calendar day the position is stated as at, "YYYY-MM-DD". */
    cutoffDate: string;
    /** e.g. "INV-2026-000078" */
    lastInvoiceNumber: string;
    /** e.g. "DLT-COM-2607-069" */
    lastCommissionNumber: string;
    /** Who supplied the position, for the audit trail. */
    statedBy: string;
}

export const CA_BASELINE: CaBaseline = {
    cutoffDate: '2026-07-31',
    lastInvoiceNumber: 'INV-2026-000078',
    lastCommissionNumber: 'DLT-COM-2607-069',
    statedBy: 'Chartered accountant',
};

/** Counter values recorded at the Phase 1 cutover. */
export const CUTOVER_COUNTERS = {
    invoices: 136,
    commissionInvoices: 71,
} as const;

/**
 * The numeric sequence in any of our serial formats.
 *
 *   INV-2026-000078   → 78
 *   DLT-COM-2607-069  → 69   (the trailing group; YYMM is a label, not the count)
 *   DLT/26-27/000137  → 137
 *   INV-2026-000042-F → 42   (a legacy sub-invoice suffix)
 */
export function sequenceOf(serial?: string | null): number | null {
    if (!serial) return null;
    const cleaned = String(serial).trim().toUpperCase().replace(/-[FDP]$/, '');
    const match = cleaned.match(/(\d+)$/);
    if (!match) return null;
    const n = parseInt(match[1], 10);
    return Number.isFinite(n) ? n : null;
}

export interface SerialRecord {
    sequence: number;
    serial: string;
    /** Firestore document id. */
    docId: string;
    /** ISO instant the serial was allocated, when known. */
    issuedAt: string | null;
    orderId?: string;
    vendorId?: string;
    vendorName?: string;
    /** Billing month, for commission invoices. */
    month?: string;
    amount?: number;
}

export type GapCause = 'abandoned-preview-or-failed-write';

export interface SeriesReconciliation {
    seriesLabel: string;
    counterValue: number;
    highestIssued: number;
    documentCount: number;

    /** Serials the counter handed out that no document ever claimed. */
    gaps: number[];
    gapCause: GapCause;
    /** One sequence claimed by more than one document. */
    duplicates: Array<{ sequence: number; records: SerialRecord[] }>;

    /** What the CA has on record. */
    caLastSerial: string;
    caLastSequence: number;
    cutoffDate: string;

    /** Documents numbered at or below the CA's last serial. */
    withinCaRange: SerialRecord[];
    /** Documents numbered above it — not yet given to the CA. */
    beyondCaRange: SerialRecord[];

    /**
     * Dated on or before the cut-off but numbered above the CA's last serial.
     * These belong in a period already filed.
     */
    missedFromFiling: SerialRecord[];
    /**
     * Numbered at or below the CA's last serial but dated after the cut-off.
     * Evidence that serial order ran backwards against invoice date.
     */
    issuedLateWithinRange: SerialRecord[];

    /** True when the series is monotonic against date — the property Rule 46 wants. */
    serialOrderMatchesDateOrder: boolean;
}

/**
 * Reconcile one series against the CA's stated last serial and cut-off.
 *
 * `records` must carry every document ever issued in the series.
 */
export function reconcileSeries(
    seriesLabel: string,
    records: SerialRecord[],
    counterValue: number,
    caLastSerial: string,
    cutoffDate: string
): SeriesReconciliation {
    const caLastSequence = sequenceOf(caLastSerial) ?? 0;
    // The cut-off is an IST calendar day; an instant is "on or before" it up to
    // 23:59:59.999 IST, which is 18:29:59.999Z.
    const cutoffInstant = new Date(`${cutoffDate}T23:59:59.999+05:30`).getTime();

    const bySequence = new Map<number, SerialRecord[]>();
    for (const record of records) {
        const list = bySequence.get(record.sequence);
        if (list) list.push(record);
        else bySequence.set(record.sequence, [record]);
    }

    const highestIssued = bySequence.size ? Math.max(...bySequence.keys()) : 0;
    const ceiling = Math.max(counterValue, highestIssued);

    const gaps: number[] = [];
    for (let i = 1; i <= ceiling; i++) if (!bySequence.has(i)) gaps.push(i);

    const duplicates = [...bySequence.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([sequence, list]) => ({ sequence, records: list }))
        .sort((a, b) => a.sequence - b.sequence);

    const withinCaRange: SerialRecord[] = [];
    const beyondCaRange: SerialRecord[] = [];
    const missedFromFiling: SerialRecord[] = [];
    const issuedLateWithinRange: SerialRecord[] = [];

    for (const record of records) {
        const issuedTime = record.issuedAt ? new Date(record.issuedAt).getTime() : NaN;
        const knownDate = Number.isFinite(issuedTime);
        const onOrBeforeCutoff = knownDate && issuedTime <= cutoffInstant;

        if (record.sequence <= caLastSequence) {
            withinCaRange.push(record);
            if (knownDate && !onOrBeforeCutoff) issuedLateWithinRange.push(record);
        } else {
            beyondCaRange.push(record);
            if (onOrBeforeCutoff) missedFromFiling.push(record);
        }
    }

    const bySeq = (a: SerialRecord, b: SerialRecord) => a.sequence - b.sequence;
    withinCaRange.sort(bySeq);
    beyondCaRange.sort(bySeq);
    missedFromFiling.sort(bySeq);
    issuedLateWithinRange.sort(bySeq);

    // Does the serial order agree with the date order?
    const dated = records
        .filter(r => r.issuedAt && Number.isFinite(new Date(r.issuedAt).getTime()))
        .sort(bySeq);
    let monotonic = true;
    for (let i = 1; i < dated.length; i++) {
        if (new Date(dated[i].issuedAt!).getTime() < new Date(dated[i - 1].issuedAt!).getTime()) {
            monotonic = false;
            break;
        }
    }

    return {
        seriesLabel,
        counterValue,
        highestIssued,
        documentCount: records.length,
        gaps,
        gapCause: 'abandoned-preview-or-failed-write',
        duplicates,
        caLastSerial,
        caLastSequence,
        cutoffDate,
        withinCaRange,
        beyondCaRange,
        missedFromFiling,
        issuedLateWithinRange,
        serialOrderMatchesDateOrder: monotonic,
    };
}

// ── Commission restatement ────────────────────────────────────────────────

export interface CommissionRestatementRow {
    vendorId: string;
    vendorName: string;
    month: string;
    invoiceNumber: string;
    orderCount: number;
    /** The post-discount total the invoice billed on. */
    billedBaseAmount: number;
    billedCommission: number;
    billedGst: number;
    /** The pre-discount total the app actually withheld on. */
    correctBaseAmount: number;
    correctCommission: number;
    correctGst: number;
    /** correct − billed. Positive means under-invoiced. */
    deltaCommission: number;
    deltaGst: number;
    deltaTotal: number;
    direction: 'under-invoiced' | 'over-invoiced' | 'agrees';
    /** What has to be issued to correct it. */
    remedy: 'debit note' | 'credit note' | 'none';
}

/**
 * Restate one vendor-month's commission on the correct base.
 *
 * The invoice billed `rate × post-discount total`. The app withheld
 * `rate × pre-discount total`, and that is the amount actually charged, so it
 * is the amount that should have been invoiced. The difference was supplied but
 * never documented.
 */
export function restateCommission(
    input: {
        vendorId: string;
        vendorName: string;
        month: string;
        invoiceNumber: string;
        orderCount: number;
        /** Sum of itemTotal — what the invoice billed on. */
        discountedBase: number;
        /** Sum of originalItemTotal — what was withheld on. */
        originalBase: number;
        ratePercent: number;
        gstRatePercent: number;
    }
): CommissionRestatementRow {
    const billedCommission = r2((input.discountedBase * input.ratePercent) / 100);
    const billedGst = r2((billedCommission * input.gstRatePercent) / 100);
    const correctCommission = r2((input.originalBase * input.ratePercent) / 100);
    const correctGst = r2((correctCommission * input.gstRatePercent) / 100);

    const deltaCommission = r2(correctCommission - billedCommission);
    const deltaGst = r2(correctGst - billedGst);
    const deltaTotal = r2(deltaCommission + deltaGst);

    let direction: CommissionRestatementRow['direction'] = 'agrees';
    let remedy: CommissionRestatementRow['remedy'] = 'none';
    if (deltaCommission > 0.01) { direction = 'under-invoiced'; remedy = 'debit note'; }
    else if (deltaCommission < -0.01) { direction = 'over-invoiced'; remedy = 'credit note'; }

    return {
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        month: input.month,
        invoiceNumber: input.invoiceNumber,
        orderCount: input.orderCount,
        billedBaseAmount: r2(input.discountedBase),
        billedCommission,
        billedGst,
        correctBaseAmount: r2(input.originalBase),
        correctCommission,
        correctGst,
        deltaCommission,
        deltaGst,
        deltaTotal,
        direction,
        remedy,
    };
}

export interface RestatementTotals {
    rows: number;
    underInvoiced: number;
    overInvoiced: number;
    deltaCommission: number;
    deltaGst: number;
    deltaTotal: number;
}

export function summariseRestatement(rows: CommissionRestatementRow[]): RestatementTotals {
    return rows.reduce<RestatementTotals>((acc, row) => ({
        rows: acc.rows + 1,
        underInvoiced: acc.underInvoiced + (row.direction === 'under-invoiced' ? 1 : 0),
        overInvoiced: acc.overInvoiced + (row.direction === 'over-invoiced' ? 1 : 0),
        deltaCommission: r2(acc.deltaCommission + row.deltaCommission),
        deltaGst: r2(acc.deltaGst + row.deltaGst),
        deltaTotal: r2(acc.deltaTotal + row.deltaTotal),
    }), { rows: 0, underInvoiced: 0, overInvoiced: 0, deltaCommission: 0, deltaGst: 0, deltaTotal: 0 });
}
