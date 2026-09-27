/**
 * The customer tax invoice for an order, composed but not issued.
 *
 * Pure: takes the order, vendor and delivery-partner records already read and
 * returns the draft document. Lives here (not in the API route) so that
 * scripts/renumber-invoice-series.js builds exactly the same document the
 * dashboard does. Relative imports only, so it compiles outside Next.js.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { PLATFORM } from './invoice-constants';
import { computeOrderEconomics, isBillableStatus, isCancelledStatus } from './pricing-engine';
import {
    INVOICE_SCHEMA_VERSION,
    assertIssuable,
    buildTaxSummary,
    buildTotals,
    type Party,
    type StoredInvoice,
} from './invoice-document';
import { toDate } from './fiscal';
import {
    HOME_STATE_CODE,
    isInterState as computeInterState,
    placeOfSupplyLabel,
    resolveStateCode,
    stateName,
} from './gst';

export type InvoiceDraft = Omit<StoredInvoice, 'invoiceNumber' | 'series' | 'sequence' | 'financialYear' | 'invoiceDate' | 'issuedAt' | 'issuedBy'>;

export interface ComposedInvoice {
    draft: InvoiceDraft;
    issuable: { ok: true } | { ok: false; reason: string };
    /** Set when the order's status forbids issuing a NEW serial. */
    statusBlock: string | null;
}

/** Delito, as it appears in the supplier block of every customer invoice. */
export function delitoParty(): Party {
    return {
        name: PLATFORM.legalName || PLATFORM.name,
        address: PLATFORM.address,
        city: 'Hathras',
        state: stateName(HOME_STATE_CODE),
        stateCode: HOME_STATE_CODE,
        gstin: PLATFORM.gstin,
        fssai: PLATFORM.fssaiLicense,
        phone: PLATFORM.phone,
        email: PLATFORM.email,
    };
}

/**
 * Build the document that would be issued for this order, without issuing it.
 */
export function buildInvoiceDraft(orderId: string, order: any, vendor: any, deliveryPerson: any): ComposedInvoice {
    vendor = vendor || {};
    deliveryPerson = deliveryPerson || {};
    // Place of supply for a B2C food delivery is where the goods are delivered.
    // Delito operates within Uttar Pradesh, so this is intra-state unless the
    // customer's own record says otherwise.
    const recipientStateCode = resolveStateCode(
        order.customerGstin as string | undefined,
        (order.deliveryState || order.customerState || vendor.state) as string | undefined
    ) || HOME_STATE_CODE;
    const interState = computeInterState(HOME_STATE_CODE, recipientStateCode);

    const commissionRate = typeof vendor.commissionRate === 'number' ? vendor.commissionRate : undefined;
    const economics = computeOrderEconomics(order, orderId, { interState, commissionRatePercent: commissionRate });

    const orderInstant = toDate(order.deliveredAt) || toDate(order.createdAt) || new Date();

    const recipient: Party = {
        name: (order.customerName as string) || 'Customer',
        address: (order.deliveryAddress as string) || '',
        city: (order.deliveryCity as string) || '',
        state: stateName(recipientStateCode),
        stateCode: recipientStateCode,
        gstin: (order.customerGstin as string) || '',
        fssai: '',
        phone: (order.customerPhone as string) || '',
        email: (order.customerEmail as string) || '',
    };

    const draft = {
        schemaVersion: INVOICE_SCHEMA_VERSION,
        documentType: 'TAX_INVOICE' as const,

        orderId,
        orderReference: orderId.length > 12 ? orderId.slice(-12).toUpperCase() : orderId.toUpperCase(),
        orderDate: orderInstant.toISOString(),
        orderStatus: (order.status as string) || 'Unknown',
        vendorId: (order.vendorId as string) || '',
        customerId: (order.customerId as string) || '',

        supplier: delitoParty(),
        recipient,
        restaurant: {
            name: (order.vendorName || vendor.shopName || vendor.fullName || 'Restaurant') as string,
            address: (vendor.address || vendor.shopAddress || '') as string,
            city: (vendor.city || '') as string,
            gstin: (vendor.gstNumber || vendor.gstin || '') as string,
            fssai: (vendor.fssaiLicense || '') as string,
        },
        deliveryPartner: {
            name: (deliveryPerson.fullName || '') as string,
            phone: (deliveryPerson.phoneNumber || deliveryPerson.phone || '') as string,
        },
        supplierOfRecordNote:
            `Tax invoice issued by ${PLATFORM.name} as the electronic commerce operator liable to pay tax ` +
            `under section 9(5) of the CGST Act, 2017.`,

        placeOfSupply: placeOfSupplyLabel(recipientStateCode),
        placeOfSupplyCode: recipientStateCode,
        isInterState: interState,
        reverseCharge: false,

        lines: economics.lines,
        components: economics.components,
        discounts: economics.discounts,
        taxSummary: buildTaxSummary(economics.components),
        totals: buildTotals(economics),

        payment: {
            mode: (order.paymentMode as string) || 'Cash on Delivery',
            status: (order.paymentStatus as string) || 'Pending',
            transactionId: (order.transactionId || order.paymentId || '') as string,
        },

        reconciliation: economics.reconciliation,
    };

    // Two separate gates. The arithmetic one is absolute: a document whose
    // parts do not foot must never be produced. The status one only governs
    // issuing a NEW serial — an invoice already issued under the legacy series
    // still has to be reprintable even if the order was later cancelled, since
    // the customer is holding it.
    const issuable = assertIssuable(economics);

    let statusBlock: string | null = null;
    if (isCancelledStatus(order.status)) {
        statusBlock = 'Order is cancelled — a tax invoice cannot be issued. Raise a credit note against the original invoice instead.';
    } else if (!isBillableStatus(order.status)) {
        statusBlock = `Order is "${order.status}" — an invoice is issued once the order is delivered.`;
    }

    return { draft, issuable, statusBlock };
}
