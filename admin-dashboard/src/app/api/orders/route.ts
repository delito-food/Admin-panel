import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyApiAuth, unauthorizedResponse, checkRateLimit, rateLimitedResponse } from '@/lib/api-auth';

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
        const limit = Math.min(parseInt(searchParams.get('limit') || '1000'), 5000);

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

            return {
                orderId: doc.id,
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
                subtotal: data.subtotal || data.itemTotal || 0,
                discount: data.discount || 0,
                deliveryFee: data.deliveryFee || 0,
                taxes: data.taxes || 0,
                tip: data.tip || 0,
                smallOrderSupportFee: data.smallOrderSupportFee || 0,
                total: data.total || 0,
                status: (taskInfo?.taskStatus === 'DELIVERED' || taskInfo?.taskStatus === 'COMPLETED') ? 'Delivered' : (data.status || 'Pending'),
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

        // CSV export
        const format = searchParams.get('format');
        if (format === 'csv') {
            const bom = '\uFEFF';
            const lines: string[] = [];
            lines.push('"Order ID","Date","Time","Customer","Phone","Vendor","Status","Payment Mode","Payment Status","Items","Item Total (₹)","Discount (₹)","Delivery Fee (₹)","Taxes (₹)","Total (₹)","Delivery Address","Delivery Person","Promo Code","Promo Disc (₹)","Coins Used","Coin Disc (₹)"');
            orders.forEach((o: any) => {
                const d = new Date(o.createdAt);
                const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                const itemList = (o.itemNames || []).join('; ');
                lines.push(`"${o.orderId}","${date}","${time}","${(o.customerName || '').replace(/"/g, '""')}","${o.customerPhone}","${(o.vendorName || '').replace(/"/g, '""')}","${o.status}","${o.paymentMode}","${o.paymentStatus}","${itemList.replace(/"/g, '""')}",${(o.itemTotal || 0).toFixed(2)},${(o.discount || 0).toFixed(2)},${(o.deliveryFee || 0).toFixed(2)},${(o.taxes || 0).toFixed(2)},${(o.total || 0).toFixed(2)},"${(o.deliveryAddress || '').replace(/"/g, '""')}","${(o.deliveryPersonName || '')}","${o.promoCode || ''}",${(o.promoDiscount || 0).toFixed(2)},${o.coinsUsed || 0},${(o.coinDiscount || 0).toFixed(2)}`);
            });
            return new Response(bom + lines.join('\n'), {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="All_Orders_${new Date().toISOString().slice(0, 10)}.csv"`,
                },
            });
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
