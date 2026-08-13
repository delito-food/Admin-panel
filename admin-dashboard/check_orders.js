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
  
  const tasksSnap = await db.collection('deliveryTasks').where('deliveryPersonId', '==', dpId).where('paymentMode', '==', 'COD').get();
  for (const doc of tasksSnap.docs) {
      const task = doc.data();
      let orderLog = `Task for Order ${task.orderId} (COD=${task.codAmount || task.orderTotal}):\n`;
      
      const orderDoc = await db.collection('orders').doc(task.orderId).get();
      if (orderDoc.exists) {
          const order = orderDoc.data();
          orderLog += `  Order Doc: codSettled=${order.codSettled}, codQrReviewStatus=${order.codQrReviewStatus}, codSettlementId=${order.codSettlementId}\n`;
      } else {
          orderLog += `  Order Doc: NOT FOUND\n`;
      }
      console.log(orderLog);
  }
}

check().catch(console.error).finally(() => process.exit(0));
