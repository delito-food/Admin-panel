import { NextResponse } from 'next/server';
import { db, collections, sendPushNotification } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';

/**
 * Outlet (shop-front) photo review.
 *
 * Vendors submit these from the vendor app's Profile completion screen. The
 * vendor app writes shopImageUrl + shopImageStatus = 'pending'; firestore.rules
 * forbid a vendor client from setting any other status. Approve / reject happens
 * only here, through the Admin SDK.
 *
 * DELIBERATELY SEPARATE from /api/verification/vendors. That route's per-document
 * action recomputes the vendor's overall verification and, when everything is
 * approved, stamps isVerified / verifiedAt / isOnline = true. Almost every shop
 * submitting an outlet photo is ALREADY verified and trading, so going through
 * that path would reset verifiedAt and could force a closed shop online. This
 * route touches the shopImage* fields and nothing else.
 */

type ReviewStatus = 'pending' | 'approved' | 'rejected';

function toIso(value: unknown): string {
    if (value && typeof value === 'object' && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
        return (value as Timestamp).toDate().toISOString();
    }
    if (typeof value === 'string') return value;
    return '';
}

// GET ?status=pending|approved|rejected (default pending)
async function handleGET(request: Request) {
    try {
        const url = new URL(request.url);
        const requested = (url.searchParams.get('status') || 'pending') as ReviewStatus;
        const status: ReviewStatus = ['pending', 'approved', 'rejected'].includes(requested) ? requested : 'pending';

        // Single-field equality - served by Firestore's automatic index, nothing to deploy.
        const snapshot = await db.collection(collections.vendors)
            .where('shopImageStatus', '==', status)
            .limit(200)
            .get();

        const vendors = snapshot.docs.map(doc => {
            const d = doc.data();
            return {
                vendorId: doc.id,
                shopName: d.shopName || '',
                fullName: d.fullName || '',
                phoneNumber: d.phoneNumber || '',
                address: d.address || '',
                city: d.city || '',
                latitude: typeof d.latitude === 'number' ? d.latitude : 0,
                longitude: typeof d.longitude === 'number' ? d.longitude : 0,
                locationSource: d.locationSource || '',
                isVerified: d.isVerified === true,
                isOnline: d.isOnline === true,
                profileImageUrl: d.profileImageUrl || '',
                shopImageUrl: d.shopImageUrl || '',
                shopImageStatus: d.shopImageStatus || '',
                shopImageReviewNote: d.shopImageReviewNote || '',
                shopImageSubmittedAt: toIso(d.shopImageSubmittedAt),
                shopImageReviewedAt: toIso(d.shopImageReviewedAt),
            };
        }).sort((a, b) => (b.shopImageSubmittedAt || '').localeCompare(a.shopImageSubmittedAt || ''));

        return NextResponse.json({ success: true, data: vendors });
    } catch (error) {
        console.error('Shop photo review fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch shop photos' }, { status: 500 });
    }
}

// PATCH { vendorId, action: 'approve' | 'reject', note? }
async function handlePATCH(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, action, note } = body as { vendorId?: string; action?: string; note?: string };

        if (!vendorId || typeof vendorId !== 'string') {
            return NextResponse.json({ success: false, error: 'Vendor ID required' }, { status: 400 });
        }
        if (action !== 'approve' && action !== 'reject') {
            return NextResponse.json({ success: false, error: 'Action must be approve or reject' }, { status: 400 });
        }
        const cleanNote = typeof note === 'string' ? note.trim().slice(0, 300) : '';
        if (action === 'reject' && !cleanNote) {
            return NextResponse.json({ success: false, error: 'A reason is required to reject' }, { status: 400 });
        }

        const ref = db.collection(collections.vendors).doc(vendorId);
        const result = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) return { ok: false as const, error: 'Vendor not found' };
            const data = snap.data() || {};
            if (!data.shopImageUrl) return { ok: false as const, error: 'This vendor has no outlet photo' };

            tx.update(ref, {
                shopImageStatus: action === 'approve' ? 'approved' : 'rejected',
                shopImageReviewNote: action === 'approve' ? '' : cleanNote,
                shopImageReviewedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
            return { ok: true as const, shopName: (data.shopName as string) || '' };
        });

        if (!result.ok) {
            return NextResponse.json({ success: false, error: result.error }, { status: 404 });
        }

        // Tell the vendor. Non-urgent type, so the vendor app shows an ordinary
        // notification and never the new-order ring.
        await sendPushNotification(
            'vendor',
            vendorId,
            action === 'approve' ? 'Outlet photo approved' : 'Outlet photo not accepted',
            action === 'approve'
                ? 'Your shop front photo has been approved.'
                : `Please retake your shop front photo: ${cleanNote}`,
            { type: 'shop_photo_review' }
        );

        return NextResponse.json({
            success: true,
            message: action === 'approve' ? 'Outlet photo approved' : 'Outlet photo rejected',
        });
    } catch (error) {
        console.error('Shop photo review update error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update shop photo review' }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node runtime.
export const GET = withAdmin(handleGET);
export const PATCH = withAdmin(handlePATCH);
