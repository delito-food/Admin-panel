import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '@/lib/api-client';

interface UseApiOptions {
    autoFetch?: boolean;
    /**
     * Refresh every N milliseconds. Polling is suspended while the tab is in
     * the background and resumes — with an immediate refresh — when it comes
     * back, so a dashboard left open on a second monitor overnight doesn't
     * spend the night querying Firestore.
     */
    pollMs?: number;
    /**
     * How long a cached response is served without a network call at all.
     * Past this, the cached value is still shown immediately while a refresh
     * runs behind it.
     */
    freshMs?: number;
}

interface UseApiResult<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
    /** Replace the cached value locally — used to merge a delta refresh. */
    mutate: (next: T) => void;
}

// ── Shared client-side response cache ──
//
// Every page in the panel mounted its own `useApi` and started from nothing,
// so moving from Orders to Vendors and back meant two more full round trips
// and two more spinners, even though the data had been on screen seconds
// earlier. The cache below is module-scoped, so it survives navigation for as
// long as the tab is open.
//
// Three things come out of that:
//   • Revisiting a page paints instantly from cache, then quietly refreshes.
//   • Two components asking for the same endpoint at the same time share one
//     request instead of racing (see `inflight`).
//   • The server sees far fewer requests, and each one it does see is more
//     likely to hit its own cache.
//
// This is a per-tab memory cache and nothing more: a reload clears it, and it
// is never the source of truth for anything written back.

interface ClientCacheEntry {
    data: unknown;
    fetchedAt: number;
}

const responseCache = new Map<string, ClientCacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Cap on distinct cached endpoints.
 *
 * Report pages build their URL from the selected filters, so a long session
 * spent exploring date ranges would otherwise accumulate an entry per
 * combination. Oldest-first eviction keeps the working set — the pages
 * someone actually moves between — and drops the one-off queries.
 */
const MAX_CACHE_ENTRIES = 40;

function rememberResponse(endpoint: string, data: unknown): void {
    responseCache.delete(endpoint);
    responseCache.set(endpoint, { data, fetchedAt: Date.now() });
    while (responseCache.size > MAX_CACHE_ENTRIES) {
        const oldest = responseCache.keys().next().value;
        if (oldest === undefined) break;
        responseCache.delete(oldest);
    }
}

/** Default window during which a cached response is used as-is. */
const DEFAULT_FRESH_MS = 20_000;

class ApiError extends Error {}

async function fetchEndpoint<T>(endpoint: string): Promise<T> {
    const existing = inflight.get(endpoint) as Promise<T> | undefined;
    if (existing) return existing;

    const work = (async (): Promise<T> => {
        const response = await authenticatedFetch(endpoint);

        if (response.status === 401) {
            throw new ApiError('Session expired. Please log in again.');
        }

        const result = await response.json();
        if (!result.success) {
            throw new ApiError(result.error || 'Failed to fetch data');
        }

        rememberResponse(endpoint, result.data);
        return result.data as T;
    })().finally(() => {
        inflight.delete(endpoint);
    });

    inflight.set(endpoint, work as Promise<unknown>);
    return work;
}

/** Drop a cached endpoint so the next read goes to the server. */
export function invalidateApiCache(endpoint?: string): void {
    if (endpoint) responseCache.delete(endpoint);
    else responseCache.clear();
}

export function useApi<T>(
    endpoint: string,
    options: UseApiOptions = {}
): UseApiResult<T> {
    const { autoFetch = true, pollMs, freshMs = DEFAULT_FRESH_MS } = options;

    const cached = responseCache.get(endpoint);
    const [data, setData] = useState<T | null>((cached?.data as T) ?? null);
    // Only show a spinner when there is genuinely nothing to show.
    const [loading, setLoading] = useState(autoFetch && !cached);
    const [error, setError] = useState<string | null>(null);

    // Guards against writing state after the component has gone, and against a
    // slow response for endpoint A landing after the caller switched to B.
    const mountedRef = useRef(true);
    const endpointRef = useRef(endpoint);
    endpointRef.current = endpoint;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const load = useCallback(async (opts: { force?: boolean } = {}) => {
        const entry = responseCache.get(endpoint);

        if (entry) {
            // Paint what we already have before doing anything else.
            if (mountedRef.current && endpointRef.current === endpoint) {
                setData(entry.data as T);
                setLoading(false);
            }
            if (!opts.force && Date.now() - entry.fetchedAt < freshMs) return;
        } else if (mountedRef.current) {
            setLoading(true);
        }

        try {
            const result = await fetchEndpoint<T>(endpoint);
            if (!mountedRef.current || endpointRef.current !== endpoint) return;
            setData(result);
            setError(null);
        } catch (err) {
            if (!mountedRef.current || endpointRef.current !== endpoint) return;
            if (err instanceof ApiError) {
                setError(err.message);
            } else {
                setError('Network error. Please try again.');
                console.error('API Error:', err);
            }
        } finally {
            if (mountedRef.current && endpointRef.current === endpoint) {
                setLoading(false);
            }
        }
    }, [endpoint, freshMs]);

    const refetch = useCallback(() => load({ force: true }), [load]);

    const mutate = useCallback((next: T) => {
        rememberResponse(endpoint, next);
        if (mountedRef.current) setData(next);
    }, [endpoint]);

    // When the endpoint changes — a report page rebuilding its URL from the
    // selected filters, say — show that endpoint's cached answer straight away
    // rather than leaving the previous one on screen.
    useEffect(() => {
        const entry = responseCache.get(endpoint);
        setData((entry?.data as T) ?? null);
        setError(null);
    }, [endpoint]);

    useEffect(() => {
        if (autoFetch) load();
    }, [load, autoFetch]);

    // ── Polling, paused while the tab is hidden ──
    useEffect(() => {
        if (!pollMs || !autoFetch) return;

        let timer: ReturnType<typeof setInterval> | undefined;

        const start = () => {
            if (timer) return;
            timer = setInterval(() => { load({ force: true }); }, pollMs);
        };
        const stop = () => {
            if (timer) clearInterval(timer);
            timer = undefined;
        };

        const onVisibility = () => {
            if (document.hidden) {
                stop();
            } else {
                // Catch up on whatever was missed, then resume the cadence.
                load({ force: true });
                start();
            }
        };

        if (!document.hidden) start();
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pollMs, autoFetch, load]);

    return { data, loading, error, refetch, mutate };
}

// Helper function for PATCH requests
export async function apiPatch<T>(
    endpoint: string,
    body: Record<string, unknown>
): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const response = await authenticatedFetch(endpoint, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        return result;
    } catch (err) {
        console.error('API PATCH Error:', err);
        return { success: false, error: 'Network error' };
    }
}

// Type definitions for API responses

// Platform earnings data structure — complete breakdown per period
export interface EarningsData {
    gmv: number;                    // Total customer payment (subtotal + delivery fee collected)
    subtotal: number;               // Food-only subtotal across orders
    customerDeliveryFees: number;   // Delivery fee collected from customers (₹4.5/km, ₹7.5/km for small orders)
    partnerDeliveryPayouts: number; // Actual delivery payout to partners (₹10 base + ₹6.5/km)
    deliveryFeeProfit: number;      // Net delivery P&L (usually negative = platform subsidises)
    commission: number;             // 15% commission on subtotal
    gstOnCommission: number;        // 18% GST on commission
    platformCommissionEarning: number; // commission + gstOnCommission
    netPlatformEarning: number;     // Actual money in hand (commission earning − delivery subsidy)
    vendorPayout: number;           // Amount payable to vendors (subtotal − commission − gst)
    orderCount: number;
}

// Top performer structure
export interface TopPerformer {
    id: string;
    name: string;
    totalOrders: number;
    revenue: number;
    rating: number;
}

export interface DashboardStats {
    stats: {
        totalOrders: number;
        todayOrders: number;
        totalRevenue: number;
        todayRevenue: number;
        activeVendors: number;
        activeDelivery: number;
        totalCustomers: number;
    };
    verification: {
        pendingVendors: number;
        pendingDeliveryPersons: number;
        pendingMenuItems: number;
        total: number;
    };
    vendors: {
        total: number;
        active: number;
        online: number;
    };
    deliveryPersons: {
        total: number;
        active: number;
        online: number;
    };
    customers: {
        total: number;
    };
    orders: {
        total: number;
        pending: number;
        completed: number;
    };
    // Comprehensive analytics
    platformEarnings?: {
        today: EarningsData;
        thisWeek: EarningsData;
        thisMonth: EarningsData;
        allTime: EarningsData;
    };
    ordersOverview?: {
        total: number;
        completed: number;
        pending: number;
        cancelled: number;
        avgOrderValue: number;
    };
    vendorStats?: {
        total: number;
        verified: number;
        suspended: number;
        online: number;
        topPerformers: TopPerformer[];
    };
    deliveryStats?: {
        total: number;
        verified: number;
        suspended: number;
        online: number;
        topPerformers: TopPerformer[];
    };
    customerMetrics?: {
        total: number;
        newThisMonth: number;
        activeThisMonth: number;
        retentionRate: number;
    };
    revenueTrend?: Array<{
        date: string;
        revenue: number;
        orders: number;
        platformEarnings: number;
    }>;
}

export interface MenuItem {
    itemId: string;
    name: string;
    price: number;
    imageUrl: string;
    discount: number;
    isAvailable: boolean;
    isBestSeller: boolean;
    isVeg: boolean;
    categoryName: string;
}

export interface SpecialOffer {
    itemId: string;
    name: string;
    price: number;
    discount: number;
    imageUrl: string;
}

export interface Vendor {
    vendorId: string;
    fullName: string;
    shopName: string;
    email: string;
    phoneNumber: string;
    profileImageUrl: string;
    shopImageUrl: string;
    address: string;
    city: string;
    pincode: string;
    gstNumber: string;
    fssaiLicense: string;
    rating: number;
    totalOrders: number;
    totalEarnings: number;
    menuItemsCount: number;
    menuItems: MenuItem[];
    specialOffers: SpecialOffer[];
    isOnline: boolean;
    isVerified: boolean;
    cuisineTypes: string[];
    minimumOrderAmount: number;
    averageDeliveryTime: number;
    createdAt: string;
    registeredAt: string;
    status: string;
    isHidden?: boolean;
    adminForceOffline?: boolean;
}

export interface Customer {
    customerId: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    profileImageUrl: string;
    address: string;
    city: string;
    pincode: string;
    addresses: Array<{
        addressId: string;
        label: string;
        fullAddress: string;
        city: string;
        pincode: string;
    }>;
    totalOrders: number;
    totalSpent: number;
    lastOrderAt: string;
    registeredAt: string;
    createdAt: string;
    status: string;
}

export interface DeliveryPartner {
    deliveryPersonId: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    profilePhotoUrl: string;
    address: string;
    city: string;
    pincode: string;
    vehicleType: string;
    vehicleNumber: string;
    driverLicenseNumber: string;
    rating: number;
    totalDeliveries: number;
    totalEarnings: number;
    incentives: number;
    codCollected: number;
    codSettled: number;
    codPending: number;
    isOnline: boolean;
    isOnDelivery: boolean;
    isVerified: boolean;
    currentLocation: string;
    registeredAt: string;
    createdAt: string;
    status: string;
}

export interface Order {
    orderId: string;
    vendorId: string;
    vendorName: string;
    vendorPhone: string;
    vendorAddress: string;
    vendorCity: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    items: Array<{
        itemId: string;
        name: string;
        price: number;
        quantity: number;
        originalPrice?: number;
        discountedPrice?: number;
    }>;
    itemNames: string[];
    itemTotal: number;
    originalItemTotal?: number;
    subtotal: number;
    discount: number;
    /** Menu / special-offer discount already applied to the item lines */
    itemDiscount?: number;
    deliveryDiscount?: number;
    hungerGameDiscount?: number;
    /** Sum of every discount applied to the order */
    totalDiscount?: number;
    /** Invoice number issued for this order (INV-2026-000042) */
    invoiceNumber?: string;
    deliveryFee: number;
    taxes: number;
    tip: number;
    smallOrderSupportFee: number;
    total: number;
    status: string;
    paymentMode: string;
    paymentStatus: string;
    deliveryAddress: string;
    distanceKm: number;
    deliveryPersonId: string | null;
    deliveryPersonName: string;
    deliveryPersonPhone: string;
    deliveryPersonVehicleType: string;
    deliveryPersonVehicleNumber: string;
    deliveryPersonRating: number;
    pickupPin: string;
    deliveryPin: string;
    pickupPinVerified: boolean;
    deliveryPinVerified: boolean;
    pickupPinVerifiedAt: string | null;
    deliveryPinVerifiedAt: string | null;
    createdAt: string;
    acceptedAt: string | null;
    preparingAt: string | null;
    preparedAt: string | null;
    dispatchedAt: string | null;
    pickedUpAt: string | null;
    deliveredAt: string | null;
    estimatedDeliveryTime: number;
    deliveryInstruction: string;
    refundStatus: string;
    refundAmount: number;
    codSettled: boolean;
    deliveryTaskStatus: string;
    // Coin & promo discount info
    coinsUsed: number;
    coinDiscount: number;
    promoCode: string;
    promoDiscount: number;
    // Vendor commission (stored on order at time of placement)
    vendorPlatformCut: number;
    vendorGstOnPlatformCut: number;
    vendorTotalDeduction: number;
    vendorEarning: number;
}

export interface PendingVendor {
    vendorId: string;
    fullName: string;
    shopName: string;
    email: string;
    phoneNumber: string;
    address: string;
    city: string;
    pincode: string;
    gstNumber: string;
    fssaiLicense: string;
    fssaiLicenseUrl: string;
    gstDocumentUrl: string;
    cuisineTypes: string[];
    submittedAt: string;
    verificationStatus: string;
}

export interface PendingDeliveryPerson {
    deliveryPersonId: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    address: string;
    city: string;
    pincode: string;
    vehicleType: string;
    vehicleNumber: string;
    driverLicenseNumber: string;
    driverLicenseUrl: string;
    vehicleDocumentUrl: string;
    profilePhotoUrl: string;
    submittedAt: string;
    verificationStatus: string;
}

export interface PendingMenuItem {
    itemId: string;
    vendorId: string;
    vendorName: string;
    name: string;
    description: string;
    price: number;
    categoryId: string;
    categoryName: string;
    imageUrl: string;
    isVeg: boolean;
    preparationTime: number;
    submittedAt: string;
    verificationStatus: string;
}
