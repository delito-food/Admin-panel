# Continuing the invoice series from the CA's position

Your CA's message:

> `INV-2026-000078` food delivery, `DLT-COM-2607-069` vendor bill —
> last bill details as on 31.7.26

Everything after that is now numbered **in continuation**, oldest delivery first:

| | CA has up to | Continues as |
|---|---|---|
| Customer (food delivery) | `INV-2026-000078` | `INV-2026-000079`, `…080`, … |
| Restaurant commission | `DLT-COM-2607-069` | `DLT-COM-2608-070`, `…071`, … |

Decisions this is built on (27 Sep 2026):

- **Old format continues.** The `DLT/26-27/…` and `DCM/26-27/…` series are retired.
- **Every delivered order since 1 Aug gets a number**, including orders that never had an invoice opened.
- **Numbered by delivery date**, and the invoice date is the delivery date (date of supply).
- Renumbering is safe only because **no customer or restaurant has received any of those PDFs**.

## Steps (on your Windows PC, in `admin-dashboard`)

1. **Deploy the dashboard code first** (your usual push to Vercel). Until step 4 is done, downloading an invoice
   from the dashboard is **paused**: it shows *"Invoice numbering is paused…"*. That is intentional. It stops a
   number being issued from the wrong counter.

2. **Dry run.** This only reads Firestore and writes three Excel files:

   ```
   node scripts/renumber-invoice-series.js
   ```

   Output goes to `admin-dashboard/invoice-continuation/`:

   | File | What it is |
   |---|---|
   | `customer-invoices-continued.xlsx` | INV-2026-000079 onward: number, delivery date, order, restaurant, value, old number |
   | `commission-invoices-continued.xlsx` | DLT-COM-…-070 onward, month by month |
   | `exceptions.xlsx` | What to look at with the CA (see below) |

3. **Send the three files to your CA** and get an OK.

4. **Apply:**

   ```
   node scripts/renumber-invoice-series.js --confirm
   ```

   Invoice numbering in the dashboard resumes automatically from the last number.

## What is in `exceptions.xlsx`

| Type | Meaning |
|---|---|
| Delivered on/before cut-off (flagged rows in the customer file) | Delivered in July but had a number above 78. Now numbered first (079…). **Needs adding to the July return.** |
| No invoice — delivered on/before cut-off | A July order that never had an invoice. Not numbered. Ask the CA whether July's return covered it. |
| Moved into continuation — old number, delivered after cut-off | Had an old low number (e.g. DELITO-INV-2026-000041) but was delivered in August, so it can't be in the July filing. Now numbered in date order with the rest. |
| Duplicate number inside the filed range | Two July bills share a number ≤ 78 (old counter bug). Check which one the CA has. |
| Held back — month not finished | A commission bill created before its month ended. Number released; the full month is billed after month end. |
| Restaurant record missing | Commission for a vendor id that isn't in the vendors list. Fix the vendor before issuing. |
| Voided — nothing to bill | A number that was used up on a cancelled order or empty month, with no credit note. Removed. |
| Cannot issue — amounts do not add up | An order whose amounts don't reconcile. Fix it, then run the script again. |

Commission: only **completed** months get new invoices. September's go out when you run the script after 30 Sep.

## Every month before filing

Run the same two commands again, with the CA's new position:

```
node scripts/renumber-invoice-series.js --cutoff 2026-08-31 --last-invoice INV-2026-000xyz --last-commission DLT-COM-2608-0ab
```

Everything delivered after that position is numbered again in date order. Numbers the CA already has are never touched.

> Once you start sending invoice PDFs to customers or restaurants, stop renumbering:
> an invoice that has gone out must keep its number.

## Code changes

| File | Change |
|---|---|
| `src/lib/invoice-series.ts` | Customer serial `INV-<FY start year>-nnnnnn`, commission `DLT-COM-<YYMM>-nnn`; numbering is paused for FY 26-27 until the script has run |
| `src/lib/invoice-compose.ts` | New. The invoice builder moved out of the API route so the script builds exactly the same document |
| `src/app/api/invoices/[orderId]/route.ts` | Uses the shared builder; keeps a reserved number's invoice date |
| `src/app/api/vendors/commission-invoice/route.ts` | Month in the serial; saves the snapshot of a reserved invoice on its first download |
| `scripts/renumber-invoice-series.js` | New. The dry run / `--confirm` script |
| `scripts/verify-pricing-engine.js` | Serial checks updated to the new formats (39/39 pass) |

Backups of the originals: `../_backup_pre_invoicecontinuation_20260927/`.

**Do not run `scripts/phase4-freeze-legacy.js`**. It marks the INV / DLT-COM series as closed, and they are live again.
