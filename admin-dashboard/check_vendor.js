const admin = require('firebase-admin');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    line = line.replace('\r', '');
    const match = line.match(/^([^#\s][^=]+)="?(.*?)"?$/);
    if (match) {
        let val = match[2];
        if (val.includes('\\n')) val = val.replace(/\\n/g, '\n');
        env[match[1]] = val;
    }
});

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY,
        })
    });
}

const db = admin.firestore();
const vendorId = 'Y06ObEgMFOU4cO6CcfajUAAEMzh1';

async function check() {
    let log = "";
    // 1. Vendor Doc
    const vendorDoc = await db.collection('vendors').doc(vendorId).get();
    if (vendorDoc.exists) {
        const data = vendorDoc.data();
        log += `=== VENDOR DOC ===\n`;
        log += `Name: ${data.shopName || data.fullName}\n`;
        log += `pendingPayout: ${data.pendingPayout}\n`;
        log += `totalEarnings: ${data.totalEarnings}\n`;
        log += `paidAmount: ${data.paidAmount}\n`;
        log += `totalCommission: ${data.totalCommission}\n\n`;
    } else {
        log += `Vendor ${vendorId} NOT FOUND.\n\n`;
    }

    // 2. Ledger Entries
    const ledgerSnap = await db.collection('ledgerEntries')
        .where('partyType', '==', 'vendor')
        .where('partyId', '==', vendorId)
        .get();

    log += `=== LEDGER ===\n`;
    if (ledgerSnap.empty) {
        log += `No ledger entries found.\n\n`;
    } else {
        let bal = 0;
        let paidOut = 0;
        ledgerSnap.docs.forEach(doc => {
            const e = doc.data();
            bal += (e.amount || 0);
            if (e.entryType === 'PAYOUT') paidOut += Math.abs(e.amount || 0);
        });
        log += `Entry count: ${ledgerSnap.size}\n`;
        log += `Calculated Balance (earnings-commission+etc): ${bal}\n`;
        log += `Calculated Paid Out: ${paidOut}\n`;
    }

    // 3. Vendor Payouts table logic fallback check (total orders sum - paid)
    // Get all related delivered orders
    const ordersSnap = await db.collection('orders')
        .where('vendorId', '==', vendorId)
        .where('status', 'in', ['delivered', 'completed', 'Delivered'])
        .get();

    let sumEarnings = 0;
    ordersSnap.docs.forEach(doc => {
        const o = doc.data();
        // simplified proxy
        const itemTotal = (o.itemTotal) || (o.subtotal) || Math.max(0, (o.total || 0) - (o.deliveryFee || 0));
        const vendorEarning = o.vendorEarning != null ? Math.max(0, o.vendorEarning) : (itemTotal * 0.85); // roughly ~15% commission if fallback
        sumEarnings += vendorEarning;
    });

    log += `=== ORDERS ===\n`;
    log += `Total Delivered Orders: ${ordersSnap.size}\n`;
    log += `Sum of Estimated vendorEarnings: ${sumEarnings}\n`;

    // Payout history
    const payoutsSnap = await db.collection('vendorPayouts')
        .where('vendorId', '==', vendorId)
        .where('status', 'in', ['completed', 'processed'])
        .get();

    let totalPaid = 0;
    payoutsSnap.docs.forEach(d => { totalPaid += (d.data().amount || 0); });

    log += `=== PAYOUTS COLLECTION ===\n`;
    log += `Confirmed payouts total: ${totalPaid}\n`;

    fs.writeFileSync('vendor_check.txt', log);
}

check().catch(console.error).finally(() => process.exit(0));
