# Phase 4 — reconciling what has already been filed

Follows Phases 1–3. This is the phase that deals with documents already in
customers' hands and periods already filed.

## What your CA's message means

> `INV-2026-000078` food delivery, `DLT-COM-2607-069` vendor bill —
> last bill details as on 31.7.26

Read as the closing position on record as at **31 July 2026**:

| Series | Last on record | Sequence |
|---|---|---|
| Customer food-delivery invoice | `INV-2026-000078` | 78 |
| Vendor commission invoice | `DLT-COM-2607-069` | 69 |

Note `DLT-COM-2607-069` — `2607` is a July-2026 *label*, but the counter behind
it was always global, so `069` is the 69th commission invoice overall, not the
69th of July. That distinction matters when reading the register.

Against the counters recorded at the Phase 1 cutover (136 and 71):

- **58 customer serials** exist beyond what the CA has
- **2 commission serials** exist beyond what the CA has

Every one has to be explained as a real document issued after the cut-off, a
serial burned by an abandoned preview (F-02), or a failed write (F-01).

### The finding that actually matters

Serials used to be allocated when someone first *opened* an invoice, not when
the order was billed. So serial order does not follow invoice date, and some
documents **dated inside July carry serials above 78**. Those belong in a return
that has already gone in. The pack calls them out as `missedFromFiling`; the
mirror case — numbered ≤ 78 but dated in August — is `issuedLateWithinRange`.

Both are direct evidence of the defect, and both need an amendment rather than a
correction going forward.

## The commission correction is a DEBIT note, not a credit note

Phase 3 built credit notes, which reduce value. This needs the opposite.

The app withheld `15% × pre-discount item total`. The monthly commission invoice
billed `15% × post-discount total`. On a ₹500 order sold at ₹400 the restaurant
was **charged ₹75 and invoiced ₹60**.

So commission was **under-invoiced**: value was supplied but never documented,
and output tax on it was never declared. Section 34(3) puts the remedy on a
debit note raising the original invoice — a credit note would move it the wrong
way. Series `DCD/26-27/000001`, 16 characters, FY-scoped like every other.

Per affected vendor-month: shortfall ₹X, GST ₹0.18X, total ₹1.18X — and because
Phase 2 moved forward-looking billing onto the pre-discount base, this is a
one-off correction with no ongoing drift.

## Running it

```bash
cd admin-dashboard

# 1. The pack — read-only, writes four workbooks
node scripts/phase4-reconcile.js

# 2. The debit notes — dry run first
node scripts/phase4-issue-debit-notes.js
node scripts/phase4-issue-debit-notes.js --confirm     # after CA approval

# 3. Close the legacy series and record the baseline
node scripts/phase4-freeze-legacy.js
node scripts/phase4-freeze-legacy.js --confirm
```

All three default to reporting only. All are idempotent — a second run issues
nothing and reports each document as already present.

The baseline is overridable if the CA restates it:

```bash
node scripts/phase4-reconcile.js \
  --cutoff 2026-08-31 \
  --last-invoice INV-2026-000091 \
  --last-commission DLT-COM-2608-072
```

## What the pack contains

`ca-reconciliation-pack/` — four workbooks, built with the same writer the
dashboard's other exports use:

| File | What it shows |
|---|---|
| `invoice-register.xlsx` | Every serial ever issued, with where it sits against `INV-2026-000078`: filed, issued after the cut-off, or **missed from the filing**. |
| `gap-register.xlsx` | Each number the counter handed out that no document claimed, with its explanation. A documented gap is defensible; an unexplained one is what an audit objects to. |
| `missed-from-filing.xlsx` | Documents dated on or before 31 July but numbered above the CA's position — the amendment list. |
| `commission-restatement.xlsx` | Per vendor-month: billed vs correct, the shortfall, and the remedy. |

## New in the codebase

| File | Purpose |
|---|---|
| `src/lib/reconciliation.ts` | Pure logic — serial parsing, gap/duplicate classification, CA-position diff, commission restatement. Holds `CA_BASELINE` and `CUTOVER_COUNTERS`. |
| `src/lib/debit-note.ts` | s.34(3) debit notes, customer and commission, transactional and idempotent. |
| `src/app/api/debit-notes/route.ts` | `GET` to list, `POST` to issue. |
| `scripts/phase4-reconcile.js` | The CA pack. |
| `scripts/phase4-issue-debit-notes.js` | Issues the commission corrections. |
| `scripts/phase4-freeze-legacy.js` | Closes the legacy counters, records the baseline. |

The GST report now carries debit notes alongside credit notes: a Table 9B
section, a Table 13 series row, and a GSTR-3B line — `netTaxPayable` is
`output tax + debit notes − credit notes`.

`firestore.rules` closes `debitNotes`, `commissionDebitNotes`,
`commissionCreditNotes` and `reconciliation` to all client access, as with the
other tax collections.

## Two series in one financial year

The legacy `INV-2026-*` series and the new `DLT/26-27/*` series both fall in
FY 2026-27. That is permitted — multiple series are allowed provided each is
consecutive and unique — but **both must be disclosed in GSTR-1 Table 13**. The
report does this: `documentSummary.series` lists each with its own range.

Worth raising with your CA explicitly, since it is the kind of thing that reads
as an anomaly if it appears without explanation.

## Verify

```bash
npx tsc --noEmit                        # clean
node scripts/verify-pricing-engine.js   # 39 invariants, all pass
npm run build                           # run on Windows
```

The harness now covers serial parsing across all four historical formats, the
CA-position diff (including the IST day-end cut-off), gap and duplicate
detection, the restatement direction, and debit note arithmetic.

## What is still open

- **GSTR-1 Table 4** — commission invoice-wise against vendor GSTINs. The data
  is there; the section is not yet split out.
- **`costUnallocated` refunds** need a screen to assign who bears them.
- **The amendment itself.** Amending a filed GSTR-1, and the route for the
  commission shortfall, are filing decisions with penalty exposure. This pack is
  the input; your CA makes the call.
