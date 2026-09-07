/**
 * The frozen tax invoice document.
 *
 * A tax invoice is a record of what was issued, not a view over live data.
 * Everything the PDF prints is stored here at issue time and read back
 * unchanged forever after: change a restaurant's GSTIN, fix a rounding bug, let
 * an order's status move, and an invoice already in a customer's hands does not
 * shift under them.
 *
 * SUPPLIER OF RECORD. Under GST s.9(5) Delito is the supplier for restaurant
 * service and for delivery service supplied through the platform, so ONE tax
 * invoice per order is issued under Delito's own GSTIN, covering food (5%),
 * delivery (18%) and the platform fee (18%). The restaurant and the delivery
 * partner appear for reference; neither is the supplier on this document, and
 * neither gets a separately numbered invoice.
 */

import type { Component, DiscountLine, InvoiceLine, OrderEconomics, Reconciliation } from './pricing-engine';

export const INVOICE_SCHEMA_VERSION = 2;

export interface Party {
    name: string;
    address: string;
    city: string;
    state: string;
    stateCode: string;
    gstin: string;
    fssai: string;
    phone: string;
    email: string;
}

export interface TaxSummaryRowV2 {
    description: string;
    hsn: string;
    ratePercent: number;
    taxableValue: number;
    cgstRate: number;
    cgst: number;
    sgstRate: number;
    sgst: number;
    igstRate: number;
    igst: number;
    totalTax: number;
}

export interface StoredInvoice {
    schemaVersion: number;

    // ── Identity ──
    invoiceNumber: string;
    series: string;
    sequence: number;
    financialYear: string;
    documentType: 'TAX_INVOICE' | 'CREDIT_NOTE';
    /** ISO. The date the serial was allocated — never the date of a re-render. */
    invoiceDate: string;
    issuedAt: string;
    issuedBy: string;

    // ── Source ──
    orderId: string;
    orderReference: string;
    orderDate: string;
    orderStatus: string;
    vendorId: string;
    customerId: string;

    // ── Parties ──
    supplier: Party;
    recipient: Party;
    /** The restaurant that prepared the order. Reference only — see s.9(5). */
    restaurant: { name: string; address: string; city: string; gstin: string; fssai: string };
    /** The delivery partner. Reference only. */
    deliveryPartner: { name: string; phone: string };
    supplierOfRecordNote: string;

    // ── Place of supply ──
    placeOfSupply: string;
    placeOfSupplyCode: string;
    isInterState: boolean;
    reverseCharge: boolean;

    // ── Values ──
    lines: InvoiceLine[];
    components: Component[];
    discounts: DiscountLine[];
    taxSummary: TaxSummaryRowV2[];
    totals: {
        grossTaxableValue: number;
        totalDiscount: number;
        taxableValue: number;
        cgst: number;
        sgst: number;
        igst: number;
        totalTax: number;
        tip: number;
        roundOff: number;
        invoiceValue: number;
    };

    payment: { mode: string; status: string; transactionId: string };

    /** Proof, kept with the document, that its parts summed to what was paid. */
    reconciliation: Reconciliation;
}

/** Build the rate-wise tax summary GSTR-1 Table 12 is filed from. */
export function buildTaxSummary(components: Component[]): TaxSummaryRowV2[] {
    return components.map((c) => ({
        description: c.label,
        hsn: c.hsn,
        ratePercent: c.ratePercent,
        taxableValue: c.taxableValue,
        cgstRate: c.igst > 0 ? 0 : c.ratePercent / 2,
        cgst: c.cgst,
        sgstRate: c.igst > 0 ? 0 : c.ratePercent / 2,
        sgst: c.sgst,
        igstRate: c.igst > 0 ? c.ratePercent : 0,
        igst: c.igst,
        totalTax: c.totalTax,
    }));
}

export function buildTotals(economics: OrderEconomics): StoredInvoice['totals'] {
    const grossTaxableValue = Math.round(
        economics.components.reduce((s, c) => s + c.grossTaxableValue, 0) * 100
    ) / 100;
    return {
        grossTaxableValue,
        totalDiscount: economics.totalDiscount,
        taxableValue: economics.taxableValue,
        cgst: economics.cgst,
        sgst: economics.sgst,
        igst: economics.igst,
        totalTax: economics.totalTax,
        tip: economics.tip,
        roundOff: economics.roundOff,
        invoiceValue: economics.invoiceValue,
    };
}

/**
 * Refuse to issue a document whose own parts do not add up.
 *
 * This is the gate that stops a bill going out with a summary that does not
 * reconcile to the amount charged — the defect that made every COD invoice
 * miss by up to fifty paise with a Round Off line permanently printing zero.
 */
export function assertIssuable(economics: OrderEconomics): { ok: true } | { ok: false; reason: string } {
    if (!economics.reconciliation.ok) {
        return { ok: false, reason: economics.reconciliation.messages.join('; ') || 'Order values do not reconcile' };
    }

    const sum = Math.round((economics.taxableValue + economics.totalTax + economics.tip + economics.roundOff) * 100) / 100;
    if (Math.abs(sum - economics.invoiceValue) > 0.01) {
        return { ok: false, reason: `Invoice components sum to ₹${sum.toFixed(2)}, not ₹${economics.invoiceValue.toFixed(2)}` };
    }

    const headSum = Math.round((economics.cgst + economics.sgst + economics.igst) * 100) / 100;
    if (Math.abs(headSum - economics.totalTax) > 0.01) {
        return { ok: false, reason: `Tax heads sum to ₹${headSum.toFixed(2)}, not ₹${economics.totalTax.toFixed(2)}` };
    }

    if (economics.isInterState && (economics.cgst > 0 || economics.sgst > 0)) {
        return { ok: false, reason: 'Inter-state supply carrying CGST/SGST' };
    }
    if (!economics.isInterState && economics.igst > 0) {
        return { ok: false, reason: 'Intra-state supply carrying IGST' };
    }

    if (economics.invoiceValue <= 0) {
        return { ok: false, reason: 'Invoice value is zero — nothing to invoice' };
    }

    return { ok: true };
}
