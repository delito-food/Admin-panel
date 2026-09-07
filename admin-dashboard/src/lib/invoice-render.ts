/**
 * Adapter: frozen StoredInvoice → the InvoiceData shape the PDF renderer takes.
 *
 * The PDF is a pure function of the stored document. Nothing here reads
 * Firestore, so a re-download in September of a bill issued in March produces
 * the March document, byte for byte.
 *
 * ── How the bill summary is made to add up ───────────────────────────────
 *
 * Promo codes, coins and HungerGame rewards are applied by the app after GST,
 * so the rupees the customer saved are tax-inclusive. Since those discounts
 * reduce the taxable value, the summary shows each one at its taxable-value
 * portion — otherwise the tax shown (which is already net) would subtract the
 * tax on the discount a second time and the column would not foot. The full
 * inclusive saving is reported separately as `totalDiscount`, which is the
 * figure the customer recognises from checkout.
 */

import type { StoredInvoice } from './invoice-document';
import type { InvoiceData, InvoiceItem, TaxSummaryRow } from './invoice-constants';
import { PLATFORM } from './invoice-constants';
import { formatIstDate, formatIstTime } from './fiscal';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The taxable-value portion of a tax-inclusive discount. */
function taxablePortion(inclusiveAmount: number, ratePercent: number): number {
    return r2(inclusiveAmount / (1 + ratePercent / 100));
}

export function storedInvoiceToRenderData(stored: StoredInvoice): InvoiceData {
    const food = stored.components.find(c => c.key === 'food');
    const delivery = stored.components.find(c => c.key === 'delivery');
    const platform = stored.components.find(c => c.key === 'platform');

    const items: InvoiceItem[] = stored.lines.map(line => ({
        slNo: line.slNo,
        name: line.name,
        hsnCode: line.hsn,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.lineDiscount,
        taxableValue: line.taxableValue,
        cgstRate: line.igst > 0 ? 0 : line.ratePercent / 2,
        cgstAmount: line.cgst,
        sgstRate: line.igst > 0 ? 0 : line.ratePercent / 2,
        sgstAmount: line.sgst,
        totalAmount: line.total,
    }));

    const taxSummary: TaxSummaryRow[] = stored.taxSummary.map(row => ({
        description: row.description,
        hsnCode: row.hsn,
        taxableAmount: row.taxableValue,
        cgstRate: row.cgstRate,
        cgstAmount: row.cgst,
        sgstRate: row.sgstRate,
        sgstAmount: row.sgst,
        igstRate: row.igstRate,
        igstAmount: row.igst,
        totalTax: row.totalTax,
    }));

    // Discounts, at the taxable-value portion that the arithmetic uses.
    const sumOf = (key: string, rate: number) => r2(
        stored.discounts
            .filter(d => d.key === key)
            .reduce((s, d) => s + taxablePortion(d.amount, rate), 0)
    );
    const foodRate = food?.ratePercent ?? 5;
    const deliveryRate = delivery?.ratePercent ?? 18;

    const itemDiscount = r2(stored.discounts.filter(d => d.key === 'item').reduce((s, d) => s + d.amount, 0));

    const invoiceDate = new Date(stored.invoiceDate);
    const orderDate = new Date(stored.orderDate);

    return {
        invoiceNumber: stored.invoiceNumber,
        invoiceIssued: true,
        invoiceIssuedAt: stored.issuedAt,
        invoiceDate: formatIstDate(isNaN(invoiceDate.getTime()) ? new Date() : invoiceDate),
        invoiceType: 'Tax Invoice',
        invoiceSubType: 'food',
        onBehalfOf: stored.supplierOfRecordNote,

        orderId: stored.orderReference,
        orderDate: formatIstDate(isNaN(orderDate.getTime()) ? new Date() : orderDate),
        orderTime: formatIstTime(isNaN(orderDate.getTime()) ? new Date() : orderDate),
        paymentMode: stored.payment.mode,
        paymentStatus: stored.payment.status,
        transactionId: stored.payment.transactionId || undefined,

        customer: {
            name: stored.recipient.name,
            phone: stored.recipient.phone,
            deliveryAddress: stored.recipient.address,
        },

        // The panel beside the customer shows the restaurant that prepared the
        // order. It is labelled as a reference, not as the supplier — Delito is
        // the supplier of record and its GSTIN heads the document.
        vendor: {
            name: stored.restaurant.name,
            address: stored.restaurant.address,
            city: stored.restaurant.city,
            gstin: stored.restaurant.gstin,
            fssaiLicense: stored.restaurant.fssai,
            phone: stored.deliveryPartner.phone,
        },

        items,

        billSummary: {
            itemTotal: food?.grossTaxableValue ?? 0,
            itemDiscount,
            discount: 0,
            deliveryDiscount: sumOf('hungerGameDelivery', deliveryRate),
            hungerGameDiscount: sumOf('hungerGameFood', foodRate),
            deliveryFee: delivery?.grossTaxableValue ?? 0,
            packagingFee: platform?.grossTaxableValue ?? 0,
            tip: stored.totals.tip,
            coinDiscount: sumOf('coin', foodRate),
            promoDiscount: sumOf('promo', foodRate),
            taxableAmount: stored.totals.taxableValue,
            cgst: stored.totals.cgst,
            sgst: stored.totals.sgst,
            igst: stored.totals.igst,
            totalTax: stored.totals.totalTax,
            roundOff: stored.totals.roundOff,
            /** The full saving as the customer knows it, inclusive of tax. */
            totalDiscount: stored.totals.totalDiscount,
            grandTotal: stored.totals.invoiceValue,
        },

        taxSummary,
        platform: PLATFORM,
        orderStatus: stored.orderStatus,
    };
}
