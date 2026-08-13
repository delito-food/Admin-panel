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

async function fix() {
  const batch = db.batch();

  // 1. Fix deliveryTask VmddN60WoQrWD6362Ew5
  const taskRef = db.collection('deliveryTasks').doc('VmddN60WoQrWD6362Ew5');
  batch.update(taskRef, {
      codSettled: false,
      codSettledAt: admin.firestore.FieldValue.delete()
  });

  // 2. Fix order p4XEoAInQAAyuUCEqZaV
  const orderRef = db.collection('orders').doc('p4XEoAInQAAyuUCEqZaV');
  batch.update(orderRef, {
      deliveryPersonId: 'tVpW0xAY8vNHmFNyO1KeTkFo5lh2',
      codSettled: false
  });

  // 3. Fix deliveryPerson tVpW0xAY8vNHmFNyO1KeTkFo5lh2
  const dpRef = db.collection('deliveryPersons').doc('tVpW0xAY8vNHmFNyO1KeTkFo5lh2');
  batch.update(dpRef, {
      codCollected: 207
  });

  await batch.commit();
  console.log("SUCCESS: All documents have been successfully updated!");
}

fix().catch(console.error).finally(() => process.exit(0));
