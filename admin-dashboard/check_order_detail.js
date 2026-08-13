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
  const orderDoc = await db.collection('orders').doc('p4XEoAInQAAyuUCEqZaV').get();
  console.log(orderDoc.data());
}

check().catch(console.error).finally(() => process.exit(0));
