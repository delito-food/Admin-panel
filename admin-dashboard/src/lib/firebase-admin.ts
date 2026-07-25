import { initializeApp, getApps, cert, type ServiceAccount, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

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
    wallets: 'wallets',
    pushNotifications: 'pushNotifications',
} as const;

// Check if Firebase is available
export function isFirebaseConfigured(): boolean {
    return hasValidCredentials();
}

/**
 * Send an FCM data push notification to a specific user.
 * Looks up the fcmToken from the appropriate Firestore collection.
 * @param recipientType 'vendor' | 'delivery' | 'customer'
 * @param recipientId Firestore document ID of the user
 * @param title Notification title
 * @param message Notification body / message
 * @param extraData Optional extra key-value pairs to include in the FCM data payload
 */
export async function sendPushNotification(
    recipientType: 'vendor' | 'delivery' | 'customer',
    recipientId: string,
    title: string,
    message: string,
    extraData: Record<string, string> = {}
): Promise<void> {
    try {
        const collectionName = recipientType === 'vendor'
            ? 'vendors'
            : recipientType === 'delivery'
            ? 'deliveryPersons'
            : 'customers';

        const userDoc = await db.collection(collectionName).doc(recipientId).get();
        const fcmToken = userDoc.data()?.fcmToken as string | undefined;
        if (!fcmToken) return; // No token registered, skip silently

        const adminApp = initFirebaseAdmin();
        if (!adminApp) return;

        await getMessaging(adminApp).send({
            token: fcmToken,
            data: {
                title,
                message,
                type: extraData.type || 'payout',
                ...extraData,
            },
            android: {
                priority: 'high',
            },
        });
    } catch (err) {
        // Non-fatal — log but don't throw
        console.warn(`FCM send failed for ${recipientType}/${recipientId}:`, err);
    }
}

/**
 * Send FCM push notifications to multiple users at once.
 * Batches tokens in groups of 500 (FCM multicast limit).
 */
export async function sendBulkPushNotification(
    tokens: string[],
    title: string,
    body: string,
    imageUrl?: string,
    extraData: Record<string, string> = {}
): Promise<{ successCount: number; failureCount: number; failedTokens: string[] }> {
    const adminApp = initFirebaseAdmin();
    if (!adminApp || tokens.length === 0) {
        return { successCount: 0, failureCount: 0, failedTokens: [] };
    }

    const messaging = getMessaging(adminApp);
    const BATCH_SIZE = 500;
    let successCount = 0;
    let failureCount = 0;
    const failedTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        try {
            const message: any = {
                tokens: batch,
                data: {
                    title,
                    message: body,
                    type: 'promotional',
                    ...extraData,
                },
                notification: {
                    title,
                    body,
                    ...(imageUrl ? { imageUrl } : {}),
                },
                android: {
                    priority: 'high' as const,
                    notification: {
                        channelId: 'promotions_v1',
                        ...(imageUrl ? { imageUrl } : {}),
                    },
                },
            };

            if (imageUrl) {
                message.data.imageUrl = imageUrl;
            }

            const response = await messaging.sendEachForMulticast(message);
            successCount += response.successCount;
            failureCount += response.failureCount;

            // Track failed tokens (cap at 50 for storage)
            response.responses.forEach((resp, idx) => {
                if (!resp.success && failedTokens.length < 50) {
                    failedTokens.push(batch[idx]);
                }
            });
        } catch (err) {
            console.error(`FCM multicast batch failed (offset ${i}):`, err);
            failureCount += batch.length;
        }
    }

    return { successCount, failureCount, failedTokens };
}

// ── Server-side in-memory cache ──
// Prevents repeated Firestore reads when multiple API routes or polling
// requests hit the same collections within a short window.
interface CacheEntry<T> {
    data: T;
    expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_CACHE_TTL = 60_000; // 60 seconds

/**
 * Get data from cache or fetch from Firestore.
 * Caches the raw doc data array for the given collection/query key.
 */
export async function cachedCollectionGet(
    collectionName: string,
    ttl: number = DEFAULT_CACHE_TTL
): Promise<FirebaseFirestore.QuerySnapshot> {
    // For full collection reads, just return the snapshot directly
    // but cache it to avoid repeated reads
    const cacheKey = `col:${collectionName}`;
    const cached = cache.get(cacheKey) as CacheEntry<FirebaseFirestore.QuerySnapshot> | undefined;
    if (cached && Date.now() < cached.expiry) {
        return cached.data;
    }
    const snapshot = await db.collection(collectionName).get();
    cache.set(cacheKey, { data: snapshot, expiry: Date.now() + ttl });
    return snapshot;
}

/**
 * Get cached document data as plain objects (most common use case).
 * Returns array of { id, ...data }.
 */
export async function cachedCollection(
    collectionName: string,
    ttl: number = DEFAULT_CACHE_TTL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Array<{ id: string; [key: string]: any }>> {
    const cacheKey = `col_data:${collectionName}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cached = cache.get(cacheKey) as CacheEntry<Array<{ id: string; [key: string]: any }>> | undefined;
    if (cached && Date.now() < cached.expiry) {
        return cached.data;
    }
    const snapshot = await db.collection(collectionName).get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    cache.set(cacheKey, { data, expiry: Date.now() + ttl });
    return data;
}

/**
 * Invalidate cache for a specific collection (call after writes).
 */
export function invalidateCache(collectionName: string): void {
    cache.delete(`col:${collectionName}`);
    cache.delete(`col_data:${collectionName}`);
}

/**
 * Invalidate all cached data.
 */
export function invalidateAllCache(): void {
    cache.clear();
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
