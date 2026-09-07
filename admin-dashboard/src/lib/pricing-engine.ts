/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The single definition of an order's economics.
 *
 * Every consumer — the customer tax invoice, the commission invoice, the GST
 * report, the payout screen — reads its numbers from here. Before this existed
 * there were three different commission bases and two different tax totals in
 * circulation, and disagreements were resolved with Math.max().
 *
 * Constants mirror shared/src/main/java/com/example/shared/PricingCalculator.kt,
 * which remains the source of truth: the app computes these at order time and
 * writes them onto the order. This module prefers what the app stored and only
 * derives a value when the field is absent.
 *
 * ── Two policy decisions are encoded here ────────────────────────────────
 *
 * 1. SUPPLIER OF RECORD (GST s.9(5)). Delito is the supplier for restaurant
 *    service and for delivery service supplied through it. One tax invoice per
 *    order is issued by Delito under its own GSTIN. The restaurant and the
 *    delivery partner are not suppliers on that document.
 *
 * 2. DISCOUNTS REDUCE TAXABLE VALUE. Menu and offer discounts already do,
 *    because the line price is the discounted one. Promo codes, Delito coins
 *    and HungerGame rewards are applied by the app AFTER GST is added, so the
 *    rupees the customer saved include tax. They are therefore treated as
 *    tax-inclusive and split back into a taxable-value reduction and a tax
 *    reduction — which is what keeps the invoice total equal to the amount the
 *    customer actually paid.
 */

import { RATE, HSN, splitTax, splitInclusive, taxOn, type TaxSplit } from './gst';

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors PricingCalculator.kt. */
export const PRICING = {
    GST_ON_FOOD: RATE.FOOD,
    GST_ON_SERVICES: RATE.DELIVERY,
    DEFAULT_COMMISSION_RATE: 15,
    GST_ON_COMMISSION: RATE.COMMISSION,
    DELIVERY_BASE_FARE: 10,
    DELIVERY_FEE_PER_KM: 6.5,
    MIN_DELIVERY_PERSON_FEE: 15,
} as const;

/**
 * How much of the item total the commission is charged on.
 *
 * `original` — the pre-discount item total. This is what PricingCalculator.kt
 * has always used, so it is what has actually been withheld from vendors since
 * launch; billing on any other basis would mean restating every issued month.
 */
export type CommissionBase = 'original' | 'discounted';
export const COMMISSION_BASE: CommissionBase = 'original';

// ── Shapes ────────────────────────────────────────────────────────────────

export interface InvoiceLine {
    slNo: number;
    name: string;
    hsn: string;
    quantity: number;
    /** Pre-discount unit price, as listed. */
    listPrice: number;
    /** Price actually charged per unit. */
    unitPrice: number;
    /** (listPrice − unitPrice) × quantity. */
    lineDiscount: number;
    taxableValue: number;
    ratePercent: number;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
}

export interface Component {
    key: 'food' | 'delivery' | 'platform';
    label: string;
    hsn: string;
    ratePercent: number;
    /** Taxable value before order-level discounts. */
    grossTaxableValue: number;
    /** Reduction in taxable value caused by order-level discounts. */
    discountOnTaxableValue: number;
    /** grossTaxableValue − discountOnTaxableValue. */
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    /** taxableValue + totalTax. */
    total: number;
}

export interface DiscountLine {
    /** Machine key, e.g. 'promo'. */
    key: string;
    label: string;
    /** The rupees the customer saved, tax inclusive. */
    amount: number;
    /** Which component's taxable value it reduces. */
    appliedTo: 'food' | 'delivery' | 'platform';
    /** Whether it was funded by the vendor or by Delito. */
    fundedBy: 'vendor' | 'platform';
}

export interface CommissionResult {
    ratePercent: number;
    base: CommissionBase;
    /** The amount the rate was applied to. */
    baseAmount: number;
    amount: number;
    gst: number;
    total: number;
    /** True when these figures came from the order rather than being derived. */
    fromStoredValues: boolean;
}

export interface Reconciliation {
    ok: boolean;
    /** What the order says the customer paid. */
    orderTotal: number;
    /** taxableValue + tax + tip + roundOff. */
    computedTotal: number;
    /** Absorbs the app's whole-rupee rounding on COD orders. */
    roundOff: number;
    /** Unexplained residual. Non-zero means the order data is inconsistent. */
    residual: number;
    messages: string[];
}

export interface OrderEconomics {
    orderId: string;
    lines: InvoiceLine[];
    components: Component[];
    discounts: DiscountLine[];
    totalDiscount: number;
    /** Gratuity — not consideration for a supply, so not taxed. */
    tip: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    roundOff: number;
    /** What the customer paid, and what the invoice must show. */
    invoiceValue: number;
    commission: CommissionResult;
    reconciliation: Reconciliation;
    isInterState: boolean;
}

// ── Engine ────────────────────────────────────────────────────────────────

/** Accept 0 as a real value; only fall through on null/undefined. */
function num(...values: unknown[]): number {
    for (const v of values) {
        if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return 0;
}

/**
 * Compute everything about an order, once.
 *
 * @param order        the raw Firestore order document
 * @param orderId      document id
 * @param opts.interState  whether the supply is inter-state (place of supply)
 * @param opts.commissionRatePercent  the vendor's rate; defaults to 15
 */
export function computeOrderEconomics(
    order: any,
    orderId: string,
    opts: { interState?: boolean; commissionRatePercent?: number } = {}
): OrderEconomics {
    const interState = opts.interState === true;
    const messages: string[] = [];

    // ── 1. Lines ──────────────────────────────────────────────────────────
    const rawItems: any[] = Array.isArray(order.items) ? order.items : [];
    const lines: InvoiceLine[] = rawItems.map((item, index) => {
        const quantity = num(item?.quantity) || 1;
        const charged = num(item?.discountedPrice, item?.price);
        const listPrice = Math.max(
            charged,
            num(item?.originalPrice, item?.mrp, item?.basePrice, item?.price)
        );
        const taxableValue = r2(charged * quantity);
        const tax = taxOn(taxableValue, RATE.FOOD);
        const split = splitTax(tax, interState);

        return {
            slNo: index + 1,
            name: String(item?.name || 'Item'),
            hsn: HSN.FOOD,
            quantity,
            listPrice: r2(listPrice),
            unitPrice: r2(charged),
            lineDiscount: r2(Math.max(0, (listPrice - charged) * quantity)),
            taxableValue,
            ratePercent: RATE.FOOD,
            cgst: split.cgst,
            sgst: split.sgst,
            igst: split.igst,
            total: r2(taxableValue + split.total),
        };
    });

    // ── 2. Component gross values, as the app charged them ────────────────
    //
    // Prefer the order's own itemTotal: it is what the app based GST on. The
    // sum of lines is only a fallback, and a mismatch between the two is worth
    // reporting rather than silently taking the larger, as the old code did.
    const lineSum = r2(lines.reduce((s, l) => s + l.taxableValue, 0));
    const storedItemTotal = num(order.itemTotal, order.subtotal);
    const foodGross = storedItemTotal > 0 ? r2(storedItemTotal) : lineSum;
    if (storedItemTotal > 0 && lines.length > 0 && Math.abs(lineSum - storedItemTotal) > 0.5) {
        messages.push(`Item lines sum to ₹${lineSum.toFixed(2)} but the order records ₹${storedItemTotal.toFixed(2)}`);
    }

    const deliveryGross = r2(num(order.deliveryFee));
    const platformGross = r2(num(order.smallOrderSupportFee, order.platformFee));

    // Tax as charged. gstOnServices covers delivery + platform together and is
    // split between them in proportion to their taxable values.
    const foodTaxCharged = num(order.gstOnFood) > 0 ? r2(num(order.gstOnFood)) : taxOn(foodGross, RATE.FOOD);
    const serviceBase = r2(deliveryGross + platformGross);
    const serviceTaxCharged = num(order.gstOnServices) > 0
        ? r2(num(order.gstOnServices))
        : taxOn(serviceBase, RATE.DELIVERY);
    const deliveryTaxCharged = serviceBase > 0 ? r2(serviceTaxCharged * deliveryGross / serviceBase) : 0;
    const platformTaxCharged = r2(serviceTaxCharged - deliveryTaxCharged);

    // ── 3. Order-level discounts ──────────────────────────────────────────
    //
    // These are subtracted from the total by the app AFTER tax
    // (PricingCalculator subtracts promoDiscount; PaymentScreen then subtracts
    // coins and HungerGame), so each is a tax-inclusive saving.
    //
    // Delivery-fee waivers are deliberately NOT listed: PricingCalculator
    // already returns deliveryFee = 0 when a free-delivery offer applies, so
    // `deliveryDiscount` is a display figure and subtracting it here would
    // credit the customer twice.
    const promo = r2(num(order.promoDiscount));
    const coin = r2(num(order.coinDiscount));
    const hungerGameTotal = r2(num(order.hungerGameDiscount));
    const hungerGameDelivery = Math.min(r2(num(order.hungerGameLevel2DeliveryDiscount)), hungerGameTotal);
    const hungerGameFood = r2(Math.max(0, hungerGameTotal - hungerGameDelivery));

    const discounts: DiscountLine[] = [];
    const itemDiscountTotal = r2(lines.reduce((s, l) => s + l.lineDiscount, 0));
    if (itemDiscountTotal > 0) {
        // Already reflected in the line prices — listed for the customer's
        // "you saved" figure, never subtracted again.
        discounts.push({ key: 'item', label: 'Menu & offer discount', amount: itemDiscountTotal, appliedTo: 'food', fundedBy: 'vendor' });
    }
    if (promo > 0) discounts.push({ key: 'promo', label: 'Promo code', amount: promo, appliedTo: 'food', fundedBy: 'platform' });
    if (coin > 0) discounts.push({ key: 'coin', label: 'Delito coins redeemed', amount: coin, appliedTo: 'food', fundedBy: 'platform' });
    if (hungerGameFood > 0) discounts.push({ key: 'hungerGameFood', label: 'HungerGame reward', amount: hungerGameFood, appliedTo: 'food', fundedBy: 'platform' });
    if (hungerGameDelivery > 0) discounts.push({ key: 'hungerGameDelivery', label: 'HungerGame free delivery', amount: hungerGameDelivery, appliedTo: 'delivery', fundedBy: 'platform' });

    // Only post-tax discounts reduce the component totals here; the item
    // discount is already inside the line prices.
    const postTaxDiscounts = discounts.filter(d => d.key !== 'item');

    // ── 4. Apply discounts to components, tax-inclusively ─────────────────
    const grossOf = { food: r2(foodGross + foodTaxCharged), delivery: r2(deliveryGross + deliveryTaxCharged), platform: r2(platformGross + platformTaxCharged) };
    const claimed = { food: 0, delivery: 0, platform: 0 };
    for (const d of postTaxDiscounts) {
        const room = Math.max(0, grossOf[d.appliedTo] - claimed[d.appliedTo]);
        const applied = Math.min(d.amount, room);
        if (applied < d.amount - 0.01) {
            messages.push(`${d.label} of ₹${d.amount.toFixed(2)} exceeds the ${d.appliedTo} total it applies to; capped at ₹${applied.toFixed(2)}`);
        }
        claimed[d.appliedTo] = r2(claimed[d.appliedTo] + applied);
    }

    const build = (
        key: Component['key'], label: string, hsn: string, ratePercent: number,
        grossTaxable: number, taxCharged: number
    ): Component => {
        const reduction = splitInclusive(claimed[key], ratePercent);
        const taxableValue = r2(Math.max(0, grossTaxable - reduction.taxableValue));
        const totalTax = r2(Math.max(0, taxCharged - reduction.tax));
        const split: TaxSplit = splitTax(totalTax, interState);
        return {
            key, label, hsn, ratePercent,
            grossTaxableValue: r2(grossTaxable),
            discountOnTaxableValue: r2(reduction.taxableValue),
            taxableValue,
            cgst: split.cgst,
            sgst: split.sgst,
            igst: split.igst,
            totalTax: split.total,
            total: r2(taxableValue + split.total),
        };
    };

    const components: Component[] = [];
    if (foodGross > 0) components.push(build('food', 'Restaurant service (food)', HSN.FOOD, RATE.FOOD, foodGross, foodTaxCharged));
    if (deliveryGross > 0) components.push(build('delivery', 'Delivery charges', HSN.DELIVERY, RATE.DELIVERY, deliveryGross, deliveryTaxCharged));
    if (platformGross > 0) components.push(build('platform', 'Platform / convenience fee', HSN.PLATFORM, RATE.PLATFORM, platformGross, platformTaxCharged));

    const taxableValue = r2(components.reduce((s, c) => s + c.taxableValue, 0));
    const cgst = r2(components.reduce((s, c) => s + c.cgst, 0));
    const sgst = r2(components.reduce((s, c) => s + c.sgst, 0));
    const igst = r2(components.reduce((s, c) => s + c.igst, 0));
    const totalTax = r2(cgst + sgst + igst);
    const tip = r2(num(order.tip));

    // ── 5. Reconcile against what the customer actually paid ──────────────
    const orderTotal = r2(num(order.total));
    const beforeRounding = r2(taxableValue + totalTax + tip);
    const difference = r2(orderTotal - beforeRounding);

    // The app rounds COD totals to whole rupees, so a residual under ~₹1 is
    // expected and belongs on the Round Off line. Anything larger means the
    // order's own fields do not agree and must not be silently absorbed.
    const ROUNDING_TOLERANCE = 1.0;
    let roundOff = 0;
    let residual = 0;
    if (Math.abs(difference) <= ROUNDING_TOLERANCE) {
        roundOff = difference;
    } else {
        roundOff = 0;
        residual = difference;
        messages.push(
            `Components total ₹${beforeRounding.toFixed(2)} but the order was charged ₹${orderTotal.toFixed(2)} ` +
            `(₹${Math.abs(residual).toFixed(2)} unexplained)`
        );
    }

    const computedTotal = r2(beforeRounding + roundOff);
    const reconciliation: Reconciliation = {
        ok: residual === 0,
        orderTotal,
        computedTotal,
        roundOff,
        residual,
        messages,
    };

    // ── 6. Commission ─────────────────────────────────────────────────────
    const commission = computeCommission(order, foodGross, opts.commissionRatePercent);

    return {
        orderId,
        lines,
        components,
        discounts,
        totalDiscount: r2(discounts.reduce((s, d) => s + d.amount, 0)),
        tip,
        taxableValue,
        cgst, sgst, igst,
        totalTax,
        roundOff,
        invoiceValue: computedTotal,
        commission,
        reconciliation,
        isInterState: interState,
    };
}

/**
 * Commission actually charged to the restaurant for one order.
 *
 * The stored figure wins when present, because that is the amount the app
 * withheld from the vendor's payout — and a commission invoice that does not
 * equal what was withheld is a dispute waiting to be raised.
 */
export function computeCommission(
    order: any,
    fallbackItemTotal: number,
    ratePercentOverride?: number
): CommissionResult {
    const ratePercent = ratePercentOverride ?? PRICING.DEFAULT_COMMISSION_RATE;

    const baseAmount = COMMISSION_BASE === 'original'
        ? r2(num(order.originalItemTotal) || fallbackItemTotal)
        : r2(num(order.itemTotal, order.subtotal) || fallbackItemTotal);

    const storedAmount = num(order.vendorPlatformCut);
    const storedGst = num(order.vendorGstOnPlatformCut);

    if (storedAmount > 0) {
        const gst = storedGst > 0 ? r2(storedGst) : r2(storedAmount * PRICING.GST_ON_COMMISSION / 100);
        return {
            ratePercent,
            base: COMMISSION_BASE,
            baseAmount,
            amount: r2(storedAmount),
            gst,
            total: r2(storedAmount + gst),
            fromStoredValues: true,
        };
    }

    const amount = r2(baseAmount * ratePercent / 100);
    const gst = r2(amount * PRICING.GST_ON_COMMISSION / 100);
    return { ratePercent, base: COMMISSION_BASE, baseAmount, amount, gst, total: r2(amount + gst), fromStoredValues: false };
}

/** Is this order one a tax invoice may be issued for? */
export function isBillableStatus(status: unknown): boolean {
    const s = String(status || '').toLowerCase();
    return s === 'delivered' || s === 'completed';
}

export function isCancelledStatus(status: unknown): boolean {
    const s = String(status || '').toLowerCase();
    return s === 'cancelled' || s === 'canceled';
}
