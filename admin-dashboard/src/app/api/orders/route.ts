/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth, unauthorizedResponse, checkRateLimit, rateLimitedResponse } from '@/lib/api-auth';
import { getInvoiceNumberMap, getInvoiceNumbersFor, invoiceNumberFor } from '@/lib/invoice-lookup';
import { reportResponse, platformMeta } from '@/lib/report-export';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';
import { withAdmin } from '@/lib/api-guard';
import { computeOrderEconomics } from '@/lib/pricing-engine';

async function handleGET(request: Request) {
    try {
        // Auth check
        const authResult = await verifyApiAuth(request);
        if (!authResult.authenticated) {
            return unauthorizedResponse(authResult.error);
        }

        // Rate limit
        const rl = checkRateLimit(`orders:${authResult.uid}`, 60, 60_000);
        if (!rl.allowed) return rateLimitedResponse();

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        // ── Delta refresh ──
        //
        // `?since=<ISO timestamp>` returns only orders created at or after that
        // moment. The Orders page uses it to keep itself current without
        // re-downloading the whole register every 90 seconds: it loads the full
        // list once, then asks for the last day's worth and merges the result.
        //
        // Everything downstream of this is then sized to that slice too —
        // invoice numbers and delivery tasks are fetched by id rather than by
        // scanning their collections — so a refresh costs a few dozen reads
        // instead of several thousand, and stays flat as the platform grows.
        //
        // A status filter is ignored in delta mode: combining an equality
        // filter with a range on a different field needs a composite index that
        // does not exist in this project, and the caller is merging into a list
        // it already filters client-side anyway.
        const sinceParam = searchParams.get('since');
        const sinceDate = sinceParam ? new Date(sinceParam) : null;
        const since = sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate : null;

        // ── Limit ──
        // `limit=all` (or 0) returns the complete order register — the Orders
        // page paginates client-side and needs every row to be present so that
        // search, status filters and the page counts cover the whole history.
        // Anything else is clamped to MAX_LIMIT as a safety valve.
        const MAX_LIMIT = 20_000;
        const rawLimit = (searchParams.get('limit') || '').trim().toLowerCase();
        const parsedLimit = parseInt(rawLimit, 10);
        const unlimited = rawLimit === 'all' || parsedLimit === 0;
        const limit = unlimited
            ? MAX_LIMIT
            : Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : MAX_LIMIT, MAX_LIMIT);

        const ordersCollection = () => db.collection(collections.orders);

        let query: FirebaseFirestore.Query;
        if (since) {
            query = ordersCollection()
                .where('createdAt', '>=', Timestamp.fromDate(since))
                .orderBy('createdAt', 'desc')
                .limit(limit);
        } else if (status && status !== 'all') {
            query = ordersCollection()
                .where('status', '==', status)
                .orderBy('createdAt', 'desc')
                .limit(limit);
        } else {
            query = ordersCollection()
                .orderBy('createdAt', 'desc')
                .limit(limit);
        }

        const snapshot = await query.get();
        const orderIds = snapshot.docs.map(doc => doc.id);

        // Invoice numbers issued for these orders (used in the UI and CSV export).
        // In delta mode we know exactly which orders we are reporting on, so we
        // fetch those invoice documents by id instead of downloading every
        // invoice ever issued.
        const invoiceNumbers = since
            ? await getInvoiceNumbersFor(orderIds)
            : await getInvoiceNumberMap();

        // ── Who is involved in this batch of orders ──
        //
        // One pass over the result collects everything the joins below need.
        // Note: collect deliveryPersonId regardless of whether a name is stored,
        // so we can always get the phone number too; collect the name-only
        // orders separately, since those can only be resolved by reverse lookup.
        const deliveryPersonIds = new Set<string>();
        const vendorIds = new Set<string>();
        const nameOnlySet = new Set<string>();

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.deliveryPersonId) deliveryPersonIds.add(data.deliveryPersonId);
            if (data.vendorId) vendorIds.add(data.vendorId);
            if (!data.deliveryPersonId && data.deliveryPersonName) {
                nameOnlySet.add(data.deliveryPersonName as string);
            }
        });

        const round2 = (n: number): number => Math.round(n * 100) / 100;

        // Helper to parse any Firestore timestamp to ISO string or null
        const tsToIso = (v: any): string | null => {
            if (!v) return null;
            if (v?.toDate) return v.toDate().toISOString();
            if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString();
        };

        // ── Cross-reference deliveryTasks ──
        //
        // A full refresh scans the (cached) collection, because it needs the
        // task for every order ever placed. A delta refresh knows its handful
        // of order ids, so it queries for exactly those tasks — chunked into
        // `in` filters of 30, which is Firestore's limit for that operator.
        const allOrderIdSet = new Set(orderIds);
        const tasksByOrderId: Record<string, { deliveryPersonId: string; deliveryPersonName: string; deliveryPersonPhone: string; dispatchedAt: any; pickedUpAt: any; deliveredAt: any; taskStatus: string }> = {};

        let allTasks: Array<{ id: string; [key: string]: any }>;
        if (since) {
            const IN_CHUNK = 30;
            const chunks: string[][] = [];
            for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
                chunks.push(orderIds.slice(i, i + IN_CHUNK));
            }
            const results = await Promise.all(
                chunks.map(chunk =>
                    db.collection(collections.deliveryTasks).where('orderId', 'in', chunk).get()
                )
            );
            allTasks = results.flatMap(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } else {
            allTasks = await cachedCollection(collections.deliveryTasks);
        }

        allTasks.forEach(taskData => {
            const orderId = taskData.orderId as string;
            if (!orderId || !allOrderIdSet.has(orderId)) return;

            const taskStatus = ((taskData.status || '') as string).toUpperCase();
            const isActiveTask = taskData.deliveryPersonId && (
                taskStatus === 'ACCEPTED' || taskStatus === 'PICKED_UP' ||
                taskStatus === 'DELIVERED' || taskStatus === 'COMPLETED' ||
                taskStatus === 'EN_ROUTE_TO_PICKUP' || taskStatus === 'ARRIVED_AT_PICKUP' ||
                taskStatus === 'EN_ROUTE_TO_CUSTOMER' || taskStatus === 'ARRIVED_AT_CUSTOMER' ||
                taskStatus === 'ASSIGNED'
            );
            if (isActiveTask) {
                tasksByOrderId[orderId] = {
                    deliveryPersonId: taskData.deliveryPersonId as string,
                    deliveryPersonName: (taskData.deliveryPersonName || '') as string,
                    deliveryPersonPhone: (taskData.deliveryPersonPhone || '') as string,
                    dispatchedAt: taskData.acceptedAt || taskData.assignedAt || taskData.createdAt || null,
                    pickedUpAt: taskData.pickedUpAt || null,
                    deliveredAt: taskData.deliveredAt || taskData.completedAt || null,
                    taskStatus: taskStatus,
                };
                deliveryPersonIds.add(taskData.deliveryPersonId as string);
            }
        });

        // ── Delivery partners and vendors, read once ──
        //
        // This used to read the deliveryPersons collection three separate times
        // — once for ids found on orders, once for the name-only reverse
        // lookup, once more for ids discovered via delivery tasks. The cache
        // absorbed two of those, but only when it happened to be warm; on a
        // cold serverless instance it was three full scans of the same data.
        // Both maps are now built in a single pass, after the task
        // cross-reference has contributed every id it knows about.
        const deliveryPersonDetails: Record<string, { name: string; phone: string; vehicleType: string; vehicleNumber: string; rating: number }> = {};
        const detailsByName: Record<string, { phone: string; vehicleType: string; vehicleNumber: string; rating: number }> = {};

        if (deliveryPersonIds.size > 0 || nameOnlySet.size > 0) {
            const allDp = await cachedCollection(collections.deliveryPersons);
            allDp.forEach(dpData => {
                const name = (dpData.fullName || dpData.name || '') as string;

                if (deliveryPersonIds.has(dpData.id)) {
                    deliveryPersonDetails[dpData.id] = {
                        name,
                        phone: (dpData.phoneNumber || dpData.phone || '') as string,
                        vehicleType: (dpData.vehicleType || '') as string,
                        vehicleNumber: (dpData.vehicleNumber || '') as string,
                        rating: (dpData.rating || 0) as number,
                    };
                }

                // Orders that store only a partner's name still need the
                // vehicle details, which live on the partner document.
                if (name && nameOnlySet.has(name)) {
                    detailsByName[name] = {
                        phone: (dpData.phoneNumber || dpData.phone || '') as string,
                        vehicleType: (dpData.vehicleType || '') as string,
                        vehicleNumber: (dpData.vehicleNumber || '') as string,
                        rating: (dpData.rating || 0) as number,
                    };
                }
            });
        }

        const vendorDetails: Record<string, { phone: string; address: string; city: string; shopName: string }> = {};
        if (vendorIds.size > 0) {
            const allVendors = await cachedCollection(collections.vendors);
            allVendors.forEach(vData => {
                if (vendorIds.has(vData.id)) {
                    vendorDetails[vData.id] = {
                        phone: (vData.phoneNumber || vData.phone || '') as string,
                        address: (vData.address || vData.shopAddress || '') as string,
                        city: (vData.city || '') as string,
                        shopName: (vData.shopName || vData.fullName || '') as string,
                    };
                }
            });
        }

        const orders = snapshot.docs.map(doc => {

            const data = doc.data();
            let deliveryPersonId = data.deliveryPersonId || null;

            // Cross-reference deliveryTasks for all orders — get delivery partner and timestamps
            const taskInfo = tasksByOrderId[doc.id];
            if (!deliveryPersonId && taskInfo) {
                deliveryPersonId = taskInfo.deliveryPersonId;
            }

            // Always prefer fetched data; fall back to what's stored in order doc
            // For orders without deliveryPersonId, try name-based reverse lookup
            const fetched = deliveryPersonId ? deliveryPersonDetails[deliveryPersonId] : null;
            const storedName = data.deliveryPersonName || taskInfo?.deliveryPersonName || '';
            const nameMatch = (!fetched && storedName) ? detailsByName[storedName] : null;

            const deliveryPersonName = fetched?.name || storedName || taskInfo?.deliveryPersonName || '';
            const deliveryPersonPhone = fetched?.phone || nameMatch?.phone || data.deliveryPersonPhone || taskInfo?.deliveryPersonPhone || '';
            const deliveryPersonVehicleType = fetched?.vehicleType || nameMatch?.vehicleType || '';
            const deliveryPersonVehicleNumber = fetched?.vehicleNumber || nameMatch?.vehicleNumber || '';
            const deliveryPersonRating = fetched?.rating || nameMatch?.rating || 0;

            const vendorId = data.vendorId || '';
            const vendor = vendorDetails[vendorId];

            // Compute dispatched timestamp: order doc fields → delivery task accepted time
            const dispatchedAt = tsToIso(data.dispatchedAt)
                || tsToIso(data.sentForDeliveryAt)
                || tsToIso(data.outForDeliveryAt)
                || tsToIso(taskInfo?.dispatchedAt)
                || null;

            // Compute pickedUpAt: order doc field → delivery task picked up time
            const pickedUpAt = tsToIso(data.pickedUpAt) || tsToIso(taskInfo?.pickedUpAt) || null;

            // ── Discounts ──
            //
            // Taken from the shared pricing engine so this list, the invoice and
            // the GST report all describe the same order the same way. The old
            // code re-derived them here with Math.max() over two disagreeing
            // sources, which is how the same order could show one discount on
            // this screen and another on its bill.
            const economics = computeOrderEconomics(data, doc.id);
            const discountOf = (key: string) => economics.discounts
                .filter(d => d.key === key)
                .reduce((sum, d) => sum + d.amount, 0);

            const originalItemTotal = data.originalItemTotal || 0;
            const itemDiscount = discountOf('item');
            const hungerGameDiscount = discountOf('hungerGameFood');
            const deliveryDiscount = discountOf('hungerGameDelivery');
            const totalDiscount = economics.totalDiscount;

            return {
                orderId: doc.id,
                invoiceNumber: invoiceNumberFor(invoiceNumbers, doc.id),
                vendorId,
                vendorName: data.vendorName || vendor?.shopName || '',
                vendorPhone: vendor?.phone || '',
                vendorAddress: vendor?.address || '',
                vendorCity: vendor?.city || '',
                customerId: data.customerId || '',
                customerName: data.customerName || '',
                customerPhone: data.customerPhone || '',
                items: data.items || [],
                itemNames: data.itemNames || [],
                itemTotal: data.itemTotal || data.subtotal || 0,
                originalItemTotal: originalItemTotal || (data.itemTotal || data.subtotal || 0),
                subtotal: data.subtotal || data.itemTotal || 0,
                discount: data.discount || 0,
                itemDiscount: round2(itemDiscount),
                deliveryDiscount: round2(deliveryDiscount),
                hungerGameDiscount: round2(hungerGameDiscount),
                totalDiscount: round2(totalDiscount),
                deliveryFee: data.deliveryFee || 0,
                taxes: data.taxes || 0,
                tip: data.tip || 0,
                smallOrderSupportFee: data.smallOrderSupportFee || 0,
                total: data.total || 0,
                status: data.status || 'Pending',
                paymentMode: data.paymentMode || 'Cash on Delivery',
                paymentStatus: data.paymentStatus || 'Pending',
                deliveryAddress: data.deliveryAddress || '',
                distanceKm: data.distanceKm || 0,
                deliveryPersonId,
                deliveryPersonName,
                deliveryPersonPhone,
                deliveryPersonVehicleType,
                deliveryPersonVehicleNumber,
                deliveryPersonRating,
                pickupPin: data.pickupPin || '',
                deliveryPin: data.deliveryPin || '',
                pickupPinVerified: data.pickupPinVerified ?? false,
                deliveryPinVerified: data.deliveryPinVerified ?? false,
                // Timeline timestamps — cover all possible field names used by the app
                createdAt: tsToIso(data.createdAt) || new Date().toISOString(),
                acceptedAt: tsToIso(data.acceptedAt) || tsToIso(data.confirmedAt) || null,
                preparingAt: tsToIso(data.preparingAt) || tsToIso(data.preparationStartedAt) || null,
                preparedAt: tsToIso(data.preparedAt) || null,
                dispatchedAt,
                pickedUpAt,
                pickupPinVerifiedAt: tsToIso(data.pickupPinVerifiedAt),
                deliveryPinVerifiedAt: tsToIso(data.deliveryPinVerifiedAt),
                deliveredAt: tsToIso(data.deliveredAt) || tsToIso(data.completedAt) || tsToIso(taskInfo?.deliveredAt) || (data.status === 'Delivered' ? tsToIso(data.updatedAt) : null),
                estimatedDeliveryTime: data.estimatedDeliveryTime || 30,
                // Delivery instruction from customer
                deliveryInstruction: data.deliveryInstruction || data.deliveryInstructions || '',
                // Refund info
                refundStatus: data.refundStatus || '',
                refundAmount: data.refundAmount || 0,
                // COD settlement
                codSettled: data.codSettled ?? false,
                // Delivery task status (from deliveryTasks collection)
                deliveryTaskStatus: taskInfo?.taskStatus || '',
                // Coin & promo discount info
                coinsUsed: data.coinsUsed || 0,
                coinDiscount: data.coinDiscount || 0,
                promoCode: data.promoCode || '',
                promoDiscount: data.promoDiscount || 0,
                // Vendor commission (stored on order at time of placement)
                vendorPlatformCut: data.vendorPlatformCut || 0,
                vendorGstOnPlatformCut: data.vendorGstOnPlatformCut || 0,
                vendorTotalDeduction: data.vendorTotalDeduction || 0,
                vendorEarning: data.vendorEarning || 0,
            };
        });

        // ── File export (styled .xlsx by default, CSV on request) ──
        const format = searchParams.get('format');
        if (format === 'csv' || format === 'xlsx') {
            const spec: XlsxSheetSpec = {
                sheetName: 'Orders',
                title: 'Order Register',
                subtitle: 'All orders with their invoice numbers, discounts and tax',
                meta: platformMeta([
                    { label: 'Status filter', value: status && status !== 'all' ? status : 'All statuses' },
                    { label: 'Orders exported', value: String(orders.length) },
                ]),
                columns: [
                    { header: 'Invoice No.', key: 'invoiceNumber', width: 20 },
                    { header: 'Order ID', key: 'orderId', width: 24 },
                    { header: 'Date', key: 'dateLabel', width: 14 },
                    { header: 'Time', key: 'timeLabel', width: 11 },
                    { header: 'Customer', key: 'customerName', width: 22 },
                    { header: 'Phone', key: 'customerPhone', width: 14 },
                    { header: 'Restaurant', key: 'vendorName', width: 24 },
                    { header: 'Status', key: 'status', width: 13 },
                    { header: 'Payment Mode', key: 'paymentMode', width: 14 },
                    { header: 'Payment Status', key: 'paymentStatus', width: 14 },
                    { header: 'Items', key: 'itemList', width: 40 },
                    { header: 'Gross Item Total', key: 'grossItemTotal', width: 16, type: 'currency' },
                    { header: 'Item Discount', key: 'itemDiscount', width: 14, type: 'currency' },
                    { header: 'Item Total', key: 'itemTotal', width: 14, type: 'currency' },
                    { header: 'Promo Discount', key: 'promoDiscount', width: 15, type: 'currency' },
                    { header: 'Coin Discount', key: 'coinDiscount', width: 14, type: 'currency' },
                    { header: 'HungerGame Discount', key: 'hungerGameDiscount', width: 18, type: 'currency' },
                    { header: 'Delivery Discount', key: 'deliveryDiscount', width: 16, type: 'currency' },
                    { header: 'Total Discount', key: 'totalDiscount', width: 15, type: 'currency' },
                    { header: 'Delivery Fee', key: 'deliveryFee', width: 14, type: 'currency' },
                    { header: 'Platform Fee', key: 'smallOrderSupportFee', width: 14, type: 'currency' },
                    { header: 'Taxes (GST)', key: 'taxes', width: 14, type: 'currency' },
                    { header: 'Total', key: 'total', width: 14, type: 'currency' },
                    { header: 'Delivery Address', key: 'deliveryAddress', width: 40 },
                    { header: 'Delivery Partner', key: 'deliveryPersonName', width: 22 },
                    { header: 'Promo Code', key: 'promoCode', width: 14 },
                    { header: 'Coins Used', key: 'coinsUsed', width: 12, type: 'number' },
                ],
                rows: orders.map((o: any) => {
                    const d = new Date(o.createdAt);
                    return {
                        ...o,
                        dateLabel: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
                        timeLabel: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
                        itemList: (o.itemNames || []).join('; '),
                        grossItemTotal: round2((o.itemTotal || 0) + (o.itemDiscount || 0)),
                    };
                }),
                totals: {
                    invoiceNumber: 'TOTAL',
                    grossItemTotal: round2(orders.reduce((s: number, o: any) => s + (o.itemTotal || 0) + (o.itemDiscount || 0), 0)),
                    itemDiscount: round2(orders.reduce((s: number, o: any) => s + (o.itemDiscount || 0), 0)),
                    itemTotal: round2(orders.reduce((s: number, o: any) => s + (o.itemTotal || 0), 0)),
                    totalDiscount: round2(orders.reduce((s: number, o: any) => s + (o.totalDiscount || 0), 0)),
                    deliveryFee: round2(orders.reduce((s: number, o: any) => s + (o.deliveryFee || 0), 0)),
                    smallOrderSupportFee: round2(orders.reduce((s: number, o: any) => s + (o.smallOrderSupportFee || 0), 0)),
                    taxes: round2(orders.reduce((s: number, o: any) => s + (o.taxes || 0), 0)),
                    total: round2(orders.reduce((s: number, o: any) => s + (o.total || 0), 0)),
                },
                notes: [
                    'Invoice numbers are issued the first time an invoice is generated for an order; "Not issued" means none exists yet.',
                    'Item Total is already net of menu and offer discounts — Gross Item Total adds them back for reference.',
                ],
            };
            return reportResponse(spec, `Orders_${new Date().toISOString().slice(0, 10)}`, format);
        }

        return NextResponse.json({ success: true, data: orders });
    } catch (error) {
        console.error('Orders fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch orders' },
            { status: 500 }
        );
    }
}






async function handlePATCH(request: Request) {
    try {
        const body = await request.json();
        const { orderId, updates } = body;

        if (!orderId) {
            return NextResponse.json(
                { success: false, error: 'Order ID required' },
                { status: 400 }
            );
        }

        await db.collection(collections.orders).doc(orderId).update({
            ...updates,
            updatedAt: Timestamp.now(),
        });

        return NextResponse.json({ success: true, message: 'Order updated' });
    } catch (error) {
        console.error('Order update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update order' },
            { status: 500 }
        );
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
export const PATCH = withAdmin(handlePATCH);
