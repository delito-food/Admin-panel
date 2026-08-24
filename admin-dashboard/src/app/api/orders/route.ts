import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth, unauthorizedResponse, checkRateLimit, rateLimitedResponse } from '@/lib/api-auth';
import { getInvoiceNumberMap, invoiceNumberFor } from '@/lib/invoice-lookup';
import { reportResponse, platformMeta } from '@/lib/report-export';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';

export async function GET(request: Request) {
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

        let query: FirebaseFirestore.Query = db.collection(collections.orders)
            .orderBy('createdAt', 'desc')
            .limit(limit);

        if (status && status !== 'all') {
            query = db.collection(collections.orders)
                .where('status', '==', status)
                .orderBy('createdAt', 'desc')
                .limit(limit);
        }

        const snapshot = await query.get();

        // Invoice numbers issued for these orders (used in the UI and CSV export)
        const invoiceNumbers = await getInvoiceNumberMap();

        // Collect ALL unique delivery person IDs and vendor IDs for batch lookup
        // Note: collect deliveryPersonId regardless of whether name is stored,
        // so we can always get the phone number too.
        const deliveryPersonIds = new Set<string>();
        const vendorIds = new Set<string>();

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.deliveryPersonId) deliveryPersonIds.add(data.deliveryPersonId);
            if (data.vendorId) vendorIds.add(data.vendorId);
        });

        // Batch fetch delivery person details — use cached collection to avoid per-batch queries
        const deliveryPersonDetails: Record<string, { name: string; phone: string; vehicleType: string; vehicleNumber: string; rating: number }> = {};
        if (deliveryPersonIds.size > 0) {
            const allDp = await cachedCollection(collections.deliveryPersons);
            allDp.forEach(dpData => {
                if (deliveryPersonIds.has(dpData.id)) {
                    deliveryPersonDetails[dpData.id] = {
                        name: (dpData.fullName || dpData.name || '') as string,
                        phone: (dpData.phoneNumber || dpData.phone || '') as string,
                        vehicleType: (dpData.vehicleType || '') as string,
                        vehicleNumber: (dpData.vehicleNumber || '') as string,
                        rating: (dpData.rating || 0) as number,
                    };
                }
            });
        }

        // Batch fetch vendor details — use cached collection
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

        const round2 = (n: number): number => Math.round(n * 100) / 100;

        // Helper to parse any Firestore timestamp to ISO string or null
        const tsToIso = (v: any): string | null => {
            if (!v) return null;
            if (v?.toDate) return v.toDate().toISOString();
            if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString();
        };

        // ── Name-based reverse lookup for orders that lack a deliveryPersonId ──
        // These orders store the name directly in the order doc, but we need
        // vehicle type/number/rating which only live in the deliveryPersons doc.
        const nameOnlySet = new Set<string>();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!data.deliveryPersonId && data.deliveryPersonName) {
                nameOnlySet.add(data.deliveryPersonName as string);
            }
        });

        // Keyed by name → delivery person details (use already-cached collection)
        const detailsByName: Record<string, { phone: string; vehicleType: string; vehicleNumber: string; rating: number }> = {};
        if (nameOnlySet.size > 0) {
            const allDpForNames = await cachedCollection(collections.deliveryPersons);
            allDpForNames.forEach(dd => {
                const key = (dd.fullName || dd.name || '') as string;
                if (key && nameOnlySet.has(key)) {
                    detailsByName[key] = {
                        phone: (dd.phoneNumber || dd.phone || '') as string,
                        vehicleType: (dd.vehicleType || '') as string,
                        vehicleNumber: (dd.vehicleNumber || '') as string,
                        rating: (dd.rating || 0) as number,
                    };
                }
            });
        }

        // ── Cross-reference deliveryTasks — use cached collection ──
        const allOrderIdSet = new Set(snapshot.docs.map(doc => doc.id));
        const tasksByOrderId: Record<string, { deliveryPersonId: string; deliveryPersonName: string; deliveryPersonPhone: string; dispatchedAt: any; pickedUpAt: any; deliveredAt: any; taskStatus: string }> = {};

        const allTasks = await cachedCollection(collections.deliveryTasks);
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

        // Fill in any newly discovered delivery person IDs from tasks
        if (deliveryPersonIds.size > 0) {
            const allDp = await cachedCollection(collections.deliveryPersons);
            allDp.forEach(dpData => {
                if (deliveryPersonIds.has(dpData.id) && !deliveryPersonDetails[dpData.id]) {
                    deliveryPersonDetails[dpData.id] = {
                        name: (dpData.fullName || dpData.name || '') as string,
                        phone: (dpData.phoneNumber || dpData.phone || '') as string,
                        vehicleType: (dpData.vehicleType || '') as string,
                        vehicleNumber: (dpData.vehicleNumber || '') as string,
                        rating: (dpData.rating || 0) as number,
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
            // `discount` on the order document only ever carries the delivery
            // discount. The real customer-facing discounts are spread across the
            // fields below, so expose each one plus a combined total.
            const itemLineDiscount = (data.items || []).reduce((sum: number, it: any) => {
                const qty = it.quantity || 1;
                const price = it.price || 0;
                const original = it.originalPrice ?? price;
                return sum + Math.max(0, (original - price) * qty);
            }, 0);
            const originalItemTotal = data.originalItemTotal || 0;
            const itemTotalValue = data.itemTotal || data.subtotal || 0;
            const itemDiscount = Math.max(
                itemLineDiscount,
                originalItemTotal > itemTotalValue ? originalItemTotal - itemTotalValue : 0
            );
            const hungerGameDeliveryDiscount = data.hungerGameLevel2DeliveryDiscount || 0;
            const hungerGameComponents = (data.hungerGameLevel1Discount || 0)
                + (data.hungerGameCouponDiscount || 0)
                + (data.hungerGameLevel5Savings || 0);
            const hungerGameDiscount = hungerGameComponents > 0
                ? hungerGameComponents
                : Math.max(0, (data.hungerGameDiscount || 0) - hungerGameDeliveryDiscount);
            const deliveryDiscount = (data.deliveryDiscount ?? data.discount ?? 0) + hungerGameDeliveryDiscount;
            const totalDiscount = itemDiscount + hungerGameDiscount + deliveryDiscount
                + (data.coinDiscount || 0) + (data.promoDiscount || 0);

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






export async function PATCH(request: Request) {
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
