import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

// Get available delivery partners and unassigned orders
export async function GET() {
    try {
        // Get orders that need assignment (pending or can be reassigned)
        const ordersSnapshot = await db.collection(collections.orders)
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        // Get all verified delivery partners
        const deliverySnapshot = await db.collection(collections.deliveryPersons)
            .where('isVerified', '==', true)
            .get();

        // Build orders list
        const orders = ordersSnapshot.docs
            .filter(doc => {
                const order = doc.data();
                const status = order.status?.toLowerCase()?.replace(/\s+/g, '_') || '';
                // Only include "Sent for Delivery" orders for manual assignment
                // These are orders that vendors have prepared and are ready for delivery
                return status === 'sent_for_delivery' || status === 'sentfordelivery' ||
                       status === 'sent for delivery' || status === 'ready_for_pickup' ||
                       status === 'prepared';
            })
            .map(doc => {
                const order = doc.data();
                return {
                    orderId: doc.id,
                    vendorId: order.vendorId || '',
                    vendorName: order.vendorName || 'Unknown Vendor',
                    vendorAddress: order.vendorAddress || order.pickupAddress || '',
                    customerId: order.customerId || '',
                    customerName: order.customerName || 'Unknown Customer',
                    customerPhone: order.customerPhone || '',
                    deliveryAddress: order.deliveryAddress || '',
                    status: order.status || 'pending',
                    total: order.total || 0,
                    paymentMode: order.paymentMode || '',
                    itemCount: order.items?.length || 0,
                    itemNames: order.items?.map((i: { name: string }) => i.name).join(', ') || '',
                    createdAt: order.createdAt?.toDate?.()?.toISOString() || '',
                    // Current assignment
                    deliveryPersonId: order.deliveryPersonId || null,
                    deliveryPersonName: order.deliveryPersonName || null,
                    isAssigned: !!order.deliveryPersonId,
                };
            });

        // Build delivery partners list with current status
        const deliveryPartners = deliverySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                deliveryPersonId: doc.id,
                fullName: data.fullName || 'Unknown',
                profilePhotoUrl: data.profilePhotoUrl || '',
                phoneNumber: data.phoneNumber || '',
                city: data.city || '',
                vehicleType: data.vehicleType || '',
                isOnline: data.isOnline || false,
                isOnDelivery: data.isOnDelivery || false,
                currentOrderId: data.currentOrderId || null,
                rating: data.rating || 0,
                totalDeliveries: data.totalDeliveries || 0,
            };
        });

        // Sort: online first, then not on delivery, then by rating
        deliveryPartners.sort((a, b) => {
            if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
            if (a.isOnDelivery !== b.isOnDelivery) return a.isOnDelivery ? 1 : -1;
            return b.rating - a.rating;
        });

        return NextResponse.json({
            success: true,
            data: {
                orders,
                deliveryPartners,
                summary: {
                    totalPendingOrders: orders.filter(o => !o.isAssigned).length,
                    totalAssignedOrders: orders.filter(o => o.isAssigned).length,
                    onlinePartners: deliveryPartners.filter(d => d.isOnline).length,
                    availablePartners: deliveryPartners.filter(d => d.isOnline && !d.isOnDelivery).length,
                }
            }
        });
    } catch (error) {
        console.error('Order assignment fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch assignment data' },
            { status: 500 }
        );
    }
}

// Assign order to delivery partner
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { orderId, deliveryPersonId, deliveryPersonName, deliveryPersonPhone, reason } = body;

        if (!orderId || !deliveryPersonId) {
            return NextResponse.json(
                { success: false, error: 'Order ID and Delivery Person ID required' },
                { status: 400 }
            );
        }

        // Get current order data
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();
        
        if (!orderDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderDoc.data() || {};
        const previousDeliveryPersonId = orderData.deliveryPersonId;

        // Update order with new delivery person
        await orderRef.update({
            deliveryPersonId: deliveryPersonId,
            deliveryPersonName: deliveryPersonName || '',
            deliveryPersonPhone: deliveryPersonPhone || '',
            assignedAt: Timestamp.now(),
            assignedBy: 'admin',
            assignmentReason: reason || 'Manual assignment by admin',
            updatedAt: Timestamp.now(),
        });

        // Update new delivery person status
        await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update({
            isOnDelivery: true,
            currentOrderId: orderId,
            updatedAt: Timestamp.now(),
        });

        // If there was a previous delivery person, reset their status
        if (previousDeliveryPersonId && previousDeliveryPersonId !== deliveryPersonId) {
            await db.collection(collections.deliveryPersons).doc(previousDeliveryPersonId).update({
                isOnDelivery: false,
                currentOrderId: FieldValue.delete(),
                updatedAt: Timestamp.now(),
            });
        }

        // Log assignment
        await db.collection('orderAssignmentLogs').add({
            orderId,
            previousDeliveryPersonId: previousDeliveryPersonId || null,
            newDeliveryPersonId: deliveryPersonId,
            newDeliveryPersonName: deliveryPersonName || '',
            reason: reason || 'Manual assignment by admin',
            assignedBy: 'admin',
            createdAt: Timestamp.now(),
        });

        // Create or update delivery task for the delivery person
        const existingTaskQuery = await db.collection(collections.deliveryTasks)
            .where('orderId', '==', orderId)
            .where('status', 'in', ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'EN_ROUTE'])
            .limit(1)
            .get();

        if (existingTaskQuery.empty) {
            // Create new delivery task
            const taskRef = db.collection(collections.deliveryTasks).doc();
            await taskRef.set({
                taskId: taskRef.id,
                orderId,
                deliveryPersonId,
                deliveryPersonName: deliveryPersonName || '',
                deliveryPersonPhone: deliveryPersonPhone || '',
                vendorId: orderData.vendorId || '',
                vendorName: orderData.vendorName || '',
                vendorAddress: orderData.vendorAddress || '',
                vendorLatitude: orderData.vendorLatitude || 0,
                vendorLongitude: orderData.vendorLongitude || 0,
                customerId: orderData.customerId || '',
                customerName: orderData.customerName || '',
                customerAddress: orderData.deliveryAddress || '',
                customerLatitude: orderData.customerLatitude || 0,
                customerLongitude: orderData.customerLongitude || 0,
                customerPhone: orderData.customerPhone || '',
                status: 'ASSIGNED',
                orderTotal: orderData.total || 0,
                deliveryFee: orderData.deliveryFee || 0,
                paymentMode: orderData.paymentMode || 'COD',
                itemsDescription: orderData.items?.map((i: { name: string }) => i.name).join(', ') || '',
                specialInstructions: orderData.deliveryInstructions || '',
                codAmount: orderData.paymentMode === 'COD' ? (orderData.total || 0) : 0,
                codCollected: false,
                createdAt: Timestamp.now(),
                assignedAt: Timestamp.now(),
                assignedBy: 'admin',
            });
        } else {
            // Update existing task with new delivery person
            const existingTask = existingTaskQuery.docs[0];
            await existingTask.ref.update({
                deliveryPersonId,
                deliveryPersonName: deliveryPersonName || '',
                deliveryPersonPhone: deliveryPersonPhone || '',
                status: 'ASSIGNED',
                assignedAt: Timestamp.now(),
                assignedBy: 'admin',
                updatedAt: Timestamp.now(),
            });
        }

        return NextResponse.json({
            success: true,
            message: `Order assigned to ${deliveryPersonName || 'delivery partner'} successfully`,
        });
    } catch (error) {
        console.error('Order assignment error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to assign order' },
            { status: 500 }
        );
    }
}

// Unassign order from delivery partner
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const orderId = searchParams.get('orderId');

        if (!orderId) {
            return NextResponse.json(
                { success: false, error: 'Order ID required' },
                { status: 400 }
            );
        }

        // Get current order data
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();
        
        if (!orderDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderDoc.data() || {};
        const deliveryPersonId = orderData.deliveryPersonId;

        // Remove assignment from order
        await orderRef.update({
            deliveryPersonId: FieldValue.delete(),
            deliveryPersonName: FieldValue.delete(),
            deliveryPersonPhone: FieldValue.delete(),
            unassignedAt: Timestamp.now(),
            unassignedBy: 'admin',
            updatedAt: Timestamp.now(),
        });

        // Reset delivery person status if they had this order
        if (deliveryPersonId) {
            const deliveryPersonRef = db.collection(collections.deliveryPersons).doc(deliveryPersonId);
            const deliveryPersonDoc = await deliveryPersonRef.get();
            const deliveryData = deliveryPersonDoc.data() || {};
            
            if (deliveryData.currentOrderId === orderId) {
                await deliveryPersonRef.update({
                    isOnDelivery: false,
                    currentOrderId: FieldValue.delete(),
                    updatedAt: Timestamp.now(),
                });
            }
        }

        // Cancel any existing delivery tasks for this order
        const existingTaskQuery = await db.collection(collections.deliveryTasks)
            .where('orderId', '==', orderId)
            .where('status', 'in', ['ASSIGNED', 'ACCEPTED'])
            .get();

        for (const taskDoc of existingTaskQuery.docs) {
            await taskDoc.ref.update({
                status: 'CANCELLED',
                cancelledAt: Timestamp.now(),
                cancelledBy: 'admin',
                cancellationReason: 'Order unassigned by admin',
                updatedAt: Timestamp.now(),
            });
        }

        return NextResponse.json({
            success: true,
            message: 'Order unassigned successfully',
        });
    } catch (error) {
        console.error('Order unassignment error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to unassign order' },
            { status: 500 }
        );
    }
}
