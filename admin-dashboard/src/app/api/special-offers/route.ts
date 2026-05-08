import { NextResponse } from 'next/server';
import { db, collections, cachedCollection, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * GET /api/special-offers
 * Fetch all special offers from BOTH collections (special_offers + specialOffers)
 * Vendors create in 'special_offers' (underscore), so we must read from there too
 */
export async function GET() {
    try {
        // Fetch from BOTH collections to ensure we catch all offers
        const [snapshotUnderscore, snapshotCamel] = await Promise.all([
            db.collection('special_offers').get(),
            db.collection(collections.specialOffers).get(),
        ]);

        // Track seen IDs to avoid duplicates
        const seenIds = new Set<string>();

        // Fetch vendor details
        const vendorIds = new Set<string>();
        const allDocs = [...snapshotUnderscore.docs, ...snapshotCamel.docs];
        allDocs.forEach(doc => {
            const data = doc.data();
            if (data.vendorId) vendorIds.add(data.vendorId);
        });

        const vendorMap: Record<string, string> = {};
        if (vendorIds.size > 0) {
            const allVendors = await cachedCollection(collections.vendors);
            allVendors.forEach(v => {
                if (vendorIds.has(v.id)) {
                    vendorMap[v.id] = (v.shopName || v.fullName || '') as string;
                }
            });
        }

        const offers = allDocs
            .filter(doc => {
                if (seenIds.has(doc.id)) return false;
                seenIds.add(doc.id);
                return true;
            })
            .map(doc => {
            const data = doc.data();
            return {
                offerId: doc.id,
                vendorId: data.vendorId || '',
                vendorName: vendorMap[data.vendorId] || data.vendorName || '',
                title: data.title || data.name || '',
                description: data.description || '',
                imageUrl: data.imageUrl || data.bannerImageUrl || '',
                bannerImageUrl: data.bannerImageUrl || data.imageUrl || '',
                discount: data.discount || data.discountPercentage || 0,
                discountType: data.discountType || (data.discountPercentage ? 'percentage' : 'flat'),
                minOrderAmount: data.minOrderAmount || data.minOrderValue || 0,
                maxDiscount: data.maxDiscount || data.maxDiscountAmount || 0,
                promoCode: data.promoCode || '',
                isActive: data.isActive !== false,
                startDate: data.startDate?.toDate?.()?.toISOString() || data.startDate || '',
                endDate: data.endDate?.toDate?.()?.toISOString() || data.validUntil?.toDate?.()?.toISOString() || data.endDate || '',
                createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
            };
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return NextResponse.json({ success: true, data: offers });
    } catch (error) {
        console.error('Special offers fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch special offers' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/special-offers
 * Admin updates a special offer (including banner image)
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { offerId, updates } = body;

        if (!offerId) {
            return NextResponse.json(
                { success: false, error: 'Offer ID is required' },
                { status: 400 }
            );
        }

        const offerRef = db.collection('special_offers').doc(offerId);
        const offerDoc = await offerRef.get();

        // Also check camelCase collection
        const offerRefCamel = db.collection(collections.specialOffers).doc(offerId);
        const offerDocCamel = await offerRefCamel.get();

        if (!offerDoc.exists && !offerDocCamel.exists) {
            return NextResponse.json(
                { success: false, error: 'Special offer not found' },
                { status: 404 }
            );
        }

        // Build safe update object
        const safeUpdates: Record<string, unknown> = {};
        const allowedFields = [
            'title', 'description', 'imageUrl', 'bannerImageUrl',
            'discount', 'discountType', 'minOrderAmount', 'maxDiscount',
            'promoCode', 'isActive', 'startDate', 'endDate',
        ];

        for (const key of allowedFields) {
            if (updates[key] !== undefined) {
                safeUpdates[key] = updates[key];
            }
        }

        // If imageUrl is updated, also update bannerImageUrl and vice versa
        if (safeUpdates.imageUrl && !safeUpdates.bannerImageUrl) {
            safeUpdates.bannerImageUrl = safeUpdates.imageUrl;
        }
        if (safeUpdates.bannerImageUrl && !safeUpdates.imageUrl) {
            safeUpdates.imageUrl = safeUpdates.bannerImageUrl;
        }

        safeUpdates.updatedAt = Timestamp.now();
        safeUpdates.lastEditedByAdmin = true;

        // Update in both collections (vendor creates in special_offers, admin may use either)
        if (offerDoc.exists) {
            await offerRef.update(safeUpdates);
        }
        if (offerDocCamel.exists) {
            await offerRefCamel.update(safeUpdates);
        }

        invalidateCache(collections.specialOffers);
        invalidateCache('special_offers');

        return NextResponse.json({
            success: true,
            message: 'Special offer updated successfully',
        });
    } catch (error) {
        console.error('Special offer update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update special offer' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/special-offers
 * Admin deletes a special offer
 */
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const offerId = searchParams.get('offerId');

        if (!offerId) {
            return NextResponse.json(
                { success: false, error: 'Offer ID is required' },
                { status: 400 }
            );
        }

        // Delete from both collections
        try {
            await db.collection('special_offers').doc(offerId).delete();
        } catch {
            // May not exist
        }
        try {
            await db.collection(collections.specialOffers).doc(offerId).delete();
        } catch {
            // May not exist
        }

        invalidateCache(collections.specialOffers);
        invalidateCache('special_offers');

        return NextResponse.json({
            success: true,
            message: 'Special offer deleted successfully',
        });
    } catch (error) {
        console.error('Special offer delete error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to delete special offer' },
            { status: 500 }
        );
    }
}






