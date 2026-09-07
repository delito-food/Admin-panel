/**
 * Invoice series audit — read-only.
 *
 * Walks every issued serial in `invoices` and `commissionInvoices`, compares
 * them against their counters, and reports duplicates and gaps.
 *
 *   node scripts/invoice-series-audit.js            # summary
 *   node scripts/invoice-series-audit.js --verbose  # list every gap / duplicate
 *
 * Writes nothing. Safe to run against production.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
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
const verbose = process.argv.includes('--verbose');

/** Pull the trailing numeric sequence out of any of our serial formats. */
function seqOf(invoiceNumber) {
    if (!invoiceNumber) return null;
    const m = String(invoiceNumber).trim().match(/(\d+)(?:-[FDP])?$/);
    return m ? parseInt(m[1], 10) : null;
}

async function auditSeries(label, collection, counterDoc, counterField) {
    const counterSnap = await db.collection('counters').doc(counterDoc).get();
    const counterValue = counterSnap.exists ? counterSnap.data()[counterField] : null;

    const snap = await db.collection(collection).get();
    const bySeq = new Map();
    let missingNumber = 0;

    snap.docs.forEach((doc) => {
        const data = doc.data();
        const number = data.invoiceNumber;
        if (!number) { missingNumber++; return; }
        const seq = seqOf(number);
        if (seq == null) return;
        if (!bySeq.has(seq)) bySeq.set(seq, []);
        bySeq.get(seq).push({ id: doc.id, number, orderId: data.orderId, vendorId: data.vendorId, month: data.month });
    });

    const highest = bySeq.size ? Math.max(...bySeq.keys()) : 0;
    const ceiling = counterValue != null ? Math.max(counterValue, highest) : highest;

    const gaps = [];
    for (let i = 1; i <= ceiling; i++) if (!bySeq.has(i)) gaps.push(i);
    const duplicates = [...bySeq.entries()].filter(([, docs]) => docs.length > 1);

    console.log(`\n─── ${label} ─────────────────────────────`);
    console.log(`  counters/${counterDoc}.${counterField} : ${counterValue ?? 'MISSING'}`);
    console.log(`  documents in ${collection}          : ${snap.size}`);
    console.log(`  distinct serials issued              : ${bySeq.size}`);
    console.log(`  highest serial seen                  : ${highest}`);
    console.log(`  documents with no serial             : ${missingNumber}`);
    console.log(`  GAPS (allocated, never written)      : ${gaps.length}`);
    console.log(`  DUPLICATE serials                    : ${duplicates.length}`);

    if (gaps.length) {
        console.log(`  → gap list: ${verbose ? gaps.join(', ') : gaps.slice(0, 30).join(', ') + (gaps.length > 30 ? ` … (+${gaps.length - 30} more, use --verbose)` : '')}`);
    }
    if (duplicates.length) {
        console.log('  → duplicates:');
        duplicates.forEach(([seq, docs]) => {
            console.log(`     seq ${seq}: ${docs.map((d) => `${d.number} (doc ${d.id})`).join('  ||  ')}`);
        });
    }

    return { label, counterValue, documents: snap.size, issued: bySeq.size, gaps: gaps.length, duplicates: duplicates.length };
}

(async () => {
    console.log('Delito — invoice series audit');
    console.log('Run at:', new Date().toISOString());

    const results = [];
    results.push(await auditSeries('Customer invoices', 'invoices', 'invoices', 'lastNumber'));
    results.push(await auditSeries('Commission invoices', 'commissionInvoices', 'commissionInvoices', 'count'));

    console.log('\n─── Summary ─────────────────────────────');
    results.forEach((r) => {
        console.log(`  ${r.label.padEnd(22)} counter=${String(r.counterValue).padStart(5)}  issued=${String(r.issued).padStart(5)}  gaps=${String(r.gaps).padStart(4)}  duplicates=${r.duplicates}`);
    });
    console.log('\nA gap is a serial the counter handed out that no document ever claimed —');
    console.log('almost always an abandoned preview (F-02) or a failed write (F-01).');
    process.exit(0);
})().catch((e) => {
    console.error('Audit failed:', e.message);
    process.exit(1);
});
