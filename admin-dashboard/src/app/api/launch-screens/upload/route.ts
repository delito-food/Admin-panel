import { NextResponse } from 'next/server';
import { uploadImage } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';

/**
 * POST /api/launch-screens/upload — multipart form: `kind`, `file`.
 *
 *   kind=animation  a Lottie file: .lottie (dotLottie, a zip) or .json
 *   kind=fallback   a PNG / JPEG / WebP shown if the animation can't play
 *
 * Stored in Firebase Storage through the Admin SDK (storage.rules don't apply
 * to it), under launch_screens/. The returned URL carries a download token, so
 * the customer app downloads it without any rule change.
 *
 * The file is checked here, not just by extension: a JSON must parse and look
 * like a Lottie (has `layers`), and a .lottie must be a zip. A broken file is
 * cheaper to refuse now than to discover on customers' phones.
 */

const MAX_ANIMATION_BYTES = 3 * 1024 * 1024;
const MAX_FALLBACK_BYTES = 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

function bad(error: string, status = 400) {
    return NextResponse.json({ success: false, error }, { status });
}

function safeStem(name: string): string {
    return (
        name
            .replace(/\.[^.]+$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'launch'
    );
}

async function handlePOST(request: Request) {
    try {
        const form = await request.formData();
        const kind = form.get('kind');
        const file = form.get('file');

        if (kind !== 'animation' && kind !== 'fallback') return bad('kind must be "animation" or "fallback"');
        if (!(file instanceof File)) return bad('A file is required');

        const buffer = Buffer.from(await file.arrayBuffer());
        const stem = `launch_screens/${Date.now()}_${safeStem(file.name)}`;

        if (kind === 'fallback') {
            const ext = IMAGE_TYPES[file.type];
            if (!ext) return bad('The backup image must be a PNG, JPEG or WebP');
            if (file.size > MAX_FALLBACK_BYTES) return bad('The backup image must be under 1 MB');
            const url = await uploadImage(`${stem}_fallback.${ext}`, buffer, file.type);
            return NextResponse.json({ success: true, data: { url, bytes: file.size } });
        }

        if (file.size > MAX_ANIMATION_BYTES) {
            return bad('The animation must be under 3 MB (aim for 300–500 KB)');
        }

        const lower = file.name.toLowerCase();
        let format: 'lottie' | 'json';
        let contentType: string;
        let meta: { width?: number; height?: number; durationMs?: number } = {};

        if (lower.endsWith('.lottie')) {
            // dotLottie is a zip archive: it must start with "PK".
            if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
                return bad('This .lottie file is damaged — export it again from LottieFiles');
            }
            format = 'lottie';
            contentType = 'application/zip';
        } else if (lower.endsWith('.json')) {
            let json: Record<string, unknown>;
            try {
                json = JSON.parse(buffer.toString('utf8'));
            } catch {
                return bad('This JSON file could not be read');
            }
            if (!Array.isArray(json.layers)) {
                return bad('This JSON is not a Lottie animation (no "layers")');
            }
            const assets = Array.isArray(json.assets) ? (json.assets as Record<string, unknown>[]) : [];
            const externalImage = assets.some(
                (a) => typeof a.p === 'string' && a.e !== 1 && !String(a.p).startsWith('data:')
            );
            if (externalImage) {
                return bad(
                    'This animation links to separate image files. Export it with images embedded, or as a .lottie file.'
                );
            }
            const fr = Number(json.fr) || 0;
            const frames = (Number(json.op) || 0) - (Number(json.ip) || 0);
            meta = {
                width: Number(json.w) || undefined,
                height: Number(json.h) || undefined,
                durationMs: fr > 0 && frames > 0 ? Math.round((frames / fr) * 1000) : undefined,
            };
            format = 'json';
            contentType = 'application/json';
        } else {
            return bad('Upload a .lottie or .json Lottie file');
        }

        const url = await uploadImage(`${stem}.${format === 'json' ? 'json' : 'lottie'}`, buffer, contentType);
        return NextResponse.json({ success: true, data: { url, format, bytes: file.size, ...meta } });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        console.error('[launch-screens upload]', message);
        return bad(message, 500);
    }
}

export const POST = withAdmin(handlePOST);
