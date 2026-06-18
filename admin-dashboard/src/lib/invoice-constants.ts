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

// Invoice number prefix
export const INVOICE_PREFIX = 'DELITO';

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
 * Format: DELITO-INV-2026-000001
 */
export function generateInvoiceNumber(counter: number): string {
    const year = new Date().getFullYear();
    const paddedCounter = String(counter).padStart(6, '0');
    return `${INVOICE_PREFIX}-INV-${year}-${paddedCounter}`;
}

/**
 * Invoice data structure matching Swiggy/Zomato format
 */
export interface InvoiceData {
    // Header
    invoiceNumber: string;
    invoiceDate: string;
    invoiceType: 'Tax Invoice' | 'Bill of Supply';
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
        discount: number;
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





