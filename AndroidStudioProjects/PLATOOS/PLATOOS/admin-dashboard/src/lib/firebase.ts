import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if Firebase config is valid
const isConfigValid = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isConfigValid) {
    // Initialize Firebase only if config is valid
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    db = getFirestore(app);
} else {
    console.warn(
        'Firebase config is missing. Please add your Firebase credentials to .env.local:\n' +
        'NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key\n' +
        'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com\n' +
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id\n' +
        'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com\n' +
        'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id\n' +
        'NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id'
    );
}

export { app, auth, db, isConfigValid };
