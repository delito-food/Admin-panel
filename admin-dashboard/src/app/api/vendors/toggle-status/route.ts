import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * PATCH /api/vendors/toggle-status
 * Admin toggles vendor online/offline status
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, isOnline, reason, adminId } = body;

        if (!vendorId || typeof isOnline !== 'boolean') {
            return NextResponse.json(
                { success: false, error: 'Vendor ID and isOnline status are required' },
                { status: 400 }
            );
        }

        // Verify vendor exists
        const vendorRef = db.collection(collections.vendors).doc(vendorId);
        const vendorDoc = await vendorRef.get();

        if (!vendorDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Vendor not found' },
                { status: 404 }
            );
        }

        const vendorData = vendorDoc.data()!;

        // Update vendor status
        const updates: Record<string, unknown> = {
            isOnline,
            updatedAt: Timestamp.now(),
            statusChangedByAdmin: true,
            statusChangeReason: reason || (isOnline ? 'Set online by admin' : 'Set offline by admin'),
            statusChangedAt: Timestamp.now(),
            statusChangedBy: adminId || 'admin',
        };

        // If forcing offline, add admin override flag
        if (!isOnline) {
            updates.adminForceOffline = true;
        } else {
            updates.adminForceOffline = false;
        }

        await vendorRef.update(updates);

        invalidateCache(collections.vendors);

        return NextResponse.json({
            success: true,
            message: `Vendor ${vendorData.shopName || vendorData.fullName} is now ${isOnline ? 'ONLINE' : 'OFFLINE'}`,
            data: {
                vendorId,
                shopName: vendorData.shopName || vendorData.fullName || '',
                isOnline,
            },
        });
    } catch (error) {
        console.error('Vendor toggle status error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update vendor status' },
            { status: 500 }
        );
    }
}

