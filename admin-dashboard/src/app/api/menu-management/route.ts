import { NextResponse } from 'next/server';
import { db, collections, cachedCollection, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * GET /api/menu-management
 * Fetch all menu items with vendor info, grouped by verification status
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const statusFilter = searchParams.get('status'); // pending, approved, rejected, all
        const vendorFilter = searchParams.get('vendorId');

        // Get all menu items
        const allItems = await cachedCollection(collections.menuItems, 30_000);

        // Get vendor details
        const vendorIds = new Set<string>();
        allItems.forEach(item => {
            if (item.vendorId) vendorIds.add(item.vendorId as string);
        });

        const vendorMap: Record<string, { shopName: string; fullName: string; isOnline: boolean; isVerified: boolean }> = {};
        if (vendorIds.size > 0) {
            const allVendors = await cachedCollection(collections.vendors);
            allVendors.forEach(v => {
                if (vendorIds.has(v.id)) {
                    vendorMap[v.id] = {
                        shopName: (v.shopName || '') as string,
                        fullName: (v.fullName || '') as string,
                        isOnline: (v.isOnline || false) as boolean,
                        isVerified: (v.isVerified || false) as boolean,
                    };
                }
            });
        }

        let items = allItems.map(item => {
            const vendor = vendorMap[item.vendorId as string] || { shopName: '', fullName: '', isOnline: false, isVerified: false };
            return {
                itemId: item.id,
                vendorId: (item.vendorId || '') as string,
                vendorName: vendor.shopName || vendor.fullName,
                vendorOnline: vendor.isOnline,
                vendorVerified: vendor.isVerified,
                name: (item.name || '') as string,
                description: (item.description || '') as string,
                price: (item.price || 0) as number,
                originalPrice: (item.originalPrice || item.price || 0) as number,
                adminApprovedPrice: (item.adminApprovedPrice || null) as number | null,
                imageUrl: (item.imageUrl || '') as string,
                categoryName: (item.categoryName || '') as string,
                categoryId: (item.categoryId || '') as string,
                isVeg: (item.isVeg || false) as boolean,
                isAvailable: item.isAvailable !== false,
                isBestSeller: (item.isBestSeller || false) as boolean,
                discount: (item.discount || 0) as number,
                preparationTime: (item.preparationTime || 0) as number,
                verificationStatus: (item.verificationStatus || 'approved') as string,
                adminNotes: (item.adminNotes || '') as string,
                rejectionReason: (item.rejectionReason || '') as string,
                submittedAt: item.submittedAt?.toDate?.()?.toISOString() || item.createdAt?.toDate?.()?.toISOString() || '',
                approvedAt: item.approvedAt?.toDate?.()?.toISOString() || '',
                updatedAt: item.updatedAt?.toDate?.()?.toISOString() || '',
            };
        });

        // Apply filters
        if (statusFilter && statusFilter !== 'all') {
            items = items.filter(item => item.verificationStatus === statusFilter);
        }
        if (vendorFilter) {
            items = items.filter(item => item.vendorId === vendorFilter);
        }

        // Sort: pending first, then by submission date
        items.sort((a, b) => {
            if (a.verificationStatus === 'pending' && b.verificationStatus !== 'pending') return -1;
            if (a.verificationStatus !== 'pending' && b.verificationStatus === 'pending') return 1;
            return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
        });

        // Summary counts
        const summary = {
            total: allItems.length,
            pending: allItems.filter(i => i.verificationStatus === 'pending').length,
            approved: allItems.filter(i => !i.verificationStatus || i.verificationStatus === 'approved').length,
            rejected: allItems.filter(i => i.verificationStatus === 'rejected').length,
        };

        return NextResponse.json({ success: true, data: { items, summary } });
    } catch (error) {
        console.error('Menu management fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch menu items' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/menu-management
 * Admin approves/rejects a menu item, optionally changing price
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { itemId, action, adminApprovedPrice, adminNotes, rejectionReason } = body;

        if (!itemId || !action) {
            return NextResponse.json(
                { success: false, error: 'Item ID and action are required' },
                { status: 400 }
            );
        }

        if (!['approve', 'reject', 'request_changes'].includes(action)) {
            return NextResponse.json(
                { success: false, error: 'Invalid action. Must be approve, reject, or request_changes' },
                { status: 400 }
            );
        }

        const itemRef = db.collection(collections.menuItems).doc(itemId);
        const itemDoc = await itemRef.get();

        if (!itemDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Menu item not found' },
                { status: 404 }
            );
        }

        const itemData = itemDoc.data()!;
        const updates: Record<string, unknown> = {
            updatedAt: Timestamp.now(),
        };

        if (action === 'approve') {
            updates.verificationStatus = 'approved';
            updates.approvedAt = Timestamp.now();
            updates.isAvailable = true;
            updates.adminNotes = adminNotes || '';
            updates.rejectionReason = '';

            // If admin changed the price
            if (adminApprovedPrice !== undefined && adminApprovedPrice !== null && adminApprovedPrice > 0) {
                updates.adminApprovedPrice = adminApprovedPrice;
                updates.originalPrice = itemData.price; // Save original vendor price
                updates.price = adminApprovedPrice; // Set new price
                updates.priceChangedByAdmin = true;
            }
        } else if (action === 'reject') {
            updates.verificationStatus = 'rejected';
            updates.rejectionReason = rejectionReason || 'Does not meet platform standards';
            updates.adminNotes = adminNotes || '';
            updates.isAvailable = false; // Hide from customer app
        } else if (action === 'request_changes') {
            updates.verificationStatus = 'changes_requested';
            updates.adminNotes = adminNotes || 'Please make changes and resubmit';
            updates.isAvailable = false;
        }

        await itemRef.update(updates);

        // Also update in vendor's subcollection if it exists
        if (itemData.vendorId) {
            try {
                const subRef = db.collection(collections.vendors)
                    .doc(itemData.vendorId)
                    .collection('menuItems')
                    .doc(itemId);
                const subDoc = await subRef.get();
                if (subDoc.exists) {
                    await subRef.update(updates);
                }
            } catch {
                // Subcollection may not exist
            }
        }

        invalidateCache(collections.menuItems);

        return NextResponse.json({
            success: true,
            message: action === 'approve'
                ? 'Menu item approved successfully'
                : action === 'reject'
                    ? 'Menu item rejected'
                    : 'Changes requested from vendor',
        });
    } catch (error) {
        console.error('Menu management update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update menu item' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/menu-management
 * Bulk actions on menu items
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { action, itemIds, adminNotes } = body;

        if (!action || !itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Action and item IDs array are required' },
                { status: 400 }
            );
        }

        const batch = db.batch();
        const now = Timestamp.now();

        for (const itemId of itemIds) {
            const itemRef = db.collection(collections.menuItems).doc(itemId);

            if (action === 'approve_all') {
                batch.update(itemRef, {
                    verificationStatus: 'approved',
                    approvedAt: now,
                    isAvailable: true,
                    adminNotes: adminNotes || '',
                    rejectionReason: '',
                    updatedAt: now,
                });
            } else if (action === 'reject_all') {
                batch.update(itemRef, {
                    verificationStatus: 'rejected',
                    isAvailable: false,
                    adminNotes: adminNotes || 'Bulk rejected by admin',
                    updatedAt: now,
                });
            }
        }

        await batch.commit();
        invalidateCache(collections.menuItems);

        return NextResponse.json({
            success: true,
            message: `${itemIds.length} items ${action === 'approve_all' ? 'approved' : 'rejected'} successfully`,
        });
    } catch (error) {
        console.error('Bulk menu action error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process bulk action' },
            { status: 500 }
        );
    }
}

