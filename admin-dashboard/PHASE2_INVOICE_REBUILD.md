# Phase 2 — the invoice becomes a document

Follows `PHASE1_INVOICE_BASELINE.md`. Phase 1 stopped serials leaking and closed
the auth hole; Phase 2 makes the invoice itself correct and immutable.

## The two decisions this was built on

**1. Delito is the supplier of record (GST s.9(5)).**
For restaurant service, and for delivery service supplied through the platform,
Delito is liable to pay the tax and issues the invoice in its own name.

Consequence: **one order, one tax invoice**, under Delito's GSTIN
`09CAMPV6339R1ZD`, covering food (5%), delivery (18%) and platform fee (18%).
The `?type=food|delivery|platform` split is gone. It issued three documents
sharing one serial with `-F`/`-D`/`-P` suffixes, attributed to three different
suppliers — one of them a delivery partner with no GSTIN — whose totals did not
sum back to the order. The parameter is accepted and ignored so old links still
work. The restaurant and delivery partner now appear on the invoice as
references, clearly labelled as such.

**2. Promo codes, coins and HungerGame rewards reduce the taxable value.**

These are applied by the app *after* GST is added, so the rupees the customer
saved include the tax on them. Treating them as reducing taxable value therefore
means splitting each saving the same way the charge was made: a taxable-value
part and a tax part. `₹50` off a 5%-rated supply is `₹47.62` of taxable value
plus `₹2.38` of tax.

This is what keeps the invoice equal to the amount actually charged. It also
decides how the bill summary reads: each discount line shows its taxable-value
portion, because the tax line beneath is already net — showing the full `₹50`
there would subtract its tax twice and the column would not foot. The full
saving appears as a separate **"You saved (incl. GST) ₹50.00"** line, which is
the figure the customer recognises from checkout.

**3. Commission is charged on the pre-discount item total.** *(your call —
matches what has actually been withheld since launch, so no restitution)*

## New modules

| File | What it owns |
|---|---|
| `src/lib/pricing-engine.ts` | Every money figure for an order. Ported from `PricingCalculator.kt`, which stays the source of truth for constants. |
| `src/lib/fiscal.ts` | IST dates, tax periods, Indian financial years. Nothing reads the host timezone. |
| `src/lib/gst.ts` | Rates, HSN codes, place of supply from GSTIN state code, tax splitting. |
| `src/lib/invoice-document.ts` | The frozen `StoredInvoice` schema and the issuability gate. |
| `src/lib/invoice-series.ts` | The four FY-scoped serial series. |
| `src/lib/invoice-render.ts` | `StoredInvoice` → PDF. Reads nothing but the stored document. |

## Numbering

| Series | Format | Counter | Chars |
|---|---|---|---|
| Customer tax invoice | `DLT/26-27/000137` | `counters/inv_26-27` | 16 |
| Credit note | `DCN/26-27/000001` | `counters/cn_26-27` | 16 |
| Commission invoice | `DCM/26-27/000072` | `counters/com_26-27` | 16 |
| Commission credit note | `DCC/26-27/000001` | `counters/comcn_26-27` | 16 |

Rule 46 caps a serial at 16 characters. The form floated in the audit,
`DLT/COM/26-27/0001`, is 18 — hence `DCM`. Counters reset on 1 April.

**Legacy serials are carried forward, never replaced.** An order already
holding `INV-2026-000042` keeps it: the record is upgraded in place to a stored
document and the counter is not touched. Drawing a fresh serial would put two
numbers against one supply. The closed series remain readable.

## What each finding got

| # | Fix |
|---|---|
| F-04 | Commission billed = commission withheld. The invoice sums the per-order `vendorPlatformCut` the app actually deducted, instead of recomputing 15% of the post-discount monthly total. This also removes the drift from rounding weekly subtotals and rounding again. |
| F-06 | The whole document is stored at issue under `invoices/{orderId}` and re-rendered from storage. Invoice date is the date the serial was allocated. Commission invoices render from their snapshot once issued. |
| F-08 | `roundOff` is computed, not hardcoded to `0`. COD whole-rupee rounding lands on that line. Nothing can be issued unless the parts sum to the amount charged. |
| F-09 | One tax computation per invoice. The summary and the HSN table are the same numbers. |
| F-10 | Discounts reduce taxable value, split tax-inclusively (above). |
| F-11 | Item discount lives in the line price and is reported once, as a saving. |
| F-12 | Dissolved — there is one invoice. |
| F-13 | All periods in `Asia/Kolkata`, everywhere. An order at 02:00 IST on the 1st stays in that month. |
| F-15 | Place of supply from the GSTIN state code, or an exact state-name match. Never a substring — which is what read a blank state as "same state". |
| F-16 | `sgst = total − cgst`, so the halves always sum back. |
| F-17 | FY-scoped series, allocated in date order. |
| F-19 | Commission out of the B2C bucket; `GST_RATES.IGST` no longer passed as the food *rate*. IGST buckets carried through. |
| F-20 | Delito is the supplier of record. |
| F-21 | `??`-style fallbacks; a legitimate `0` is no longer replaced. |
| F-22 | Point reads for vendor and delivery partner; single-field query for a vendor's orders instead of loading the whole collection. |
| F-23 | Vendors with an issued invoice stay in the listing even at zero orders. |

Still open, by design: **F-07** (credit notes), **F-14** (the payout `Math.max`),
**F-18** (report built from documents rather than orders). All Phase 3. The
payout divergence is now *reported* as `paidAmountDivergence` rather than hidden.

## Verify

```bash
cd admin-dashboard
npx tsc --noEmit                        # types, incl. route contracts
node scripts/verify-pricing-engine.js   # 15 invoice invariants
npm run build                           # run on Windows — see below
```

`verify-pricing-engine.js` compiles the engine and runs synthetic orders through
it, asserting that every invoice foots to the amount charged, that discounts
reduce taxable value without double-crediting a free-delivery waiver, that tax
heads sum exactly, that inter-state carries IGST only, that commission uses the
pre-discount base, that a self-inconsistent order is refused, that IST month
boundaries hold, and that every serial fits Rule 46. All 15 pass.

`npm run build` could not be run here: `node_modules` holds the Windows SWC
binary and the sandbox has no network to fetch a Linux one.

## Before deploying

1. **Re-check `admins` is populated** — watch for `[API Auth] BOOTSTRAP` in the
   logs (Phase 1).
2. **Confirm the two policy answers with your CA in writing.** They are encoded
   in `pricing-engine.ts`; changing either later means reissuing invoices.
3. **Issue one invoice on a test order and read the PDF.** Check the supplier
   block reads Delito, the restaurant panel is labelled as a reference, the bill
   summary foots, and the "You saved" line matches the customer's checkout.
4. **Old invoices reprint under their old numbers.** Confirm on an order that
   already has an `INV-2026-…` serial.

## Rollback

Pre-Phase-2 copies are beside the originals:
`src/app/api/invoices/[orderId]/route.ts.phase1.bak`,
`src/app/api/vendors/commission-invoice/route.ts.phase1.bak`,
`src/app/api/reports/gst/route.ts.phase1.bak`,
`src/lib/invoice-pdf.ts.phase1.bak`.
The published history is in `github.com/delito-food/Admin-panel`.
