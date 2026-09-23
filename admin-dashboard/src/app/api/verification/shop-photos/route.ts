import { NextResponse } from 'next/server';
import { db, collections, sendPushNotification, uploadImage } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';

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
 *
 * ── What `shopImageUrl` means ──
 *
 * The customer app renders a vendor's cover as
 * `shopImageUrl.ifEmpty { profileImageUrl }` and never consults
 * shopImageStatus, so a photo is visible to customers from the moment the
 * vendor uploads it — approving here changed a flag nobody read. Until the
 * customer app is released with a status check, the only field that actually
 * controls what customers see is shopImageUrl itself.
 *
 * So this route treats shopImageUrl as "what customers are looking at right
 * now", and parks anything that should not be on screen in
 * shopImagePulledUrl:
 *
 *   reject  → photo moves to shopImagePulledUrl, customers fall back to the
 *             profile image. Previously a rejected photo stayed live.
 *   pull    → same move, but the submission stays in the pending queue. For a
 *             photo that needs to come down this second, ahead of any decision.
 *   approve → restores a parked photo into shopImageUrl.
 *
 * Nothing is ever deleted; the review queue keeps showing the parked photo, so
 * a pull is always reversible by approving.
 *
 * One consequence to know about: the vendor app treats a blank shopImageUrl as
 * an incomplete profile (ProfileCompletion.kt), so a vendor whose photo is
 * pulled or rejected is prompted to retake it. That is the intended outcome
 * for a rejection, and an acceptable one for a pull.
 */

type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** Largest admin-supplied replacement photo we accept. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
                // The photo to review is whichever one exists — a pulled or
                // rejected submission is parked, not discarded.
                reviewImageUrl: d.shopImageUrl || d.shopImagePulledUrl || '',
                shopImageStatus: d.shopImageStatus || '',
                shopImageReviewNote: d.shopImageReviewNote || '',
                shopImageSubmittedAt: toIso(d.shopImageSubmittedAt),
                shopImageReviewedAt: toIso(d.shopImageReviewedAt),
                // Whether customers can see this photo at this moment. True
                // for every unreviewed submission, which is the bug this
                // screen now makes visible.
                liveOnCustomerApp: !!d.shopImageUrl,
                // Set when an admin replaced the photo by hand.
                shopImageSource: d.shopImageSource || 'vendor',
                shopImageOverriddenBy: d.shopImageOverriddenBy || '',
                shopImageOverriddenAt: toIso(d.shopImageOverriddenAt),
            };
        }).sort((a, b) => (b.shopImageSubmittedAt || '').localeCompare(a.shopImageSubmittedAt || ''));

        return NextResponse.json({ success: true, data: vendors });
    } catch (error) {
        console.error('Shop photo review fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch shop photos' }, { status: 500 });
    }
}

// PATCH { vendorId, action: 'approve' | 'reject' | 'pull', note? }
async function handlePATCH(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, action, note } = body as { vendorId?: string; action?: string; note?: string };

        if (!vendorId || typeof vendorId !== 'string') {
            return NextResponse.json({ success: false, error: 'Vendor ID required' }, { status: 400 });
        }
        if (action !== 'approve' && action !== 'reject' && action !== 'pull') {
            return NextResponse.json({ success: false, error: 'Action must be approve, reject or pull' }, { status: 400 });
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

            const liveUrl = (data.shopImageUrl as string) || '';
            const parkedUrl = (data.shopImagePulledUrl as string) || '';
            if (!liveUrl && !parkedUrl) {
                return { ok: false as const, error: 'This vendor has no outlet photo' };
            }

            const update: Record<string, unknown> = {
                shopImageReviewedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (action === 'approve') {
                // Put the photo back on customer screens if it was parked.
                update.shopImageStatus = 'approved';
                update.shopImageReviewNote = '';
                if (!liveUrl && parkedUrl) {
                    update.shopImageUrl = parkedUrl;
                    update.shopImagePulledUrl = FieldValue.delete();
                }
            } else if (action === 'reject') {
                // Take it down as well as marking it rejected. Leaving a
                // rejected photo in shopImageUrl left it on customer screens
                // indefinitely.
                update.shopImageStatus = 'rejected';
                update.shopImageReviewNote = cleanNote;
                if (liveUrl) {
                    update.shopImagePulledUrl = liveUrl;
                    update.shopImageUrl = '';
                }
            } else {
                // Pull: off customer screens now, decision deferred. The
                // status is untouched so it stays in the same review queue.
                if (!liveUrl) {
                    return { ok: false as const, error: 'This photo is already off the customer app' };
                }
                update.shopImagePulledUrl = liveUrl;
                update.shopImageUrl = '';
                // A pull is not a review decision, so don't stamp one.
                delete update.shopImageReviewedAt;
            }

            tx.update(ref, update);
            return { ok: true as const, shopName: (data.shopName as string) || '' };
        });

        if (!result.ok) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        // Tell the vendor. Non-urgent type, so the vendor app shows an ordinary
        // notification and never the new-order ring. A pull is silent — it is
        // a holding action, and the vendor hears from us when it is decided.
        if (action === 'approve' || action === 'reject') {
            await sendPushNotification(
                'vendor',
                vendorId,
                action === 'approve' ? 'Outlet photo approved' : 'Outlet photo not accepted',
                action === 'approve'
                    ? 'Your shop front photo has been approved.'
                    : `Please retake your shop front photo: ${cleanNote}`,
                { type: 'shop_photo_review' }
            );
        }

        const messages = {
            approve: 'Outlet photo approved and live',
            reject: 'Outlet photo rejected and removed from the customer app',
            pull: 'Outlet photo removed from the customer app',
        } as const;

        return NextResponse.json({ success: true, message: messages[action] });
    } catch (error) {
        console.error('Shop photo review update error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update shop photo review' }, { status: 500 });
    }
}

/**
 * POST — admin replaces a vendor's outlet photo by hand (multipart form).
 *
 * Fields: vendorId, file.
 *
 * For the cases review alone can't solve: the vendor keeps submitting
 * something unusable, or ops has a good shop-front photo taken during
 * onboarding. The replacement goes live immediately and is marked as
 * admin-sourced so the next person can see the photo on screen is not the
 * vendor's own submission.
 */
async function handlePOST(request: Request, _context: unknown, auth: AdminResult) {
    try {
        const form = await request.formData();
        const vendorId = form.get('vendorId');
        const file = form.get('file');

        if (typeof vendorId !== 'string' || !vendorId) {
            return NextResponse.json({ success: false, error: 'Vendor ID required' }, { status: 400 });
        }
        if (!(file instanceof File)) {
            return NextResponse.json({ success: false, error: 'An image file is required' }, { status: 400 });
        }
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return NextResponse.json(
                { success: false, error: 'Photo must be a JPEG, PNG or WebP image' },
                { status: 400 }
            );
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { success: false, error: 'Photo must be under 4 MB' },
                { status: 400 }
            );
        }

        const ref = db.collection(collections.vendors).doc(vendorId);
        const snap = await ref.get();
        if (!snap.exists) {
            return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 });
        }

        const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
        const buffer = Buffer.from(await file.arrayBuffer());
        const url = await uploadImage(
            `vendor_profiles/${vendorId}/outlet_admin_${Date.now()}.${extension}`,
            buffer,
            file.type
        );

        await ref.update({
            shopImageUrl: url,
            shopImageStatus: 'approved',
            shopImageReviewNote: '',
            shopImageReviewedAt: FieldValue.serverTimestamp(),
            shopImagePulledUrl: FieldValue.delete(),
            // Audit trail — who replaced it, and that it wasn't the vendor.
            shopImageSource: 'admin',
            shopImageOverriddenBy: auth.email || auth.uid || 'admin',
            shopImageOverriddenAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await sendPushNotification(
            'vendor',
            vendorId,
            'Outlet photo updated',
            'The Delito team has set the shop front photo shown to customers.',
            { type: 'shop_photo_review' }
        );

        return NextResponse.json({
            success: true,
            message: 'Outlet photo replaced and live',
            data: { shopImageUrl: url },
        });
    } catch (error) {
        console.error('Shop photo override error:', error);
        const message = error instanceof Error && error.message.includes('storage bucket')
            ? error.message
            : 'Failed to replace outlet photo';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node runtime.
export const GET = withAdmin(handleGET);
export const PATCH = withAdmin(handlePATCH);
export const POST = withAdmin(handlePOST);
