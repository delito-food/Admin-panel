import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';

/**
 * POST /api/menu-management/vendor/[vendorId]/items/bulk-update
 *
 * One endpoint for the admin's bulk menu edits:
 *   - Price Manager   → { itemId, price, variantPrices? }
 *   - Move category   → { itemId, categoryId }
 *   - Availability    → { itemId, isAvailable }
 *
 * Only the fields named above are ever written — the item document is never
 * replaced — so vendor-side fields (tags, add-ons, images…) are untouched.
 *
 * Safety rules:
 *   - every item must exist and belong to this vendor, otherwise it is skipped
 *   - prices must be finite, > 0 and ≤ MAX_PRICE; stored rounded to 2 decimals
 *   - variant prices are matched by position against the variants already on
 *     the document, and only `price` on each variant is changed
 *   - the vendor sub-collection copy is updated only when it already exists
 *     (same behaviour as PATCH /api/menu-management)
 *   - price changes follow the approve-flow convention: price + adminApprovedPrice
 *     + priceChangedByAdmin, with originalPrice keeping the vendor's own price
 */

const MAX_ITEMS = 1000;
const MAX_PRICE = 100_000;
const WRITES_PER_BATCH = 450; // Firestore hard limit is 500

type UpdateInput = {
    itemId?: unknown;
    price?: unknown;
    variantPrices?: unknown;
    categoryId?: unknown;
    isAvailable?: unknown;
};

type Skipped = { itemId: string; reason: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

function isValidPrice(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_PRICE;
}

async function handlePOST(
    request: Request,
    context: { params: Promise<{ vendorId: string }> },
    auth: AdminResult
) {
    try {
        const { vendorId } = await context.params;
        if (!vendorId) {
            return NextResponse.json({ success: false, error: 'Vendor ID is required' }, { status: 400 });
        }

        let body: { updates?: unknown; source?: unknown };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
        }

        const rawUpdates = body.updates;
        if (!Array.isArray(rawUpdates) || rawUpdates.length === 0) {
            return NextResponse.json({ success: false, error: 'updates array is required' }, { status: 400 });
        }
        if (rawUpdates.length > MAX_ITEMS) {
            return NextResponse.json({ success: false, error: `At most ${MAX_ITEMS} items per request` }, { status: 400 });
        }

        const source = typeof body.source === 'string' ? body.source.slice(0, 40) : 'bulk_update';

        // De-duplicate by itemId (last one wins) and drop malformed rows.
        const byId = new Map<string, UpdateInput>();
        const skipped: Skipped[] = [];
        for (const u of rawUpdates as UpdateInput[]) {
            if (!u || typeof u.itemId !== 'string' || !u.itemId.trim()) {
                skipped.push({ itemId: String(u?.itemId ?? ''), reason: 'Missing itemId' });
                continue;
            }
            byId.set(u.itemId.trim(), u);
        }
        if (byId.size === 0) {
            return NextResponse.json({ success: false, error: 'No valid items to update', skipped }, { status: 400 });
        }

        // Categories are only needed when something is being moved.
        const needsCategories = Array.from(byId.values()).some(u => u.categoryId !== undefined);
        const categoryNames = new Map<string, string>();
        if (needsCategories) {
            const catSnap = await db.collection(collections.categories).where('vendorId', '==', vendorId).get();
            catSnap.docs.forEach(d => categoryNames.set(d.id, (d.data().name || '') as string));
        }

        const itemIds = Array.from(byId.keys());
        const topRefs = itemIds.map(id => db.collection(collections.menuItems).doc(id));
        const subRefs = itemIds.map(id =>
            db.collection(collections.vendors).doc(vendorId).collection('menuItems').doc(id)
        );
        const [topSnaps, subSnaps] = await Promise.all([db.getAll(topRefs), db.getAll(subRefs)]);

        const now = Timestamp.now();
        const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
        const audit: Record<string, unknown>[] = [];

        itemIds.forEach((itemId, idx) => {
            const input = byId.get(itemId)!;
            const snap = topSnaps[idx];
            if (!snap || !snap.exists) {
                skipped.push({ itemId, reason: 'Item not found' });
                return;
            }
            const data = snap.data() || {};
            if (data.vendorId !== vendorId) {
                skipped.push({ itemId, reason: 'Item does not belong to this vendor' });
                return;
            }

            const update: Record<string, unknown> = {};
            const auditRow: Record<string, unknown> = { itemId, name: data.name || '' };

            // ── Price ──
            if (input.price !== undefined) {
                if (!isValidPrice(input.price)) {
                    skipped.push({ itemId, reason: `Invalid price (must be > 0 and ≤ ${MAX_PRICE})` });
                    return;
                }
                const newPrice = round2(input.price);
                const oldPrice = Number(data.price) || 0;
                if (newPrice !== oldPrice) {
                    update.price = newPrice;
                    update.adminApprovedPrice = newPrice;
                    update.priceChangedByAdmin = true;
                    // Keep the vendor's own price the first time the admin overrides it.
                    const existingOriginal = Number(data.originalPrice) || 0;
                    update.originalPrice = data.priceChangedByAdmin === true && existingOriginal > 0
                        ? existingOriginal
                        : oldPrice;
                    auditRow.oldPrice = oldPrice;
                    auditRow.newPrice = newPrice;
                }
            }

            // ── Variant prices (matched by position) ──
            if (input.variantPrices !== undefined) {
                const existing = Array.isArray(data.variants) ? data.variants as Record<string, unknown>[] : [];
                const vp = input.variantPrices;
                if (!Array.isArray(vp) || vp.length !== existing.length) {
                    skipped.push({ itemId, reason: 'Variant list changed since the page was loaded — refresh and retry' });
                    return;
                }
                if (!vp.every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= MAX_PRICE)) {
                    skipped.push({ itemId, reason: 'Invalid variant price' });
                    return;
                }
                const changed = existing.some((v, i) => round2(vp[i] as number) !== (Number(v?.price) || 0));
                if (changed) {
                    update.variants = existing.map((v, i) => ({ ...v, price: round2(vp[i] as number) }));
                    auditRow.oldVariantPrices = existing.map(v => Number(v?.price) || 0);
                    auditRow.newVariantPrices = (vp as number[]).map(round2);
                }
            }

            // ── Category move ──
            if (input.categoryId !== undefined) {
                if (typeof input.categoryId !== 'string' || !categoryNames.has(input.categoryId)) {
                    skipped.push({ itemId, reason: 'Target category not found for this vendor' });
                    return;
                }
                if (input.categoryId !== data.categoryId) {
                    update.categoryId = input.categoryId;
                    update.categoryName = categoryNames.get(input.categoryId) || '';
                    auditRow.fromCategory = data.categoryName || '';
                    auditRow.toCategory = update.categoryName;
                }
            }

            // ── Availability ──
            if (input.isAvailable !== undefined) {
                if (typeof input.isAvailable !== 'boolean') {
                    skipped.push({ itemId, reason: 'isAvailable must be true or false' });
                    return;
                }
                if (input.isAvailable !== (data.isAvailable !== false)) {
                    update.isAvailable = input.isAvailable;
                    auditRow.isAvailable = input.isAvailable;
                }
            }

            if (Object.keys(update).length === 0) {
                skipped.push({ itemId, reason: 'No change' });
                return;
            }

            update.updatedAt = now;
            writes.push({ ref: topRefs[idx], data: update });
            if (subSnaps[idx]?.exists) {
                writes.push({ ref: subRefs[idx], data: update });
            }
            audit.push(auditRow);
        });

        // Commit in chunks under Firestore's 500-writes-per-batch limit.
        // (A normal vendor menu fits in a single batch.)
        for (let i = 0; i < writes.length; i += WRITES_PER_BATCH) {
            const batch = db.batch();
            writes.slice(i, i + WRITES_PER_BATCH).forEach(w => batch.update(w.ref, w.data));
            await batch.commit();
        }
        const committedItems = audit.length;

        if (committedItems > 0) {
            invalidateCache(collections.menuItems);

            // Best-effort audit trail — never fails the request.
            try {
                await db.collection('menuBulkUpdateLogs').add({
                    vendorId,
                    source,
                    adminUid: auth?.uid || '',
                    adminEmail: auth?.email || '',
                    itemCount: committedItems,
                    changes: audit.slice(0, 500),
                    createdAt: now,
                });
            } catch (e) {
                console.warn('menuBulkUpdateLogs write failed (non-fatal):', e);
            }
        }

        const realSkips = skipped.filter(s => s.reason !== 'No change');
        return NextResponse.json({
            success: true,
            updated: committedItems,
            unchanged: skipped.length - realSkips.length,
            skipped: realSkips,
            message: `${committedItems} item${committedItems === 1 ? '' : 's'} updated`
                + (realSkips.length ? `, ${realSkips.length} skipped` : ''),
        });
    } catch (error) {
        console.error('Bulk update vendor menu items error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update items' }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const POST = withAdmin(handlePOST);
