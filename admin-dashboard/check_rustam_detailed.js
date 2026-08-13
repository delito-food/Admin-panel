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

async function checkRustamDetailed() {
  const ids = ["AlX6ibdlKgPZa0N0ZH4EZmnqSmX2", "QMVqDprh86QbiyEBYZJ8BVlfEJI3"];
  for (const id of ids) {
    const doc = await db.collection('deliveryPersons').doc(id).get();
    const data = doc.data();
    console.log(`\nID: ${id}`);
    console.log(`codCollected: ${data.codCollected}`);
    console.log(`codPending: ${data.codPending}`);
    console.log(`codSettled: ${data.codSettled}`);
    
    // Check orders collection
    let pendingOrdersTotal = 0;
    const ordersSnap = await db.collection('orders')
      .where('deliveryPersonId', '==', id)
      .where('codSettled', '==', false)
      .get();
      
    ordersSnap.forEach(o => {
        const odata = o.data();
        if ((odata.status === 'delivered' || odata.status === 'completed') && (odata.paymentMode || '').toLowerCase().includes('cod')) {
            pendingOrdersTotal += (odata.total || 0);
        }
    });
    console.log(`Orders pending COD: ${pendingOrdersTotal}`);
  }
}

checkRustamDetailed().catch(console.error).finally(() => process.exit(0));
