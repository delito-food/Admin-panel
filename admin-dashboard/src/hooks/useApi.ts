import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api-client';

interface UseApiOptions {
    autoFetch?: boolean;
}

interface UseApiResult<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

export function useApi<T>(
    endpoint: string,
    options: UseApiOptions = { autoFetch: true }
): UseApiResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await authenticatedFetch(endpoint);

            if (response.status === 401) {
                setError('Session expired. Please log in again.');
                setLoading(false);
                return;
            }

            const result = await response.json();

            if (result.success) {
                setData(result.data);
            } else {
                setError(result.error || 'Failed to fetch data');
            }
        } catch (err) {
            setError('Network error. Please try again.');
            console.error('API Error:', err);
        } finally {
            setLoading(false);
        }
    }, [endpoint]);

    useEffect(() => {
        if (options.autoFetch) {
            fetchData();
        }
    }, [fetchData, options.autoFetch]);

    return { data, loading, error, refetch: fetchData };
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
