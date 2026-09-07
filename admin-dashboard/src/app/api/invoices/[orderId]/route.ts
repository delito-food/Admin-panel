/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /api/invoices/[orderId]
 *
 *   ?format=pdf     download the tax invoice (issues a serial if none exists)
 *   ?issue=true     allocate a serial without downloading
 *   (neither)       preview — reads only, never allocates
 *
 * ── One order, one tax invoice ───────────────────────────────────────────
 *
 * Under GST s.9(5) Delito is the supplier of record for restaurant service and
 * for delivery service supplied through the platform. So a single tax invoice
 * is issued per order under Delito's GSTIN, covering food (5%), delivery (18%)
 * and the platform fee (18%). The restaurant and the delivery partner are shown
 * for reference and neither receives a separately numbered document.
 *
 * The previous `?type=food|delivery|platform` split issued three documents
 * sharing one serial with -F/-D/-P suffixes, attributed to three different
 * suppliers, whose totals did not sum back to the order. It is gone; the
 * parameter is accepted and ignored so old links keep working.
 *
 * ── The document is frozen ───────────────────────────────────────────────
 *
 * Everything printed is computed once, at issue, and stored under
 * `invoices/{orderId}`. Re-rendering reads that record and nothing else, so an
 * invoice already in a customer's hands cannot change because a vendor edited
 * their GSTIN or a rounding rule was fixed.
 */

import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { db, collections } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { checkRateLimit, rateLimitedResponse, type AdminResult } from '@/lib/api-auth';
import { PLATFORM } from '@/lib/invoice-constants';
import { generateInvoicePDF } from '@/lib/invoice-pdf';
import { computeOrderEconomics, isBillableStatus, isCancelledStatus } from '@/lib/pricing-engine';
import {
    INVOICE_SCHEMA_VERSION,
    assertIssuable,
    buildTaxSummary,
    buildTotals,
    type Party,
    type StoredInvoice,
} from '@/lib/invoice-document';
import { storedInvoiceToRenderData } from '@/lib/invoice-render';
import { SERIES, counterDocId, formatSerial } from '@/lib/invoice-series';
import { financialYearOf, toDate } from '@/lib/fiscal';
import {
    HOME_STATE_CODE,
    isInterState as computeInterState,
    placeOfSupplyLabel,
    resolveStateCode,
    stateName,
} from '@/lib/gst';

const INVOICES = 'invoices';

/** Delito, as it appears in the supplier block of every customer invoice. */
function delitoParty(): Party {
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
 * Pure: reads the order and its related records, computes, returns.
 */
async function composeInvoice(orderId: string): Promise<{
    draft: Omit<StoredInvoice, 'invoiceNumber' | 'series' | 'sequence' | 'financialYear' | 'invoiceDate' | 'issuedAt' | 'issuedBy'>;
    issuable: { ok: true } | { ok: false; reason: string };
    /** Set when the order's status forbids issuing a NEW serial. */
    statusBlock: string | null;
    order: any;
}> {
    const orderSnap = await db.collection(collections.orders).doc(orderId).get();
    if (!orderSnap.exists) throw new Error('Order not found');
    const order = orderSnap.data()!;

    // Point reads, not a scan of every vendor and delivery person.
    const [vendorSnap, dpSnap] = await Promise.all([
        order.vendorId
            ? db.collection(collections.vendors).doc(order.vendorId as string).get()
            : Promise.resolve(null),
        order.deliveryPersonId
            ? db.collection(collections.deliveryPersons).doc(order.deliveryPersonId as string).get()
            : Promise.resolve(null),
    ]);
    const vendor: any = vendorSnap?.exists ? vendorSnap.data() : {};
    const deliveryPerson: any = dpSnap?.exists ? dpSnap.data() : {};

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

    return { draft, issuable, statusBlock, order };
}

/**
 * Read whatever has been recorded for this order.
 *
 * Two shapes exist. A Phase-2 record is the frozen document and renders
 * directly. A pre-Phase-2 record holds only a serial from the closed
 * INV-2026-nnnnnn series — that number is already spent and already in a
 * customer's hands, so it must be carried forward rather than replaced, and a
 * second serial must never be drawn for the same order.
 */
async function readInvoiceRecord(orderId: string): Promise<{ document: StoredInvoice | null; legacyNumber: string | null }> {
    const snap = await db.collection(INVOICES).doc(orderId).get();
    if (!snap.exists) return { document: null, legacyNumber: null };
    const data = snap.data() as any;
    if (!data?.invoiceNumber) return { document: null, legacyNumber: null };
    if (data.schemaVersion === INVOICE_SCHEMA_VERSION) {
        return { document: data as StoredInvoice, legacyNumber: null };
    }
    return { document: null, legacyNumber: String(data.invoiceNumber) };
}

/**
 * Issue the invoice: allocate the next serial in this financial year's series
 * and write the frozen document, in one transaction. If the write fails the
 * counter never moved, so the series cannot develop a hole.
 */
async function issueInvoice(
    orderId: string,
    draft: Awaited<ReturnType<typeof composeInvoice>>['draft'],
    issuedBy: string,
    legacyNumber: string | null
): Promise<StoredInvoice> {
    const invoiceRef = db.collection(INVOICES).doc(orderId);
    const now = new Date();
    const fy = financialYearOf(now);
    const counterRef = db.collection('counters').doc(counterDocId('invoice', fy.label));

    return db.runTransaction(async (tx) => {
        const existing = await tx.get(invoiceRef);
        const existingData = existing.exists ? (existing.data() as any) : null;
        if (existingData?.invoiceNumber && existingData.schemaVersion === INVOICE_SCHEMA_VERSION) {
            return existingData as StoredInvoice;
        }

        // A legacy serial is already allocated and already issued to the
        // customer. Upgrading the record to a stored document must reuse that
        // number and leave the counter alone — drawing a new one would put two
        // serials against a single supply.
        const legacy = legacyNumber ? parseInt(legacyNumber.replace(/\D/g, '').slice(-6), 10) || 0 : 0;
        let sequence = legacy;
        let invoiceNumber = legacyNumber || '';

        if (!legacyNumber) {
            const counterSnap = await tx.get(counterRef);
            let current: number;
            if (!counterSnap.exists) {
                current = 0;
            } else {
                const raw = counterSnap.data()?.lastNumber;
                if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                    throw new Error('Invoice counter is unreadable — refusing to allocate a number');
                }
                current = raw;
            }
            sequence = current + 1;
            invoiceNumber = formatSerial('invoice', fy.label, sequence);
        }

        const issuedAt = Timestamp.now();

        const document: StoredInvoice = {
            ...draft,
            invoiceNumber,
            series: legacyNumber ? 'LEGACY' : SERIES.invoice.prefix,
            sequence,
            financialYear: legacyNumber ? '' : fy.label,
            invoiceDate: issuedAt.toDate().toISOString(),
            issuedAt: issuedAt.toDate().toISOString(),
            issuedBy,
        };

        if (!legacyNumber) {
            tx.set(counterRef, {
                lastNumber: sequence,
                series: SERIES.invoice.prefix,
                financialYear: fy.label,
                updatedAt: issuedAt,
            }, { merge: true });
        }

        // The whole document, not just its number.
        tx.set(invoiceRef, { ...document, issuedAtTs: issuedAt }, { merge: true });

        return document;
    });
}

async function handleGET(
    request: Request,
    { params }: { params: Promise<{ orderId: string }> },
    auth: AdminResult
) {
    try {
        const rl = checkRateLimit(`invoices:${auth.uid}`, 30, 60_000);
        if (!rl.allowed) return rateLimitedResponse();

        const { orderId } = await params;
        if (!orderId) {
            return NextResponse.json({ success: false, error: 'Order ID is required' }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const format = searchParams.get('format');
        const issue = format === 'pdf' || searchParams.get('issue') === 'true';

        // Already issued? Serve the frozen document and touch nothing.
        const record = await readInvoiceRecord(orderId);
        let stored = record.document;

        if (!stored) {
            const { draft, issuable, statusBlock } = await composeInvoice(orderId);
            // A legacy serial is already spent, so status no longer gates it.
            const blocked = issuable.ok ? (record.legacyNumber ? null : statusBlock) : issuable.reason;

            if (!issue) {
                // Preview. No serial is consumed; the draft carries whatever
                // reason it could not be issued so the admin sees it before
                // clicking download.
                const preview = storedInvoiceToRenderData({
                    ...draft,
                    invoiceNumber: record.legacyNumber || '',
                    series: SERIES.invoice.prefix,
                    sequence: 0,
                    financialYear: financialYearOf(new Date()).label,
                    invoiceDate: new Date().toISOString(),
                    issuedAt: '',
                    issuedBy: '',
                } as StoredInvoice);

                return NextResponse.json({
                    success: true,
                    data: {
                        ...preview,
                        invoiceNumber: record.legacyNumber || '',
                        invoiceIssued: !!record.legacyNumber,
                        invoiceIssuedAt: null,
                    },
                    issuable: !blocked,
                    blockedReason: blocked,
                });
            }

            if (blocked) {
                return NextResponse.json({ success: false, error: blocked }, { status: 409 });
            }

            stored = await issueInvoice(orderId, draft, auth.email || auth.uid || 'unknown', record.legacyNumber);
        }

        const renderData = storedInvoiceToRenderData(stored);

        if (format === 'pdf') {
            const pdfBuffer = generateInvoicePDF(renderData);
            const safeNumber = stored.invoiceNumber.replace(/\//g, '-');
            return new Response(new Uint8Array(pdfBuffer), {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="Invoice-${safeNumber}.pdf"`,
                    'Content-Length': pdfBuffer.length.toString(),
                },
            });
        }

        return NextResponse.json({ success: true, data: renderData, issuable: true, blockedReason: null });
    } catch (error: any) {
        console.error('Invoice generation error:', error);
        const message = error?.message || 'Failed to generate invoice';
        const status = message === 'Order not found' ? 404 : 500;
        return NextResponse.json({ success: false, error: message }, { status });
    }
}


// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
