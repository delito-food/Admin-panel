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

async function analyze() {
  const ids = ['tVpW0xAY8vNHmFNyO1KeTkFo5lh2', 'Urysuv9GTmgNQttyWbmJ4mkDdFB2'];
  
  for (const id of ids) {
    console.log(`\n\n=== Analyzing Delivery Person: ${id} ===`);
    const dpDoc = await db.collection('deliveryPersons').doc(id).get();
    if (dpDoc.exists) {
        console.log("DP Data:", { 
            name: dpDoc.data().name || dpDoc.data().fullName, 
            codCollected: dpDoc.data().codCollected, 
            codPending: dpDoc.data().codPending,
            codSettled: dpDoc.data().codSettled
        });
    } else {
        console.log("DP Doc NOT FOUND");
    }

    const tasksSnap = await db.collection('deliveryTasks').where('deliveryPersonId', '==', id).get();
    console.log(`Found ${tasksSnap.size} total tasks for ${id}`);
    tasksSnap.forEach(doc => {
        const d = doc.data();
        if (d.codCollected || !d.codSettled || d.paymentMode === 'COD' || d.paymentMode === 'Cash') {
            console.log(`Task ${doc.id}: status=${d.status}, pm=${d.paymentMode}, codAmount=${d.codAmount}, codCollected=${d.codCollected}, codSettled=${d.codSettled}, codQrReviewStatus=${d.codQrReviewStatus}`);
        }
    });

    const ordersSnap = await db.collection('orders').where('deliveryPersonId', '==', id).get();
    console.log(`Found ${ordersSnap.size} total orders for ${id}`);
    ordersSnap.forEach(doc => {
        const d = doc.data();
        const pm = (d.paymentMode || '').toLowerCase();
        if ((pm === 'cod' || pm === 'cash') && (!d.codSettled)) {
            console.log(`Order ${doc.id}: status=${d.status}, pm=${d.paymentMode}, total=${d.total}, codSettled=${d.codSettled}`);
        }
    });
  }
}

analyze().catch(console.error).finally(() => process.exit(0));
