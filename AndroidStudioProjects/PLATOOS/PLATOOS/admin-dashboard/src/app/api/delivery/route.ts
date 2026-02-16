import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Get all delivery persons
        const deliverySnapshot = await db.collection(collections.deliveryPersons).get();

        // Get all orders to calculate earnings per delivery partner
        const ordersSnapshot = await db.collection(collections.orders).get();

        // Build a map of delivery partner earnings from orders
        const deliveryEarnings: Record<string, {
            totalEarnings: number;
            totalDeliveries: number;
            incentives: number;
            codCollected: number;
            codSettled: number;
        }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const deliveryPersonId = order.deliveryPersonId;
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
            if (order.status === 'Delivered' || order.status === 'Completed') {
                deliveryEarnings[deliveryPersonId].totalDeliveries += 1;

                // Calculate delivery fee as earnings (assume ₹30 per delivery or from order)
                const deliveryFee = order.deliveryFee || order.deliveryCharges || 30;
                deliveryEarnings[deliveryPersonId].totalEarnings += deliveryFee;

                // Calculate incentives (e.g., bonus for completing orders)
                const incentive = order.deliveryIncentive || 0;
                deliveryEarnings[deliveryPersonId].incentives += incentive;

                // Track COD collection
                if (order.paymentMethod === 'COD' || order.paymentMethod === 'Cash') {
                    const codAmount = order.total || order.grandTotal || 0;
                    deliveryEarnings[deliveryPersonId].codCollected += codAmount;

                    // Check if COD is settled
                    if (order.codSettled) {
                        deliveryEarnings[deliveryPersonId].codSettled += codAmount;
                    }
                }
            }
        });

        const deliveryPersons = deliverySnapshot.docs.map(doc => {
            const data = doc.data();
            const earnings = deliveryEarnings[doc.id] || {
                totalEarnings: 0,
                totalDeliveries: 0,
                incentives: 0,
                codCollected: 0,
                codSettled: 0
            };

            return {
                deliveryPersonId: doc.id,
                fullName: data.fullName || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                address: data.address || '',
                city: data.city || '',
                pincode: data.pincode || '',
                vehicleType: data.vehicleType || 'Bike',
                vehicleNumber: data.vehicleNumber || '',
                driverLicenseNumber: data.driverLicenseNumber || '',
                driverLicenseUrl: data.driverLicenseUrl || '',
                vehicleDocumentUrl: data.vehicleDocumentUrl || '',
                profilePhotoUrl: data.profilePhotoUrl || '',
                bankName: data.bankName || '',
                bankAccountNumber: data.bankAccountNumber || '',
                ifscCode: data.ifscCode || '',
                upiId: data.upiId || '',
                rating: data.rating || 0,
                // Use calculated values or fallback to stored values
                totalDeliveries: earnings.totalDeliveries || data.totalDeliveries || 0,
                totalEarnings: earnings.totalEarnings || data.totalEarnings || 0,
                incentives: earnings.incentives || data.incentives || 0,
                codCollected: earnings.codCollected || data.codCollected || 0,
                codSettled: earnings.codSettled || data.codSettled || 0,
                codPending: (earnings.codCollected - earnings.codSettled) || data.codPending || 0,
                isOnline: data.isOnline || false,
                isOnDelivery: data.isOnDelivery || false,
                isVerified: data.isVerified || false,
                currentLocation: data.currentLocation || 'Offline',
                registeredAt: data.createdAt || new Date().toISOString(),
                createdAt: data.createdAt || new Date().toISOString(),
                status: data.isVerified ? 'active' : 'pending',
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

        return NextResponse.json({ success: true, message: 'Delivery person updated' });
    } catch (error) {
        console.error('Delivery person update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update delivery person' },
            { status: 500 }
        );
    }
}
