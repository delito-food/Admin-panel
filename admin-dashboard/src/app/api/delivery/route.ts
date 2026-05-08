import { NextResponse } from 'next/server';
import { db, collections, cachedCollection, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Get all delivery persons (cached)
        const deliveryDocs = await cachedCollection(collections.deliveryPersons);

        // Get all orders to calculate earnings (cached)
        const orderDocs = await cachedCollection(collections.orders);

        // Build a map of delivery partner earnings from orders
        const deliveryEarnings: Record<string, {
            totalEarnings: number;
            totalDeliveries: number;
            incentives: number;
            codCollected: number;
            codSettled: number;
        }> = {};

        orderDocs.forEach(order => {
            const deliveryPersonId = order.deliveryPersonId as string;
            if (!deliveryPersonId) return;

            if (!deliveryEarnings[deliveryPersonId]) {
                deliveryEarnings[deliveryPersonId] = {
                    totalEarnings: 0,
                    totalDeliveries: 0,
                    incentives: 0,
                    codCollected: 0,
                    codSettled: 0
                };
            }

            // Only count completed/delivered orders
            if (order.status === 'Delivered' || order.status === 'Completed' ||
                order.status === 'delivered' || order.status === 'completed') {
                deliveryEarnings[deliveryPersonId].totalDeliveries += 1;

                // Calculate delivery person earnings: Base ₹10 + ₹6.5/km, min ₹15
                const distanceKm = Number(order.distanceKm || 0);
                const deliveryPersonEarning = Number(order.deliveryPersonEarnings || 0) ||
                    (distanceKm > 0 ? Math.max(15, Math.round((10 + distanceKm * 6.5) * 10) / 10) : 15);
                deliveryEarnings[deliveryPersonId].totalEarnings += deliveryPersonEarning;

                // Calculate incentives (e.g., bonus for completing orders)
                const incentive = Number(order.deliveryIncentive || 0);
                deliveryEarnings[deliveryPersonId].incentives += incentive;

                // Track COD collection (field is paymentMode, not paymentMethod)
                const paymentMode = String(order.paymentMode || '').toLowerCase();
                if (paymentMode === 'cod' || paymentMode === 'cash' || paymentMode === 'cash on delivery') {
                    const codAmount = Number(order.total || 0);
                    deliveryEarnings[deliveryPersonId].codCollected += codAmount;

                    // Check if COD is settled
                    if (order.codSettled) {
                        deliveryEarnings[deliveryPersonId].codSettled += codAmount;
                    }
                }
            }
        });

        const deliveryPersons = deliveryDocs.map(data => {
            const earnings = deliveryEarnings[data.id] || {
                totalEarnings: 0,
                totalDeliveries: 0,
                incentives: 0,
                codCollected: 0,
                codSettled: 0
            };

            return {
                deliveryPersonId: data.id,
                fullName: (data.fullName || '') as string,
                email: (data.email || '') as string,
                phoneNumber: (data.phoneNumber || '') as string,
                address: (data.address || '') as string,
                city: (data.city || '') as string,
                pincode: (data.pincode || '') as string,
                vehicleType: (data.vehicleType || 'Bike') as string,
                vehicleNumber: (data.vehicleNumber || '') as string,
                driverLicenseNumber: (data.driverLicenseNumber || '') as string,
                driverLicenseUrl: (data.driverLicenseUrl || '') as string,
                vehicleDocumentUrl: (data.vehicleDocumentUrl || '') as string,
                profilePhotoUrl: (data.profilePhotoUrl || '') as string,
                bankName: (data.bankName || '') as string,
                bankAccountNumber: (data.bankAccountNumber || '') as string,
                ifscCode: (data.ifscCode || '') as string,
                upiId: (data.upiId || '') as string,
                rating: (data.rating || 0) as number,
                // Use Math.max so the stored (corrected) doc value is never ignored
                // when task-calculated values are lower (e.g. tasks lack distance data → ₹15 minimum)
                totalDeliveries: Math.max(earnings.totalDeliveries, (data.totalDeliveries as number) || 0),
                totalEarnings: Math.max(earnings.totalEarnings, (data.totalEarnings as number) || 0),
                incentives: earnings.incentives || (data.incentives as number) || 0,
                codCollected: earnings.codCollected || (data.codCollected as number) || 0,
                codSettled: earnings.codSettled || (data.codSettled as number) || 0,
                codPending: (earnings.codCollected - earnings.codSettled) || (data.codPending as number) || 0,
                isOnline: data.isOnline || false,
                isOnDelivery: data.isOnDelivery || false,
                isVerified: data.isVerified || false,
                isSuspended: data.isSuspended || false,
                suspensionReason: data.suspensionReason || '',
                currentLocation: data.currentLocation || 'Offline',
                registeredAt: data.createdAt || new Date().toISOString(),
                createdAt: data.createdAt || new Date().toISOString(),
                status: (data.isSuspended) ? 'suspended' : data.isVerified ? 'active' : 'pending',
            };
        });

        return NextResponse.json({ success: true, data: deliveryPersons });
    } catch (error) {
        console.error('Delivery persons fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch delivery persons' },
            { status: 500 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { deliveryPersonId, updates } = body;

        if (!deliveryPersonId) {
            return NextResponse.json(
                { success: false, error: 'Delivery person ID required' },
                { status: 400 }
            );
        }

        await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update({
            ...updates,
            updatedAt: Timestamp.now(),
        });

        invalidateCache(collections.deliveryPersons);

        return NextResponse.json({ success: true, message: 'Delivery person updated' });
    } catch (error) {
        console.error('Delivery person update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update delivery person' },
            { status: 500 }
        );
    }
}
