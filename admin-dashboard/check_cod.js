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
  const snapshot = await db.collection('deliveryPersons').get();
  
  console.log("=== All Delivery Persons ===");
  
  let count = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.codCollected > 0 || data.codPending > 0 || true) {
       console.log(`ID: ${doc.id}`);
       console.log(`Name: ${data.fullName || data.name}`);
       console.log(`Phone: ${data.phoneNumber}`);
       console.log(`COD Collected (Mirror): ${data.codCollected || 0}`);
       console.log(`Is Online: ${data.isOnline}`);
       console.log("------------------------");
       count++;
    }
  });
  console.log(`Total: ${count}`);
}

check().catch(console.error).finally(() => process.exit(0));
