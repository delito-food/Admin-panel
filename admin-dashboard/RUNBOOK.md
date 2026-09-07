# Go-live runbook

Everything runs **on your Windows machine**. Firestore is not reachable from
either sandbox this session can use, so none of it can be run for you.

```powershell
cd C:\Users\annsh\AndroidStudioProjects\PLATOOS\PLATOOS\admin-dashboard
```

Steps 1–5 are reversible. Steps 6–7 create tax documents and consume serials —
they are one-way, and both wait on your CA.

---

## 0 · Pre-flight (nothing is written)

```powershell
npm install
npx tsc --noEmit
node scripts\verify-pricing-engine.js
npm run build
```

All four must pass. `npm run build` is the one I could not run — this sandbox
has the Windows SWC binary and no network — so it is the real gate.

No new environment variables are required. `ADMIN_EMAILS` is optional and
documented in `.env.example`.

---

## 1 · Firestore rules and indexes — before the dashboard

```powershell
cd ..
firebase deploy --only firestore:rules,firestore:indexes
cd admin-dashboard
```

The ledger query needs its composite index, and the rules close the new tax
collections to client access.

**This is safe to deploy ahead of the app.** The rules only add deny entries for
`invoices`, `creditNotes`, `debitNotes`, `commissionInvoices`,
`commissionDebitNotes`, `commissionCreditNotes`, `ledgerEntries`, `counters`
and `reconciliation` — none of which the customer, vendor or delivery apps or
the Cloud Functions read. The Admin SDK bypasses rules entirely, so the
dashboard is unaffected either way.

Index builds take a few minutes. Wait for green in the Firebase console.

---

## 2 · Push the dashboard

```powershell
powershell -ExecutionPolicy Bypass -File .\push-to-admin-panel.ps1
```

Vercel deploys from `github.com/delito-food/Admin-panel`. Watch that build too —
it runs on Linux and will fetch its own SWC binary.

---

## 3 · Confirm an admin exists — do this immediately

Every `/api` route now verifies the token and checks admin authorisation. There
is a deliberate bootstrap escape hatch: while the `admins` collection is empty
*and* `ADMIN_EMAILS` is unset, any verified Firebase user is let through. It
exists so this change could not lock you out. **It closes itself the moment one
admin document exists.**

Open the Vercel logs and look for `[API Auth] BOOTSTRAP`. It should never
appear. If it does, the panel is open to any signed-in user of your Firebase
project — including customers of the Android app:

```powershell
npx ts-node scripts\create-admin.ts you@example.com <password> "Your Name"
```

Then reload the dashboard and confirm the line stops.

---

## 4 · Smoke-test the deploy

1. **Log in.** If the panel loads and lists orders, token verification works.
2. **Open an invoice preview.** It should show *"Draft — number issued on
   download"* and **no serial**. Note the current value of `counters/inv_26-27`
   (or its absence) before and after: previewing must not move it.
3. **Download one invoice.** It issues `DLT/26-27/000001` — the first of the new
   financial-year series. Check the PDF: Delito as supplier, the restaurant
   panel labelled *"RESTAURANT (order prepared by)"*, the bill summary footing
   to the total, and a *"You saved (incl. GST)"* line if the order was
   discounted.
4. **Re-download the same invoice.** Identical document, same serial, same date.
5. **Open an order that already has an `INV-2026-…` number.** It must keep that
   number, not draw a new one.
6. **Check the payouts screen.** It will read `balanceSource: "orders"` until
   step 5 — that is expected.

If any of these fail, stop and roll back before going further.

---

## 5 · Backfill the ledger

```powershell
node scripts\backfill-ledger.js --dry-run
```

Read the per-vendor and per-partner table it prints. **Every gap of ₹1 or more
is a real discrepancy that predates the ledger.** Understand them before your
next payout run — that table is the first honest comparison of the two records
that were previously reconciled with `Math.max()`.

```powershell
node scripts\backfill-ledger.js
```

Then reload the payouts screens: `balanceSource` should read `"ledger"` and
`discrepancies` should be empty for the vendors you expect.

---

## 6 · The CA pack

```powershell
node scripts\phase4-reconcile.js
```

Writes four workbooks into `ca-reconciliation-pack\`. Send that folder to your
CA. The one to read yourself first is `missed-from-filing.xlsx` — documents
dated on or before 31 July but numbered above `INV-2026-000078`, which belong in
a return that has already gone in.

The folder is excluded from the push script and from git: it carries vendor
turnover and GSTINs and should reach your CA directly, not a repository.

---

## 7 · The corrections — only after your CA signs off

```powershell
node scripts\phase4-issue-debit-notes.js            # dry run
node scripts\phase4-issue-debit-notes.js --confirm  # issue
node scripts\phase4-freeze-legacy.js                # dry run
node scripts\phase4-freeze-legacy.js --confirm      # close the legacy series
```

The debit notes correct commission that was under-invoiced. They consume serials
and become filed documents, so they wait on approval. Both scripts are
idempotent — a second run issues nothing.

---

## What changes for people on day one

- **Admins** — previewing an invoice no longer produces a number; downloading
  does. One "Invoice" button per order instead of three.
- **Customers** — one tax invoice per order, from Delito, replacing three
  documents that shared a serial and did not sum to what was charged.
- **Restaurants** — commission invoices now bill what was actually withheld.
  Their first invoice under the new series will be `DCM/26-27/000001`.
- **The Android apps** — unchanged. Nothing in `PricingCalculator.kt` or any app
  was modified, so no rebuild or release is needed.

## Rollback

- **Code** — `github.com/delito-food/Admin-panel` history; locally, the `*.bak`
  files beside each changed route.
- **Rules** — redeploy the previous `firestore.rules` from the PLATOOS repo.
- **Ledger rows** — additive and idempotent; leaving them costs nothing, and the
  payout screens fall back to deriving from orders if they are removed.
- **Issued documents** — a tax invoice, credit note or debit note cannot be
  rolled back. That is the point of them. Corrections go on a new document.

To relax admin *authorisation* without giving up token *verification*, set
`ADMIN_EMAILS` in Vercel rather than removing the `withAdmin()` wrappers.
