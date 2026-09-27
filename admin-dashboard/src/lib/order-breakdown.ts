/**
 * Money breakdown of one delivered order — shared by the dashboard and
 * the story page so both report the same platform earnings.
 */

// Platform rate constants
const COMMISSION_RATE = 0.15;      // 15% commission on food subtotal
const GST_RATE = 0.18;             // 18% GST on commission
const BASE_DELIVERY_FEE_PARTNER = 10;  // ₹10 base given to delivery partner
const PER_KM_RATE_PARTNER = 6.5;  // ₹6.5/km given to delivery partner
// Customer-facing delivery fee is stored in order.deliveryFee (4.5/km based)

/**
 * Calculate the complete money breakdown for a single delivered order.
 *
 * Customer pays:  subtotal + customerDeliveryFee
 * Vendor gets:    subtotal - commission - gstOnCommission
 * Platform gets:  commission + gstOnCommission + deliveryFeeProfit (may be negative)
 * Partner gets:   partnerDeliveryPayout (₹10 base + ₹6.5/km)
 *
 * deliveryFeeProfit = customerDeliveryFee - partnerDeliveryPayout
 *   → positive means platform earns on delivery
 *   → negative means platform subsidises delivery (usual case)
 */
export function calcOrderBreakdown(order: {
    subtotal?: number;
    itemTotal?: number;
    total?: number;
    deliveryFee?: number;
    deliveryPersonEarnings?: number;
    distanceKm?: number;
    smallOrderSupportFee?: number;
    taxes?: number;
    gstOnFood?: number;
    gstOnServices?: number;
    vendorEarning?: number;
    vendorPlatformCut?: number;
    vendorGstOnPlatformCut?: number;
}) {
    const subtotal = order.subtotal || order.itemTotal || 0;
    const customerDeliveryFee = order.deliveryFee || 0;

    // What the delivery partner actually earns — round1 precision matching apps
    const distanceKm = order.distanceKm || 0;
    const partnerDeliveryPayout = order.deliveryPersonEarnings != null
        ? order.deliveryPersonEarnings
        : (distanceKm > 0
            ? Math.max(15, Math.round((BASE_DELIVERY_FEE_PARTNER + distanceKm * PER_KM_RATE_PARTNER) * 10) / 10)
            : 15); // ₹15 minimum if no distance data

    // Use stored commission values when available (respects custom vendor rates)
    const commission = (order.vendorPlatformCut && order.vendorPlatformCut > 0)
        ? order.vendorPlatformCut
        : Math.round(subtotal * COMMISSION_RATE * 10) / 10;
    const gstOnCommission = (order.vendorGstOnPlatformCut && order.vendorGstOnPlatformCut > 0)
        ? order.vendorGstOnPlatformCut
        : Math.round(commission * GST_RATE * 10) / 10;
    const platformCommissionEarning = Math.round((commission + gstOnCommission) * 10) / 10;

    // Delivery profit/loss for platform
    const deliveryFeeProfit = customerDeliveryFee - partnerDeliveryPayout; // usually negative

    // Small order fee (₹10 bonus platform gets for orders below threshold)
    const smallOrderFee = order.smallOrderSupportFee || 0;

    // Net platform earnings from this order (commission + delivery profit/loss + small order fee)
    const netPlatformEarning = platformCommissionEarning + deliveryFeeProfit + smallOrderFee;

    // What vendor receives — use stored value if available, else calculate
    const vendorPayout = order.vendorEarning != null && order.vendorEarning > 0
        ? order.vendorEarning
        : Math.round((subtotal - platformCommissionEarning) * 10) / 10;

    // Total GMV = what customer actually pays (use stored total, which includes GST)
    // Fallback to subtotal + deliveryFee if total is not available
    const gmv = order.total || (subtotal + customerDeliveryFee);

    return {
        gmv,                        // total customer payment
        subtotal,                   // food-only subtotal
        customerDeliveryFee,        // delivery fee charged to customer
        partnerDeliveryPayout,      // actual payout to delivery partner
        deliveryFeeProfit,          // positive = platform earns; negative = platform subsidises
        commission,                 // 15% of subtotal
        gstOnCommission,            // 18% on commission
        platformCommissionEarning,  // commission + GST
        smallOrderFee,
        netPlatformEarning,         // platform's actual net (after delivery subsidy)
        vendorPayout,               // subtotal - commission - gst
    };
}
