import dns from 'node:dns';
import { initializeApp, getApps, cert, type ServiceAccount, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';

/**
 * Resolve Google's hosts over IPv4 first.
 *
 * Node 17+ hands back DNS results in whatever order the resolver gave them
 * ("verbatim"), which usually means the AAAA record first. If the machine
 * advertises IPv6 but has no working route over it — common on home ISPs,
 * hotel and office Wi-Fi, and inside some VPNs — every Firestore connection
 * goes to an address like `2404:6800:4002:819::200a` and sits there until the
 * TCP connect times out. gRPC then retries with backoff, which is how one
 * `/api/notifications` request ends up taking minutes and failing with
 * `14 UNAVAILABLE … connect ETIMEDOUT`.
 *
 * Preferring IPv4 costs nothing on a healthy dual-stack network and removes
 * the stall on a broken one. `NODE_OPTIONS=--dns-result-order=ipv4first` does
 * the same from outside; doing it here means it can't be forgotten on a new
 * machine or in a deploy environment.
 */
try {
    dns.setDefaultResultOrder('ipv4first');
} catch {
    // Not available outside the Node runtime — nothing to do.
}

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

    /**
     * Read over REST instead of gRPC.
     *
     * The admin dashboard only ever does one-shot reads and writes — no
     * snapshot listeners — so gRPC's long-lived channel buys nothing here, and
     * it is the part that fails loudly on flaky networks: a dead channel
     * retries internally for minutes before surfacing `14 UNAVAILABLE`, and
     * every route waiting on it hangs for that whole time. REST fails in
     * seconds and reconnects per request.
     *
     * `settings()` can only be called before the instance is first used, and
     * `getFirestore(app)` returns the same instance across Next's dev hot
     * reloads, so a second call after a reload throws. That's harmless.
     */
    try {
        firestoreDb.settings({ preferRest: true });
    } catch {
        // Already configured (hot reload) — the existing settings stand.
    }

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
    },
    /**
     * Fetch a known set of documents in one round trip.
     *
     * Billed per document returned, so when the ids are already known this is
     * dramatically cheaper than downloading the collection and filtering it —
     * the difference between 30 reads and 1,000 on a delta refresh.
     */
    getAll: async (
        refs: FirebaseFirestore.DocumentReference[]
    ): Promise<FirebaseFirestore.DocumentSnapshot[]> => {
        if (refs.length === 0) return [];
        const firestore = getDb();
        if (!firestore) {
            throw new Error('Firebase not initialized. Please set environment variables.');
        }
        // getAll takes a variadic list; chunk so a large id set can't blow the
        // request size limit.
        const CHUNK = 300;
        const out: FirebaseFirestore.DocumentSnapshot[] = [];
        for (let i = 0; i < refs.length; i += CHUNK) {
            const chunk = refs.slice(i, i + CHUNK);
            out.push(...(await firestore.getAll(...chunk)));
        }
        return out;
    },
    /**
     * Run a Firestore transaction.
     *
     * Needed anywhere a read-then-write must be atomic — notably allocating
     * invoice numbers from a counter, where two concurrent requests must never
     * be handed the same number.
     */
    runTransaction: <T>(
        updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<T>,
        transactionOptions?: FirebaseFirestore.ReadWriteTransactionOptions
    ): Promise<T> => {
        const firestore = getDb();
        if (!firestore) {
            throw new Error('Firebase not initialized. Please set environment variables.');
        }
        return firestore.runTransaction(updateFunction, transactionOptions);
    },
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
    invoices: 'invoices',
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

// ── Storage ──

/**
 * Upload an image through the Admin SDK and return a URL the apps can load.
 *
 * Why server-side rather than from the browser: storage.rules only let a
 * vendor write under `vendor_profiles/{vendorId}/`, keyed on their own uid, so
 * an admin signed in as themselves is refused. The Admin SDK is not subject to
 * storage.rules at all, which means an admin can replace a vendor's outlet
 * photo without loosening the rule that stops vendors writing to each other's
 * folders.
 *
 * The returned URL carries a download token, the same shape the apps already
 * receive from the client SDK, so Coil loads it exactly like a vendor upload
 * and it keeps working regardless of how storage.rules change later.
 */
export async function uploadImage(
    path: string,
    data: Buffer,
    contentType: string
): Promise<string> {
    const adminApp = initFirebaseAdmin();
    if (!adminApp) {
        throw new Error('Firebase not initialized. Please set environment variables.');
    }

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET
        || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) {
        throw new Error(
            'No storage bucket configured. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ' +
            '(the same value the client config uses).'
        );
    }

    const token = randomUUID();
    const file = getStorage(adminApp).bucket(bucketName).file(path);

    await file.save(data, {
        contentType,
        resumable: false,
        metadata: {
            contentType,
            cacheControl: 'public, max-age=31536000',
            metadata: { firebaseStorageDownloadTokens: token },
        },
    });

    return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

// ── Server-side in-memory cache ──
//
// Prevents repeated Firestore reads when multiple API routes or polling
// requests hit the same collections within a short window.
//
// Three properties matter here, and the original cache only had the first:
//
//   1. A TTL, so the same collection isn't re-read on every request.
//   2. Single-flight. Without it, N requests that all miss at the same moment
//      each issue their own full-collection read — which is exactly what
//      happens when a page mounts and fires four API calls at once, or when
//      a poll lands while a manual refresh is already running. With it, the
//      first read is shared and the rest either join it or serve the last
//      known value.
//   3. TTLs that match how fast each collection actually changes. `orders`
//      turns over constantly; `categories` changes when someone edits a menu.
//      One 60-second number for both meant the slow collections were re-read
//      hundreds of times a day for nothing.
//
// Deliberately NOT done: refreshing a stale entry in the background and
// returning immediately. On a serverless host the function can be frozen the
// moment the response is sent, so that read would be paid for and thrown away
// without ever populating the cache. Stale data is only served here when a
// refresh someone else is already awaiting is in flight, or when Firestore is
// unreachable — in both cases the read is guaranteed to be consumed.
interface CacheEntry<T> {
    data: T;
    expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** In-progress reads, keyed the same way as `cache`. See single-flight above. */
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_CACHE_TTL = 60_000; // 60 seconds

/**
 * How long each collection's contents stay fresh.
 *
 * Tuned to how quickly the data actually moves, not to a single global guess.
 * Anything not listed falls back to DEFAULT_CACHE_TTL.
 *
 * Note that every route that writes to a collection calls `invalidateCache()`
 * for it, so a longer TTL here does not mean an admin action takes that long
 * to show up — it means untouched data isn't re-read for no reason.
 */
const COLLECTION_TTL: Record<string, number> = {
    // Moves constantly — keep it short.
    orders: 30_000,
    deliveryTasks: 30_000,
    notifications: 30_000,
    pendingDeliveryRequests: 30_000,

    // Changes when an admin or a partner acts; writes invalidate explicitly.
    vendors: 120_000,
    deliveryPersons: 120_000,
    specialOffers: 120_000,

    // Effectively reference data for the lifetime of a page session.
    customers: 300_000,
    menuItems: 300_000,
    invoices: 300_000,
    wallets: 300_000,
    pushNotifications: 300_000,
    deliveryHistory: 300_000,
    categories: 600_000,
};

/** The freshness window for a collection, used when a caller doesn't specify one. */
export function collectionTtl(collectionName: string): number {
    return COLLECTION_TTL[collectionName] ?? DEFAULT_CACHE_TTL;
}

// ── Fail fast when Firestore is unreachable ──
//
// A route like /api/notifications reads four collections in sequence. With no
// deadline, an unreachable backend costs each read the full gRPC/REST retry
// budget — the request that prompted this took 3.4 minutes to return, and
// still returned nothing useful. Three things bound that:
//
//   1. A hard deadline per read, so one read can't outlast a page load.
//   2. A circuit breaker, so reads two through four don't each re-pay the
//      deadline once the first has already proven the backend is down.
//   3. Stale cache as the fallback, so a dashboard that was working a minute
//      ago keeps rendering last-known data instead of empty panels.

/** Per-read deadline. Override with FIRESTORE_TIMEOUT_MS if a query is slow. */
const FIRESTORE_TIMEOUT_MS = Number(process.env.FIRESTORE_TIMEOUT_MS) || 8_000;

/** How long one failure suppresses further attempts. */
const BREAKER_MS = Number(process.env.FIRESTORE_BREAKER_MS) || 10_000;

let unreachableUntil = 0;

export class FirestoreUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FirestoreUnavailableError';
    }
}

/** Connection-level failure, as opposed to a permission or query error. */
function isConnectionFailure(err: unknown): boolean {
    if (err instanceof FirestoreUnavailableError) return true;
    const e = err as { code?: unknown; message?: unknown };
    // gRPC: 14 UNAVAILABLE, 4 DEADLINE_EXCEEDED. Node sockets: ETIMEDOUT etc.
    if (e?.code === 14 || e?.code === 4) return true;
    return /ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ENOTFOUND|UNAVAILABLE/i.test(
        String(e?.code ?? '') + ' ' + String(e?.message ?? '')
    );
}

/**
 * Run a Firestore read under a deadline. The underlying request may still be
 * in flight when this rejects — it is abandoned, not cancelled, which is fine
 * for reads.
 */
export function withFirestoreTimeout<T>(
    work: Promise<T>,
    label: string,
    ms: number = FIRESTORE_TIMEOUT_MS
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        work,
        new Promise<never>((_, reject) => {
            timer = setTimeout(
                () =>
                    reject(
                        new FirestoreUnavailableError(
                            `Firestore read "${label}" gave up after ${ms}ms — the backend is unreachable.`
                        )
                    ),
                ms
            );
        }),
    ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** True while a recent failure says not to bother trying again yet. */
function breakerOpen(): boolean {
    return Date.now() < unreachableUntil;
}

function tripBreaker(collectionName: string, err: unknown): void {
    if (!isConnectionFailure(err)) return;
    const alreadyOpen = breakerOpen();
    unreachableUntil = Date.now() + BREAKER_MS;
    if (!alreadyOpen) {
        console.warn(
            `Firestore unreachable (first failure on "${collectionName}"). ` +
                `Skipping reads for ${BREAKER_MS}ms and serving cached data where available.`,
            err instanceof Error ? err.message : err
        );
    }
}

/**
 * The shared read path:
 *   fresh cache → join an in-flight read → live read → stale cache → throw.
 */
async function readThroughCache<T>(
    cacheKey: string,
    collectionName: string,
    ttl: number,
    read: () => Promise<T>
): Promise<T> {
    const cached = cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (cached && Date.now() < cached.expiry) {
        return cached.data;
    }

    if (breakerOpen()) {
        if (cached) return cached.data;
        throw new FirestoreUnavailableError(
            `Firestore is unreachable and nothing is cached for "${collectionName}".`
        );
    }

    // ── Single-flight ──
    // Someone is already reading this. Serve the previous value if we have one
    // (a few seconds of staleness beats a second identical full-collection
    // read), otherwise wait for theirs rather than starting our own.
    const pending = inflight.get(cacheKey) as Promise<T> | undefined;
    if (pending) {
        if (cached) return cached.data;
        try {
            return await pending;
        } catch (err) {
            if (cached) return (cached as CacheEntry<T>).data;
            throw err;
        }
    }

    const work = withFirestoreTimeout(read(), collectionName)
        .then((data) => {
            cache.set(cacheKey, { data, expiry: Date.now() + ttl });
            return data;
        })
        .finally(() => {
            inflight.delete(cacheKey);
        });

    inflight.set(cacheKey, work as Promise<unknown>);

    try {
        return await work;
    } catch (err) {
        tripBreaker(collectionName, err);
        if (cached && isConnectionFailure(err)) {
            console.warn(`Serving stale "${collectionName}" — live read failed.`);
            return cached.data;
        }
        throw err;
    }
}

/**
 * Get data from cache or fetch from Firestore.
 * Caches the raw doc data array for the given collection/query key.
 */
export async function cachedCollectionGet(
    collectionName: string,
    ttl?: number
): Promise<FirebaseFirestore.QuerySnapshot> {
    return readThroughCache(`col:${collectionName}`, collectionName, ttl ?? collectionTtl(collectionName), () =>
        db.collection(collectionName).get()
    );
}

/**
 * Get cached document data as plain objects (most common use case).
 * Returns array of { id, ...data }.
 */
export async function cachedCollection(
    collectionName: string,
    ttl?: number
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Array<{ id: string; [key: string]: any }>> {
    return readThroughCache(
        `col_data:${collectionName}`,
        collectionName,
        ttl ?? collectionTtl(collectionName),
        async () => {
            const snapshot = await db.collection(collectionName).get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
    );
}

/**
 * Cache anything derived from Firestore under a caller-chosen key.
 *
 * Use this for a computed payload that is expensive to rebuild even when the
 * underlying collections are already cached — the dashboard summary, for
 * instance, walks every order to accumulate four periods of earnings. Caching
 * the *answer* means a page revisit costs nothing at all rather than a fresh
 * pass over the whole register.
 *
 * Keys live in their own namespace, so `invalidateCache('orders')` leaves them
 * alone; give derived entries a TTL no longer than the data they are built
 * from, and they will never be more stale than that data would have been.
 */
export async function cachedQuery<T>(
    key: string,
    read: () => Promise<T>,
    ttl: number = DEFAULT_CACHE_TTL
): Promise<T> {
    return readThroughCache(`derived:${key}`, key, ttl, read);
}

/**
 * A cached `count()` aggregation.
 *
 * Firestore bills an aggregation at roughly one read per 1,000 index entries
 * scanned, so counting a collection this way costs a fraction of downloading
 * it. Prefer this over pulling a whole collection just to call `.length` or
 * `.filter(...).length` on it.
 */
export async function cachedCount(
    collectionName: string,
    filters: Array<{
        field: string;
        operator: FirebaseFirestore.WhereFilterOp;
        value: unknown;
    }> = [],
    ttl?: number
): Promise<number> {
    const signature = filters
        .map(f => `${f.field}${f.operator}${JSON.stringify(f.value ?? null)}`)
        .join('|');

    return readThroughCache(
        `count:${collectionName}:${signature}`,
        collectionName,
        ttl ?? collectionTtl(collectionName),
        async () => {
            let query: FirebaseFirestore.Query = db.collection(collectionName);
            for (const f of filters) {
                query = query.where(f.field, f.operator, f.value);
            }
            const snapshot = await query.count().get();
            return snapshot.data().count;
        }
    );
}

/**
 * Invalidate cache for a specific collection (call after writes).
 *
 * Clears the collection's document cache and every count derived from it, so a
 * write is visible on the next read rather than at the end of the TTL.
 */
export function invalidateCache(collectionName: string): void {
    const exact = [`col:${collectionName}`, `col_data:${collectionName}`];
    for (const key of exact) {
        cache.delete(key);
        inflight.delete(key);
    }

    const countPrefix = `count:${collectionName}:`;
    for (const key of Array.from(cache.keys())) {
        if (key.startsWith(countPrefix)) cache.delete(key);
    }
    for (const key of Array.from(inflight.keys())) {
        if (key.startsWith(countPrefix)) inflight.delete(key);
    }
}

/**
 * Invalidate cache for a collection and any derived payloads built from it.
 *
 * `derivedKeys` are the `cachedQuery` keys that read this collection — pass
 * them so a write doesn't leave a summary showing the old numbers.
 */
export function invalidateCacheWithDerived(collectionName: string, derivedKeys: string[] = []): void {
    invalidateCache(collectionName);
    for (const key of derivedKeys) {
        cache.delete(`derived:${key}`);
        inflight.delete(`derived:${key}`);
    }
}

/**
 * Invalidate all cached data.
 */
export function invalidateAllCache(): void {
    cache.clear();
    inflight.clear();
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
