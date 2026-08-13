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

async function settleFor(deliveryPersonId) {
    console.log(`Starting forced settlement for: ${deliveryPersonId}`);
    
    let totalSettled = 0;
    
    // 1. Settle Delivery Tasks
    const tasksSnap = await db.collection('deliveryTasks')
      .where('deliveryPersonId', '==', deliveryPersonId)
      .where('status', '==', 'DELIVERED')
      .where('paymentMode', '==', 'COD')
      .where('codSettled', '==', false)
      .get();
      
    if (!tasksSnap.empty) {
        const batch = db.batch();
        tasksSnap.forEach(doc => {
            batch.update(doc.ref, {
                codSettled: true,
                codSettledAt: admin.firestore.Timestamp.now(),
                codQrReviewStatus: 'reviewed' // In case it was stuck on QR review
            });
            totalSettled += (doc.data().codAmount || doc.data().orderTotal || 0);
        });
        await batch.commit();
        console.log(`Marked ${tasksSnap.size} delivery tasks as settled.`);
    }

    // 2. Settle Orders
    const ordersSnap = await db.collection('orders')
      .where('deliveryPersonId', '==', deliveryPersonId)
      .where('codSettled', '==', false)
      .get();

    if (!ordersSnap.empty) {
        const batch = db.batch();
        let orderUpdates = 0;
        ordersSnap.forEach(doc => {
            const data = doc.data();
            const pm = (data.paymentMode || '').toLowerCase();
            if ((data.status === 'delivered' || data.status === 'completed') && (pm === 'cod' || pm === 'cash')) {
                batch.update(doc.ref, {
                    codSettled: true,
                    codSettledAt: admin.firestore.Timestamp.now(),
                    codQrReviewStatus: 'reviewed'
                });
                orderUpdates++;
            }
        });
        if (orderUpdates > 0) {
            await batch.commit();
            console.log(`Marked ${orderUpdates} orders as settled.`);
        }
    }

    // 3. Reset profile mirror
    const dpRef = db.collection('deliveryPersons').doc(deliveryPersonId);
    const dpDoc = await dpRef.get();
    if (dpDoc.exists) {
        const dpData = dpDoc.data();
        await dpRef.update({
            codCollected: 0,
            codPending: 0,
            codSettled: (dpData.codSettled || 0) + totalSettled
        });
        console.log(`Reset mirror stats for ${dpData.fullName || dpData.name}.`);
    }

    console.log(`\n✅ Successfully cleared COD limit for ${deliveryPersonId}!`);
}

// Get ID from command line arg
const targetId = process.argv[2];
if (!targetId) {
    console.error("Please provide a delivery person ID as an argument.");
    process.exit(1);
}

settleFor(targetId).catch(console.error).finally(() => process.exit(0));
