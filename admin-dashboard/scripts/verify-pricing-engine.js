/**
 * Verification harness for lib/pricing-engine.ts.
 *
 *   node scripts/verify-pricing-engine.js
 *
 * Compiles the engine and its dependencies to a temporary directory, then runs
 * synthetic orders through it and asserts the invariants a tax invoice depends
 * on. Touches no network and no Firestore, so it runs anywhere.
 *
 * The invariant that matters most: for every order, the invoice's own parts sum
 * to the amount the customer was actually charged. That is the check the old
 * code never made, which is why COD invoices printed a bill summary that missed
 * the total by up to fifty paise with a Round Off line permanently at zero.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Invoke the compiler through the current Node binary rather than through
// npx: on Windows execFileSync('npx') does not resolve to npx.cmd and fails
// with ENOENT, which is where this script would have stopped.
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
// Compiled inside the project so that Node can resolve firebase-admin from
// node_modules — some engine modules import it at the top level even though
// the functions under test are pure.
const OUT = path.join(ROOT, 'node_modules', '.cache', 'delito-verify');
// The project folder may be mounted without delete permission, so the output
// directory is reused rather than removed; tsc overwrites what it emits.
fs.mkdirSync(OUT, { recursive: true });

process.stdout.write('Compiling engine… ');
try {
    execFileSync(process.execPath, [
        TSC,
        path.join(ROOT, 'src/lib/pricing-engine.ts'),
        path.join(ROOT, 'src/lib/invoice-document.ts'),
        path.join(ROOT, 'src/lib/fiscal.ts'),
        path.join(ROOT, 'src/lib/invoice-series.ts'),
        path.join(ROOT, 'src/lib/gst.ts'),
        path.join(ROOT, 'src/lib/credit-note.ts'),
        path.join(ROOT, 'src/lib/ledger.ts'),
        path.join(ROOT, 'src/lib/reconciliation.ts'),
        path.join(ROOT, 'src/lib/debit-note.ts'),
        '--outDir', OUT,
        '--module', 'commonjs',
        '--target', 'es2020',
        '--esModuleInterop',
        '--skipLibCheck',
        '--rootDir', path.join(ROOT, 'src/lib'),
    ], { cwd: ROOT, stdio: 'pipe' });
} catch (err) {
    console.log('FAILED');
    console.error(err.stdout?.toString() || err.message);
    process.exit(1);
}
console.log('ok');

const { computeOrderEconomics, computeCommission } = require(path.join(OUT, 'pricing-engine.js'));
const { assertIssuable } = require(path.join(OUT, 'invoice-document.js'));
const { istMonthBounds, istParts, financialYearOf, istInstant } = require(path.join(OUT, 'fiscal.js'));
const { formatSerial, parseSerial } = require(path.join(OUT, 'invoice-series.js'));
const { istFinancialQuarter, istDaysAgoStart, istTodayBounds, istMonthBoundsOffset } = require(path.join(OUT, 'fiscal.js'));
const { resolveStateCode, isInterState, splitTax, placeOfSupplyLabel } = require(path.join(OUT, 'gst.js'));
const { computeReversal } = require(path.join(OUT, 'credit-note.js'));
const { computeBalance, ledgerEntryId, divergence } = require(path.join(OUT, 'ledger.js'));
const { reconcileSeries, restateCommission, summariseRestatement, sequenceOf, CA_BASELINE, CUTOVER_COUNTERS } = require(path.join(OUT, 'reconciliation.js'));
const { computeDebitNote } = require(path.join(OUT, 'debit-note.js'));

let passed = 0;
const failures = [];

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  PASS  ${name}`);
    } catch (e) {
        failures.push({ name, message: e.message });
        console.log(`  FAIL  ${name}`);
        console.log(`        ${e.message}`);
    }
}

function eq(actual, expected, label, tolerance = 0.005) {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${label}: expected ${expected}, got ${actual}`);
    }
}
function assert(cond, message) {
    if (!cond) throw new Error(message);
}

/** Every invoice must foot. This is asserted on every case below. */
function assertFoots(e, label) {
    const sum = Math.round((e.taxableValue + e.totalTax + e.tip + e.roundOff) * 100) / 100;
    eq(sum, e.invoiceValue, `${label}: components do not sum to the invoice value`);
    eq(e.invoiceValue, e.reconciliation.orderTotal, `${label}: invoice value ≠ amount charged`);
    const heads = Math.round((e.cgst + e.sgst + e.igst) * 100) / 100;
    eq(heads, e.totalTax, `${label}: tax heads do not sum to total tax`);
}

const baseOrder = {
    status: 'delivered',
    itemTotal: 400, originalItemTotal: 400,
    deliveryFee: 30, smallOrderSupportFee: 0,
    gstOnFood: 20, gstOnServices: 5.4,
    total: 455.4,
    items: [{ name: 'Paneer Butter Masala', price: 400, originalPrice: 400, quantity: 1 }],
};

console.log('\n── Reconciliation ──');

check('plain order foots to the amount charged', () => {
    const e = computeOrderEconomics({ ...baseOrder }, 'o1');
    assertFoots(e, 'plain');
    eq(e.taxableValue, 430, 'taxable value');
    eq(e.totalTax, 25.4, 'total tax');
    assert(e.reconciliation.ok, 'should reconcile cleanly');
    assert(assertIssuable(e).ok, 'should be issuable');
});

check('COD whole-rupee rounding lands on Round Off, not in thin air', () => {
    // The app rounds a COD total to whole rupees: 455.4 → 455.
    const e = computeOrderEconomics({ ...baseOrder, total: 455, paymentMode: 'Cash on Delivery' }, 'o2');
    assertFoots(e, 'cod');
    eq(e.roundOff, -0.4, 'round off');
    assert(e.roundOff !== 0, 'Round Off must carry the rounding, not print zero');
    assert(assertIssuable(e).ok, 'should be issuable');
});

console.log('\n── Discounts reduce taxable value ──');

check('promo code reduces taxable value and tax, tax-inclusively', () => {
    const e = computeOrderEconomics({ ...baseOrder, promoDiscount: 50, total: 405.4 }, 'o3');
    assertFoots(e, 'promo');
    const food = e.components.find(c => c.key === 'food');
    // ₹50 off a 5%-rated supply is ₹47.62 of taxable value plus ₹2.38 of tax.
    eq(food.taxableValue, 352.38, 'food taxable value after promo');
    eq(food.totalTax, 17.62, 'food tax after promo');
    eq(e.totalDiscount, 50, 'saving reported to the customer stays the full ₹50');
});

check('coins and HungerGame stack without breaking the total', () => {
    const e = computeOrderEconomics({
        ...baseOrder, promoDiscount: 20, coinDiscount: 15,
        hungerGameDiscount: 25, hungerGameLevel1Discount: 25,
        total: 395.4,
    }, 'o4');
    assertFoots(e, 'stacked');
    eq(e.totalDiscount, 60, 'total savings');
    assert(e.discounts.some(d => d.key === 'coin'), 'coin discount must appear as a line');
});

check('free delivery is not credited twice', () => {
    // PricingCalculator already returns deliveryFee = 0; deliveryDiscount is a
    // display figure. Subtracting it again would produce a negative total.
    const e = computeOrderEconomics({
        ...baseOrder, deliveryFee: 0, deliveryDiscount: 30,
        gstOnServices: 0, total: 420,
    }, 'o5');
    assertFoots(e, 'free delivery');
    eq(e.invoiceValue, 420, 'total unaffected by the display-only waiver');
});

check('item discount sits in the line price, not as a second deduction', () => {
    const e = computeOrderEconomics({
        ...baseOrder,
        items: [{ name: 'Thali', price: 400, originalPrice: 500, quantity: 1 }],
    }, 'o6');
    assertFoots(e, 'item discount');
    eq(e.lines[0].taxableValue, 400, 'line taxable value is the discounted price');
    eq(e.lines[0].lineDiscount, 100, 'line discount reported for the savings figure');
    const food = e.components.find(c => c.key === 'food');
    eq(food.taxableValue, 400, 'item discount must not be deducted a second time');
});

console.log('\n── Tax heads ──');

check('intra-state splits CGST and SGST that sum exactly', () => {
    const e = computeOrderEconomics({ ...baseOrder, gstOnFood: 20.01, total: 455.41 }, 'o7');
    eq(e.cgst + e.sgst, e.totalTax, 'halves must sum back to the total');
    eq(e.igst, 0, 'no IGST on an intra-state supply');
});

check('inter-state carries IGST only', () => {
    const e = computeOrderEconomics({ ...baseOrder }, 'o8', { interState: true });
    assertFoots(e, 'interstate');
    eq(e.cgst, 0, 'CGST must be zero');
    eq(e.sgst, 0, 'SGST must be zero');
    eq(e.igst, 25.4, 'IGST carries the whole tax');
    assert(assertIssuable(e).ok, 'should be issuable');
});

console.log('\n── Commission ──');

check('commission is charged on the pre-discount item total', () => {
    const c = computeCommission({ itemTotal: 400, originalItemTotal: 500 }, 400, 15);
    eq(c.baseAmount, 500, 'base is the pre-discount total');
    eq(c.amount, 75, 'commission');
    eq(c.gst, 13.5, 'GST on commission');
});

check('commission billed equals commission withheld', () => {
    // The app wrote 75 onto the order; the invoice must bill exactly that.
    const c = computeCommission(
        { itemTotal: 400, originalItemTotal: 500, vendorPlatformCut: 75, vendorGstOnPlatformCut: 13.5 },
        400, 15
    );
    eq(c.amount, 75, 'must use the withheld figure');
    assert(c.fromStoredValues, 'should report that it came from the order');
});

console.log('\n── Refusing to issue a bad document ──');

check('an order whose fields disagree is not issuable', () => {
    const e = computeOrderEconomics({ ...baseOrder, total: 900 }, 'o9');
    assert(!e.reconciliation.ok, 'reconciliation must fail');
    const verdict = assertIssuable(e);
    assert(!verdict.ok, 'assertIssuable must refuse');
    assert(/unexplained/i.test(verdict.reason), `reason should name the residual, got: ${verdict.reason}`);
});

check('a zero-value order is not issuable', () => {
    const e = computeOrderEconomics({ status: 'delivered', items: [], total: 0 }, 'o10');
    assert(!assertIssuable(e).ok, 'nothing to invoice');
});

console.log('\n── Periods and series ──');

check('month boundaries are IST, not the host timezone', () => {
    // 02:00 IST on 1 March is 20:30 UTC on 28 February.
    const bounds = istMonthBounds('2026-03');
    const order = istInstant(2026, 3, 1, 2, 0);
    assert(order >= bounds.start, 'an order at 02:00 IST on the 1st belongs to March');
    const feb = istMonthBounds('2026-02');
    assert(order > feb.end, 'and must not fall into February');
    eq(istParts(order).month, 3, 'IST month');
});

check('financial year runs April to March', () => {
    eq(financialYearOf(istInstant(2026, 3, 31, 23, 0)).startYear, 2025, 'March belongs to the previous FY');
    eq(financialYearOf(istInstant(2026, 4, 1, 0, 30)).startYear, 2026, 'April opens a new FY');
    assert(financialYearOf(istInstant(2026, 9, 5)).label === '26-27', 'FY label');
});

check('serials fit Rule 46: 16 characters, round-trip cleanly', () => {
    const serial = formatSerial('invoice', '26-27', 137);
    eq(serial.length, 16, 'serial length');
    assert(serial === 'DLT/26-27/000137', `unexpected serial: ${serial}`);
    for (const key of ['invoice', 'creditNote', 'commission', 'commissionCreditNote']) {
        const s = formatSerial(key, '26-27', 1);
        assert(s.length <= 16, `${key} serial "${s}" is ${s.length} characters — Rule 46 caps it at 16`);
        assert(/^[A-Z0-9/-]+$/.test(s), `${key} serial has characters Rule 46 does not allow`);
    }
    const parsed = parseSerial('DCM/26-27/000072');
    assert(parsed.series === 'commission' && parsed.sequence === 72, 'serial should round-trip');
});


console.log('\n── Place of supply ──');

check('state code comes from the GSTIN, not a free-text field', () => {
    eq(resolveStateCode('09CAMPV6339R1ZD', 'anything').length, 2, 'code length');
    assert(resolveStateCode('09CAMPV6339R1ZD') === '09', 'UP is 09');
    assert(resolveStateCode('27AAPFU0939F1ZV') === '27', 'Maharashtra is 27');
});

check('a blank state no longer reads as same-state', () => {
    // The old substring test evaluated 'uttar pradesh'.includes('') === true,
    // so a vendor with no state was silently billed CGST + SGST.
    assert(resolveStateCode('', '') === null, 'blank state must not resolve');
    assert(resolveStateCode(null, 'Uttar') === null, 'a partial name must not match');
    assert(resolveStateCode(null, 'Uttar Pradesh') === '09', 'an exact name still matches');
});

check('supply type follows the two state codes', () => {
    assert(isInterState('09', '09') === false, 'same state');
    assert(isInterState('09', '27') === true, 'different state');
    assert(isInterState('09', null) === false, 'unknown recipient defaults to intra-state B2C');
    assert(placeOfSupplyLabel('09') === '09-Uttar Pradesh', 'GSTR-1 label form');
});

console.log('\n── Credit notes ──');

const invoiceComponents = [
    { key: 'food', label: 'Food', hsn: '9963', ratePercent: 5, grossTaxableValue: 400,
      discountOnTaxableValue: 0, taxableValue: 400, cgst: 10, sgst: 10, igst: 0, totalTax: 20, total: 420 },
    { key: 'delivery', label: 'Delivery', hsn: '996812', ratePercent: 18, grossTaxableValue: 30,
      discountOnTaxableValue: 0, taxableValue: 30, cgst: 2.7, sgst: 2.7, igst: 0, totalTax: 5.4, total: 35.4 },
];
const INVOICE_VALUE = 455.4;

check('a full credit note reverses the whole invoice', () => {
    const rev = computeReversal(invoiceComponents, INVOICE_VALUE, INVOICE_VALUE, false);
    eq(rev.taxableValue, 430, 'taxable value reversed');
    eq(rev.totalTax, 25.4, 'tax reversed');
    eq(rev.taxableValue + rev.totalTax + rev.roundOff, INVOICE_VALUE, 'credit note must foot');
    assert(rev.scope === 'FULL', 'scope');
});

check('a partial credit apportions across the rate mix', () => {
    const half = Math.round(INVOICE_VALUE / 2 * 100) / 100;
    const rev = computeReversal(invoiceComponents, half, INVOICE_VALUE, false);
    eq(rev.taxableValue + rev.totalTax + rev.roundOff, half, 'partial credit must foot');
    eq(rev.cgst + rev.sgst + rev.igst, rev.totalTax, 'tax heads must sum');
    assert(rev.scope === 'PARTIAL', 'scope');
    // Both rates must survive the apportionment, not collapse to one.
    assert(rev.components.length === 2, 'both components reversed');
    assert(rev.components[0].taxableValue > 0 && rev.components[1].taxableValue > 0, 'each component carries part of the credit');
});

check('an inter-state credit note reverses IGST only', () => {
    const igstComponents = invoiceComponents.map(c => ({ ...c, cgst: 0, sgst: 0, igst: c.totalTax }));
    const rev = computeReversal(igstComponents, INVOICE_VALUE, INVOICE_VALUE, true);
    eq(rev.cgst, 0, 'no CGST');
    eq(rev.sgst, 0, 'no SGST');
    eq(rev.igst, 25.4, 'IGST reversed');
});

console.log('\n── Ledger ──');

check('balance is the sum of its rows', () => {
    const b = computeBalance('v1', [
        { entryType: 'EARNING', amount: 400, occurredAt: '2026-09-01T00:00:00Z' },
        { entryType: 'COMMISSION', amount: -88.5, occurredAt: '2026-09-01T00:00:00Z' },
        { entryType: 'PAYOUT', amount: -200, occurredAt: '2026-09-05T00:00:00Z' },
    ]);
    eq(b.balance, 111.5, 'balance');
    eq(b.earnings, 400, 'earnings');
    eq(b.commission, 88.5, 'commission');
    eq(b.paidOut, 200, 'paid out');
    eq(b.entryCount, 3, 'row count');
    assert(b.lastEntryAt === '2026-09-05T00:00:00Z', 'last entry');
});

check('net payable is the balance plus what has been paid', () => {
    // This is the identity the payouts screen relies on.
    const b = computeBalance('v1', [
        { entryType: 'EARNING', amount: 1000 },
        { entryType: 'COMMISSION', amount: -177 },
        { entryType: 'PAYOUT', amount: -500 },
    ]);
    eq(b.balance + b.paidOut, 823, 'gross payable');
    eq(b.balance, 323, 'still owed');
});

check('a credit note reduces what the vendor is owed', () => {
    const b = computeBalance('v1', [
        { entryType: 'EARNING', amount: 400 },
        { entryType: 'CREDIT_NOTE', amount: -120 },
    ]);
    eq(b.balance, 280, 'balance after credit');
    eq(b.creditNotes, 120, 'credited');
});

check('posting the same source twice yields one row id', () => {
    const a = ledgerEntryId('vendor', 'v1', 'PAYOUT', 'payout-99');
    const b = ledgerEntryId('vendor', 'v1', 'PAYOUT', 'payout-99');
    assert(a === b, 'ids must match so a replay is a no-op');
    assert(!/[^A-Za-z0-9_.-]/.test(ledgerEntryId('vendor', 'v/1', 'PAYOUT', 'a b/c')), 'id must be path-safe');
});

check('divergence reports the gap instead of picking a winner', () => {
    const d = divergence(1000, 950);
    eq(d.gap, 50, 'gap');
    assert(d.agrees === false, 'must not agree');
    assert(divergence(1000, 1000).agrees === true, 'equal values agree');
});

check('financial quarters are IST and land on the right months', () => {
    const q1 = istFinancialQuarter(istInstant(2026, 5, 15));
    assert(q1.quarter === 'Q1', 'May is Q1');
    eq(istParts(q1.period.start).month, 4, 'Q1 starts in April');
    eq(istParts(q1.period.end).month, 6, 'Q1 ends in June');
    eq(istParts(q1.period.end).day, 30, 'June has 30 days');

    const q4 = istFinancialQuarter(istInstant(2026, 2, 10));
    assert(q4.quarter === 'Q4', 'February is Q4');
    eq(istParts(q4.period.start).month, 1, 'Q4 starts in January');
    eq(istParts(q4.period.end).month, 3, 'Q4 ends in March');
    assert(q4.label === 'Q4 FY2025-26', 'Q4 of Jan 2026 belongs to FY2025-26, got ' + q4.label);
});

check('a day boundary does not drift on a UTC host', () => {
    // 00:15 IST is 18:45 UTC the previous day. Under setHours() that order was
    // counted against yesterday.
    const justAfterMidnightIst = istInstant(2026, 9, 6, 0, 15);
    const bounds = istTodayBounds(justAfterMidnightIst);
    assert(justAfterMidnightIst >= bounds.start, 'must fall inside its own IST day');
    assert(justAfterMidnightIst <= bounds.end, 'must fall inside its own IST day');
    eq(istParts(bounds.start).day, 6, 'IST day');

    const sevenBack = istDaysAgoStart(7, justAfterMidnightIst);
    eq(istParts(sevenBack).day, 30, 'seven IST days before 6 Sep is 30 Aug');
    eq(istParts(sevenBack).hour, 0, 'and starts at IST midnight');
});

check('month offsets roll the year correctly', () => {
    const jan = istInstant(2026, 1, 10);
    const prev = istMonthBoundsOffset(1, jan);
    eq(istParts(prev.start).year, 2025, 'one month before January is December of the prior year');
    eq(istParts(prev.start).month, 12, 'December');
    eq(istParts(prev.end).day, 31, 'December has 31 days');
});

console.log('\n── Phase 4: reconciliation against the CA position ──');

check('sequences parse out of every serial format we have used', () => {
    eq(sequenceOf('INV-2026-000078'), 78, 'legacy customer');
    eq(sequenceOf('DLT-COM-2607-069'), 69, 'legacy commission — the trailing group, not the YYMM label');
    eq(sequenceOf('DLT/26-27/000137'), 137, 'current customer');
    eq(sequenceOf('DCM/26-27/000072'), 72, 'current commission');
    eq(sequenceOf('INV-2026-000042-F'), 42, 'a legacy sub-invoice suffix is not a sequence');
    assert(sequenceOf('') === null && sequenceOf(null) === null, 'empty input');
});

check('the CA baseline is the one stated', () => {
    assert(CA_BASELINE.lastInvoiceNumber === 'INV-2026-000078', 'customer serial');
    assert(CA_BASELINE.lastCommissionNumber === 'DLT-COM-2607-069', 'commission serial');
    assert(CA_BASELINE.cutoffDate === '2026-07-31', 'cut-off');
    eq(CUTOVER_COUNTERS.invoices - sequenceOf(CA_BASELINE.lastInvoiceNumber), 58, 'serials beyond the CA position');
    eq(CUTOVER_COUNTERS.commissionInvoices - sequenceOf(CA_BASELINE.lastCommissionNumber), 2, 'commission serials beyond');
});

check('a document dated inside a filed period but numbered above is flagged', () => {
    const rec = reconcileSeries('Customer', [
        { sequence: 77, serial: 'INV-2026-000077', docId: 'a', issuedAt: '2026-07-20T10:00:00+05:30' },
        { sequence: 78, serial: 'INV-2026-000078', docId: 'b', issuedAt: '2026-07-31T22:00:00+05:30' },
        // Numbered above the CA position, but issued INSIDE July — this is the
        // one that belongs in a return already filed.
        { sequence: 80, serial: 'INV-2026-000080', docId: 'c', issuedAt: '2026-07-25T09:00:00+05:30' },
        { sequence: 81, serial: 'INV-2026-000081', docId: 'd', issuedAt: '2026-08-04T09:00:00+05:30' },
    ], 136, 'INV-2026-000078', '2026-07-31');

    eq(rec.caLastSequence, 78, 'CA sequence');
    eq(rec.withinCaRange.length, 2, 'within range');
    eq(rec.beyondCaRange.length, 2, 'beyond range');
    eq(rec.missedFromFiling.length, 1, 'exactly one document missed from the filing');
    assert(rec.missedFromFiling[0].serial === 'INV-2026-000080', 'the July-dated one numbered above the cut-off');
    assert(rec.serialOrderMatchesDateOrder === false, 'serial order runs backwards against date here');
});

check('a serial inside the CA range but dated after the cut-off is flagged too', () => {
    const rec = reconcileSeries('Customer', [
        { sequence: 70, serial: 'INV-2026-000070', docId: 'a', issuedAt: '2026-08-10T09:00:00+05:30' },
    ], 136, 'INV-2026-000078', '2026-07-31');
    eq(rec.issuedLateWithinRange.length, 1, 'numbered within range, issued after the cut-off');
});

check('the cut-off is an IST day end, not a UTC one', () => {
    // 23:30 IST on 31 July is 18:00Z on 31 July — inside the period. Treating
    // the cut-off as a UTC midnight would push it into August.
    const rec = reconcileSeries('Customer', [
        { sequence: 90, serial: 'INV-2026-000090', docId: 'a', issuedAt: '2026-07-31T23:30:00+05:30' },
    ], 136, 'INV-2026-000078', '2026-07-31');
    eq(rec.missedFromFiling.length, 1, '23:30 IST on the 31st is still July');
});

check('gaps and duplicates are both found', () => {
    const rec = reconcileSeries('Customer', [
        { sequence: 1, serial: 'INV-2026-000001', docId: 'a', issuedAt: null },
        { sequence: 3, serial: 'INV-2026-000003', docId: 'b', issuedAt: null },
        { sequence: 3, serial: 'INV-2026-000003', docId: 'c', issuedAt: null },
    ], 5, 'INV-2026-000078', '2026-07-31');
    assert(JSON.stringify(rec.gaps) === JSON.stringify([2, 4, 5]), 'gaps: ' + rec.gaps.join(','));
    eq(rec.duplicates.length, 1, 'one duplicated sequence');
    eq(rec.duplicates[0].records.length, 2, 'two documents share it');
});

console.log('\n── Phase 4: commission restatement ──');

check('commission was UNDER-invoiced, so the remedy is a debit note', () => {
    const row = restateCommission({
        vendorId: 'v1', vendorName: 'Test', month: '2026-07', invoiceNumber: 'DLT-COM-2607-069',
        orderCount: 1, discountedBase: 400, originalBase: 500, ratePercent: 15, gstRatePercent: 18,
    });
    eq(row.billedCommission, 60, 'billed on the post-discount base');
    eq(row.correctCommission, 75, 'withheld on the pre-discount base');
    eq(row.deltaCommission, 15, 'shortfall');
    eq(row.deltaGst, 2.7, 'GST on the shortfall');
    eq(row.deltaTotal, 17.7, 'total to correct');
    assert(row.direction === 'under-invoiced', 'direction');
    assert(row.remedy === 'debit note', 'a credit note would move it the wrong way');
});

check('an undiscounted month needs no correction', () => {
    const row = restateCommission({
        vendorId: 'v1', vendorName: 'Test', month: '2026-07', invoiceNumber: 'X',
        orderCount: 1, discountedBase: 500, originalBase: 500, ratePercent: 15, gstRatePercent: 18,
    });
    eq(row.deltaTotal, 0, 'no delta');
    assert(row.remedy === 'none', 'nothing to issue');
});

check('restatement totals add up across vendors', () => {
    const mk = (d, o) => restateCommission({ vendorId: 'v', vendorName: 'v', month: '2026-07',
        invoiceNumber: 'X', orderCount: 1, discountedBase: d, originalBase: o, ratePercent: 15, gstRatePercent: 18 });
    const t = summariseRestatement([mk(400, 500), mk(1000, 1000), mk(200, 260)]);
    eq(t.rows, 3, 'rows');
    eq(t.underInvoiced, 2, 'two under-invoiced');
    eq(t.deltaCommission, 24, 'commission shortfall 15 + 0 + 9');
    eq(t.deltaTotal, 28.32, 'with GST');
});

check('a debit note carries tax on the raised value and foots', () => {
    const t = computeDebitNote(15, 18, false);
    eq(t.taxableValue, 15, 'raised value');
    eq(t.totalTax, 2.7, 'tax');
    eq(t.cgst + t.sgst + t.igst, t.totalTax, 'heads sum');
    eq(t.taxableValue + t.totalTax, t.debitValue, 'note foots');
    const inter = computeDebitNote(15, 18, true);
    eq(inter.igst, 2.7, 'inter-state is IGST only');
    eq(inter.cgst, 0, 'no CGST');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  • ${f.name}: ${f.message}`));
    process.exit(1);
}
console.log('All invoice invariants hold.');
