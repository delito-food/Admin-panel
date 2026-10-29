/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Money breakdown of one fulfilled order — shared by the dashboard and the
 * story page so both report the same Delito earnings.
 *
 * ── What "Delito earning" means here ─────────────────────────────────────
 *
 * The money that stays with Delito once everyone else on the order has been
 * paid. Worked out from the cash, not from a list of income lines, so nothing
 * on the bill can be silently left out:
 *
 *   customer paid (order.total)
 *   − tip                      → passed to the rider
 *   − GST on the customer bill → remitted (same figure the GST report files)
 *   − vendor payout            → order.vendorEarning, already net of
 *                                commission, GST on commission and the
 *                                vendor's share of a co-funded offer
 *   − rider pay                → order.deliveryPersonEarnings (incl. surge share)
 *   − GST on commission        → collected from the vendor, remitted
 *   = Delito earning
 *
 * The same figure, read as income lines (shown on the dashboard card):
 *
 *   commission (ex-GST)
 *   + delivery fee + surge fee charged to the customer (ex-GST)
 *   + platform / small-order / COD fees (ex-GST)
 *   − rider pay
 *   − discounts Delito funded (promo codes, coins, HungerGame, Delito's share
 *     of co-funded offers — ex-GST, because the discount also lowers the GST)
 *   ± rounding / anything the order's own fields don't explain
 *
 * Before this, the dashboard counted GST on commission as Delito's income
 * (it is a tax collected for the government) and ignored every Delito-funded
 * discount, so the headline was higher than the money actually earned.
 */

import { computeOrderEconomics, computeCommission } from './pricing-engine';
import { RATE } from './gst';

// Fallback rider pay for orders written before deliveryPersonEarnings existed.
const BASE_DELIVERY_FEE_PARTNER = 10;
const PER_KM_RATE_PARTNER = 6.5;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export type OrderBreakdown = ReturnType<typeof calcOrderBreakdown>;

export function calcOrderBreakdown(order: any, orderId: string = String(order?.orderId || order?.id || '')) {
    // Food at the shop's price — the vendor's gross, and what the app writes as
    // both `itemTotal` and `subtotal`.
    const subtotal = num(order.itemTotal) || num(order.subtotal);

    // Delivery charged to the customer, surge included (its rider share is
    // inside rider pay, so the surge the customer paid has to be on this side).
    const customerDeliveryFee = r2(num(order.deliveryFee) + Math.max(0, num(order.surgeFee)));
    const platformFees = r2(num(order.technologyServiceFee) + num(order.smallOrderSupportFee) + num(order.codCharges));

    // Rider pay. Never legitimately 0, so a stored 0 means "missing".
    const distanceKm = num(order.distanceKm);
    const partnerDeliveryPayout = num(order.deliveryPersonEarnings) > 0
        ? num(order.deliveryPersonEarnings)
        : (distanceKm > 0
            ? Math.max(15, Math.round((BASE_DELIVERY_FEE_PARTNER + distanceKm * PER_KM_RATE_PARTNER) * 10) / 10)
            : 15);

    // Commission as withheld from the vendor (stored value wins; otherwise
    // the vendor's rate on the pre-discount item total, as the app does).
    const commissionResult = computeCommission(order, subtotal);
    const commission = commissionResult.amount;
    const gstOnCommission = commissionResult.gst;
    const platformCommissionEarning = r2(commission + gstOnCommission); // billed to vendors, incl. GST

    // Vendor payout — stored figure wins (it already carries the vendor's
    // share of a co-funded offer). Same rule as the cash-flow report.
    const storedVendor = order.vendorEarning;
    const vendorPayout = (typeof storedVendor === 'number' && Number.isFinite(storedVendor) && storedVendor >= 0 &&
        (storedVendor > 0 || num(order.campaignDiscount) > 0))
        ? storedVendor
        : Math.max(0, r2(subtotal - commission - gstOnCommission - num(order.campaignVendorFunded)));

    // Customer bill: what was paid and the GST on it, from the same engine the
    // tax invoice and the GST report use.
    const economics = computeOrderEconomics(order, orderId);
    const tip = economics.tip;
    const gmv = num(order.total) > 0 ? num(order.total) : economics.invoiceValue;
    const customerGst = economics.totalTax;

    // Discounts Delito paid for, ex-GST. A post-tax discount (promo, coins,
    // HungerGame) is tax-inclusive, so part of it is GST Delito no longer owes.
    const delitoFundedDiscounts = r2(economics.discounts
        .filter(d => d.fundedBy === 'platform' && d.key !== 'item')
        .reduce((s, d) => {
            if (d.preTax === true) return s + d.amount;
            const rate = d.appliedTo === 'food' ? RATE.FOOD : RATE.DELIVERY;
            return s + d.amount / (1 + rate / 100);
        }, 0));

    // ── The answer ──
    const netPlatformEarning = r2(gmv - tip - customerGst - vendorPayout - partnerDeliveryPayout - gstOnCommission);

    // Income-line view of the same number.
    const customerFeesExGst = r2(customerDeliveryFee + platformFees);
    const deliveryFeeProfit = r2(customerDeliveryFee - partnerDeliveryPayout); // usually negative
    const explained = commission + customerFeesExGst - partnerDeliveryPayout - delitoFundedDiscounts;
    const otherAdjustments = r2(netPlatformEarning - explained); // COD rounding, data mismatches

    // Money that went back to the customer on this order (refund paid, or COD
    // waived). Reported beside the earning, not netted from it: who bears a
    // refund is decided per refund (vendor or Delito).
    const refundStatus = String(order.refundStatus || '').toUpperCase();
    const refundMoved = Boolean(
        order.refundId || order.razorpayRefundId || order.refundProcessedAt || order.refundedAt ||
        order.paymentStatus === 'Refunded' ||
        ['FULL_REFUNDED', 'HALF_REFUNDED', 'COMPLETED', 'SUCCESS', 'PROCESSED', 'REFUNDED'].includes(refundStatus)
    );
    const refunded = refundMoved ? num(order.refundAmount) : 0;

    return {
        gmv,                        // total the customer paid
        subtotal,                   // food at shop price
        customerDeliveryFee,        // delivery + surge charged to customer (ex-GST)
        platformFees,               // platform / small-order / COD fees (ex-GST)
        partnerDeliveryPayout,      // rider pay
        deliveryFeeProfit,          // customerDeliveryFee − rider pay
        commission,                 // ex-GST
        gstOnCommission,            // collected from vendor, remitted
        platformCommissionEarning,  // commission + GST, as billed to vendors
        delitoFundedDiscounts,      // ex-GST
        customerGst,                // GST on the customer bill, remitted
        tip,                        // passed to rider
        smallOrderFee: num(order.smallOrderSupportFee),
        otherAdjustments,
        refunded,
        netPlatformEarning,         // Delito's real earning on this order
        vendorPayout,
    };
}
