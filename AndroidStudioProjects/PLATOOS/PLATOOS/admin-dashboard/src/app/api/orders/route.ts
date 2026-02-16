import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const limit = parseInt(searchParams.get('limit') || '50');

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

        // Collect unique delivery person IDs that need name lookup
        const deliveryPersonIds = new Set<string>();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.deliveryPersonId && !data.deliveryPersonName) {
                deliveryPersonIds.add(data.deliveryPersonId);
            }
        });

        // Fetch delivery person names in batch
        const deliveryPersonNames: Record<string, { name: string; phone: string }> = {};
        if (deliveryPersonIds.size > 0) {
            const ids = Array.from(deliveryPersonIds);
            // Firestore limits 'in' queries to 30 items
            for (let i = 0; i < ids.length; i += 30) {
                const batch = ids.slice(i, i + 30);
                const dpSnapshot = await db.collection(collections.deliveryPersons)
                    .where('__name__', 'in', batch)
                    .get();
                dpSnapshot.docs.forEach(dpDoc => {
                    const dpData = dpDoc.data();
                    deliveryPersonNames[dpDoc.id] = {
                        name: dpData.fullName || dpData.name || '',
                        phone: dpData.phoneNumber || dpData.phone || '',
                    };
                });
            }
        }

        const orders = snapshot.docs.map(doc => {
            const data = doc.data();
            const deliveryPersonId = data.deliveryPersonId || null;
            
            // Use stored name or lookup from deliveryPersonNames
            let deliveryPersonName = data.deliveryPersonName || '';
            let deliveryPersonPhone = data.deliveryPersonPhone || '';
            
            if (deliveryPersonId && !deliveryPersonName && deliveryPersonNames[deliveryPersonId]) {
                deliveryPersonName = deliveryPersonNames[deliveryPersonId].name;
                deliveryPersonPhone = deliveryPersonNames[deliveryPersonId].phone || deliveryPersonPhone;
            }

            return {
                orderId: doc.id,
                vendorId: data.vendorId || '',
                vendorName: data.vendorName || '',
                customerId: data.customerId || '',
                customerName: data.customerName || '',
                customerPhone: data.customerPhone || '',
                items: data.items || [],
                itemNames: data.itemNames || [],
                subtotal: data.subtotal || 0,
                discount: data.discount || 0,
                deliveryFee: data.deliveryFee || 0,
                taxes: data.taxes || 0,
                total: data.total || 0,
                status: data.status || 'Pending',
                paymentMode: data.paymentMode || 'Cash on Delivery',
                paymentStatus: data.paymentStatus || 'Pending',
                deliveryAddress: data.deliveryAddress || '',
                deliveryPersonId: deliveryPersonId,
                deliveryPersonName: deliveryPersonName,
                deliveryPersonPhone: deliveryPersonPhone,
                pickupPin: data.pickupPin || '',
                deliveryPin: data.deliveryPin || '',
                pickupPinVerified: data.pickupPinVerified ?? false,
                deliveryPinVerified: data.deliveryPinVerified ?? false,
                pickupPinVerifiedAt: data.pickupPinVerifiedAt?.toDate ? data.pickupPinVerifiedAt.toDate().toISOString() : null,
                deliveryPinVerifiedAt: data.deliveryPinVerifiedAt?.toDate ? data.deliveryPinVerifiedAt.toDate().toISOString() : null,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt?._seconds ? new Date(data.createdAt._seconds * 1000).toISOString() : (data.createdAt || new Date().toISOString())),
                estimatedDeliveryTime: data.estimatedDeliveryTime || 30,
            };
        });

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
