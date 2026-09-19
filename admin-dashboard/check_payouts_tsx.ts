import { db, collections } from './src/lib/firebase-admin';
import { allLedgerBalances, divergence } from './src/lib/ledger';

async function check() {
    const vendorDocs = await db.collection(collections.vendors).get();

    let ledgerBalances = {};
    try {
        ledgerBalances = await allLedgerBalances('vendor');
    } catch (err) {
        console.warn('ledger error', err);
    }

    let showing = 0;

    for (const doc of vendorDocs.docs) {
        const data = doc.data();
        const vendorDocPaid = data.paidAmount || 0;
        const vendorDocNet = ((data.totalEarnings || 0) - (data.totalCommission || 0));

        let pendingAmount = 0;
        let netPayable = 0;
        let paidAmount = vendorDocPaid;
        const ledger = ledgerBalances[doc.id];

        const source = ledger && ledger.entryCount > 0 ? 'ledger' : 'orders';

        if (source === 'ledger') {
            paidAmount = Math.round(ledger.paidOut * 100) / 100;
            netPayable = Math.round((ledger.balance + ledger.paidOut) * 100) / 100;
            pendingAmount = Math.round(Math.max(0, netPayable - paidAmount) * 100) / 100;
        } else {
            // fallback (just using doc fields for this test, though route.ts aggregates orders)
            // route.ts would calculate order-by-order. Let's see if pendingPayout works for fallback.
            pendingAmount = data.pendingPayout || 0;
        }

        if (pendingAmount > 0) {
            console.log(`Vendor ${data.shopName || data.fullName}, source=${source}, pendingAmount=${pendingAmount}, ledgerBal=${ledger?.balance}, netPayable=${netPayable}, paid=${paidAmount}`);
            showing++;
        }
    }

    console.log(`Total vendors showing > 0 pending: ${showing}`);
}

check().catch(console.error).finally(() => process.exit(0));
