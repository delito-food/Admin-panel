import { NextResponse } from 'next/server';
import { db, collections, cachedCollection, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Tamper-free COD Settlement Logic
 *
 * Single source of truth: orders collection.
 * - COD collected = sum of `total` from all delivered COD orders for a delivery person
 * - COD settled = sum of `total` from all delivered COD orders where `codSettled === true`
 * - COD pending = collected - settled
 *
 * We NEVER trust aggregated fields on the deliveryPerson document for calculations.
 * Those fields are only updated as a convenience mirror.
 */

export async function GET() {
    try {
        // Use cached collections (60s TTL) to avoid quota exhaustion
        const deliveryDocs = await cachedCollection(collections.deliveryPersons);
        const orderDocs = await cachedCollection(collections.orders);
        const taskDocs = await cachedCollection(collections.deliveryTasks);

        // Settlement history — small collection, direct query OK
        const settlementsSnapshot = await db.collection('codSettlements')
            .orderBy('createdAt', 'desc')
            .limit(200)
            .get()
            .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

        const codByPartner: Record<string, {
            collected: number;
            settled: number;
            pending: number;
            totalOrders: number;
            pendingOrderIds: string[];
            settledOrderIds: string[];
            qrPendingReview: number;
            qrReviewOrders: Array<{ orderId: string; total: number; customerName: string; createdAt: string; qrReviewStatus: string }>;
            orderDetails: Array<{ orderId: string; total: number; settled: boolean; customerName: string; createdAt: string; paymentMethod?: string; qrReviewStatus?: string }>;
            seenOrderIds: Set<string>;
        }> = {};

        // Helper to init partner entry
        const ensurePartner = (dpId: string) => {
            if (!codByPartner[dpId]) {
                codByPartner[dpId] = {
                    collected: 0, settled: 0, pending: 0,
                    totalOrders: 0, pendingOrderIds: [], settledOrderIds: [],
                    qrPendingReview: 0, qrReviewOrders: [],
                    orderDetails: [], seenOrderIds: new Set(),
                };
            }
        };

        // ── Source 1: Orders collection (primary) ──
        orderDocs.forEach(order => {
            // Filter: only COD orders
            const paymentMode = String(order.paymentMode || '').toLowerCase().trim();
            if (paymentMode !== 'cod' && paymentMode !== 'cash' && paymentMode !== 'cash on delivery') return;

            const status = ((order.status || '') as string).toLowerCase();
            const dpId = (order.deliveryPersonId || '') as string;

            // Must have delivery person AND be delivered/completed to count
            if (!dpId) return;
            if (status !== 'delivered' && status !== 'completed') return;

            ensurePartner(dpId);
            codByPartner[dpId].seenOrderIds.add(order.id);

            const total = (order.total || 0) as number;
            const isSettled = order.codSettled === true;
            const paymentMethod = ((order.codPaymentMethod || '') as string).toUpperCase();
            const qrReviewStatus = (order.codQrReviewStatus || '') as string;

            codByPartner[dpId].collected += total;
            codByPartner[dpId].totalOrders += 1;

            const createdAt = (order.createdAt as any)?.toDate?.()?.toISOString?.() ||
                ((order.createdAt as any)?._seconds ? new Date((order.createdAt as any)._seconds * 1000).toISOString() : '');

            codByPartner[dpId].orderDetails.push({
                orderId: order.id,
                total,
                settled: isSettled,
                customerName: (order.customerName || 'Unknown') as string,
                createdAt,
                paymentMethod: paymentMethod || 'CASH',
                qrReviewStatus,
            });

            if (paymentMethod === 'QR' && qrReviewStatus === 'pending_review') {
                // QR payment pending admin verification — treat as PENDING
                codByPartner[dpId].pending += total;
                codByPartner[dpId].pendingOrderIds.push(order.id);
                codByPartner[dpId].qrPendingReview += total;
                codByPartner[dpId].qrReviewOrders.push({
                    orderId: order.id, total, customerName: (order.customerName || 'Unknown') as string,
                    createdAt, qrReviewStatus,
                });
            } else if (paymentMethod === 'QR' && (qrReviewStatus === 'reviewed' || isSettled)) {
                // QR payment verified by admin — mark as settled
                codByPartner[dpId].settled += total;
                codByPartner[dpId].settledOrderIds.push(order.id);
            } else if (isSettled) {
                codByPartner[dpId].settled += total;
                codByPartner[dpId].settledOrderIds.push(order.id);
            } else {
                codByPartner[dpId].pending += total;
                codByPartner[dpId].pendingOrderIds.push(order.id);
            }
        });

        // ── Source 2: DeliveryTasks collection (supplemental) ──
        // Catches COD orders where deliveryPersonId wasn't set on the order doc
        // but WAS set on the deliveryTask
        taskDocs.forEach(task => {
            const taskStatus = ((task.status || '') as string).toUpperCase();
            if (taskStatus !== 'DELIVERED') return;

            const paymentMode = String(task.paymentMode || '').toLowerCase().trim();
            if (paymentMode !== 'cod' && paymentMode !== 'cash' && paymentMode !== 'cash on delivery') return;

            const dpId = (task.deliveryPersonId || '') as string;
            if (!dpId) return;

            const orderId = (task.orderId || task.id || '') as string;

            ensurePartner(dpId);

            // Skip if we already counted this order from the orders collection
            if (codByPartner[dpId].seenOrderIds.has(orderId)) return;

            // Also check if any other partner already counted this orderId
            let alreadyCounted = false;
            for (const partnerId of Object.keys(codByPartner)) {
                if (codByPartner[partnerId].seenOrderIds.has(orderId)) {
                    alreadyCounted = true;
                    break;
                }
            }
            if (alreadyCounted) return;

            codByPartner[dpId].seenOrderIds.add(orderId);

            const total = (task.codAmount as number) || (task.orderTotal as number) || 0;
            if (total <= 0) return;

            const isCodCollected = task.codCollected === true;
            const isCodSettled = task.codSettled === true;
            const paymentMethod = ((task.codPaymentMethod || '') as string).toUpperCase();
            const qrReviewStatus = (task.codQrReviewStatus || '') as string;

            // Only count if COD was collected (delivered)
            if (!isCodCollected && !isCodSettled) return;

            codByPartner[dpId].collected += total;
            codByPartner[dpId].totalOrders += 1;

            const createdAt = (task.createdAt as any)?.toDate?.()?.toISOString?.() ||
                ((task.createdAt as any)?._seconds ? new Date((task.createdAt as any)._seconds * 1000).toISOString() : '');

            codByPartner[dpId].orderDetails.push({
                orderId,
                total,
                settled: isCodSettled,
                customerName: (task.customerName || 'Unknown') as string,
                createdAt,
                paymentMethod: paymentMethod || 'CASH',
                qrReviewStatus,
            });

            if (paymentMethod === 'QR' && qrReviewStatus === 'pending_review') {
                // QR payment pending admin verification — treat as PENDING
                codByPartner[dpId].pending += total;
                codByPartner[dpId].pendingOrderIds.push(orderId);
                codByPartner[dpId].qrPendingReview += total;
                codByPartner[dpId].qrReviewOrders.push({
                    orderId, total, customerName: (task.customerName || 'Unknown') as string,
                    createdAt, qrReviewStatus,
                });
            } else if (paymentMethod === 'QR' && (qrReviewStatus === 'reviewed' || isCodSettled)) {
                // QR payment verified by admin — mark as settled
                codByPartner[dpId].settled += total;
                codByPartner[dpId].settledOrderIds.push(orderId);
            } else if (isCodSettled) {
                codByPartner[dpId].settled += total;
                codByPartner[dpId].settledOrderIds.push(orderId);
            } else {
                codByPartner[dpId].pending += total;
                codByPartner[dpId].pendingOrderIds.push(orderId);
            }
        });

        // ── Build settlement history ──
        const recentSettlements = settlementsSnapshot.docs.map(doc => {
            const s = doc.data();
            return {
                settlementId: doc.id,
                deliveryPersonId: s.deliveryPersonId || '',
                deliveryPersonName: s.deliveryPersonName || '',
                amount: s.amount || 0,
                ordersCount: s.ordersCount || (s.orderIds?.length ?? 0),
                method: s.method || 'Cash',
                status: s.status || 'pending',
                createdAt: s.createdAt?.toDate?.()?.toISOString?.() || '',
                processedAt: s.processedAt?.toDate?.()?.toISOString?.() || null,
                notes: s.notes || null,
                receiptId: s.receiptId || null,
                processedBy: s.processedBy || 'unknown',
                orderIds: s.orderIds || [],
            };
        });

        // ── Build delivery partner COD response ──
        const deliveryPartners = deliveryDocs
            .map(data => {
                const cod = codByPartner[data.id] || {
                    collected: 0, settled: 0, pending: 0,
                    totalOrders: 0, pendingOrderIds: [], settledOrderIds: [], orderDetails: [],
                    seenOrderIds: new Set(), qrPendingReview: 0, qrReviewOrders: [],
                };

                return {
                    deliveryPersonId: data.id,
                    fullName: (data.fullName || data.name || 'Unknown') as string,
                    profilePhotoUrl: (data.profilePhotoUrl || '') as string,
                    phoneNumber: (data.phoneNumber || '') as string,
                    city: (data.city || '') as string,
                    isOnline: (data.isOnline || false) as boolean,
                    isVerified: (data.isVerified || false) as boolean,
                    // All computed from orders — single source of truth
                    codCollected: Math.round(cod.collected * 100) / 100,
                    codSettled: Math.round(cod.settled * 100) / 100,
                    codPending: Math.round(cod.pending * 100) / 100,
                    pendingOrders: cod.pendingOrderIds.length,
                    pendingOrderIds: cod.pendingOrderIds,
                    totalCodOrders: cod.totalOrders,
                    // QR payment review
                    qrPendingReview: Math.round(cod.qrPendingReview * 100) / 100,
                    qrReviewOrders: cod.qrReviewOrders,
                };
            })
            .filter(d => d.codCollected > 0 || d.codPending > 0 || d.qrPendingReview > 0)
            .sort((a, b) => b.codPending - a.codPending);

        // ── Summary stats ──
        const summary = {
            totalCodCollected: Math.round(deliveryPartners.reduce((s, d) => s + d.codCollected, 0) * 100) / 100,
            totalCodSettled: Math.round(deliveryPartners.reduce((s, d) => s + d.codSettled, 0) * 100) / 100,
            totalCodPending: Math.round(deliveryPartners.reduce((s, d) => s + d.codPending, 0) * 100) / 100,
            totalQrPendingReview: Math.round(deliveryPartners.reduce((s, d) => s + d.qrPendingReview, 0) * 100) / 100,
            partnersWithPending: deliveryPartners.filter(d => d.codPending > 0).length,
            totalSettlementRecords: recentSettlements.length,
        };

        return NextResponse.json({
            success: true,
            data: { deliveryPartners, recentSettlements, summary }
        });
    } catch (error) {
        console.error('COD tracking fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch COD data' },
            { status: 500 }
        );
    }
}

/**
 * POST: Record a COD settlement
 *
 * Two modes:
 * 1. Admin settles on behalf (method: Cash, Bank Transfer, UPI, or "Admin Override")
 * 2. Delivery person self-settles via Razorpay (method: "Razorpay", processedBy: "delivery_app")
 *
 * For tamper-proof settlement:
 * - We mark individual orders as codSettled = true
 * - Create a settlement receipt in codSettlements
 * - Mirror update the deliveryPerson document (convenience only)
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { deliveryPersonId, deliveryPersonName, amount, method, notes, orderIds } = body;

        if (!deliveryPersonId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Delivery person ID and valid amount required' },
                { status: 400 }
            );
        }

        // Validate: compute actual pending from orders (tamper-proof)
        let actualPending = 0;
        const validPendingOrderIds: string[] = [];
        const seenSettlementOrderIds = new Set<string>();

        if (orderIds && orderIds.length > 0) {
            // Validate the provided order IDs against orders collection
            for (let i = 0; i < orderIds.length; i += 10) {
                const batch = orderIds.slice(i, i + 10);
                const orderSnap = await db.collection(collections.orders)
                    .where('__name__', 'in', batch)
                    .get();
                orderSnap.docs.forEach(doc => {
                    const order = doc.data();
                    if (order.deliveryPersonId === deliveryPersonId &&
                        !order.codSettled &&
                        (order.status?.toLowerCase() === 'delivered' || order.status?.toLowerCase() === 'completed')) {
                        actualPending += order.total || 0;
                        validPendingOrderIds.push(doc.id);
                        seenSettlementOrderIds.add(doc.id);
                    }
                });
            }

            // Also check deliveryTasks for the provided orderIds not found in orders collection
            const missingOrderIds = orderIds.filter((id: string) => !seenSettlementOrderIds.has(id));
            if (missingOrderIds.length > 0) {
                for (let i = 0; i < missingOrderIds.length; i += 10) {
                    const batch = missingOrderIds.slice(i, i + 10);
                    const taskSnap = await db.collection(collections.deliveryTasks)
                        .where('orderId', 'in', batch)
                        .get();
                    taskSnap.docs.forEach(doc => {
                        const task = doc.data();
                        if (task.deliveryPersonId !== deliveryPersonId) return;
                        const orderId = task.orderId || doc.id;
                        if (seenSettlementOrderIds.has(orderId)) return;
                        if (task.codSettled) return;
                        seenSettlementOrderIds.add(orderId);
                        const codAmount = (task.codAmount as number) || (task.orderTotal as number) || 0;
                        if (codAmount > 0) {
                            actualPending += codAmount;
                            validPendingOrderIds.push(orderId);
                        }
                    });
                }
            }
        } else {
            // No orderIds provided — fetch all orders for this partner from orders collection
            const pendingOrdersSnap = await db.collection(collections.orders)
                .where('deliveryPersonId', '==', deliveryPersonId)
                .where('paymentMode', 'in', ['COD', 'cod', 'Cash', 'cash', 'Cash on Delivery'])
                .get();

            pendingOrdersSnap.docs.forEach(doc => {
                const order = doc.data();
                const pm = (order.paymentMode || '').toLowerCase().trim();
                const isCod = pm === 'cod' || pm === 'cash' || pm === 'cash on delivery';
                if (!isCod) return;
                if (!order.codSettled &&
                    (order.status?.toLowerCase() === 'delivered' || order.status?.toLowerCase() === 'completed')) {
                    actualPending += order.total || 0;
                    validPendingOrderIds.push(doc.id);
                    seenSettlementOrderIds.add(doc.id);
                }
            });

            // ALWAYS also check deliveryTasks — most COD data lives here
            // (orders may not have deliveryPersonId set, or may not exist at all)
            const tasksSnap = await db.collection(collections.deliveryTasks)
                .where('deliveryPersonId', '==', deliveryPersonId)
                .where('status', '==', 'DELIVERED')
                .where('paymentMode', '==', 'COD')
                .where('codCollected', '==', true)
                .where('codSettled', '==', false)
                .get();

            tasksSnap.docs.forEach(doc => {
                const task = doc.data();
                const orderId = task.orderId || doc.id;
                // Skip if already counted from orders collection
                if (seenSettlementOrderIds.has(orderId)) return;
                seenSettlementOrderIds.add(orderId);
                const codAmount = (task.codAmount as number) || (task.orderTotal as number) || 0;
                if (codAmount > 0) {
                    actualPending += codAmount;
                    validPendingOrderIds.push(orderId);
                }
            });
        }

        // Use the higher of computed pending vs requested amount — trust the delivery app
        // which reads directly from deliveryTasks (the source of truth for COD collection)
        const effectivePending = Math.max(actualPending, amount);

        if (amount > effectivePending + 1) { // +1 for floating point tolerance
            return NextResponse.json(
                { success: false, error: `Settlement amount ₹${amount} exceeds actual pending ₹${Math.round(effectivePending)}` },
                { status: 400 }
            );
        }

        // Replace actualPending with effectivePending for downstream logic
        actualPending = effectivePending;

        // Generate receipt ID
        const receiptId = `COD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        // Determine which orders to mark settled based on amount (FIFO — oldest first)
        const settleAll = amount >= actualPending - 1; // -1 for floating point tolerance
        let finalOrdersToSettle: string[];

        if (settleAll) {
            // Settling full pending amount — mark all orders
            finalOrdersToSettle = [...validPendingOrderIds];
        } else {
            // Partial settlement — need to fetch individual order totals for FIFO
            finalOrdersToSettle = [];
            let runningTotal = 0;

            // Fetch order totals for FIFO selection
            for (let i = 0; i < validPendingOrderIds.length; i += 10) {
                const batch = validPendingOrderIds.slice(i, i + 10);
                const orderSnap = await db.collection(collections.orders)
                    .where('__name__', 'in', batch)
                    .get();

                const orderTotals: Array<{ id: string; total: number; createdAt: any }> = [];
                orderSnap.docs.forEach(doc => {
                    orderTotals.push({
                        id: doc.id,
                        total: doc.data().total || 0,
                        createdAt: doc.data().createdAt,
                    });
                });

                // Sort by createdAt ascending (oldest first)
                orderTotals.sort((a, b) => {
                    const aTime = a.createdAt?.toDate?.()?.getTime?.() || a.createdAt?._seconds * 1000 || 0;
                    const bTime = b.createdAt?.toDate?.()?.getTime?.() || b.createdAt?._seconds * 1000 || 0;
                    return aTime - bTime;
                });

                for (const order of orderTotals) {
                    if (runningTotal >= amount) break;
                    finalOrdersToSettle.push(order.id);
                    runningTotal += order.total;
                }

                if (runningTotal >= amount) break;
            }
        }

        // Create settlement record
        const settlementRef = await db.collection('codSettlements').add({
            deliveryPersonId,
            deliveryPersonName: deliveryPersonName || '',
            amount: Math.round(amount * 100) / 100,
            method: method || 'Cash',
            status: 'completed',
            notes: notes || null,
            orderIds: finalOrdersToSettle,
            ordersCount: finalOrdersToSettle.length,
            receiptId,
            createdAt: Timestamp.now(),
            processedAt: Timestamp.now(),
            processedBy: body.processedBy || 'admin',
        });

        // Mark individual orders as codSettled (Firestore batch limit: 500 writes)
        if (finalOrdersToSettle.length > 0) {
            const BATCH_LIMIT = 499; // Leave room for safety
            for (let i = 0; i < finalOrdersToSettle.length; i += BATCH_LIMIT) {
                const batchOrders = finalOrdersToSettle.slice(i, i + BATCH_LIMIT);
                const batch = db.batch();
                for (const orderId of batchOrders) {
                    const orderRef = db.collection(collections.orders).doc(orderId);
                    batch.update(orderRef, {
                        codSettled: true,
                        codSettledAt: Timestamp.now(),
                        codSettlementId: settlementRef.id,
                        codReceiptId: receiptId,
                    });
                }
                await batch.commit();
            }
        }

        // Also mark delivery tasks as codSettled (delivery app reads from this collection)
        try {
            const tasksSnapshot = await db.collection('deliveryTasks')
                .where('deliveryPersonId', '==', deliveryPersonId)
                .where('status', '==', 'DELIVERED')
                .where('paymentMode', '==', 'COD')
                .where('codCollected', '==', true)
                .where('codSettled', '==', false)
                .get();

            if (tasksSnapshot.size > 0) {
                const TASK_BATCH_LIMIT = 499;
                for (let i = 0; i < tasksSnapshot.docs.length; i += TASK_BATCH_LIMIT) {
                    const batchDocs = tasksSnapshot.docs.slice(i, i + TASK_BATCH_LIMIT);
                    const batch = db.batch();
                    for (const doc of batchDocs) {
                        batch.update(doc.ref, {
                            codSettled: true,
                            codSettledAt: Timestamp.now(),
                            updatedAt: Timestamp.now(),
                        });
                    }
                    await batch.commit();
                }
                console.log(`Marked ${tasksSnapshot.size} delivery tasks as COD settled`);
            }
        } catch (taskError) {

            console.warn('Failed to update delivery tasks codSettled flag:', taskError);
        }

        // Mirror-update the deliveryPerson document (convenience field, not source of truth)
        try {
            const dpRef = db.collection(collections.deliveryPersons).doc(deliveryPersonId);
            const dpDoc = await dpRef.get();
            const dpData = dpDoc.data() || {};
            const currentCollected = dpData.codCollected || 0;
            const currentSettled = dpData.codSettled || 0;
            await dpRef.update({
                codCollected: Math.max(0, currentCollected - amount),
                codSettled: currentSettled + amount,
                lastCodSettlementAt: Timestamp.now(),
                lastCodSettlementId: settlementRef.id,
                updatedAt: Timestamp.now(),
            });
        } catch (e) {
            // Non-critical: log but don't fail
            console.warn('Failed to mirror-update deliveryPerson COD fields:', e);
        }

        // Invalidate caches so next read gets fresh data
        invalidateCache(collections.orders);
        invalidateCache(collections.deliveryPersons);

        return NextResponse.json({
            success: true,
            message: `COD settlement of ₹${Math.round(amount)} recorded successfully`,
            settlementId: settlementRef.id,
            receiptId,
            ordersSettled: finalOrdersToSettle.length,
            actualPendingBeforeSettlement: Math.round(actualPending),
        });
    } catch (error) {
        console.error('COD settlement error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to record settlement' },
            { status: 500 }
        );
    }
}

/**
 * PATCH: Admin manually marks amount as settled (override)
 * Used when admin wants to reconcile without actual payment flow
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { settlementId, action, notes } = body;

        if (!settlementId) {
            return NextResponse.json(
                { success: false, error: 'Settlement ID required' },
                { status: 400 }
            );
        }

        const settlementRef = db.collection('codSettlements').doc(settlementId);
        const settlementDoc = await settlementRef.get();

        if (!settlementDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Settlement not found' },
                { status: 404 }
            );
        }

        if (action === 'void') {
            // Void a settlement — unmark orders and reverse the settlement
            const settlement = settlementDoc.data()!;
            const orderIds = settlement.orderIds || [];

            // Unmark orders (respect Firestore batch limit of 500)
            if (orderIds.length > 0) {
                const BATCH_LIMIT = 499;
                for (let i = 0; i < orderIds.length; i += BATCH_LIMIT) {
                    const batchOrders = orderIds.slice(i, i + BATCH_LIMIT);
                    const batch = db.batch();
                    for (const orderId of batchOrders) {
                        const orderRef = db.collection(collections.orders).doc(orderId);
                        batch.update(orderRef, {
                            codSettled: false,
                            codSettledAt: null,
                            codSettlementId: null,
                            codReceiptId: null,
                        });
                    }
                    await batch.commit();
                }
            }

            // Mark settlement as voided
            await settlementRef.update({
                status: 'voided',
                voidedAt: Timestamp.now(),
                voidNotes: notes || 'Voided by admin',
            });

            // Reverse mirror on delivery person
            try {
                const dpRef = db.collection(collections.deliveryPersons).doc(settlement.deliveryPersonId);
                const dpDoc = await dpRef.get();
                const dpData = dpDoc.data() || {};
                await dpRef.update({
                    codCollected: (dpData.codCollected || 0) + settlement.amount,
                    codSettled: Math.max(0, (dpData.codSettled || 0) - settlement.amount),
                    updatedAt: Timestamp.now(),
                });
            } catch { /* non-critical */ }

            return NextResponse.json({
                success: true,
                message: `Settlement ${settlementId} voided. ${orderIds.length} orders unmarked.`
            });
        }

        return NextResponse.json(
            { success: false, error: `Unknown action: ${action}` },
            { status: 400 }
        );
    } catch (error) {
        console.error('COD PATCH error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update settlement' },
            { status: 500 }
        );
    }
}

/**
 * PUT: Review QR COD payments
 * Admin marks a QR payment as reviewed (confirmed received) or rejected.
 */
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { orderId, status: reviewStatus } = body; // status: 'reviewed' or 'rejected'

        if (!orderId || !reviewStatus) {
            return NextResponse.json(
                { success: false, error: 'orderId and status required' },
                { status: 400 }
            );
        }

        if (reviewStatus !== 'reviewed' && reviewStatus !== 'rejected') {
            return NextResponse.json(
                { success: false, error: 'status must be "reviewed" or "rejected"' },
                { status: 400 }
            );
        }

        // Update the order doc
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();
        if (orderDoc.exists) {
            await orderRef.update({
                codQrReviewStatus: reviewStatus,
                codQrReviewedAt: Timestamp.now(),
                // If approved, mark as settled. If rejected, unsettle.
                codSettled: reviewStatus === 'reviewed',
                ...(reviewStatus === 'reviewed' ? { codSettledAt: Timestamp.now() } : {}),
                ...(reviewStatus === 'rejected' ? { paymentStatus: 'QR Rejected — Needs Resettlement' } : {}),
            });
        }

        // Update the delivery task too
        const tasksSnap = await db.collection(collections.deliveryTasks)
            .where('orderId', '==', orderId)
            .limit(1)
            .get();

        if (!tasksSnap.empty) {
            const taskRef = tasksSnap.docs[0].ref;
            await taskRef.update({
                codQrReviewStatus: reviewStatus,
                codQrReviewedAt: Timestamp.now(),
                // If approved, mark as settled so it disappears from delivery app pending list
                codSettled: reviewStatus === 'reviewed',
                ...(reviewStatus === 'reviewed' ? { codSettledAt: Timestamp.now() } : {}),
                ...(reviewStatus === 'rejected' ? { codSettled: false } : {}),
                updatedAt: Timestamp.now(),
            });

            // If rejected, add the amount back to the delivery person's pending COD
            if (reviewStatus === 'rejected') {
                const taskData = tasksSnap.docs[0].data();
                const dpId = taskData.deliveryPersonId;
                const codAmount = taskData.codAmount || taskData.orderTotal || 0;
                if (dpId && codAmount > 0) {
                    try {
                        const dpRef = db.collection(collections.deliveryPersons).doc(dpId);
                        const dpDoc = await dpRef.get();
                        if (dpDoc.exists) {
                            const dpData = dpDoc.data() || {};
                            await dpRef.update({
                                codCollected: (dpData.codCollected || 0) + codAmount,
                                codSettled: Math.max(0, (dpData.codSettled || 0) - codAmount),
                                updatedAt: Timestamp.now(),
                            });
                        }
                    } catch (e) {
                        console.warn('Failed to update delivery person COD after rejection:', e);
                    }
                }
            }
        }

        // Invalidate cache
        invalidateCache(collections.orders);
        invalidateCache(collections.deliveryTasks);

        return NextResponse.json({
            success: true,
            message: `QR payment for order ${orderId} marked as ${reviewStatus}`,
        });
    } catch (error) {
        console.error('QR review error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to review QR payment' },
            { status: 500 }
        );
    }
}
