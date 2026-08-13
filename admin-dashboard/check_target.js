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
  const dpId = 'tVpW0xAY8vNHmFNyO1KeTkFo5lh2';
  
  console.log('--- Delivery Person Doc ---');
  const dpDoc = await db.collection('deliveryPersons').doc(dpId).get();
  if (dpDoc.exists) {
      const data = dpDoc.data();
      console.log('codCollected:', data.codCollected);
      console.log('codSettled:', data.codSettled);
  }

  console.log('\n--- Orders ---');
  const ordersSnap = await db.collection('orders').where('deliveryPersonId', '==', dpId).get();
  ordersSnap.forEach(doc => {
      const data = doc.data();
      const isCod = String(data.paymentMode || '').toLowerCase().includes('cash') || String(data.paymentMode || '').toLowerCase().includes('cod');
      if (isCod) {
          console.log(`Order ${doc.id}: status=${data.status}, paymentMode=${data.paymentMode}, total=${data.total}, codSettled=${data.codSettled}, codQrReviewStatus=${data.codQrReviewStatus}`);
      }
  });

  console.log('\n--- Delivery Tasks ---');
  const tasksSnap = await db.collection('deliveryTasks').where('deliveryPersonId', '==', dpId).get();
  tasksSnap.forEach(doc => {
      const data = doc.data();
      if (data.paymentMode === 'COD') {
          console.log(`Task ${doc.id}: orderId=${data.orderId}, status=${data.status}, paymentMode=${data.paymentMode}, codAmount=${data.codAmount}, orderTotal=${data.orderTotal}, codCollected=${data.codCollected}, codSettled=${data.codSettled}`);
      }
  });

  console.log('\n--- COD Settlements ---');
  const setSnap = await db.collection('codSettlements').where('deliveryPersonId', '==', dpId).get();
  setSnap.forEach(doc => {
      const data = doc.data();
      console.log(`Settlement ${doc.id}: amount=${data.amount}, status=${data.status}, orderIds=${data.orderIds}`);
  });
}

check().catch(console.error).finally(() => process.exit(0));
