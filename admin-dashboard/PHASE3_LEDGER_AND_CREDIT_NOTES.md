# Phase 3 — corrections, and a ledger to hold them

Follows `PHASE1_INVOICE_BASELINE.md` and `PHASE2_INVOICE_REBUILD.md`.

Phase 2 made the invoice immutable. That creates a problem Phase 3 solves: if an
invoice cannot be edited, every correction has to become its own document. And
once money can be reversed, "what does this vendor get paid" can no longer be a
guess between two caches.

## 1. Credit notes (F-07)

`src/lib/credit-note.ts`, `POST /api/credit-notes`, series `DCN/26-27/000001`.

Section 34: where a supply is cancelled, refunded or revised down after a tax
invoice, output tax is reversed by a credit note referencing the original — not
by editing it. Before this, an order could be invoiced and then refunded with
nothing reversing it, so GST stayed declared and paid on a supply that had been
undone.

- Serial, document, and the credited total on the invoice all move in **one
  transaction**. A failed write leaves the counter untouched.
- **Over-crediting is impossible.** `creditedTotal` accumulates on the invoice
  and is read inside the transaction, so two simultaneous credits conflict and
  retry rather than both succeeding.
- **Partial credits apportion across the rate mix.** A half credit on an invoice
  carrying food at 5% and delivery at 18% reverses half of each, with tax
  re-split from the scaled figure so the heads always sum back.
- **Idempotent on the refund id** (`cn_<refundId>`), so a retried refund returns
  the note it already made instead of issuing a second one.

## 2. Refunds and cancellations raise them automatically (F-07)

`src/lib/refund-effects.ts`, wired into both success paths of `/api/refunds`.

Two effects, deliberately separated:

**The tax reversal is not a judgement call.** If an invoice exists, a credit note
is raised. If the money has already moved and the note fails, the refund records
`creditNoteWarning` and the response surfaces it — the request is not failed
after the customer has been refunded.

**Who bears the cost is a commercial decision the system does not know.** A
refund for a rider's mistake is not the restaurant's to fund. The vendor's
balance is debited *only* when the caller passes `borneBy: 'vendor'`; otherwise
the refund is flagged `costUnallocated` for someone to decide. Guessing here
would recreate exactly the class of bug this work set out to remove.

`POST /api/orders/cancel` now **refuses** to cancel an order that carries an
uncredited invoice, and says to raise a credit note instead.

## 3. The append-only ledger (F-14)

`src/lib/ledger.ts`, collection `ledgerEntries`.

What a vendor was owed came from two records — the `payouts` collection and
counters on the vendor document — reconciled with `Math.max()`, on the reasoning
that pending should never be understated. That is a guess: a stale-high cache
underpaid the vendor, a stale-low one overpaid, and nothing said which had
happened.

Now every movement is an immutable row and a balance is the sum of its rows:

| Type | Sign | Source |
|---|---|---|
| `EARNING` | + | delivered order |
| `COMMISSION` | − | commission + GST withheld on that order |
| `PAYOUT` | − | a confirmed payout |
| `CREDIT_NOTE` | − | a vendor-borne refund |
| `ADJUSTMENT` | ± | a manual correction, always with a reason |

Row ids are derived from what caused them, so posting is idempotent — a replayed
webhook or a re-run backfill writes the same single row.

**The arbitration rule changed.** It is no longer "the bigger number wins" but
"the ledger where rows exist, otherwise the derivation." The denormalised
counters are never a value source again; they are compared, and any gap comes
back as `discrepancies` for someone to investigate. Both the vendor
(`/api/vendors/payouts`) and delivery (`/api/delivery/payouts`) screens now
report `balanceSource` and `discrepancies`.

Payout confirmation, and RazorpayX reconciliation, both post rows. A payout
completed by reconciliation previously never reached any balance at all.

### Backfill — run this before trusting the ledger figures

```bash
cd admin-dashboard
node scripts/backfill-ledger.js   # report + per-vendor gap table
node scripts/backfill-ledger.js --confirm   # post the rows
```

The dry run prints, per vendor and per delivery partner, the ledger balance
against the cached counters. **Every gap of ₹1 or more is a real discrepancy
that predates the ledger — investigate before paying.** Until a party has rows,
its screen falls back to the derived figure and says so in `balanceSource`.

## 4. The GST report is built from documents (F-18)

`/api/reports/gst` now reads the issued documents, not just the orders:

- A stored invoice is **authoritative** — its frozen figures are what the
  customer holds and what must be filed, even if a rounding rule changed since.
- An order with no invoice is still costed so the report stays usable, but it is
  flagged `documentIssued: false` and listed under **`unbilled`**. That count is
  the gap that must reach zero before the period can be filed.
- **Table 9B** — credit notes, listed and subtracted from the net liability,
  never netted into the invoice rows.
- **Table 13** — document summary per series, from the serials actually
  allocated, with `notIssued` alongside.
- Commission is out of the B2C bucket (Table 4 proper is the remaining work).
- GSTR-3B carries IGST and a credit-note line; `netTaxPayable` is net of credit
  notes.

## The rest of the sweep

Things found while checking nothing was left behind:

| Where | What |
|---|---|
| `delivery/cod` | **The over-settlement guard could never fire.** It compared the request against `Math.max(actualPending, amount)`, which is `>= amount` by construction — so any settlement amount was accepted, however large, and a partner could be recorded as settling cash never collected. Now checked against COD actually recorded, with an explicit `force: true` that is logged. |
| `delivery/payouts` | The same `Math.max()` reconciliation as vendors, on earnings, delivery count **and** paid amount — three inflated figures per stale cache. Now ledger-backed. |
| `refunds` | Any order with one successful refund was rejected, so a second partial refund was impossible. Now capped at what remains unrefunded. |
| `reports/tds` | Financial quarters, and user-supplied dates, resolved in host-local time. Now IST. |
| `reports/hsn`, `reports/refunds` | Month defaults and day filters in host-local time. Now IST. |
| `cashflow`, `dashboard`, `analytics`, `reports`, `reports/advanced` | "Today", "this week", "this month" all started at 05:30 IST on a UTC host, so each morning's trade was reported against the previous day. Now IST throughout. |
| `orders` | Discounts re-derived with `Math.max()` over two sources — the same order could show one discount here and another on its bill. Now from the engine. |
| `invoice-constants` | `generateInvoiceNumber()` deleted. It stamped the calendar year onto a counter that never reset. |
| `payouts/reconcile` | Reversals updated `paidAmount` with an unguarded read-modify-write. Now transactional, and posts a ledger row. |
| `firestore.rules` | `invoices`, `creditNotes`, `commissionInvoices`, `ledgerEntries`, `counters` were unlisted. Now closed to all client access — they carry other parties' turnover and tax details. |
| `firestore.indexes.json` | Added the `ledgerEntries` (partyType, partyId, occurredAt) composite index the ledger needs. |

## Verify

```bash
cd admin-dashboard
npx tsc --noEmit                        # types + route contracts — clean
node scripts/verify-pricing-engine.js   # 29 invariants — all pass
npm run build                           # run on Windows
```

The harness now covers place of supply, credit note reversal (full, partial,
inter-state), ledger folding and idempotency, and IST quarters and day
boundaries, on top of the Phase 2 invoice invariants.

`npm run build` still cannot run here — `node_modules` holds the Windows SWC
binary and the sandbox has no network.

## Deploy order

1. `firebase deploy --only firestore:rules,firestore:indexes` — **first**; the
   ledger query needs its index.
2. Push the dashboard.
3. `node scripts/backfill-ledger.js`, read the gap table, investigate
   anything material, then run it for real.
4. Check the payouts screens show `balanceSource: "ledger"` and an empty
   `discrepancies` for the vendors you expect.

## Still open

- **GSTR-1 Table 4** proper — commission invoice-wise against vendor GSTINs.
- **Phase 4** — the gap and duplicate register for legacy serials 1–136 and
  1–71, and the commission restatement. `scripts/invoice-series-audit.js` is
  ready to run.
- `costUnallocated` refunds need a screen to assign who bears them.
