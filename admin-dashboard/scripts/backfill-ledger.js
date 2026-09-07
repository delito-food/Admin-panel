/**
 * Backfill the append-only ledger from history.
 *
 *   node scripts/backfill-ledger.js --dry-run    # report only, writes nothing
 *   node scripts/backfill-ledger.js              # write the rows
 *
 * Posts, per vendor:
 *   EARNING     + the item total of every delivered order
 *   COMMISSION  − the commission and its GST actually withheld on that order
 *   PAYOUT      − every completed payout record
 *
 * so that balance = earnings − commission − payouts = what the vendor is owed.
 *
 * Row ids are derived from what caused them, so this is safe to run more than
 * once: a second run writes nothing and reports every row as already present.
 *
 * Run this BEFORE trusting the payouts screen's ledger figures. Until a vendor
 * has rows, that screen falls back to deriving from orders and says so in
 * `balanceSource`.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

const env = {};
fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split('\n').forEach((line) => {
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

/** Mirrors lib/ledger.ts — keep the two in step. */
function ledgerEntryId(partyType, partyId, entryType, sourceId) {
    return `${partyType}_${partyId}_${entryType}_${sourceId}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

/** Mirrors lib/pricing-engine.ts computeCommission, COMMISSION_BASE = 'original'. */
function commissionFor(order, ratePercent) {
    const stored = num(order.vendorPlatformCut);
    if (stored > 0) {
        const gst = num(order.vendorGstOnPlatformCut) > 0
            ? num(order.vendorGstOnPlatformCut)
            : r2(stored * 0.18);
        return { amount: r2(stored), gst };
    }
    const base = num(order.originalItemTotal) || num(order.itemTotal) || num(order.subtotal);
    const amount = r2((base * ratePercent) / 100);
    return { amount, gst: r2(amount * 0.18) };
}

function isBillable(status) {
    const s = String(status || '').toLowerCase();
    return s === 'delivered' || s === 'completed';
}

function toIso(v) {
    if (!v) return new Date().toISOString();
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

(async () => {
    console.log(`Delito — ledger backfill${DRY_RUN ? ' (DRY RUN — nothing will be written)' : ''}`);
    console.log('Run at:', new Date().toISOString(), '\n');

    const settingsDoc = await db.collection('platformSettings').doc('commission').get();
    const defaultRate = settingsDoc.exists ? (num(settingsDoc.data()?.defaultRate) || 15) : 15;

    const vendorSnap = await db.collection('vendors').get();
    const rateByVendor = {};
    vendorSnap.docs.forEach((d) => { rateByVendor[d.id] = num(d.data().commissionRate) || defaultRate; });
    console.log(`vendors: ${vendorSnap.size}`);

    const rows = [];

    // ── Orders ──
    const orderSnap = await db.collection('orders').get();
    let billable = 0;
    orderSnap.docs.forEach((doc) => {
        const o = doc.data();
        const vendorId = o.vendorId;
        if (!vendorId || !isBillable(o.status)) return;
        billable++;

        const itemTotal = num(o.itemTotal) || num(o.subtotal);
        const occurredAt = toIso(o.deliveredAt || o.createdAt);
        const c = commissionFor(o, rateByVendor[vendorId] || defaultRate);

        if (itemTotal > 0) {
            rows.push({
                id: ledgerEntryId('vendor', vendorId, 'EARNING', doc.id),
                data: {
                    partyType: 'vendor', partyId: vendorId, entryType: 'EARNING',
                    amount: r2(itemTotal), currency: 'INR',
                    sourceType: 'order', sourceId: doc.id,
                    description: `Food sales on order ${doc.id}`,
                    occurredAt, createdAt: new Date().toISOString(), createdBy: 'backfill',
                },
            });
        }
        const deduction = r2(c.amount + c.gst);
        if (deduction > 0) {
            rows.push({
                id: ledgerEntryId('vendor', vendorId, 'COMMISSION', doc.id),
                data: {
                    partyType: 'vendor', partyId: vendorId, entryType: 'COMMISSION',
                    amount: -deduction, currency: 'INR',
                    sourceType: 'order', sourceId: doc.id,
                    description: `Commission ₹${c.amount.toFixed(2)} + GST ₹${c.gst.toFixed(2)} on order ${doc.id}`,
                    occurredAt, createdAt: new Date().toISOString(), createdBy: 'backfill',
                },
            });
        }
    });
    console.log(`orders: ${orderSnap.size} (${billable} delivered/completed)`);

    // ── Completed payouts ──
    const payoutSnap = await db.collection('vendorPayouts').get();
    let completed = 0;
    payoutSnap.docs.forEach((doc) => {
        const p = doc.data();
        if (String(p.status || '').toLowerCase() !== 'completed') return;
        const vendorId = p.vendorId || p.recipientId;
        const amount = num(p.amount);
        if (!vendorId || amount <= 0) return;
        completed++;
        rows.push({
            id: ledgerEntryId('vendor', vendorId, 'PAYOUT', doc.id),
            data: {
                partyType: 'vendor', partyId: vendorId, entryType: 'PAYOUT',
                amount: -r2(amount), currency: 'INR',
                sourceType: 'payout', sourceId: doc.id,
                description: `Payout${p.transactionId ? `, txn ${p.transactionId}` : ''}`,
                occurredAt: toIso(p.confirmedAt || p.processedAt || p.createdAt),
                createdAt: new Date().toISOString(), createdBy: 'backfill',
            },
        });
    });
    console.log(`vendor payouts: ${payoutSnap.size} (${completed} completed)`);

    // ── Delivery partners ──
    let dpEarningRows = 0;
    orderSnap.docs.forEach((doc) => {
        const o = doc.data();
        const dpId = o.deliveryPersonId;
        if (!dpId || !isBillable(o.status)) return;
        const earning = r2(num(o.deliveryPersonEarnings) + num(o.tip));
        if (earning <= 0) return;
        dpEarningRows++;
        rows.push({
            id: ledgerEntryId('deliveryPartner', dpId, 'EARNING', doc.id),
            data: {
                partyType: 'deliveryPartner', partyId: dpId, entryType: 'EARNING',
                amount: earning, currency: 'INR',
                sourceType: 'order', sourceId: doc.id,
                description: `Delivery earnings on order ${doc.id}`,
                occurredAt: toIso(o.deliveredAt || o.createdAt),
                createdAt: new Date().toISOString(), createdBy: 'backfill',
            },
        });
    });

    const dpPayoutSnap = await db.collection('deliveryPayouts').get();
    let dpCompleted = 0;
    dpPayoutSnap.docs.forEach((doc) => {
        const p = doc.data();
        if (String(p.status || '').toLowerCase() !== 'completed') return;
        const dpId = p.deliveryPersonId || p.recipientId;
        const amount = num(p.amount);
        if (!dpId || amount <= 0) return;
        dpCompleted++;
        rows.push({
            id: ledgerEntryId('deliveryPartner', dpId, 'PAYOUT', doc.id),
            data: {
                partyType: 'deliveryPartner', partyId: dpId, entryType: 'PAYOUT',
                amount: -r2(amount), currency: 'INR',
                sourceType: 'payout', sourceId: doc.id,
                description: `Payout${p.transactionId ? `, txn ${p.transactionId}` : ''}`,
                occurredAt: toIso(p.confirmedAt || p.processedAt || p.createdAt),
                createdAt: new Date().toISOString(), createdBy: 'backfill',
            },
        });
    });
    console.log(`delivery: ${dpEarningRows} earning rows, ${dpPayoutSnap.size} payouts (${dpCompleted} completed)`);

    console.log(`\nrows to post: ${rows.length}`);

    // ── Compare each vendor's ledger balance against the cached counter ──
    const balances = {};
    rows.forEach((r) => {
        const id = r.data.partyId;
        balances[id] = r2((balances[id] || 0) + r.data.amount);
    });

    console.log('\nVendor                        ledger balance    cached pending    gap');
    console.log('─'.repeat(78));
    let flagged = 0;
    vendorSnap.docs.forEach((d) => {
        const v = d.data();
        const ledger = balances[d.id];
        if (ledger === undefined) return;
        const cached = r2(num(v.totalEarnings) - num(v.totalCommission) - num(v.paidAmount));
        const gap = r2(ledger - cached);
        if (Math.abs(gap) >= 1) flagged++;
        const name = String(v.shopName || v.fullName || d.id).slice(0, 28).padEnd(28);
        console.log(`${name}  ${String(ledger.toFixed(2)).padStart(14)}  ${String(cached.toFixed(2)).padStart(15)}  ${String(gap.toFixed(2)).padStart(9)}${Math.abs(gap) >= 1 ? '  ←' : ''}`);
    });
    console.log('─'.repeat(78));
    console.log(`${flagged} vendor(s) where the ledger and the cached counters differ by ₹1 or more.`);
    console.log('Each gap is a real discrepancy that predates the ledger — investigate before paying.');

    if (DRY_RUN) {
        console.log('\nDry run — nothing written. Re-run without --dry-run to post these rows.');
        process.exit(0);
    }

    // ── Write, in batches, skipping rows that already exist ──
    let written = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += 400) {
        const chunk = rows.slice(i, i + 400);
        const refs = chunk.map((r) => db.collection('ledgerEntries').doc(r.id));
        const existing = await db.getAll(...refs);
        const batch = db.batch();
        let inBatch = 0;
        chunk.forEach((r, idx) => {
            if (existing[idx].exists) { skipped++; return; }
            batch.set(refs[idx], {
                ...r.data,
                occurredAtTs: admin.firestore.Timestamp.fromDate(new Date(r.data.occurredAt)),
                createdAtTs: admin.firestore.Timestamp.now(),
            });
            inBatch++;
        });
        if (inBatch > 0) await batch.commit();
        written += inBatch;
        process.stdout.write(`\rposted ${written}, skipped ${skipped} of ${rows.length}…`);
    }
    console.log(`\n\nDone. ${written} rows posted, ${skipped} already present.`);
    console.log('The payouts screen will now report balanceSource: "ledger" for these vendors.');
    process.exit(0);
})().catch((e) => {
    console.error('\nBackfill failed:', e.message);
    process.exit(1);
});
