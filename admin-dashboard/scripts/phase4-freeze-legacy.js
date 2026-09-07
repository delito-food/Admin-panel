/**
 * Phase 4 — close the legacy series and record the CA baseline.
 *
 *   node scripts/phase4-freeze-legacy.js              # DRY RUN
 *   node scripts/phase4-freeze-legacy.js --confirm    # write the markers
 *
 * Two writes, both idempotent:
 *
 *   counters/invoices            closedAt, closedReason, finalNumber
 *   counters/commissionInvoices  closedAt, closedReason, finalNumber
 *
 * and one record of the position the CA stated, so the reconciliation can be
 * re-run later against the same baseline rather than a remembered one:
 *
 *   reconciliation/caBaseline
 *
 * Nothing has drawn from the legacy counters since Phase 2 — serials now come
 * from the financial-year counters (inv_26-27, com_26-27). These markers make
 * that explicit in the data, so a future reader cannot mistake a dormant
 * counter for a live one.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIRM = process.argv.includes('--confirm');

const CA_BASELINE = {
    cutoffDate: '2026-07-31',
    lastInvoiceNumber: 'INV-2026-000078',
    lastCommissionNumber: 'DLT-COM-2607-069',
    statedBy: 'Chartered accountant',
    recordedAt: new Date().toISOString(),
    note: 'Position stated by the CA as the last documents on record as at 31 July 2026.',
};

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

(async () => {
    console.log(`Delito — freeze legacy series${CONFIRM ? '' : '  (DRY RUN)'}\n`);

    const targets = [
        {
            id: 'invoices',
            field: 'lastNumber',
            label: 'Customer invoices (INV-YYYY-NNNNNN)',
            replacement: 'inv_<FY>  →  DLT/26-27/000001',
        },
        {
            id: 'commissionInvoices',
            field: 'count',
            label: 'Commission invoices (DLT-COM-YYMM-NNN)',
            replacement: 'com_<FY>  →  DCM/26-27/000001',
        },
    ];

    for (const t of targets) {
        const ref = db.collection('counters').doc(t.id);
        const snap = await ref.get();
        const data = snap.exists ? snap.data() : {};
        const finalNumber = Number(data?.[t.field]) || Number(data?.lastNumber) || 0;

        console.log(`  ${t.label}`);
        console.log(`    counters/${t.id}.${t.field} = ${finalNumber}`);
        console.log(`    already closed: ${data?.closedAt ? 'yes (' + data.closedAt + ')' : 'no'}`);
        console.log(`    replaced by: ${t.replacement}`);

        if (CONFIRM && !data?.closedAt) {
            await ref.set({
                closedAt: new Date().toISOString(),
                closedReason:
                    'Series closed at the Phase 2 cutover. Serials now come from the financial-year ' +
                    'counters, which reset on 1 April and are allocated inside the transaction that ' +
                    'writes the document. Existing numbers keep their identity; nothing new is drawn from here.',
                finalNumber,
            }, { merge: true });
            console.log('    → closed');
        }
        console.log();
    }

    console.log('  CA baseline');
    console.log(`    as at ${CA_BASELINE.cutoffDate}`);
    console.log(`    last customer invoice   ${CA_BASELINE.lastInvoiceNumber}`);
    console.log(`    last commission invoice ${CA_BASELINE.lastCommissionNumber}`);

    if (CONFIRM) {
        await db.collection('reconciliation').doc('caBaseline').set(CA_BASELINE, { merge: true });
        console.log('    → recorded at reconciliation/caBaseline');
    }

    if (!CONFIRM) {
        console.log('\nDry run — nothing written. Re-run with --confirm.');
    } else {
        console.log('\nDone.');
    }
    process.exit(0);
})().catch((e) => {
    console.error('Failed:', e.message);
    process.exit(1);
});
