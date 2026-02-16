import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// GET pending vendors for verification (with menu items)
export async function GET() {
    try {
        const snapshot = await db.collection(collections.vendors)
            .where('isVerified', '==', false)
            .get();

        // Get all menu items for pending vendors
        const vendorIds = snapshot.docs.map(doc => doc.id);
        const menuItemsMap: Record<string, Array<{
            itemId: string;
            name: string;
            description: string;
            price: number;
            categoryName: string;
            imageUrl: string;
            isVeg: boolean;
            isBestSeller: boolean;
            preparationTime: number;
            discount: number;
            isVerified: boolean;
            verificationStatus: string;
            verificationNotes: string;
        }>> = {};

        if (vendorIds.length > 0) {
            // Firestore 'in' queries support max 30 items per batch
            const batches = [];
            for (let i = 0; i < vendorIds.length; i += 30) {
                batches.push(vendorIds.slice(i, i + 30));
            }

            for (const batch of batches) {
                const menuSnapshot = await db.collection(collections.menuItems)
                    .where('vendorId', 'in', batch)
                    .get();

                menuSnapshot.docs.forEach(doc => {
                    const data = doc.data();
                    const vendorId = data.vendorId;
                    if (!menuItemsMap[vendorId]) menuItemsMap[vendorId] = [];
                    menuItemsMap[vendorId].push({
                        itemId: doc.id,
                        name: data.name || '',
                        description: data.description || '',
                        price: data.price || 0,
                        categoryName: data.categoryName || 'Uncategorized',
                        imageUrl: data.imageUrl || '',
                        isVeg: data.isVeg ?? true,
                        isBestSeller: data.isBestSeller || false,
                        preparationTime: data.preparationTime || 0,
                        discount: data.discount || 0,
                        isVerified: data.isVerified || false,
                        verificationStatus: data.verificationStatus || 'pending',
                        verificationNotes: data.verificationNotes || '',
                    });
                });
            }
        }

        const pendingVendors = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                vendorId: doc.id,
                fullName: data.fullName || '',
                shopName: data.shopName || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                address: data.address || '',
                city: data.city || '',
                pincode: data.pincode || '',
                gstNumber: data.gstNumber || '',
                fssaiLicense: data.fssaiLicense || '',
                fssaiLicenseUrl: data.fssaiLicenseUrl || '',
                gstDocumentUrl: data.gstDocumentUrl || '',
                profileImageUrl: data.profileImageUrl || '',
                shopImageUrl: data.shopImageUrl || data.profileImageUrl || '',
                cuisineTypes: data.cuisineTypes || [],
                // Bank info (if available in Firestore)
                bankAccountNumber: data.bankAccountNumber || '',
                bankName: data.bankName || '',
                ifscCode: data.ifscCode || '',
                upiId: data.upiId || '',
                // Menu items for this vendor
                menuItems: menuItemsMap[doc.id] || [],
                submittedAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
                verificationStatus: 'pending',
            };
        });

        return NextResponse.json({ success: true, data: pendingVendors });
    } catch (error) {
        console.error('Verification vendors fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch pending vendors' },
            { status: 500 }
        );
    }
}

// PATCH to approve/reject vendor
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, action, notes } = body;

        if (!vendorId || !action) {
            return NextResponse.json(
                { success: false, error: 'Vendor ID and action required' },
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
            updates.isOnline = true;  // Set online when approved so vendor appears to customers
            updates.hasCompletedSetup = true;  // Mark setup as complete
        } else if (action === 'reject') {
            updates.isVerified = false;
            updates.verificationStatus = 'rejected';
            updates.isOnline = false;  // Ensure offline when rejected
        }

        await db.collection(collections.vendors).doc(vendorId).update(updates);

        return NextResponse.json({
            success: true,
            message: `Vendor ${action === 'approve' ? 'approved' : 'rejected'}`
        });
    } catch (error) {
        console.error('Vendor verification error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update vendor verification' },
            { status: 500 }
        );
    }
}
