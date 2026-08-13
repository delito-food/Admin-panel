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

async function checkRustam() {
  const snapshot = await db.collection('deliveryPersons').get();
  
  let found = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    const name = (data.fullName || data.name || '').toLowerCase();
    if (name.includes('rustam')) {
        found.push({ id: doc.id, ...data });
    }
  });

  console.log(`Found ${found.length} delivery persons matching "rustam"`);
  
  for (const person of found) {
      console.log(`\nID: ${person.id}`);
      console.log(`Name: ${person.fullName || person.name}`);
      console.log(`Phone: ${person.phoneNumber}`);
      console.log(`Is Online: ${person.isOnline}`);
      
      let pendingTasks = 0;
      const tasksSnap = await db.collection('deliveryTasks')
          .where('deliveryPersonId', '==', person.id)
          .where('status', '==', 'DELIVERED')
          .where('paymentMode', '==', 'COD')
          .where('codSettled', '==', false)
          .get();
      
      tasksSnap.forEach(t => pendingTasks += (t.data().codAmount || t.data().orderTotal || 0));
      console.log(`Actual Pending COD (from tasks): ${pendingTasks}`);
  }
}

checkRustam().catch(console.error).finally(() => process.exit(0));
