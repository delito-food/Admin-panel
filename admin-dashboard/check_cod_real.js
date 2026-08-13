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

async function check() {
  const tasksSnap = await db.collection('deliveryTasks')
    .where('status', '==', 'DELIVERED')
    .where('paymentMode', '==', 'COD')
    .where('codCollected', '==', true)
    .where('codSettled', '==', false)
    .get();

  const pendingAmounts = {};
  tasksSnap.forEach(doc => {
    const data = doc.data();
    const dpId = data.deliveryPersonId;
    if (dpId) {
      pendingAmounts[dpId] = (pendingAmounts[dpId] || 0) + (data.codAmount || data.orderTotal || 0);
    }
  });

  const ordersSnap = await db.collection('orders')
    .where('codSettled', '==', false)
    .get();
  
  ordersSnap.forEach(doc => {
    const data = doc.data();
    if (data.status === 'delivered' || data.status === 'completed') {
        const pm = (data.paymentMode || '').toLowerCase();
        if (pm === 'cod' || pm === 'cash') {
            const dpId = data.deliveryPersonId;
            if (dpId) {
                // Approximate since we aren't deduping with tasks here, just to find who has limits
                pendingAmounts[dpId] = (pendingAmounts[dpId] || 0) + (data.total || 0);
            }
        }
    }
  });

  console.log("=== Delivery Persons with ACTUAL Pending COD Limit ===");
  for (const dpId of Object.keys(pendingAmounts)) {
      if (pendingAmounts[dpId] > 0) {
          const dpDoc = await db.collection('deliveryPersons').doc(dpId).get();
          const dpData = dpDoc.exists ? dpDoc.data() : {};
          console.log(`ID: ${dpId}`);
          console.log(`Name: ${dpData.fullName || dpData.name || 'Unknown'}`);
          console.log(`Phone: ${dpData.phoneNumber || 'Unknown'}`);
          console.log(`Approx Pending COD: ${pendingAmounts[dpId]}`);
          console.log("------------------------");
      }
  }
}

check().catch(console.error).finally(() => process.exit(0));
