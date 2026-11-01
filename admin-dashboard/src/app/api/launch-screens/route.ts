import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';

/**
 * Launch Screen API
 * ────────────────────────────────────────────────────────────────────────────
 * Backs the customer app's launch screen (see LaunchScreenRepository.kt).
 *
 *   platformSettings/launchScreenConfig — the built-in gate animation:
 *       mode (auto | pink | green | night), dayTheme (pink | green),
 *       dayStartHour, nightStartHour, tagline, customEnabled
 *   launchScreens/{id} — uploaded Lottie launch screens with a schedule
 *
 * The app decides from the copy it saved on the previous launch and refreshes
 * that copy in the background, so every change here shows from the NEXT time
 * a customer opens the app. Uploaded files are downloaded to the phone before
 * they are ever played.
 */

const COLLECTION = 'launchScreens';
const SETTINGS_COLLECTION = 'platformSettings';
const CONFIG_DOC = 'launchScreenConfig';

const MODES = ['auto', 'pink', 'green', 'night'] as const;
const DAY_THEMES = ['pink', 'green'] as const;
const SHOW_ON = ['all', 'day', 'night'] as const;
const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

// Not exported: a route file may only export HTTP handlers and route config.
const DEFAULT_TAGLINE = "Craving? We're on it!";

const DEFAULT_CONFIG = {
    mode: 'auto',
    dayTheme: 'pink',
    dayStartHour: 6,
    nightStartHour: 19,
    tagline: DEFAULT_TAGLINE,
    customEnabled: true,
};

export interface LaunchScreenDoc {
    id: string;
    label: string;
    mediaUrl: string;
    format: 'lottie' | 'json';
    mediaBytes: number;
    fallbackImageUrl: string;
    backgroundColor: string;
    scaleMode: 'fit' | 'crop';
    showOn: 'all' | 'day' | 'night';
    priority: number;
    maxDurationMs: number;
    isActive: boolean;
    startAt: string | null;
    endAt: string | null;
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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(Math.min(max, Math.max(min, n)));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Accepts an ISO string or '' / null; anything unparseable becomes null. */
function isoOrNull(value: unknown): string | null {
    if (!value || typeof value !== 'string') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isHttpsUrl(value: unknown): value is string {
    return typeof value === 'string' && /^https:\/\//i.test(value);
}

function normalise(id: string, data: FirebaseFirestore.DocumentData): LaunchScreenDoc {
    return {
        id,
        label: data.label || 'Untitled launch screen',
        mediaUrl: data.mediaUrl || '',
        format: data.format === 'json' ? 'json' : 'lottie',
        mediaBytes: Number(data.mediaBytes) || 0,
        fallbackImageUrl: data.fallbackImageUrl || '',
        backgroundColor: HEX_COLOR.test(String(data.backgroundColor || '')) ? data.backgroundColor : '#FFFFFF',
        scaleMode: data.scaleMode === 'crop' ? 'crop' : 'fit',
        showOn: pick(data.showOn, SHOW_ON, 'all'),
        priority: clampInt(data.priority, 0, 100, 0),
        maxDurationMs: clampInt(data.maxDurationMs, 1000, 8000, 4000),
        isActive: data.isActive !== false,
        startAt: toIso(data.startAt),
        endAt: toIso(data.endAt),
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
        updatedBy: data.updatedBy || null,
    };
}

function normaliseConfig(data: FirebaseFirestore.DocumentData | undefined) {
    const d = data || {};
    return {
        mode: pick(d.mode, MODES, 'auto'),
        dayTheme: pick(d.dayTheme, DAY_THEMES, 'pink'),
        dayStartHour: clampInt(d.dayStartHour, 0, 23, DEFAULT_CONFIG.dayStartHour),
        nightStartHour: clampInt(d.nightStartHour, 0, 23, DEFAULT_CONFIG.nightStartHour),
        tagline: typeof d.tagline === 'string' && d.tagline.trim() ? d.tagline.trim().slice(0, 60) : DEFAULT_TAGLINE,
        customEnabled: d.customEnabled !== false,
    };
}

/** Fields shared by create and update, validated. Undefined = not sent. */
function screenFields(body: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    if (body.label !== undefined) out.label = String(body.label || '').trim().slice(0, 80) || 'Untitled launch screen';
    if (body.mediaUrl !== undefined) out.mediaUrl = isHttpsUrl(body.mediaUrl) ? body.mediaUrl : '';
    if (body.format !== undefined) out.format = body.format === 'json' ? 'json' : 'lottie';
    if (body.mediaBytes !== undefined) out.mediaBytes = Number(body.mediaBytes) || 0;
    if (body.fallbackImageUrl !== undefined) {
        out.fallbackImageUrl = isHttpsUrl(body.fallbackImageUrl) ? body.fallbackImageUrl : '';
    }
    if (body.backgroundColor !== undefined) {
        out.backgroundColor = HEX_COLOR.test(String(body.backgroundColor || '')) ? body.backgroundColor : '#FFFFFF';
    }
    if (body.scaleMode !== undefined) out.scaleMode = body.scaleMode === 'crop' ? 'crop' : 'fit';
    if (body.showOn !== undefined) out.showOn = pick(body.showOn, SHOW_ON, 'all');
    if (body.priority !== undefined) out.priority = clampInt(body.priority, 0, 100, 0);
    if (body.maxDurationMs !== undefined) out.maxDurationMs = clampInt(body.maxDurationMs, 1000, 8000, 4000);
    if (body.isActive !== undefined) out.isActive = !!body.isActive;
    if (body.startAt !== undefined) out.startAt = isoOrNull(body.startAt);
    if (body.endAt !== undefined) out.endAt = isoOrNull(body.endAt);
    return out;
}

function scheduleError(startAt: unknown, endAt: unknown): string | null {
    if (typeof startAt === 'string' && typeof endAt === 'string' && new Date(endAt) <= new Date(startAt)) {
        return 'The end time must be after the start time';
    }
    return null;
}

function errorResponse(scope: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[launch-screens ${scope}]`, message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
}

/** GET /api/launch-screens — every screen (newest first) + the gate config */
async function handleGET() {
    try {
        const [snap, configSnap] = await Promise.all([
            db.collection(COLLECTION).get(),
            db.collection(SETTINGS_COLLECTION).doc(CONFIG_DOC).get(),
        ]);
        const screens = snap.docs
            .map((d) => normalise(d.id, d.data()))
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const config = normaliseConfig(configSnap.exists ? configSnap.data() : undefined);
        return NextResponse.json({ success: true, data: { screens, config } });
    } catch (error) {
        return errorResponse('GET', error);
    }
}

/** POST /api/launch-screens — add an uploaded launch screen */
async function handlePOST(request: Request, _context: unknown, auth: AdminResult) {
    try {
        const body = await request.json();
        if (!isHttpsUrl(body.mediaUrl)) {
            return NextResponse.json({ success: false, error: 'Upload an animation file first' }, { status: 400 });
        }
        const fields = screenFields(body);
        const scheduleProblem = scheduleError(fields.startAt, fields.endAt);
        if (scheduleProblem) {
            return NextResponse.json({ success: false, error: scheduleProblem }, { status: 400 });
        }

        const now = new Date().toISOString();
        const payload = {
            label: 'Untitled launch screen',
            format: 'lottie',
            mediaBytes: 0,
            fallbackImageUrl: '',
            backgroundColor: '#FFFFFF',
            scaleMode: 'fit',
            showOn: 'all',
            priority: 0,
            maxDurationMs: 4000,
            isActive: true,
            startAt: null,
            endAt: null,
            ...fields,
            createdAt: now,
            updatedAt: now,
            updatedBy: auth.email || auth.uid || null,
        };
        const ref = await db.collection(COLLECTION).add(payload);
        return NextResponse.json({ success: true, data: normalise(ref.id, payload) });
    } catch (error) {
        return errorResponse('POST', error);
    }
}

/**
 * PATCH /api/launch-screens
 *   { config: {…} }   → update the built-in gate settings
 *   { id, ...fields } → update one uploaded screen
 */
async function handlePATCH(request: Request, _context: unknown, auth: AdminResult) {
    try {
        const body = await request.json();
        const now = new Date().toISOString();
        const updatedBy = auth.email || auth.uid || null;

        if (body.config) {
            const config = normaliseConfig(body.config);
            await db
                .collection(SETTINGS_COLLECTION)
                .doc(CONFIG_DOC)
                .set({ ...config, updatedAt: now, updatedBy }, { merge: true });
            return NextResponse.json({ success: true, data: config });
        }

        if (!body.id || typeof body.id !== 'string') {
            return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
        }

        const ref = db.collection(COLLECTION).doc(body.id);
        const existing = await ref.get();
        if (!existing.exists) {
            return NextResponse.json({ success: false, error: 'Launch screen not found' }, { status: 404 });
        }

        const fields = screenFields(body);
        if (fields.mediaUrl === '') {
            return NextResponse.json({ success: false, error: 'An animation file is required' }, { status: 400 });
        }
        const merged = { ...existing.data(), ...fields };
        const scheduleProblem = scheduleError(merged.startAt, merged.endAt);
        if (scheduleProblem) {
            return NextResponse.json({ success: false, error: scheduleProblem }, { status: 400 });
        }

        await ref.update({ ...fields, updatedAt: now, updatedBy });
        return NextResponse.json({ success: true });
    } catch (error) {
        return errorResponse('PATCH', error);
    }
}

/** DELETE /api/launch-screens?id=… — phones remove the downloaded file on their next sync */
async function handleDELETE(request: Request) {
    try {
        const id = new URL(request.url).searchParams.get('id');
        if (!id) {
            return NextResponse.json({ success: false, error: 'id query param is required' }, { status: 400 });
        }
        await db.collection(COLLECTION).doc(id).delete();
        return NextResponse.json({ success: true });
    } catch (error) {
        return errorResponse('DELETE', error);
    }
}

export const GET = withAdmin(handleGET);
export const POST = withAdmin(handlePOST);
export const PATCH = withAdmin(handlePATCH);
export const DELETE = withAdmin(handleDELETE);
