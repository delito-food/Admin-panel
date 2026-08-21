import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { verifyApiAuth, unauthorizedResponse } from '@/lib/api-auth';

/**
 * Hero Banner API
 * ────────────────────────────────────────────────────────────────────────────
 * Backs the green wavy hero canvas at the top of the customer app home screen.
 *
 * A banner stores the media plus a *transform*, not a pre-cropped file. The
 * customer app's hero box is `fillMaxWidth() x 390.dp`, so its aspect ratio is
 * different on every device (≈0.92 on a 360dp phone, ≈1.23 on a 480dp tablet).
 * There is no single crop that fits them all, so instead both the admin editor
 * and the app render the media with the identical formula:
 *
 *     1. cover-fit the media into the hero box  (CSS `object-fit: cover`
 *        === Compose `ContentScale.Crop`)
 *     2. scale by `zoom` about the box centre
 *     3. translate by (offsetX * boxWidth, offsetY * boxHeight)
 *
 * Because step 1 is cover, the media ALWAYS fills the box — letterboxing is
 * impossible. The offsets are clamped on both sides (editor and app) so panning
 * can never drag an empty edge into view.
 */

const COLLECTION = 'heroBanners';
const SETTINGS_COLLECTION = 'platformSettings';
const CONFIG_DOC = 'heroBannerConfig';

/** Keep in step with `DEFAULT_HEADER_TINT_OPACITY` in src/lib/hero-canvas.ts. */
const DEFAULT_HEADER_TINT_OPACITY = 1;

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const DEFAULT_CONFIG = {
    isEnabled: true,
    rotationSeconds: 6,
    // When true and no banner is active, the app falls back to the bundled
    // hero11/hero12 artwork rather than the plain "What are you craving?" text.
    fallbackToBundled: true,
};

export interface HeroBannerDoc {
    id: string;
    label: string;
    mediaUrl: string;
    mediaType: 'image' | 'gif';
    naturalWidth: number;
    naturalHeight: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
    isActive: boolean;
    sortOrder: number;
    startAt: string | null;
    endAt: string | null;
    linkType: 'none' | 'vendor' | 'category' | 'url';
    linkValue: string;
    /** Per-banner header bar colour. Empty = the app keeps its own green. */
    headerColor: string;
    headerOpacity: number;
    createdAt: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
}

function toIso(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    const maybeTs = value as { toDate?: () => Date };
    if (typeof maybeTs.toDate === 'function') return maybeTs.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function normalise(id: string, data: FirebaseFirestore.DocumentData): HeroBannerDoc {
    return {
        id,
        label: data.label || 'Untitled banner',
        mediaUrl: data.mediaUrl || '',
        mediaType: data.mediaType === 'gif' ? 'gif' : 'image',
        naturalWidth: Number(data.naturalWidth) || 0,
        naturalHeight: Number(data.naturalHeight) || 0,
        zoom: clampNumber(data.zoom, 1, 4, 1),
        offsetX: clampNumber(data.offsetX, -1, 1, 0),
        offsetY: clampNumber(data.offsetY, -1, 1, 0),
        isActive: data.isActive !== false,
        sortOrder: Number(data.sortOrder) || 0,
        startAt: toIso(data.startAt),
        endAt: toIso(data.endAt),
        linkType: data.linkType || 'none',
        linkValue: data.linkValue || '',
        headerColor: HEX_COLOR.test(String(data.headerColor || '')) ? String(data.headerColor) : '',
        headerOpacity: clampNumber(data.headerOpacity, 0, 1, DEFAULT_HEADER_TINT_OPACITY),
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
        updatedBy: data.updatedBy || null,
    };
}

/** GET /api/hero-banners — list every banner (active and inactive) + config */
export async function GET(request: Request) {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return unauthorizedResponse(auth.error);

    try {
        const [snap, configSnap] = await Promise.all([
            db.collection(COLLECTION).get(),
            db.collection(SETTINGS_COLLECTION).doc(CONFIG_DOC).get(),
        ]);

        const banners = snap.docs
            .map((d) => normalise(d.id, d.data()))
            .sort((a, b) => a.sortOrder - b.sortOrder);

        const config = configSnap.exists
            ? { ...DEFAULT_CONFIG, ...configSnap.data() }
            : DEFAULT_CONFIG;

        return NextResponse.json({ success: true, data: { banners, config } });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[hero-banners GET]', message);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

/** POST /api/hero-banners — create a banner */
export async function POST(request: Request) {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return unauthorizedResponse(auth.error);

    try {
        const body = await request.json();

        if (!body.mediaUrl || typeof body.mediaUrl !== 'string') {
            return NextResponse.json(
                { success: false, error: 'mediaUrl is required' },
                { status: 400 }
            );
        }

        // New banners land at the end of the running order.
        const existing = await db.collection(COLLECTION).get();
        const maxOrder = existing.docs.reduce(
            (max, d) => Math.max(max, Number(d.data().sortOrder) || 0),
            0
        );

        const now = new Date().toISOString();
        const payload = {
            label: body.label || 'Untitled banner',
            mediaUrl: body.mediaUrl,
            mediaType: body.mediaType === 'gif' ? 'gif' : 'image',
            naturalWidth: Number(body.naturalWidth) || 0,
            naturalHeight: Number(body.naturalHeight) || 0,
            zoom: clampNumber(body.zoom, 1, 4, 1),
            offsetX: clampNumber(body.offsetX, -1, 1, 0),
            offsetY: clampNumber(body.offsetY, -1, 1, 0),
            isActive: body.isActive !== false,
            sortOrder: maxOrder + 1,
            startAt: body.startAt || null,
            endAt: body.endAt || null,
            linkType: body.linkType || 'none',
            linkValue: body.linkValue || '',
            // A banner may legitimately have no colour of its own — the app
            // then keeps its green — so an empty string is stored as-is rather
            // than being back-filled with a default here.
            headerColor: HEX_COLOR.test(String(body.headerColor || ''))
                ? String(body.headerColor)
                : '',
            headerOpacity: clampNumber(body.headerOpacity, 0, 1, DEFAULT_HEADER_TINT_OPACITY),
            createdAt: now,
            updatedAt: now,
            updatedBy: auth.email || auth.uid || null,
        };

        const ref = await db.collection(COLLECTION).add(payload);
        return NextResponse.json({ success: true, data: { id: ref.id, ...payload } });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[hero-banners POST]', message);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * PATCH /api/hero-banners
 * Three shapes, all on the same endpoint:
 *   { id, ...fields }        → update one banner
 *   { reorder: [id, id, …] } → rewrite sortOrder to match the array order
 *   { config: {…} }          → update rotation / enabled config
 */
export async function PATCH(request: Request) {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return unauthorizedResponse(auth.error);

    try {
        const body = await request.json();
        const now = new Date().toISOString();

        if (Array.isArray(body.reorder)) {
            const batch = db.batch();
            body.reorder.forEach((id: string, index: number) => {
                batch.update(db.collection(COLLECTION).doc(id), {
                    sortOrder: index + 1,
                    updatedAt: now,
                });
            });
            await batch.commit();
            return NextResponse.json({ success: true });
        }

        if (body.config) {
            await db
                .collection(SETTINGS_COLLECTION)
                .doc(CONFIG_DOC)
                .set(
                    {
                        isEnabled: body.config.isEnabled !== false,
                        rotationSeconds: clampNumber(body.config.rotationSeconds, 2, 60, 6),
                        fallbackToBundled: body.config.fallbackToBundled !== false,
                        updatedAt: now,
                        updatedBy: auth.email || auth.uid || null,
                    },
                    { merge: true }
                );
            return NextResponse.json({ success: true });
        }

        if (!body.id) {
            return NextResponse.json(
                { success: false, error: 'id is required' },
                { status: 400 }
            );
        }

        const updates: Record<string, unknown> = {
            updatedAt: now,
            updatedBy: auth.email || auth.uid || null,
        };

        if (body.label !== undefined) updates.label = body.label;
        if (body.mediaUrl !== undefined) updates.mediaUrl = body.mediaUrl;
        if (body.mediaType !== undefined) updates.mediaType = body.mediaType === 'gif' ? 'gif' : 'image';
        if (body.naturalWidth !== undefined) updates.naturalWidth = Number(body.naturalWidth) || 0;
        if (body.naturalHeight !== undefined) updates.naturalHeight = Number(body.naturalHeight) || 0;
        if (body.zoom !== undefined) updates.zoom = clampNumber(body.zoom, 1, 4, 1);
        if (body.offsetX !== undefined) updates.offsetX = clampNumber(body.offsetX, -1, 1, 0);
        if (body.offsetY !== undefined) updates.offsetY = clampNumber(body.offsetY, -1, 1, 0);
        if (body.isActive !== undefined) updates.isActive = !!body.isActive;
        if (body.sortOrder !== undefined) updates.sortOrder = Number(body.sortOrder) || 0;
        if (body.startAt !== undefined) updates.startAt = body.startAt || null;
        if (body.endAt !== undefined) updates.endAt = body.endAt || null;
        if (body.linkType !== undefined) updates.linkType = body.linkType;
        if (body.linkValue !== undefined) updates.linkValue = body.linkValue;
        if (body.headerColor !== undefined) {
            updates.headerColor = HEX_COLOR.test(String(body.headerColor || ''))
                ? String(body.headerColor)
                : '';
        }
        if (body.headerOpacity !== undefined) {
            updates.headerOpacity = clampNumber(
                body.headerOpacity,
                0,
                1,
                DEFAULT_HEADER_TINT_OPACITY
            );
        }

        await db.collection(COLLECTION).doc(body.id).update(updates);
        return NextResponse.json({ success: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[hero-banners PATCH]', message);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

/** DELETE /api/hero-banners?id=… */
export async function DELETE(request: Request) {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return unauthorizedResponse(auth.error);

    try {
        const id = new URL(request.url).searchParams.get('id');
        if (!id) {
            return NextResponse.json(
                { success: false, error: 'id query param is required' },
                { status: 400 }
            );
        }

        await db.collection(COLLECTION).doc(id).delete();
        return NextResponse.json({ success: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[hero-banners DELETE]', message);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
