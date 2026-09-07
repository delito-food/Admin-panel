/**
 * What has to happen when money goes back to a customer.
 *
 * A refund used to be a single row in `refunds` plus a status flag on the
 * order. Nothing reversed the tax invoice, so output GST stayed declared on a
 * supply that had been undone, and nothing recorded the effect on the vendor's
 * balance.
 *
 * Two effects, deliberately kept apart:
 *
 *   1. THE TAX REVERSAL is not a judgement call. If a tax invoice was issued
 *      for the order, a credit note must be raised against it. This always
 *      happens.
 *
 *   2. WHO BEARS THE COST is a commercial decision, and the system does not
 *      know it. A refund for a rider's mistake is not the restaurant's to fund.
 *      So the vendor's balance is only touched when the caller states who bears
 *      it; otherwise the refund is flagged as unallocated for someone to
 *      decide. Guessing here would recreate exactly the class of bug this work
 *      set out to remove.
 */

import { issueCreditNote, type CreditNoteReasonCode, type StoredCreditNote } from './credit-note';
import { postLedgerEntry } from './ledger';

export interface RefundEffectsInput {
    orderId: string;
    refundId: string;
    amount: number;
    isFullRefund: boolean;
    reason?: string;
    /** Who absorbs the refund. Omit when it has not been decided yet. */
    borneBy?: 'platform' | 'vendor';
    vendorId?: string;
    issuedBy: string;
    /** Set when the order was cancelled rather than refunded on complaint. */
    cancelled?: boolean;
}

export interface RefundEffectsResult {
    creditNote: StoredCreditNote | null;
    creditNoteNumber: string | null;
    /** Set when a credit note could not be raised. Surfaced to the admin. */
    creditNoteWarning: string | null;
    ledgerEntryId: string | null;
    /** True when nobody has been assigned the cost of this refund yet. */
    costUnallocated: boolean;
}

function reasonCodeFor(input: RefundEffectsInput): CreditNoteReasonCode {
    if (input.cancelled) return 'ORDER_CANCELLED';
    return input.isFullRefund ? 'FULL_REFUND' : 'PARTIAL_REFUND';
}

export async function applyRefundEffects(input: RefundEffectsInput): Promise<RefundEffectsResult> {
    const result: RefundEffectsResult = {
        creditNote: null,
        creditNoteNumber: null,
        creditNoteWarning: null,
        ledgerEntryId: null,
        costUnallocated: !input.borneBy,
    };

    // ── 1. Reverse the tax ──
    try {
        const cn = await issueCreditNote({
            orderId: input.orderId,
            amount: input.amount,
            reasonCode: reasonCodeFor(input),
            reason: input.reason,
            refundId: input.refundId,
            issuedBy: input.issuedBy,
        });

        if (cn.ok) {
            result.creditNote = cn.creditNote;
            result.creditNoteNumber = cn.creditNote.creditNoteNumber;
        } else if (cn.code === 'NO_INVOICE') {
            // Nothing was invoiced, so there is no output tax to reverse. Not an
            // error — most refunds on undelivered orders land here.
            result.creditNoteWarning = null;
        } else {
            result.creditNoteWarning = cn.reason;
        }
    } catch (err) {
        // The money has already moved; failing the refund now would leave the
        // customer refunded with the request reported as failed. Record the gap
        // instead so it can be closed by hand.
        result.creditNoteWarning =
            `Refund succeeded but the credit note could not be issued: ${err instanceof Error ? err.message : String(err)}. ` +
            'Raise it from the Credit Notes screen so the output tax is reversed.';
        console.error('[refund] credit note failed for order', input.orderId, err);
    }

    // ── 2. Move the money, only if told whose it is ──
    if (input.borneBy === 'vendor' && input.vendorId) {
        try {
            const posted = await postLedgerEntry({
                partyType: 'vendor',
                partyId: input.vendorId,
                entryType: 'CREDIT_NOTE',
                amount: -Math.abs(input.amount),
                sourceType: 'creditNote',
                sourceId: input.refundId,
                description: `Refund on order ${input.orderId}${result.creditNoteNumber ? ` (${result.creditNoteNumber})` : ''}`,
                createdBy: input.issuedBy,
            });
            result.ledgerEntryId = posted.id;
        } catch (err) {
            console.error('[refund] ledger post failed for order', input.orderId, err);
        }
    }

    return result;
}
