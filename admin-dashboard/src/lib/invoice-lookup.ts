import { cachedCollection, collections, db } from './firebase-admin';
import { formatInvoiceNumber } from './invoice-constants';

/**
 * Map of orderId → invoice number, normalised for display/export.
 *
 * Invoice numbers are issued lazily (the first time an invoice is generated for
 * an order) and stored in the `invoices` collection keyed by order id.
 * Reports and CSV exports use this lookup so that every row can be traced back
 * to the document that was actually issued to the customer.
 */
export async function getInvoiceNumberMap(ttl?: number): Promise<Record<string, string>> {
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

/**
 * Invoice numbers for a known set of orders, fetched by document id.
 *
 * Use this instead of {@link getInvoiceNumberMap} whenever the order ids are
 * already in hand — a delta refresh, a single order's detail view, a small
 * export. It costs one read per order rather than one read per invoice ever
 * issued, which is the difference between a poll that stays flat as the
 * platform grows and one that gets steadily more expensive.
 */
export async function getInvoiceNumbersFor(orderIds: string[]): Promise<Record<string, string>> {
    if (orderIds.length === 0) return {};
    try {
        const refs = Array.from(new Set(orderIds)).map(id =>
            db.collection(collections.invoices).doc(id)
        );
        const snapshots = await db.getAll(refs);
        const map: Record<string, string> = {};
        for (const snapshot of snapshots) {
            if (!snapshot.exists) continue;
            const number = formatInvoiceNumber(snapshot.data()?.invoiceNumber as string | undefined);
            if (number) map[snapshot.id] = number;
        }
        return map;
    } catch (err) {
        console.warn('Invoice number lookup by id failed:', err);
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
