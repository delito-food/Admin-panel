import { cachedCollection, collections } from './firebase-admin';
import { formatInvoiceNumber } from './invoice-constants';

/**
 * Map of orderId → invoice number, normalised for display/export.
 *
 * Invoice numbers are issued lazily (the first time an invoice is generated for
 * an order) and stored in the `invoices` collection keyed by order id.
 * Reports and CSV exports use this lookup so that every row can be traced back
 * to the document that was actually issued to the customer.
 */
export async function getInvoiceNumberMap(ttl = 60_000): Promise<Record<string, string>> {
    try {
        const docs = await cachedCollection(collections.invoices, ttl);
        const map: Record<string, string> = {};
        for (const doc of docs) {
            const number = formatInvoiceNumber(doc.invoiceNumber as string | undefined);
            if (!number) continue;
            // doc id is the order id; orderId field kept as a fallback
            map[doc.id] = number;
            if (doc.orderId && typeof doc.orderId === 'string') {
                map[doc.orderId] = number;
            }
        }
        return map;
    } catch (err) {
        console.warn('Invoice number lookup failed:', err);
        return {};
    }
}

/** Label used in exports when no invoice has been issued yet. */
export const NO_INVOICE_LABEL = 'Not issued';

export function invoiceNumberFor(
    map: Record<string, string>,
    orderId: string,
    suffix?: 'F' | 'D' | 'P'
): string {
    const base = map[orderId];
    if (!base) return NO_INVOICE_LABEL;
    return suffix ? `${base}-${suffix}` : base;
}
