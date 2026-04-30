/**
 * Shared pricing constants and calculations for Admin Dashboard.
 * These MUST match the values in shared/PricingCalculator.kt and shared/FeeCalculator.kt.
 */

// Commission & GST
export const COMMISSION_RATE = 0.15;       // 15% commission on food subtotal
export const GST_ON_COMMISSION_RATE = 0.18; // 18% GST on commission

// Delivery partner earnings
export const DELIVERY_BASE_FARE = 10;      // ₹10 base
export const DELIVERY_FEE_PER_KM = 6.5;   // ₹6.5/km
export const MIN_DELIVERY_PERSON_FEE = 15; // ₹15 minimum

// Customer delivery fee
export const CUSTOMER_DELIVERY_FEE_PER_KM = 4.5;
export const MIN_CUSTOMER_DELIVERY_FEE = 15;
export const MAX_CUSTOMER_DELIVERY_FEE = 100;

/** Round to 1 decimal place */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Calculate delivery partner earnings based on distance.
 * Must match PricingCalculator.calculateDeliveryPersonEarnings()
 */
export function calculateDeliveryPartnerPayout(distanceKm: number): number {
    if (distanceKm <= 0) return MIN_DELIVERY_PERSON_FEE;
    const fee = DELIVERY_BASE_FARE + distanceKm * DELIVERY_FEE_PER_KM;
    const rounded = round1(fee);
    return Math.max(rounded, MIN_DELIVERY_PERSON_FEE);
}

/**
 * Calculate vendor earnings breakdown.
 * Must match FeeCalculator.calculateVendorEarnings()
 */
export function calculateVendorEarnings(itemTotal: number) {
    if (itemTotal <= 0) return { platformFee: 0, gstOnPlatformFee: 0, totalDeduction: 0, vendorEarning: 0 };

    const platformFee = round1(itemTotal * COMMISSION_RATE);
    const gstOnPlatformFee = round1(platformFee * GST_ON_COMMISSION_RATE);
    const totalDeduction = round1(platformFee + gstOnPlatformFee);
    const vendorEarning = round1(Math.max(0, itemTotal - totalDeduction));

    return { platformFee, gstOnPlatformFee, totalDeduction, vendorEarning };
}

/**
 * Format price for display — shows 1 decimal if fractional, otherwise whole number.
 * Must match PriceFormatter.format()
 */
export function formatPrice(amount: number): string {
    if (amount === Math.floor(amount)) {
        return amount.toFixed(0);
    }
    return amount.toFixed(1);
}

/**
 * Format price with ₹ symbol
 */
export function formatPriceWithSymbol(amount: number): string {
    return `₹${formatPrice(amount)}`;
}

