/**
 * Phase 4 — issue the commission debit notes.
 *
 *   node scripts/phase4-issue-debit-notes.js              # DRY RUN, writes nothing
 *   node scripts/phase4-issue-debit-notes.js --confirm    # issue them
 *
 * Run scripts/phase4-reconcile.js first and have the CA approve the
 * restatement. This script issues one debit note per affected commission
 * invoice, raising it to the commission that was actually withheld.
 *
 * Idempotent: the note id is derived from the invoice it corrects, so a second
 * run issues nothing and reports each one as already present.
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
const CONFIRM = process.argv.includes('--confirm');

const env = {};
fs.readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n').forEach((line) => {
    const m = line.replace('\r', '').match(/^([^#\s][^=]+)="?(.*?)"?$/);
    if (!m) return;
    let v = m[2];
    if (v.includes('\\n')) v = v.replace(/\\n/g, '\n');
    env[m[1]] = v;
});
// lib/firebase-admin.ts initialises from the environment.
process.env.FIREBASE_PROJECT_ID = env.FIREBASE_PROJECT_ID;
process.env.FIREBASE_CLIENT_EMAIL = env.FIREBASE_CLIENT_EMAIL;
process.env.FIREBASE_PRIVATE_KEY = env.FIREBASE_PRIVATE_KEY;

const BUILD = path.join(ROOT, 'node_modules', '.cache', 'delito-phase4');
fs.mkdirSync(BUILD, { recursive: true });
process.stdout.write('Compiling… ');
try {
    execFileSync(process.execPath, [
        TSC,
        path.join(ROOT, 'src/lib/debit-note.ts'),
        path.join(ROOT, 'src/lib/reconciliation.ts'),
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

const { issueDebitNote } = require(path.join(BUILD, 'debit-note.js'));
const { restateCommission, summariseRestatement } = require(path.join(BUILD, 'reconciliation.js'));
const { istMonthBounds, withinPeriod, toDate } = require(path.join(BUILD, 'fiscal.js'));

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

(async () => {
    console.log(`\nDelito — commission debit notes${CONFIRM ? '' : '  (DRY RUN — nothing will be written)'}\n`);

    const settingsDoc = await db.collection('platformSettings').doc('commission').get();
    const defaultRate = settingsDoc.exists ? (num(settingsDoc.data()?.defaultRate) || 15) : 15;

    const vendorSnap = await db.collection('vendors').get();
    const vendors = {};
    vendorSnap.docs.forEach((d) => { vendors[d.id] = d.data(); });

    const orderSnap = await db.collection('orders').get();
    const orders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const commissionSnap = await db.collection('commissionInvoices').get();
    const rows = [];

    for (const doc of commissionSnap.docs) {
        const d = doc.data();
        if (!d.invoiceNumber || !d.vendorId || !d.month) continue;
        const period = istMonthBounds(d.month);
        if (!period) continue;

        const v = vendors[d.vendorId] || {};
        const rate = num(v.commissionRate) || defaultRate;

        const monthOrders = orders.filter((o) => {
            if (o.vendorId !== d.vendorId) return false;
            const s = String(o.status || '').toLowerCase();
            if (s !== 'delivered' && s !== 'completed') return false;
            const dt = toDate(o.deliveredAt) || toDate(o.createdAt);
            return dt ? withinPeriod(dt, period) : false;
        });

        const row = restateCommission({
            vendorId: d.vendorId,
            vendorName: d.vendorName || d.snapshot?.vendorName || v.shopName || d.vendorId,
            month: d.month,
            invoiceNumber: d.invoiceNumber,
            orderCount: monthOrders.length,
            discountedBase: r2(monthOrders.reduce((s, o) => s + (num(o.itemTotal) || num(o.subtotal)), 0)),
            originalBase: r2(monthOrders.reduce(
                (s, o) => s + (num(o.originalItemTotal) || num(o.itemTotal) || num(o.subtotal)), 0)),
            ratePercent: rate,
            gstRatePercent: 18,
        });
        rows.push({ row, docId: doc.id, alreadyDebited: !!d.debitedTotal });
    }

    const needed = rows.filter((r) => r.row.remedy === 'debit note');
    const totals = summariseRestatement(needed.map((r) => r.row));

    console.log('Invoice              Restaurant                    Month     Shortfall   GST      Total');
    console.log('─'.repeat(92));
    needed.forEach(({ row, alreadyDebited }) => {
        console.log(
            row.invoiceNumber.padEnd(20) +
            String(row.vendorName).slice(0, 28).padEnd(30) +
            row.month.padEnd(10) +
            row.deltaCommission.toFixed(2).padStart(10) +
            row.deltaGst.toFixed(2).padStart(9) +
            row.deltaTotal.toFixed(2).padStart(10) +
            (alreadyDebited ? '  (already raised)' : '')
        );
    });
    console.log('─'.repeat(92));
    console.log(
        'TOTAL'.padEnd(60) +
        totals.deltaCommission.toFixed(2).padStart(10) +
        totals.deltaGst.toFixed(2).padStart(9) +
        totals.deltaTotal.toFixed(2).padStart(10)
    );

    if (rows.some((r) => r.row.direction === 'over-invoiced')) {
        console.log('\n⚠ Some invoices are OVER-invoiced. Those need CREDIT notes, not debit notes,');
        console.log('  and are not issued by this script. Raise them from the Credit Notes screen.');
    }

    if (!CONFIRM) {
        console.log('\nDry run. Have the CA approve the restatement, then re-run with --confirm.');
        process.exit(0);
    }

    console.log('\nIssuing…');
    let issued = 0, skipped = 0, failed = 0;
    for (const { row, docId } of needed) {
        try {
            const result = await issueDebitNote({
                target: 'commission',
                invoiceDocId: docId,
                additionalTaxableValue: row.deltaCommission,
                reasonCode: 'COMMISSION_BASE_CORRECTION',
                reason: `Commission recomputed on the pre-discount item total for ${row.month}, matching the amount withheld. Raises ${row.invoiceNumber}.`,
                interState: false,
                issuedBy: 'phase4-restatement',
                idempotencyKey: docId,
            });
            if (!result.ok) { failed++; console.log(`  FAILED ${row.invoiceNumber}: ${result.reason}`); continue; }
            if (result.alreadyExisted) { skipped++; console.log(`  exists ${result.debitNote.debitNoteNumber} → ${row.invoiceNumber}`); }
            else { issued++; console.log(`  issued ${result.debitNote.debitNoteNumber} → ${row.invoiceNumber}  ₹${row.deltaTotal.toFixed(2)}`); }
        } catch (err) {
            failed++;
            console.log(`  FAILED ${row.invoiceNumber}: ${err.message}`);
        }
    }
    console.log(`\n${issued} issued, ${skipped} already present, ${failed} failed.`);
    console.log('These belong in GSTR-1 Table 9B of the return for the month they were issued.');
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
    console.error('\nFailed:', e.message);
    process.exit(1);
});
