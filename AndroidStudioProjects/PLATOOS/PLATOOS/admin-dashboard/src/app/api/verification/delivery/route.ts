import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// GET pending delivery persons for verification
export async function GET() {
    try {
        // Fetch all delivery persons to handle cases where 'isVerified' field might be missing
        const snapshot = await db.collection(collections.deliveryPersons).get();

        const pendingPartners = snapshot.docs
            .map(doc => {
                const data = doc.data();
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
                    submittedAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
                    verificationStatus: 'pending',
                    isVerified: data.isVerified === true // Explicit check
                };
            })
            .filter(partner => !partner.isVerified); // Filter out verified ones in JS

        return NextResponse.json({ success: true, data: pendingPartners });
    } catch (error) {
        console.error('Verification delivery fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch pending delivery persons' },
            { status: 500 }
        );
    }
}

// PATCH to approve/reject delivery person
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { deliveryPersonId, action, notes } = body;

        if (!deliveryPersonId || !action) {
            return NextResponse.json(
                { success: false, error: 'Delivery person ID and action required' },
                { status: 400 }
            );
        }

        const updates: Record<string, unknown> = {
            updatedAt: Timestamp.now(),
            verifiedAt: Timestamp.now(),
            verificationNotes: notes || '',
        };

        if (action === 'approve') {
            updates.isVerified = true;
            updates.verificationStatus = 'approved';
        } else if (action === 'reject') {
            updates.isVerified = false;
            updates.verificationStatus = 'rejected';
        }

        await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update(updates);

        return NextResponse.json({
            success: true,
            message: `Delivery person ${action === 'approve' ? 'approved' : 'rejected'}`
        });
    } catch (error) {
        console.error('Delivery verification error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update delivery person verification' },
            { status: 500 }
        );
    }
}
