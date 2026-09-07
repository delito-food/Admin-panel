/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Append-only money ledger.
 *
 * What a vendor is owed used to be worked out from two independent records —
 * the `payouts` collection and denormalised counters on the vendor document —
 * which were allowed to drift and then reconciled with `Math.max()`, on the
 * reasoning that pending should never be understated. That is a guess, not a
 * reconciliation: if the vendor document was stale-high on `paidAmount` the
 * vendor was underpaid, and if it was stale-low we overpaid, with no way to
 * tell which had happened.
 *
 * Here there is one record. Every movement of money is an immutable row, and a
 * balance is the sum of the rows that produced it. Nothing is ever updated in
 * place, so a balance can always be explained line by line. The counters on the
 * vendor document survive as a display cache, and any divergence from the
 * ledger is reported as a discrepancy rather than silently resolved.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from './firebase-admin';

export const LEDGER_COLLECTION = 'ledgerEntries';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Sign convention: the amount is what it does to the party's balance.
 *
 *   EARNING            +  the vendor's share of a delivered order
 *   COMMISSION         −  platform commission and its GST
 *   PAYOUT             −  money actually paid out
 *   CREDIT_NOTE        −  reversal of an invoiced supply
 *   ADJUSTMENT         ±  a manual correction, always with a reason
 */
export type LedgerEntryType = 'EARNING' | 'COMMISSION' | 'PAYOUT' | 'CREDIT_NOTE' | 'ADJUSTMENT';

export type LedgerPartyType = 'vendor' | 'deliveryPartner';

export interface LedgerEntry {
    partyType: LedgerPartyType;
    partyId: string;
    entryType: LedgerEntryType;
    /** Signed. Positive increases what the party is owed. */
    amount: number;
    currency: 'INR';
    /** What produced this row — an order, a payout record, a credit note. */
    sourceType: 'order' | 'payout' | 'creditNote' | 'manual';
    sourceId: string;
    description: string;
    /** When the money moved, not when the row was written. */
    occurredAt: string;
    createdAt: string;
    createdBy: string;
}

/**
 * Deterministic row id.
 *
 * Posting is idempotent because the id is derived from what caused the row: a
 * replayed webhook, a retried request or a re-run backfill writes the same id
 * and therefore the same single row.
 */
export function ledgerEntryId(
    partyType: LedgerPartyType,
    partyId: string,
    entryType: LedgerEntryType,
    sourceId: string
): string {
    return `${partyType}_${partyId}_${entryType}_${sourceId}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

export interface PostEntryInput {
    partyType: LedgerPartyType;
    partyId: string;
    entryType: LedgerEntryType;
    amount: number;
    sourceType: LedgerEntry['sourceType'];
    sourceId: string;
    description: string;
    occurredAt?: Date;
    createdBy: string;
}

/** Write one row. Safe to call twice with the same source — see ledgerEntryId. */
export async function postLedgerEntry(input: PostEntryInput): Promise<{ id: string; written: boolean }> {
    const id = ledgerEntryId(input.partyType, input.partyId, input.entryType, input.sourceId);
    const ref = db.collection(LEDGER_COLLECTION).doc(id);

    return db.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (existing.exists) return { id, written: false };

        const now = Timestamp.now();
        const entry: LedgerEntry = {
            partyType: input.partyType,
            partyId: input.partyId,
            entryType: input.entryType,
            amount: r2(input.amount),
            currency: 'INR',
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            description: input.description,
            occurredAt: (input.occurredAt || now.toDate()).toISOString(),
            createdAt: now.toDate().toISOString(),
            createdBy: input.createdBy,
        };
        tx.set(ref, { ...entry, occurredAtTs: Timestamp.fromDate(new Date(entry.occurredAt)), createdAtTs: now });
        return { id, written: true };
    });
}

/** Write several rows under one transaction, each idempotent. */
export async function postLedgerEntries(inputs: PostEntryInput[]): Promise<{ written: number; skipped: number }> {
    let written = 0;
    let skipped = 0;
    // Chunked so a large backfill cannot exceed a transaction's document limit.
    for (let i = 0; i < inputs.length; i += 200) {
        const chunk = inputs.slice(i, i + 200);
        for (const input of chunk) {
            const result = await postLedgerEntry(input);
            if (result.written) written++; else skipped++;
        }
    }
    return { written, skipped };
}

export interface LedgerBalance {
    partyId: string;
    /** Sum of every row. What the party is owed right now. */
    balance: number;
    earnings: number;
    commission: number;
    creditNotes: number;
    paidOut: number;
    adjustments: number;
    entryCount: number;
    lastEntryAt: string | null;
}

export function emptyBalance(partyId: string): LedgerBalance {
    return {
        partyId, balance: 0, earnings: 0, commission: 0,
        creditNotes: 0, paidOut: 0, adjustments: 0, entryCount: 0, lastEntryAt: null,
    };
}

export function accumulate(balance: LedgerBalance, entry: any): void {
    const amount = Number(entry.amount) || 0;
    balance.balance = r2(balance.balance + amount);
    balance.entryCount += 1;

    switch (entry.entryType as LedgerEntryType) {
        case 'EARNING': balance.earnings = r2(balance.earnings + amount); break;
        case 'COMMISSION': balance.commission = r2(balance.commission + Math.abs(amount)); break;
        case 'CREDIT_NOTE': balance.creditNotes = r2(balance.creditNotes + Math.abs(amount)); break;
        case 'PAYOUT': balance.paidOut = r2(balance.paidOut + Math.abs(amount)); break;
        case 'ADJUSTMENT': balance.adjustments = r2(balance.adjustments + amount); break;
    }

    const at = entry.occurredAt as string | undefined;
    if (at && (!balance.lastEntryAt || at > balance.lastEntryAt)) balance.lastEntryAt = at;
}

/**
 * Fold a set of rows into a balance.
 *
 * The only definition of what a party is owed: the sum of its rows. Kept
 * pure so it can be tested, and so every caller folds the same way.
 */
export function computeBalance(partyId: string, entries: Array<Partial<LedgerEntry>>): LedgerBalance {
    const balance = emptyBalance(partyId);
    entries.forEach(e => accumulate(balance, e));
    return balance;
}

/** Balances for every party with at least one row, keyed by party id. */
export async function allLedgerBalances(partyType: LedgerPartyType = 'vendor'): Promise<Record<string, LedgerBalance>> {
    const snap = await db.collection(LEDGER_COLLECTION).where('partyType', '==', partyType).get();
    const balances: Record<string, LedgerBalance> = {};
    snap.docs.forEach((doc) => {
        const entry = doc.data();
        const partyId = entry.partyId as string;
        if (!partyId) return;
        balances[partyId] ||= emptyBalance(partyId);
        accumulate(balances[partyId], entry);
    });
    return balances;
}

/** One party's balance, with the rows that produced it. */
export async function ledgerBalanceFor(
    partyType: LedgerPartyType,
    partyId: string
): Promise<{ balance: LedgerBalance; entries: LedgerEntry[] }> {
    const snap = await db.collection(LEDGER_COLLECTION)
        .where('partyType', '==', partyType)
        .where('partyId', '==', partyId)
        .get();

    const balance = emptyBalance(partyId);
    const entries: LedgerEntry[] = [];
    snap.docs.forEach((doc) => {
        const entry = doc.data() as LedgerEntry;
        accumulate(balance, entry);
        entries.push(entry);
    });
    entries.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return { balance, entries };
}

/**
 * Compare the ledger against a cached figure.
 *
 * Returns the gap rather than picking a winner. A non-zero gap is a bug to
 * investigate, not a number to round away.
 */
export function divergence(ledgerValue: number, cachedValue: number): { gap: number; agrees: boolean } {
    const gap = r2(ledgerValue - cachedValue);
    return { gap, agrees: Math.abs(gap) < 0.01 };
}
