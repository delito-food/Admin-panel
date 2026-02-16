import { initializeApp, getApps, cert, type ServiceAccount, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

// Cache for lazy initialization
let app: App | null = null;
let firestoreDb: Firestore | null = null;
let firebaseAuth: Auth | null = null;

// Check if we have valid credentials
function hasValidCredentials(): boolean {
    return !!(
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY
    );
}

// Initialize Firebase Admin lazily
function initFirebaseAdmin(): App | null {
    if (app) return app;

    if (!hasValidCredentials()) {
        console.warn('Firebase credentials not configured. API routes will return mock data.');
        return null;
    }

    if (getApps().length === 0) {
        const serviceAccount: ServiceAccount = {
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        };

        app = initializeApp({
            credential: cert(serviceAccount),
        });
    } else {
        app = getApps()[0];
    }

    return app;
}

// Get Firestore instance lazily
function getDb(): Firestore | null {
    if (firestoreDb) return firestoreDb;

    const app = initFirebaseAdmin();
    if (!app) return null;

    firestoreDb = getFirestore(app);
    return firestoreDb;
}

// Get Auth instance lazily
function getAuthInstance(): Auth | null {
    if (firebaseAuth) return firebaseAuth;

    const app = initFirebaseAdmin();
    if (!app) return null;

    firebaseAuth = getAuth(app);
    return firebaseAuth;
}

// Export lazy getters
export const db = {
    collection: (name: string) => {
        const firestore = getDb();
        if (!firestore) {
            throw new Error('Firebase not initialized. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.');
        }
        return firestore.collection(name);
    },
    batch: () => {
        const firestore = getDb();
        if (!firestore) {
            throw new Error('Firebase not initialized. Please set environment variables.');
        }
        return firestore.batch();
    }
};

export const auth = {
    getUser: async (uid: string) => {
        const authInstance = getAuthInstance();
        if (!authInstance) {
            throw new Error('Firebase not initialized.');
        }
        return authInstance.getUser(uid);
    },
    verifyIdToken: async (token: string) => {
        const authInstance = getAuthInstance();
        if (!authInstance) {
            throw new Error('Firebase not initialized.');
        }
        return authInstance.verifyIdToken(token);
    }
};

// Collection references
export const collections = {
    vendors: 'vendors',
    deliveryPersons: 'deliveryPersons',
    customers: 'customers',
    orders: 'orders',
    menuItems: 'menuItems',
    categories: 'categories',
    specialOffers: 'specialOffers',
    notifications: 'notifications',
    deliveryTasks: 'deliveryTasks',
    deliveryHistory: 'deliveryHistory',
} as const;

// Check if Firebase is available
export function isFirebaseConfigured(): boolean {
    return hasValidCredentials();
}

// Helper functions for Firestore operations
export async function getDocuments<T>(collectionName: string): Promise<T[]> {
    const snapshot = await db.collection(collectionName).get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as T));
}

export async function getDocument<T>(collectionName: string, docId: string): Promise<T | null> {
    const doc = await db.collection(collectionName).doc(docId).get();
    if (!doc.exists) return null;
    return { ...doc.data(), id: doc.id } as T;
}

export async function updateDocument(
    collectionName: string,
    docId: string,
    data: Record<string, unknown>
): Promise<void> {
    await db.collection(collectionName).doc(docId).update({
        ...data,
        updatedAt: Timestamp.now(),
    });
}

export async function queryDocuments<T>(
    collectionName: string,
    field: string,
    operator: FirebaseFirestore.WhereFilterOp,
    value: unknown
): Promise<T[]> {
    const snapshot = await db.collection(collectionName)
        .where(field, operator, value)
        .get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as T));
}

// Get documents with multiple conditions
export async function queryDocumentsMultiple<T>(
    collectionName: string,
    conditions: Array<{
        field: string;
        operator: FirebaseFirestore.WhereFilterOp;
        value: unknown;
    }>
): Promise<T[]> {
    let query: FirebaseFirestore.Query = db.collection(collectionName);

    for (const condition of conditions) {
        query = query.where(condition.field, condition.operator, condition.value);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as T));
}

// Count documents matching a condition
export async function countDocuments(
    collectionName: string,
    field?: string,
    operator?: FirebaseFirestore.WhereFilterOp,
    value?: unknown
): Promise<number> {
    let query: FirebaseFirestore.Query = db.collection(collectionName);

    if (field && operator && value !== undefined) {
        query = query.where(field, operator, value);
    }

    const snapshot = await query.count().get();
    return snapshot.data().count;
}
