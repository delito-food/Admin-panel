/**
 * Why is a vendor missing from the pending-payouts screen?
 *
 *   node scripts/diagnose-vendor-payouts.js
 *   node scripts/diagnose-vendor-payouts.js <vendorId>   # one vendor, in detail
 *
 * Reads only. It reproduces, per vendor, the three records the payouts screen
 * reconciles — the delivered orders, the ledger, and the payouts collection —
 * and prints them side by side, so a vendor showing ₹0 pending can be read off
 * against what their own orders say they are owed.
 *
 * A vendor whose ledger holds payout rows but no earning rows is the case this
 * was written for: `balance + paidOut` comes to exactly 0, so the screen used
 * to report ₹0 payable and drop them from the list. Those rows are the ones
 * `scripts/backfill-ledger.js` writes; run it with --confirm to fill them in.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const ONLY_VENDOR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

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
const rupees = (n) => n.toFixed(2);

function isBillable(status) {
    const s = String(status || '').toLowerCase();
    return s === 'delivered' || s === 'completed';
}

/** The same fallback chain the payouts route uses. */
function itemTotalOf(o) {
    return num(o.itemTotal) || num(o.subtotal) || Math.max(0, num(o.total) - num(o.deliveryFee));
}

(async () => {
    console.log('Delito — vendor payout reconciliation (read only)');
    console.log('Run at:', new Date().toISOString(), '\n');

    const vendorSnap = await db.collection('vendors').get();
    const orderSnap = await db.collection('orders').get();
    const ledgerSnap = await db.collection('ledgerEntries').where('partyType', '==', 'vendor').get();
    const payoutSnap = await db.collection('vendorPayouts').get();

    // ── Delivered orders, per vendor ──
    const derived = {};
    let ordersWithoutItemTotal = 0;
    orderSnap.docs.forEach((doc) => {
        const o = doc.data();
        if (!o.vendorId || !isBillable(o.status)) return;
        const d = (derived[o.vendorId] ||= { net: 0, orders: 0, noItemTotal: 0 });
        const itemTotal = itemTotalOf(o);
        if (!num(o.itemTotal) && !num(o.subtotal)) { d.noItemTotal++; ordersWithoutItemTotal++; }
        const earning = (o.vendorEarning != null && Number.isFinite(o.vendorEarning))
            ? Math.max(0, o.vendorEarning)
            : Math.max(0, itemTotal - num(o.vendorPlatformCut) - num(o.vendorGstOnPlatformCut));
        d.net = r2(d.net + earning);
        d.orders++;
    });

    // ── Ledger, per vendor ──
    const ledger = {};
    ledgerSnap.docs.forEach((doc) => {
        const e = doc.data();
        if (!e.partyId) return;
        const l = (ledger[e.partyId] ||= { balance: 0, earnings: 0, paidOut: 0, offerShare: 0, rows: 0 });
        const amount = num(e.amount);
        l.balance = r2(l.balance + amount);
        l.rows++;
        if (e.entryType === 'EARNING') l.earnings = r2(l.earnings + amount);
        if (e.entryType === 'PAYOUT') l.paidOut = r2(l.paidOut + Math.abs(amount));
        if (e.entryType === 'OFFER_SHARE') l.offerShare = r2(l.offerShare + Math.abs(amount));
    });

    // ── Confirmed payouts, per vendor ──
    const paid = {};
    payoutSnap.docs.forEach((doc) => {
        const p = doc.data();
        const s = String(p.status || '').toLowerCase();
        if (s !== 'completed' && s !== 'processed') return;
        const id = p.vendorId || p.recipientId;
        if (!id) return;
        paid[id] = r2((paid[id] || 0) + num(p.amount));
    });

    const ids = ONLY_VENDOR ? [ONLY_VENDOR] : vendorSnap.docs.map((d) => d.id);
    const nameOf = {};
    vendorSnap.docs.forEach((d) => { nameOf[d.id] = String(d.data().shopName || d.data().fullName || d.id); });

    const rows = [];
    ids.forEach((id) => {
        const d = derived[id] || { net: 0, orders: 0, noItemTotal: 0 };
        const l = ledger[id];
        const paidOut = Math.max(l ? l.paidOut : 0, paid[id] || 0);
        const ledgerNet = l ? r2(l.balance + l.paidOut) : null;
        const ledgerUsable = !!l && l.earnings > 0 && r2(d.net - ledgerNet) < 0.01;

        // What the screen used to report: the ledger the moment it had any row.
        const before = l && l.rows > 0 ? r2(Math.max(0, ledgerNet - l.paidOut)) : r2(Math.max(0, d.net - (paid[id] || 0)));
        // What it reports now: the ledger only when it accounts for the orders.
        const after = r2(Math.max(0, (ledgerUsable ? ledgerNet : d.net) - paidOut));

        rows.push({
            id, name: nameOf[id] || id,
            orders: d.orders, derivedNet: d.net, noItemTotal: d.noItemTotal,
            ledgerRows: l ? l.rows : 0, ledgerEarnings: l ? l.earnings : 0, ledgerNet,
            paidOut, before, after, source: ledgerUsable ? 'ledger' : 'orders',
        });
    });

    rows.sort((a, b) => (b.after - b.before) - (a.after - a.before) || b.after - a.after);

    console.log('Vendor                        orders   payable      paid    pending(before)  pending(now)  source');
    console.log('─'.repeat(104));
    let recovered = 0;
    let newlyVisible = 0;
    rows.forEach((r) => {
        if (r.orders === 0 && r.after === 0 && r.before === 0) return;
        const gained = r2(r.after - r.before);
        if (gained > 0) { recovered = r2(recovered + gained); if (r.before <= 0) newlyVisible++; }
        console.log(
            `${r.name.slice(0, 28).padEnd(28)}  ${String(r.orders).padStart(6)}  ` +
            `${rupees(r.source === 'ledger' && r.ledgerNet !== null ? r.ledgerNet : r.derivedNet).padStart(9)}  ` +
            `${rupees(r.paidOut).padStart(8)}  ${rupees(r.before).padStart(15)}  ${rupees(r.after).padStart(12)}  ${r.source}` +
            `${gained > 0 ? '   ←' : ''}`
        );
    });
    console.log('─'.repeat(104));
    console.log(`${newlyVisible} vendor(s) were being hidden by a ledger that does not account for their orders.`);
    console.log(`₹${rupees(recovered)} of pending payouts was not being shown.`);
    if (ordersWithoutItemTotal > 0) {
        console.log(`${ordersWithoutItemTotal} delivered order(s) carry no itemTotal/subtotal — their value comes from total − deliveryFee.`);
    }

    if (ONLY_VENDOR) {
        const l = ledger[ONLY_VENDOR];
        console.log('\nLedger rows for', ONLY_VENDOR);
        if (!l) console.log('  none');
        else console.log(`  ${l.rows} row(s): earnings ₹${rupees(l.earnings)}, paid out ₹${rupees(l.paidOut)}, offer share ₹${rupees(l.offerShare)}, balance ₹${rupees(l.balance)}`);
    }

    console.log('\nTo fill the missing rows in: node scripts/backfill-ledger.js  (then --confirm to write)');
    process.exit(0);
})().catch((e) => {
    console.error('\nDiagnosis failed:', e.message);
    process.exit(1);
});
