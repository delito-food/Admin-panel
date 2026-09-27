import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';

/**
 * POST /api/menu-management/vendor/[vendorId]/categories/reorder
 * Body: { orderedCategoryIds: string[] }
 *
 * The category at index i gets sortOrder = i — the same convention the vendor
 * app uses (MenuRepository.updateCategorySortOrders), so both stay in sync.
 * Writes ONLY sortOrder + updatedAt; every other category field is untouched.
 */
async function handlePOST(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const { vendorId } = await context.params;
        if (!vendorId) {
            return NextResponse.json({ success: false, error: 'Vendor ID is required' }, { status: 400 });
        }

        let body: { orderedCategoryIds?: unknown };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
        }

        const raw = body.orderedCategoryIds;
        if (!Array.isArray(raw) || raw.length === 0 || !raw.every(id => typeof id === 'string' && id.trim())) {
            return NextResponse.json({ success: false, error: 'orderedCategoryIds must be a non-empty string array' }, { status: 400 });
        }
        const ids = Array.from(new Set((raw as string[]).map(id => id.trim())));

        // Every id must be one of this vendor's categories.
        const snap = await db.collection(collections.categories).where('vendorId', '==', vendorId).get();
        const owned = new Set(snap.docs.map(d => d.id));
        const foreign = ids.filter(id => !owned.has(id));
        if (foreign.length > 0) {
            return NextResponse.json({ success: false, error: 'Some categories do not belong to this vendor — refresh and retry' }, { status: 400 });
        }

        // Categories that exist but were not sent keep their relative order, after the sent ones.
        const missing = snap.docs
            .filter(d => !ids.includes(d.id))
            .sort((a, b) => (Number(a.data().sortOrder) || 0) - (Number(b.data().sortOrder) || 0))
            .map(d => d.id);
        const finalOrder = [...ids, ...missing];

        const subRefs = finalOrder.map(id =>
            db.collection(collections.vendors).doc(vendorId).collection('categories').doc(id)
        );
        const subSnaps = await db.getAll(subRefs);

        const now = Timestamp.now();
        const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
        finalOrder.forEach((id, index) => {
            const data = { sortOrder: index, updatedAt: now };
            writes.push({ ref: db.collection(collections.categories).doc(id), data });
            if (subSnaps[index]?.exists) writes.push({ ref: subRefs[index], data });
        });

        for (let i = 0; i < writes.length; i += 450) {
            const batch = db.batch();
            writes.slice(i, i + 450).forEach(w => batch.update(w.ref, w.data));
            await batch.commit();
        }

        invalidateCache(collections.categories);
        return NextResponse.json({ success: true, message: 'Category order saved', data: finalOrder });
    } catch (error) {
        console.error('Reorder vendor categories error:', error);
        return NextResponse.json({ success: false, error: 'Failed to save category order' }, { status: 500 });
    }
}

// ── Auth ──
export const POST = withAdmin(handlePOST);
