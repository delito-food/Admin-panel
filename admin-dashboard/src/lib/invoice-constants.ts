/**
 * Platform-level constants for invoice generation.
 * Inspired by Swiggy/Zomato invoice fields.
 */

export const PLATFORM = {
    name: 'Delito',
    legalName: 'Delito',
    tagline: 'Food Delivery Platform',
    address: 'Verma, Colony Gali No. 1, Hathras, Uttar Pradesh, India',
    gstin: '09CAMPV6339R1ZD',
    fssaiLicense: '22726884000160',
    pan: '',
    cin: '',
    email: 'Delitosupportt@gmail.com',
    phone: '',
    website: 'Delito.vercel.app',
};

// GST rates for food delivery (Restaurant Service)
export const GST_RATES = {
    CGST: 2.5,   // Central GST rate on restaurant food
    SGST: 2.5,   // State GST rate on restaurant food
    IGST: 5,     // Inter-state GST (CGST + SGST)
    GST_ON_DELIVERY: 18, // GST on delivery charges
    GST_ON_PLATFORM_FEE: 18, // GST on platform/convenience fee
};

// HSN Codes (like Swiggy/Zomato)
export const HSN_CODES = {
    FOOD: '9963',           // Restaurant & catering services
    DELIVERY: '996812',     // Courier & delivery services
    PLATFORM: '998599',     // Other support services (platform fee)
};

// Invoice number prefix.
// NOTE: numbers are now issued as INV-<year>-<counter> (no company prefix).
// Legacy numbers stored in Firestore may still carry the DELITO- prefix —
// use formatInvoiceNumber() to normalise them on output.
export const INVOICE_PREFIX = 'INV';
export const LEGACY_INVOICE_PREFIX = 'DELITO';

// ─── Commission Invoice Constants ───
export const COMMISSION_PLATFORM = {
    name: 'DELITO',
    tagline: 'Powered by Delito',
    gstin: '09CAMPV6339R1ZD',
    fssaiLicense: '22726884000160',
    address: 'Verma, Colony Gali No. 1,\nHathras, Uttar Pradesh,\nIndia',
    state: 'Uttar Pradesh',
    email: 'Delitosupportt@gmail.com',
    website: 'Delito.vercel.app',
};

export const COMMISSION_HSN_CODE = '998399';
export const COMMISSION_GST_RATE = 18; // 18% total (9% CGST + 9% SGST)

// ─── Commission invoice numbering ───
// Numbers are issued from a single monotonic counter (counters/commissionInvoices)
// and recorded in the `commissionInvoices` collection, keyed by vendorId_YYYY-MM.
// A number is allocated exactly once per vendor per billing month; previewing an
// invoice never consumes one.
export const COMMISSION_INVOICE_PREFIX = 'DLT-COM';
export const COMMISSION_INVOICES_COLLECTION = 'commissionInvoices';
export const COMMISSION_INVOICE_COUNTER_DOC = 'commissionInvoices';

/** Shown wherever an invoice number has not been allocated yet. */
export const COMMISSION_INVOICE_NOT_ISSUED = 'Not issued';

/** Stable document id for a vendor's invoice in a given billing month. */
export function commissionInvoiceDocId(vendorId: string, month: string): string {
    return `${vendorId}_${month}`;
}

/**
 * Build a commission invoice number.
 * Format: DLT-COM-YYMM-NNN (e.g. DLT-COM-2602-014)
 * `sequence` comes from the shared counter, so numbers are unique across the
 * whole platform and strictly increasing in the order they were issued.
 */
export function formatCommissionInvoiceNumber(
    year: number,
    monthNum: number,
    sequence: number
): string {
    const yy = String(year).slice(-2);
    const mm = String(monthNum).padStart(2, '0');
    return `${COMMISSION_INVOICE_PREFIX}-${yy}${mm}-${String(sequence).padStart(3, '0')}`;
}

/** Pull the numeric sequence back out of a commission invoice number. */
export function parseCommissionInvoiceSequence(invoiceNumber?: string | null): number {
    if (!invoiceNumber) return 0;
    const match = invoiceNumber.trim().match(/-(\d+)$/);
    if (!match) return 0;
    const n = parseInt(match[1], 10);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Commission Invoice data structure for vendor commission tax invoices.
 */
export interface CommissionInvoiceData {
    platform: typeof COMMISSION_PLATFORM;
    vendor: {
        name: string;
        gstin: string;
        fssaiLicense: string;
        address: string;
        state: string;
    };
    invoiceNumber: string;
    /** False when this is a preview and no number has been allocated yet. */
    invoiceIssued?: boolean;
    /** ISO timestamp of when the number was first allocated. */
    invoiceIssuedAt?: string | null;
    invoiceDate: string;
    hsnCode: string;
    placeOfSupply: string;
    serviceType: string;
    category: string;
    reverseCharges: boolean;
    billingPeriod: string;
    commissionRate: number;
    weeklyBreakdown: Array<{
        weekLabel: string;
        orders: number;
        grossSales: number;
        commission: number;
        gstOnCommission: number;
        totalDeduction: number;
        netPayout: number;
    }>;
    monthlyTotals: {
        orders: number;
        grossSales: number;
        commission: number;
        gstOnCommission: number;
        totalDeduction: number;
        netPayout: number;
    };
    gstBreakup: {
        igstRate: number;
        igstAmount: number;
        cgstRate: number;
        cgstAmount: number;
        sgstRate: number;
        sgstAmount: number;
        totalGst: number;
        totalCommissionPlusGst: number;
    };
}

/**
 * Generate invoice number from a sequential counter
 * Format: INV-2026-000001
 */
export function generateInvoiceNumber(counter: number): string {
    const year = new Date().getFullYear();
    const paddedCounter = String(counter).padStart(6, '0');
    return `${INVOICE_PREFIX}-${year}-${paddedCounter}`;
}

/**
 * Normalise an invoice number for display/export.
 * Strips the legacy company prefix so both old and new records render as
 * INV-2026-000042 (with an optional -F / -D / -P sub-invoice suffix).
 */
export function formatInvoiceNumber(invoiceNumber?: string | null): string {
    if (!invoiceNumber) return '';
    return invoiceNumber
        .trim()
        .replace(new RegExp(`^${LEGACY_INVOICE_PREFIX}[-_\\s]*`, 'i'), '');
}

/**
 * Invoice data structure matching Swiggy/Zomato format
 */
export interface InvoiceData {
    // Header
    invoiceNumber: string;
    invoiceDate: string;
    /** Every Delito invoice is issued as a Tax Invoice. */
    invoiceType: 'Tax Invoice';
    invoiceSubType?: 'food' | 'delivery' | 'platform';
    onBehalfOf?: string; // e.g. "on behalf of <vendor name>" or "on behalf of <delivery person>"

    // Order Details
    orderId: string;
    orderDate: string;
    orderTime: string;
    paymentMode: string;
    paymentStatus: string;
    transactionId?: string;

    // Customer Details
    customer: {
        name: string;
        phone: string;
        deliveryAddress: string;
    };

    // Vendor/Restaurant Details
    vendor: {
        name: string;
        address: string;
        city: string;
        gstin: string;
        fssaiLicense: string;
        phone: string;
    };

    // Item-wise breakdown with tax
    items: InvoiceItem[];

    // Bill Summary
    billSummary: {
        itemTotal: number;
        /** Menu/offer level discount already applied on the item lines */
        itemDiscount: number;
        discount: number;
        deliveryDiscount: number;
        hungerGameDiscount: number;
        deliveryFee: number;
        packagingFee: number;       // smallOrderSupportFee / platform fee
        tip: number;
        coinDiscount: number;
        promoDiscount: number;
        taxableAmount: number;
        cgst: number;
        sgst: number;
        totalTax: number;
        roundOff: number;
        /** Sum of every discount line shown on the invoice */
        totalDiscount: number;
        grandTotal: number;
    };

    // Tax Summary (for GST reporting)
    taxSummary: TaxSummaryRow[];

    // Platform Details
    platform: typeof PLATFORM;

    // Status
    orderStatus: string;
}

export interface InvoiceItem {
    slNo: number;
    name: string;
    hsnCode?: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxableValue: number;
    cgstRate: number;
    cgstAmount: number;
    sgstRate: number;
    sgstAmount: number;
    totalAmount: number;
}

export interface TaxSummaryRow {
    description: string;
    hsnCode?: string;
    taxableAmount: number;
    cgstRate: number;
    cgstAmount: number;
    sgstRate: number;
    sgstAmount: number;
    totalTax: number;
}





