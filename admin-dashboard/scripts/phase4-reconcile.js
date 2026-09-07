/**
 * Phase 4 — the reconciliation pack for the chartered accountant.
 *
 *   node scripts/phase4-reconcile.js                       # report + workbooks
 *   node scripts/phase4-reconcile.js --out ./ca-pack       # choose the folder
 *   node scripts/phase4-reconcile.js --cutoff 2026-07-31 \
 *        --last-invoice INV-2026-000078 \
 *        --last-commission DLT-COM-2607-069
 *
 * Read-only against Firestore. Writes only the workbooks.
 *
 * The CA's stated position as at 31 July 2026 is the baseline:
 *
 *   INV-2026-000078    last customer food-delivery invoice
 *   DLT-COM-2607-069   last vendor commission invoice
 *
 * Everything issued beyond those serials has to be explained, and — because
 * serials used to be allocated when someone opened a preview rather than when
 * an order was billed — some documents DATED inside the filed period carry
 * serials above them. Those are the ones that matter: they belong in a return
 * that has already gone in.
 */

const admin = require('firebase-admin');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Invoke the compiler through the current Node binary rather than through
// npx: on Windows execFileSync('npx') does not resolve to npx.cmd and fails
// with ENOENT, which is where this script would have stopped.
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CUTOFF = arg('cutoff', '2026-07-31');
const LAST_INVOICE = arg('last-invoice', 'INV-2026-000078');
const LAST_COMMISSION = arg('last-commission', 'DLT-COM-2607-069');
const OUT_DIR = path.resolve(ROOT, arg('out', 'ca-reconciliation-pack'));

// ── Compile the shared logic so the script and the app agree ──
const BUILD = path.join(ROOT, 'node_modules', '.cache', 'delito-phase4');
fs.mkdirSync(BUILD, { recursive: true });
process.stdout.write('Compiling shared logic… ');
try {
    execFileSync(process.execPath, [
        TSC,
        path.join(ROOT, 'src/lib/reconciliation.ts'),
        path.join(ROOT, 'src/lib/xlsx-writer.ts'),
        path.join(ROOT, 'src/lib/fiscal.ts'),
        '--outDir', BUILD,
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

const {
    reconcileSeries, restateCommission, summariseRestatement, sequenceOf,
} = require(path.join(BUILD, 'reconciliation.js'));
const { buildXlsx } = require(path.join(BUILD, 'xlsx-writer.js'));
const { istMonthBounds, withinPeriod, toDate } = require(path.join(BUILD, 'fiscal.js'));

// ── Firestore ──
const env = {};
fs.readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n').forEach((line) => {
    const m = line.replace('\r', '').match(/^([^#\s][^=]+)="?(.*?)"?$/);
    if (!m) return;
    let v = m[2];
    if (v.includes('\\n')) v = v.replace(/\\n/g, '\n');
    env[m[1]] = v;
});
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
});
const db = admin.firestore();

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const money = (n) => n.toFixed(2);
const iso = (v) => {
    const d = toDate(v);
    return d ? d.toISOString() : null;
};

function saveSheet(spec, filename) {
    const bytes = buildXlsx(spec);
    const file = path.join(OUT_DIR, filename);
    fs.writeFileSync(file, Buffer.from(bytes));
    return file;
}

const META = [
    { label: 'Legal name', value: 'Delito' },
    { label: 'GSTIN', value: '09CAMPV6339R1ZD' },
    { label: 'Position stated as at', value: CUTOFF },
    { label: 'Last customer invoice on record', value: LAST_INVOICE },
    { label: 'Last commission invoice on record', value: LAST_COMMISSION },
    { label: 'Pack generated', value: new Date().toISOString() },
];

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log('\nDelito — Phase 4 reconciliation');
    console.log(`Baseline: ${LAST_INVOICE} / ${LAST_COMMISSION} as at ${CUTOFF}\n`);

    // ── Counters ──
    const [invCounter, comCounter] = await Promise.all([
        db.collection('counters').doc('invoices').get(),
        db.collection('counters').doc('commissionInvoices').get(),
    ]);
    const invCounterValue = num(invCounter.data()?.lastNumber);
    const comCounterValue = num(comCounter.data()?.count) || num(comCounter.data()?.lastNumber);

    // ── Customer invoices ──
    const invoiceSnap = await db.collection('invoices').get();
    const invoiceRecords = [];
    invoiceSnap.docs.forEach((doc) => {
        const d = doc.data();
        if (!d.invoiceNumber) return;
        const seq = sequenceOf(d.invoiceNumber);
        if (seq == null) return;
        invoiceRecords.push({
            sequence: seq,
            serial: String(d.invoiceNumber),
            docId: doc.id,
            issuedAt: iso(d.issuedAtTs || d.issuedAt || d.createdAt),
            orderId: d.orderId || doc.id,
            vendorId: d.vendorId || '',
            amount: r2(num(d.totals?.invoiceValue) || num(d.total)),
        });
    });

    // ── Commission invoices ──
    const commissionSnap = await db.collection('commissionInvoices').get();
    const commissionRecords = [];
    commissionSnap.docs.forEach((doc) => {
        const d = doc.data();
        if (!d.invoiceNumber) return;
        const seq = sequenceOf(d.invoiceNumber);
        if (seq == null) return;
        commissionRecords.push({
            sequence: seq,
            serial: String(d.invoiceNumber),
            docId: doc.id,
            issuedAt: iso(d.issuedAt),
            vendorId: d.vendorId || '',
            vendorName: d.vendorName || d.snapshot?.vendorName || '',
            month: d.month || '',
            amount: r2(num(d.totalDeduction) || num(d.snapshot?.monthlyTotals?.totalDeduction)),
        });
    });

    const invoiceRec = reconcileSeries('Customer tax invoices', invoiceRecords, invCounterValue, LAST_INVOICE, CUTOFF);
    const commissionRec = reconcileSeries('Commission invoices', commissionRecords, comCounterValue, LAST_COMMISSION, CUTOFF);

    for (const rec of [invoiceRec, commissionRec]) {
        console.log(`─── ${rec.seriesLabel} ${'─'.repeat(Math.max(0, 46 - rec.seriesLabel.length))}`);
        console.log(`  counter                              ${rec.counterValue}`);
        console.log(`  documents found                      ${rec.documentCount}`);
        console.log(`  highest serial issued                ${rec.highestIssued}`);
        console.log(`  CA has up to                         ${rec.caLastSerial} (seq ${rec.caLastSequence})`);
        console.log(`  gaps (serial handed out, no document) ${rec.gaps.length}`);
        console.log(`  duplicate serials                    ${rec.duplicates.length}`);
        console.log(`  beyond the CA's last serial          ${rec.beyondCaRange.length}`);
        console.log(`  ⚠ dated on/before cut-off but numbered above  ${rec.missedFromFiling.length}`);
        console.log(`  ⚠ numbered within range but dated after       ${rec.issuedLateWithinRange.length}`);
        console.log(`  serial order follows date order      ${rec.serialOrderMatchesDateOrder ? 'yes' : 'NO'}`);
        if (rec.duplicates.length) {
            console.log('  duplicates:');
            rec.duplicates.forEach((d) => {
                console.log(`    seq ${d.sequence}: ${d.records.map(r => `${r.serial} (${r.docId})`).join('  ||  ')}`);
            });
        }
        console.log();
    }

    // ── Commission restatement ──
    const settingsDoc = await db.collection('platformSettings').doc('commission').get();
    const defaultRate = settingsDoc.exists ? (num(settingsDoc.data()?.defaultRate) || 15) : 15;
    const vendorSnap = await db.collection('vendors').get();
    const vendors = {};
    vendorSnap.docs.forEach((d) => { vendors[d.id] = d.data(); });

    const orderSnap = await db.collection('orders').get();
    const orders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const restatementRows = [];
    for (const rec of commissionRecords) {
        const period = istMonthBounds(rec.month);
        if (!period) continue;
        const v = vendors[rec.vendorId] || {};
        const rate = num(v.commissionRate) || defaultRate;

        const monthOrders = orders.filter((o) => {
            if (o.vendorId !== rec.vendorId) return false;
            const s = String(o.status || '').toLowerCase();
            if (s !== 'delivered' && s !== 'completed') return false;
            const d = toDate(o.deliveredAt) || toDate(o.createdAt);
            return d ? withinPeriod(d, period) : false;
        });

        const discountedBase = r2(monthOrders.reduce((s, o) => s + (num(o.itemTotal) || num(o.subtotal)), 0));
        const originalBase = r2(monthOrders.reduce(
            (s, o) => s + (num(o.originalItemTotal) || num(o.itemTotal) || num(o.subtotal)), 0));

        restatementRows.push(restateCommission({
            vendorId: rec.vendorId,
            vendorName: rec.vendorName || v.shopName || v.fullName || rec.vendorId,
            month: rec.month,
            invoiceNumber: rec.serial,
            orderCount: monthOrders.length,
            discountedBase,
            originalBase,
            ratePercent: rate,
            gstRatePercent: 18,
        }));
    }

    const totals = summariseRestatement(restatementRows);
    console.log('─── Commission restatement ────────────────────');
    console.log(`  commission invoices examined         ${totals.rows}`);
    console.log(`  under-invoiced                       ${totals.underInvoiced}`);
    console.log(`  over-invoiced                        ${totals.overInvoiced}`);
    console.log(`  commission shortfall                 ₹${money(totals.deltaCommission)}`);
    console.log(`  GST on the shortfall                 ₹${money(totals.deltaGst)}`);
    console.log(`  total to correct by debit note       ₹${money(totals.deltaTotal)}`);
    console.log();

    // ── Workbooks ──
    const written = [];

    written.push(saveSheet({
        sheetName: 'Invoice register',
        title: 'Customer tax invoice register',
        subtitle: `Every serial ever issued, against the position stated as at ${CUTOFF}`,
        meta: META,
        columns: [
            { header: 'Seq', key: 'sequence', width: 8, type: 'number' },
            { header: 'Invoice No.', key: 'serial', width: 22 },
            { header: 'Order ID', key: 'orderId', width: 26 },
            { header: 'Issued At (UTC)', key: 'issuedAt', width: 24 },
            { header: 'Invoice Value', key: 'amount', width: 15, type: 'currency' },
            { header: 'Position vs CA', key: 'position', width: 30 },
        ],
        rows: [...invoiceRec.withinCaRange, ...invoiceRec.beyondCaRange]
            .sort((a, b) => a.sequence - b.sequence)
            .map((r) => ({
                ...r,
                position: r.sequence <= invoiceRec.caLastSequence
                    ? (invoiceRec.issuedLateWithinRange.includes(r) ? 'within range — but dated after cut-off' : 'filed')
                    : (invoiceRec.missedFromFiling.includes(r) ? 'MISSED FROM FILING — dated on/before cut-off' : 'issued after cut-off'),
            })),
        notes: [
            `Counter stood at ${invoiceRec.counterValue}; ${invoiceRec.documentCount} documents carry a serial.`,
            `${invoiceRec.gaps.length} serials were handed out that no document ever claimed — see the gap register.`,
            'Serials were allocated when an invoice was first opened, not when the order was billed, so serial order does not follow invoice date.',
        ],
    }, 'invoice-register.xlsx'));

    written.push(saveSheet({
        sheetName: 'Gap register',
        title: 'Unclaimed serials',
        subtitle: 'Every number the counter issued that no document ever claimed',
        meta: META,
        columns: [
            { header: 'Series', key: 'series', width: 26 },
            { header: 'Missing Seq', key: 'sequence', width: 14, type: 'number' },
            { header: 'Within CA range', key: 'withinCa', width: 16 },
            { header: 'Explanation', key: 'cause', width: 58 },
        ],
        rows: [
            ...invoiceRec.gaps.map((seq) => ({
                series: 'Customer tax invoice',
                sequence: seq,
                withinCa: seq <= invoiceRec.caLastSequence ? 'yes' : 'no',
                cause: 'Serial consumed by an invoice preview that was never downloaded, or by a write that failed after the counter moved. No supply took place.',
            })),
            ...commissionRec.gaps.map((seq) => ({
                series: 'Commission invoice',
                sequence: seq,
                withinCa: seq <= commissionRec.caLastSequence ? 'yes' : 'no',
                cause: 'Serial consumed without a document being written. No supply took place.',
            })),
        ],
        notes: [
            'A documented gap is defensible; an unexplained one is what an audit objects to.',
            'Both causes were fixed in Phase 1: a serial is now allocated only inside the transaction that writes the document claiming it, and previews never allocate.',
        ],
    }, 'gap-register.xlsx'));

    written.push(saveSheet({
        sheetName: 'Missed from filing',
        title: 'Documents dated inside a filed period but numbered above the CA position',
        subtitle: `Dated on or before ${CUTOFF}, serial above ${LAST_INVOICE} / ${LAST_COMMISSION}`,
        meta: META,
        columns: [
            { header: 'Series', key: 'series', width: 26 },
            { header: 'Seq', key: 'sequence', width: 8, type: 'number' },
            { header: 'Serial', key: 'serial', width: 22 },
            { header: 'Reference', key: 'reference', width: 26 },
            { header: 'Issued At (UTC)', key: 'issuedAt', width: 24 },
            { header: 'Value', key: 'amount', width: 15, type: 'currency' },
        ],
        rows: [
            ...invoiceRec.missedFromFiling.map((r) => ({ ...r, series: 'Customer tax invoice', reference: r.orderId })),
            ...commissionRec.missedFromFiling.map((r) => ({ ...r, series: 'Commission invoice', reference: `${r.vendorName} ${r.month}` })),
        ],
        notes: [
            'Each row belongs in a tax period that has already been filed and needs an amendment in the next return.',
            'This is the direct consequence of allocating serials on preview: an older order opened later took a higher number.',
        ],
    }, 'missed-from-filing.xlsx'));

    written.push(saveSheet({
        sheetName: 'Commission restatement',
        title: 'Commission billed against commission withheld',
        subtitle: 'The invoice billed on the post-discount total; the app withheld on the pre-discount total',
        meta: META,
        columns: [
            { header: 'Invoice No.', key: 'invoiceNumber', width: 22 },
            { header: 'Restaurant', key: 'vendorName', width: 28 },
            { header: 'Month', key: 'month', width: 12 },
            { header: 'Orders', key: 'orderCount', width: 10, type: 'number' },
            { header: 'Billed Base (post-disc.)', key: 'billedBaseAmount', width: 20, type: 'currency' },
            { header: 'Billed Commission', key: 'billedCommission', width: 18, type: 'currency' },
            { header: 'Billed GST', key: 'billedGst', width: 14, type: 'currency' },
            { header: 'Correct Base (pre-disc.)', key: 'correctBaseAmount', width: 20, type: 'currency' },
            { header: 'Correct Commission', key: 'correctCommission', width: 18, type: 'currency' },
            { header: 'Correct GST', key: 'correctGst', width: 14, type: 'currency' },
            { header: 'Shortfall — Commission', key: 'deltaCommission', width: 20, type: 'currency' },
            { header: 'Shortfall — GST', key: 'deltaGst', width: 16, type: 'currency' },
            { header: 'Shortfall — Total', key: 'deltaTotal', width: 17, type: 'currency' },
            { header: 'Remedy', key: 'remedy', width: 14 },
        ],
        rows: restatementRows,
        totals: {
            invoiceNumber: 'TOTAL',
            orderCount: restatementRows.reduce((s, r) => s + r.orderCount, 0),
            billedCommission: r2(restatementRows.reduce((s, r) => s + r.billedCommission, 0)),
            billedGst: r2(restatementRows.reduce((s, r) => s + r.billedGst, 0)),
            correctCommission: r2(restatementRows.reduce((s, r) => s + r.correctCommission, 0)),
            correctGst: r2(restatementRows.reduce((s, r) => s + r.correctGst, 0)),
            deltaCommission: totals.deltaCommission,
            deltaGst: totals.deltaGst,
            deltaTotal: totals.deltaTotal,
        },
        notes: [
            'Commission was UNDER-invoiced: more was withheld from the restaurant than the invoice documented.',
            'The remedy under s.34(3) is a DEBIT note raising the value of each affected invoice — not a credit note.',
            'Issue them with: node scripts/phase4-issue-debit-notes.js --confirm',
        ],
    }, 'commission-restatement.xlsx'));

    console.log('─── Workbooks written ─────────────────────────');
    written.forEach((f) => console.log('  ' + path.relative(ROOT, f)));

    console.log('\n─── What to hand the CA ───────────────────────');
    console.log(`  1. invoice-register.xlsx        every serial, and where it sits against ${LAST_INVOICE}`);
    console.log('  2. gap-register.xlsx            each unclaimed number with its explanation');
    console.log('  3. missed-from-filing.xlsx      documents belonging to periods already filed');
    console.log('  4. commission-restatement.xlsx  the shortfall, per vendor-month, and the remedy');
    console.log('\nAmending a filed GSTR-1, and the route for the commission shortfall, are filing');
    console.log('decisions with penalty exposure. This pack is the input; the CA makes the call.');
    process.exit(0);
})().catch((e) => {
    console.error('\nReconciliation failed:', e.message);
    process.exit(1);
});
