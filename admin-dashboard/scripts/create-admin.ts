import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env vars from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function createAdmin() {
    const email = process.argv[2];
    const password = process.argv[3];
    const name = process.argv[4] || 'Admin';

    if (!email || !password) {
        console.log('Usage: npx ts-node scripts/create-admin.ts <email> <password> [name]');
        process.exit(1);
    }

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        console.error('Firebase credentials (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY) are missing in .env.local');
        process.exit(1);
    }

    const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };

    const app = initializeApp({
        credential: cert(serviceAccount),
    });

    const auth = getAuth(app);
    const db = getFirestore(app);

    try {
        console.log(`Creating admin user: ${email}...`);
        
        let user;
        try {
            user = await auth.getUserByEmail(email);
            console.log('User already exists in Auth. Updating password and name...');
            await auth.updateUser(user.uid, { password, displayName: name });
        } catch (e: any) {
            if (e.code === 'auth/user-not-found') {
                user = await auth.createUser({
                    email,
                    password,
                    displayName: name,
                });
            } else {
                throw e;
            }
        }

        await db.collection('admins').doc(user.uid).set({
            name,
            email,
            role: 'admin',
            createdAt: new Date().toISOString(),
        });

        console.log(`✅ Successfully created/updated admin: ${email} with UID: ${user.uid}`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating admin:', error);
        process.exit(1);
    }
}

createAdmin();
