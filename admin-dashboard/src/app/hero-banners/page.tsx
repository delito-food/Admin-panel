'use client';

/**
 * Hero Banners — admin page
 * ────────────────────────────────────────────────────────────────────────────
 * Uploads images and GIFs for the green hero at the top of the customer app's
 * home screen, and aligns each one against a true-to-app preview. Each banner
 * also carries its own header bar colour — the bar sits above the canvas, so it
 * covers no artwork, and it re-tints as banners rotate. There is no platform
 * default: a banner either sets a colour or the bar stays the app's green.
 *
 * Nothing is re-encoded on upload: the original file goes to Cloudinary (so
 * GIFs keep animating) and only a transform — zoom + offset — is stored
 * alongside it. See `src/lib/hero-canvas.ts` for why that beats exporting a
 * fixed crop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ImageIcon,
    Upload,
    Loader2,
    Trash2,
    Pencil,
    ArrowUp,
    ArrowDown,
    Eye,
    EyeOff,
    Save,
    X,
    RefreshCw,
    Timer,
    Palette,
    CheckCircle2,
    AlertCircle,
} from 'lucide-react';
import HeroCanvasEditor from './HeroCanvasEditor';
import {
    APP_GREEN,
    DEFAULT_FIT,
    DEFAULT_HEADER_TINT_OPACITY,
    HEADER_BAND_HEIGHT_DP,
    headerTintCss,
    heroBox,
    bundledHeroFit,
    RECOMMENDED_HEIGHT_PX,
    RECOMMENDED_WIDTH_PX,
    fitToImageStyle,
    heroClipPath,
    type HeroFit,
} from '@/lib/hero-canvas';

interface HeroBanner {
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
    /**
     * This banner's own header bar colour. The bar sits above the canvas, so it
     * covers no artwork — it just has to look right next to it. Blank keeps the
     * app's green; there is no platform default.
     */
    headerColor: string;
    /** How far the colour is blended over the app green. 1 = the colour flat. */
    headerOpacity: number;
    updatedAt: string | null;
    updatedBy: string | null;
}

interface HeroConfig {
    isEnabled: boolean;
    rotationSeconds: number;
    fallbackToBundled: boolean;
}

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dnmuwv56l';
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'platoos_preset';

/** The list thumbnails render at this fraction of a 412dp-wide phone. */
const LIST_SCALE = 0.32;

const emptyDraft = (): HeroBanner => ({
    id: '',
    label: '',
    mediaUrl: '',
    mediaType: 'image',
    naturalWidth: 0,
    naturalHeight: 0,
    zoom: DEFAULT_FIT.zoom,
    offsetX: DEFAULT_FIT.offsetX,
    offsetY: DEFAULT_FIT.offsetY,
    isActive: true,
    sortOrder: 0,
    startAt: null,
    endAt: null,
    linkType: 'none',
    linkValue: '',
    headerColor: '',
    headerOpacity: DEFAULT_HEADER_TINT_OPACITY,
    updatedAt: null,
    updatedBy: null,
});

export default function HeroBannersPage() {
    const [banners, setBanners] = useState<HeroBanner[]>([]);
    const [config, setConfig] = useState<HeroConfig>({
        isEnabled: true,
        rotationSeconds: 6,
        fallbackToBundled: true,
    });
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');

    const [draft, setDraft] = useState<HeroBanner | null>(null);
    const [draftBytes, setDraftBytes] = useState(0);
    const [isNew, setIsNew] = useState(false);

    // Free-text mirror of config.rotationSeconds while it's being typed.
    const [rotationDraft, setRotationDraft] = useState('6');

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [dragOver, setDragOver] = useState(false);

    /* ── Data ─────────────────────────────────────────────────────────────── */

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/hero-banners');
            const result = await res.json();
            if (result.success) {
                setBanners(result.data.banners);
                const loaded: HeroConfig = {
                    isEnabled: result.data.config.isEnabled !== false,
                    rotationSeconds: result.data.config.rotationSeconds ?? 6,
                    fallbackToBundled: result.data.config.fallbackToBundled !== false,
                };
                setConfig(loaded);
                setRotationDraft(String(loaded.rotationSeconds));
                setError('');
            } else {
                setError(result.error || 'Failed to load banners');
            }
        } catch {
            setError('Network error while loading banners');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const flash = (message: string) => {
        setToast(message);
        setTimeout(() => setToast(''), 2600);
    };

    /* ── Upload ───────────────────────────────────────────────────────────── */

    const uploadToCloudinary = async (file: File): Promise<string> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', UPLOAD_PRESET);
        formData.append('folder', 'hero_banners');

        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) throw new Error('Cloudinary upload failed');
        const data = await res.json();
        return data.secure_url as string;
    };

    const handleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Only images and GIFs can be used as hero banners.');
            return;
        }

        setUploading(true);
        setError('');

        try {
            const url = await uploadToCloudinary(file);
            const isGif = file.type === 'image/gif' || /\.gif($|\?)/i.test(url);

            setDraftBytes(file.size);
            setIsNew(true);
            setDraft({
                ...emptyDraft(),
                label: file.name.replace(/\.[^.]+$/, ''),
                mediaUrl: url,
                mediaType: isGif ? 'gif' : 'image',
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    /* ── Mutations ────────────────────────────────────────────────────────── */

    const saveDraft = async () => {
        if (!draft) return;
        if (!draft.mediaUrl) {
            setError('No media to save.');
            return;
        }

        setSaving(true);
        setError('');

        try {
            const res = await fetch('/api/hero-banners', {
                method: isNew ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft),
            });
            const result = await res.json();
            if (!result.success) throw new Error(result.error || 'Save failed');

            setDraft(null);
            await fetchData();
            flash(isNew ? 'Banner added' : 'Banner updated');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    /**
     * Every mutation goes through here.
     *
     * A bare `await fetch(...)` inside a click handler is a trap: if the request
     * rejects (offline, dev server restarting, route not compiled yet) nothing
     * catches it, so it surfaces as an unhandled rejection pointing deep inside
     * the global fetch patch in `lib/api-client.ts` — an error that tells the
     * admin nothing about what actually failed. This turns any failure into a
     * message on screen and lets the caller roll its optimistic update back.
     */
    const mutate = async (
        url: string,
        init: RequestInit,
        onFailure?: () => void
    ): Promise<boolean> => {
        try {
            const res = await fetch(url, init);
            const result = await res.json().catch(() => null);

            if (!res.ok || !result?.success) {
                throw new Error(result?.error || `Request failed (${res.status})`);
            }

            setError('');
            return true;
        } catch (e) {
            onFailure?.();
            setError(e instanceof Error ? e.message : 'Network error — change not saved');
            return false;
        }
    };

    const patchBanner = async (id: string, changes: Partial<HeroBanner>) => {
        // Optimistic — the list is small and the round trip is short. `before`
        // is captured so a failed save snaps the row back instead of leaving
        // the screen claiming something that never reached Firestore.
        const before = banners;
        setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, ...changes } : b)));

        await mutate(
            '/api/hero-banners',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, ...changes }),
            },
            () => setBanners(before)
        );
    };

    const removeBanner = async (banner: HeroBanner) => {
        if (!confirm(`Delete "${banner.label}"? This cannot be undone.`)) return;

        const ok = await mutate(`/api/hero-banners?id=${banner.id}`, { method: 'DELETE' });
        if (!ok) return;

        await fetchData();
        flash('Banner deleted');
    };

    const move = async (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= banners.length) return;

        const before = banners;
        const next = [...banners];
        [next[index], next[target]] = [next[target], next[index]];
        setBanners(next);

        await mutate(
            '/api/hero-banners',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reorder: next.map((b) => b.id) }),
            },
            () => setBanners(before)
        );
    };

    const saveConfig = async (changes: Partial<HeroConfig>) => {
        const before = config;
        const next = { ...config, ...changes };
        setConfig(next);

        const ok = await mutate(
            '/api/hero-banners',
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: next }),
            },
            () => setConfig(before)
        );

        if (ok) flash('Settings saved');
    };

    /**
     * The rotation interval is typed, not nudged, so it needs a draft.
     * Writing straight through on every keystroke made the field impossible to
     * edit: clearing it to type "12" sent a 0, which the API clamped to 2 and
     * echoed back, so the box refilled itself under the cursor. The draft holds
     * whatever is being typed — including empty — and only a blur or Enter with
     * a sane value commits.
     */
    const commitRotation = () => {
        const parsed = Number(rotationDraft);

        if (!Number.isFinite(parsed) || parsed < 2 || parsed > 60) {
            setRotationDraft(String(config.rotationSeconds));
            setError('Rotation interval must be between 2 and 60 seconds.');
            return;
        }

        const rounded = Math.round(parsed);
        setRotationDraft(String(rounded));
        if (rounded !== config.rotationSeconds) saveConfig({ rotationSeconds: rounded });
    };

    const activeCount = useMemo(() => banners.filter((b) => b.isActive).length, [banners]);

    /* ── Render ───────────────────────────────────────────────────────────── */

    return (
        <div style={{ display: 'grid', gap: 22 }}>
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 16,
                    flexWrap: 'wrap',
                }}
            >
                <div>
                    <h1
                        style={{
                            fontSize: '1.5rem',
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}
                    >
                        <ImageIcon size={24} /> Hero Banners
                    </h1>
                    <p
                        style={{
                            color: 'var(--foreground-secondary)',
                            fontSize: '0.85rem',
                            marginTop: 4,
                        }}
                    >
                        Images and GIFs shown on the green curve at the top of the customer app home
                        screen. {activeCount} of {banners.length} live.
                    </p>
                </div>
                <button onClick={fetchData} style={secondaryBtn}>
                    <RefreshCw size={15} /> Refresh
                </button>
            </div>

            {error && (
                <div style={bannerStyle('error')}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        style={bannerStyle('success')}
                    >
                        <CheckCircle2 size={16} /> {toast}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Rotation config */}
            <div style={cardStyle}>
                <div
                    style={{
                        display: 'flex',
                        gap: 22,
                        flexWrap: 'wrap',
                        alignItems: 'center',
                    }}
                >
                    <SwitchRow
                        label="Show hero banners in the app"
                        hint="Off = the app falls back to the built-in artwork."
                        checked={config.isEnabled}
                        onChange={(v) => saveConfig({ isEnabled: v })}
                    />
                    <div style={{ display: 'grid', gap: 5 }}>
                        <label style={labelStyle}>
                            <Timer size={13} /> Rotate every
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                                type="number"
                                min={2}
                                max={60}
                                value={rotationDraft}
                                onChange={(e) => setRotationDraft(e.target.value)}
                                onBlur={commitRotation}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                    if (e.key === 'Escape') {
                                        setRotationDraft(String(config.rotationSeconds));
                                        e.currentTarget.blur();
                                    }
                                }}
                                style={{ ...inputStyle, width: 88 }}
                            />
                            <span
                                style={{
                                    fontSize: '0.8rem',
                                    color: 'var(--foreground-secondary)',
                                }}
                            >
                                seconds
                            </span>
                            {String(config.rotationSeconds) !== rotationDraft.trim() && (
                                <button onClick={commitRotation} style={miniSaveBtn}>
                                    <Save size={12} /> Save
                                </button>
                            )}
                        </div>
                        <span
                            style={{
                                fontSize: '0.71rem',
                                color: 'var(--foreground-secondary)',
                            }}
                        >
                            2–60 seconds. Press Enter or click away to save.
                        </span>
                    </div>
                    <SwitchRow
                        label="Fall back to built-in art"
                        hint="Used when nothing is live or scheduled."
                        checked={config.fallbackToBundled}
                        onChange={(v) => saveConfig({ fallbackToBundled: v })}
                    />

                </div>
            </div>

            {/* Upload */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                    border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border)'}`,
                    background: dragOver ? 'rgba(34,197,94,0.06)' : 'var(--surface)',
                    borderRadius: 14,
                    padding: '28px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 140ms ease',
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.gif"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFile(file);
                        e.target.value = '';
                    }}
                />
                {uploading ? (
                    <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
                        <Loader2 size={22} className="animate-spin" />
                        <span style={{ fontSize: '0.85rem' }}>Uploading…</span>
                    </div>
                ) : (
                    <div style={{ display: 'grid', placeItems: 'center', gap: 6 }}>
                        <Upload size={22} style={{ color: 'var(--primary)' }} />
                        <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                            Drop an image or GIF here
                        </div>
                        <div
                            style={{
                                fontSize: '0.78rem',
                                color: 'var(--foreground-secondary)',
                                maxWidth: 560,
                            }}
                        >
                            Best results at {RECOMMENDED_WIDTH_PX} × {RECOMMENDED_HEIGHT_PX} px
                            (roughly 1.06:1). The next screen lets you align it against the real
                            hero curve, so nothing important gets cropped.
                        </div>
                    </div>
                )}
            </div>

            {/* List */}
            {loading ? (
                <div style={{ display: 'grid', placeItems: 'center', padding: 50 }}>
                    <Loader2 size={26} className="animate-spin" />
                </div>
            ) : banners.length === 0 ? (
                <div
                    style={{
                        ...cardStyle,
                        textAlign: 'center',
                        color: 'var(--foreground-secondary)',
                        padding: 40,
                    }}
                >
                    No hero banners yet. Upload one above — until then the app shows its built-in
                    artwork.
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                    {banners.map((banner, index) => (
                        <motion.div
                            key={banner.id}
                            layout
                            style={{
                                ...cardStyle,
                                display: 'flex',
                                gap: 16,
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                opacity: banner.isActive ? 1 : 0.55,
                            }}
                        >
                            {/* Thumbnail rendered with the real header bar above
                                the real canvas outline, at the real fit */}
                            <div style={{ flexShrink: 0 }}>
                            <div
                                style={{
                                    width: 412 * LIST_SCALE,
                                    height: HEADER_BAND_HEIGHT_DP * LIST_SCALE,
                                    background: headerTintCss(
                                        banner.headerColor,
                                        banner.headerOpacity
                                    ),
                                }}
                            />
                            <div
                                style={{
                                    position: 'relative',
                                    width: 412 * LIST_SCALE,
                                    height: heroBox(412).h * LIST_SCALE,
                                    background:
                                        'linear-gradient(180deg, #1B7A3E 0%, #2E9C55 100%)',
                                    overflow: 'hidden',
                                    clipPath: heroClipPath(
                                        412 * LIST_SCALE,
                                        heroBox(412).h * LIST_SCALE,
                                        LIST_SCALE
                                    ),
                                }}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={banner.mediaUrl}
                                    alt={banner.label}
                                    style={fitToImageStyle(
                                        {
                                            w: 412 * LIST_SCALE,
                                            h: heroBox(412).h * LIST_SCALE,
                                        },
                                        banner.naturalWidth,
                                        banner.naturalHeight,
                                        banner
                                    )}
                                />
                            </div>
                            </div>

                            <div style={{ flex: '1 1 220px', display: 'grid', gap: 5 }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <span style={{ fontWeight: 700 }}>{banner.label}</span>
                                    <Pill tone={banner.mediaType === 'gif' ? 'purple' : 'grey'}>
                                        {banner.mediaType.toUpperCase()}
                                    </Pill>
                                    <Pill tone={banner.isActive ? 'green' : 'grey'}>
                                        {banner.isActive ? 'Live' : 'Hidden'}
                                    </Pill>
                                    {banner.zoom > 1.01 && (
                                        <Pill tone="grey">{banner.zoom.toFixed(2)}× zoom</Pill>
                                    )}
                                </div>
                                <div
                                    style={{
                                        fontSize: '0.75rem',
                                        color: 'var(--foreground-secondary)',
                                    }}
                                >
                                    {banner.naturalWidth
                                        ? `${banner.naturalWidth} × ${banner.naturalHeight} px`
                                        : 'Size unknown'}
                                    {banner.startAt || banner.endAt
                                        ? ` · ${fmtDate(banner.startAt)} → ${fmtDate(banner.endAt)}`
                                        : ''}
                                    {banner.updatedBy ? ` · last edited by ${banner.updatedBy}` : ''}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <IconAction
                                    title="Move up"
                                    disabled={index === 0}
                                    onClick={() => move(index, -1)}
                                >
                                    <ArrowUp size={15} />
                                </IconAction>
                                <IconAction
                                    title="Move down"
                                    disabled={index === banners.length - 1}
                                    onClick={() => move(index, 1)}
                                >
                                    <ArrowDown size={15} />
                                </IconAction>
                                <IconAction
                                    title={banner.isActive ? 'Hide from app' : 'Show in app'}
                                    onClick={() =>
                                        patchBanner(banner.id, { isActive: !banner.isActive })
                                    }
                                >
                                    {banner.isActive ? <Eye size={15} /> : <EyeOff size={15} />}
                                </IconAction>
                                <IconAction
                                    title="Align & edit"
                                    onClick={() => {
                                        setIsNew(false);
                                        setDraftBytes(0);
                                        setDraft({ ...banner });
                                    }}
                                >
                                    <Pencil size={15} />
                                </IconAction>
                                <IconAction
                                    title="Delete"
                                    danger
                                    onClick={() => removeBanner(banner)}
                                >
                                    <Trash2 size={15} />
                                </IconAction>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Editor modal */}
            <AnimatePresence>
                {draft && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => !saving && setDraft(null)}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0,0,0,0.55)',
                            zIndex: 60,
                            display: 'grid',
                            placeItems: 'center',
                            padding: 20,
                            overflowY: 'auto',
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.97, y: 12 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.97, y: 12 }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                background: 'var(--surface)',
                                borderRadius: 16,
                                border: '1px solid var(--border)',
                                padding: 22,
                                width: 'min(1080px, 100%)',
                                maxHeight: '92vh',
                                overflowY: 'auto',
                                display: 'grid',
                                gap: 18,
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}
                            >
                                <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                                    {isNew ? 'Align new banner' : 'Edit banner'}
                                </h2>
                                <button
                                    onClick={() => setDraft(null)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--foreground-secondary)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <HeroCanvasEditor
                                mediaUrl={draft.mediaUrl}
                                mediaType={draft.mediaType}
                                fileBytes={draftBytes}
                                naturalWidth={draft.naturalWidth}
                                naturalHeight={draft.naturalHeight}
                                headerBandColor={draft.headerColor}
                                headerBandOpacity={draft.headerOpacity}
                                fit={{
                                    zoom: draft.zoom,
                                    offsetX: draft.offsetX,
                                    offsetY: draft.offsetY,
                                }}
                                onChange={(f: HeroFit) =>
                                    setDraft((d) => (d ? { ...d, ...f } : d))
                                }
                                onNaturalSize={(w, h) =>
                                    setDraft((d) => {
                                        if (!d) return d;
                                        const sized = {
                                            ...d,
                                            naturalWidth: w,
                                            naturalHeight: h,
                                        };
                                        // First time we learn a fresh upload's real
                                        // size, seed it with the placement the
                                        // built-in artwork used, so swapping a
                                        // banner in doesn't visibly jump the hero.
                                        // Only on upload — never stomp an
                                        // alignment someone already saved.
                                        if (isNew && !d.naturalWidth) {
                                            return { ...sized, ...bundledHeroFit(w, h) };
                                        }
                                        return sized;
                                    })
                                }
                            />

                            <div
                                style={{
                                    display: 'grid',
                                    gap: 12,
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                }}
                            >
                                <Field label="Name (internal)">
                                    <input
                                        value={draft.label}
                                        onChange={(e) =>
                                            setDraft({ ...draft, label: e.target.value })
                                        }
                                        placeholder="Diwali sale banner"
                                        style={inputStyle}
                                    />
                                </Field>
                                <Field label="Live from (optional)">
                                    <input
                                        type="datetime-local"
                                        value={toLocalInput(draft.startAt)}
                                        onChange={(e) =>
                                            setDraft({
                                                ...draft,
                                                startAt: fromLocalInput(e.target.value),
                                            })
                                        }
                                        style={inputStyle}
                                    />
                                </Field>
                                <Field label="Live until (optional)">
                                    <input
                                        type="datetime-local"
                                        value={toLocalInput(draft.endAt)}
                                        onChange={(e) =>
                                            setDraft({
                                                ...draft,
                                                endAt: fromLocalInput(e.target.value),
                                            })
                                        }
                                        style={inputStyle}
                                    />
                                </Field>
                                <Field label="On tap">
                                    <select
                                        value={draft.linkType}
                                        onChange={(e) =>
                                            setDraft({
                                                ...draft,
                                                linkType: e.target.value as HeroBanner['linkType'],
                                            })
                                        }
                                        style={inputStyle}
                                    >
                                        <option value="none">Do nothing</option>
                                        <option value="vendor">Open a vendor</option>
                                        <option value="category">Open a category</option>
                                        <option value="url">Open a link</option>
                                    </select>
                                </Field>
                                {draft.linkType !== 'none' && (
                                    <Field
                                        label={
                                            draft.linkType === 'vendor'
                                                ? 'Vendor ID'
                                                : draft.linkType === 'category'
                                                  ? 'Category name'
                                                  : 'URL'
                                        }
                                    >
                                        <input
                                            value={draft.linkValue}
                                            onChange={(e) =>
                                                setDraft({ ...draft, linkValue: e.target.value })
                                            }
                                            style={inputStyle}
                                        />
                                    </Field>
                                )}
                            </div>

                            {/* Per-banner header colour. The bar above the canvas
                                takes this while this banner is showing, and
                                cross-fades to the next banner's as they rotate. */}
                            <div
                                style={{
                                    display: 'grid',
                                    gap: 8,
                                    padding: 14,
                                    borderRadius: 12,
                                    border: '1px solid var(--border)',
                                }}
                            >
                                <label style={labelStyle}>
                                    <Palette size={13} /> Header colour for this banner
                                </label>
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <input
                                        type="color"
                                        aria-label="Header colour for this banner"
                                        value={
                                            /^#[0-9a-fA-F]{6}$/.test(draft.headerColor)
                                                ? draft.headerColor
                                                : APP_GREEN
                                        }
                                        onChange={(e) =>
                                            setDraft({ ...draft, headerColor: e.target.value })
                                        }
                                        style={{
                                            width: 42,
                                            height: 34,
                                            padding: 2,
                                            borderRadius: 8,
                                            border: '1px solid var(--border)',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                        }}
                                    />
                                    <input
                                        type="text"
                                        aria-label="Header colour hex for this banner"
                                        value={draft.headerColor}
                                        placeholder={`${APP_GREEN} (app green)`}
                                        onChange={(e) =>
                                            setDraft({ ...draft, headerColor: e.target.value })
                                        }
                                        style={{ ...inputStyle, width: 116 }}
                                    />
                                    <input
                                        type="range"
                                        aria-label="Header colour strength"
                                        min={0}
                                        max={100}
                                        value={Math.round((draft.headerOpacity ?? 1) * 100)}
                                        onChange={(e) =>
                                            setDraft({
                                                ...draft,
                                                headerOpacity: Number(e.target.value) / 100,
                                            })
                                        }
                                        style={{ width: 130 }}
                                    />
                                    <span
                                        style={{
                                            fontSize: '0.8rem',
                                            color: 'var(--foreground-secondary)',
                                            minWidth: 84,
                                        }}
                                    >
                                        {Math.round((draft.headerOpacity ?? 1) * 100)}% strength
                                    </span>
                                    {draft.headerColor && (
                                        <button
                                            onClick={() => setDraft({ ...draft, headerColor: '' })}
                                            style={secondaryBtn}
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                                <span
                                    style={{
                                        fontSize: '0.71rem',
                                        color: 'var(--foreground-secondary)',
                                    }}
                                >
                                    The bar above the canvas takes this colour while this banner is
                                    on screen, and cross-fades to the next banner&apos;s as they
                                    rotate. Clear it and the bar keeps the app&apos;s green — there
                                    is no platform default. 0% strength is that green, 100% is your
                                    colour flat.
                                </span>
                            </div>

                            <SwitchRow
                                label="Live in the app"
                                hint="Hidden banners stay saved but are skipped in the rotation."
                                checked={draft.isActive}
                                onChange={(v) => setDraft({ ...draft, isActive: v })}
                            />

                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    gap: 10,
                                }}
                            >
                                <button onClick={() => setDraft(null)} style={secondaryBtn}>
                                    Cancel
                                </button>
                                <button
                                    onClick={saveDraft}
                                    disabled={saving}
                                    style={{
                                        ...primaryBtn,
                                        opacity: saving ? 0.7 : 1,
                                    }}
                                >
                                    {saving ? (
                                        <Loader2 size={15} className="animate-spin" />
                                    ) : (
                                        <Save size={15} />
                                    )}
                                    {isNew ? 'Add banner' : 'Save changes'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Styles & small components ────────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 16,
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 9,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--foreground)',
    fontSize: '0.83rem',
    outline: 'none',
};

const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: 'var(--foreground-secondary)',
};

const primaryBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '10px 18px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--primary)',
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.83rem',
    cursor: 'pointer',
};

const miniSaveBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 11px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--primary)',
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.72rem',
    cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--foreground)',
    fontWeight: 600,
    fontSize: '0.83rem',
    cursor: 'pointer',
};

function bannerStyle(tone: 'error' | 'success'): React.CSSProperties {
    return {
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '11px 14px',
        borderRadius: 11,
        fontSize: '0.83rem',
        fontWeight: 600,
        background: tone === 'error' ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)',
        color: tone === 'error' ? '#EF4444' : '#16A34A',
    };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'grid', gap: 5 }}>
            <span style={labelStyle}>{label}</span>
            {children}
        </div>
    );
}

function Pill({
    children,
    tone,
}: {
    children: React.ReactNode;
    tone: 'green' | 'grey' | 'purple';
}) {
    const map = {
        green: { bg: 'rgba(34,197,94,0.14)', fg: '#16A34A' },
        grey: { bg: 'rgba(148,163,184,0.16)', fg: 'var(--foreground-secondary)' },
        purple: { bg: 'rgba(168,85,247,0.14)', fg: '#A855F7' },
    }[tone];

    return (
        <span
            style={{
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: '0.66rem',
                fontWeight: 700,
                background: map.bg,
                color: map.fg,
            }}
        >
            {children}
        </span>
    );
}

function IconAction({
    children,
    onClick,
    title,
    disabled,
    danger,
}: {
    children: React.ReactNode;
    onClick: () => void;
    title: string;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            disabled={disabled}
            style={{
                width: 34,
                height: 34,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 9,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: danger ? '#EF4444' : 'var(--foreground-secondary)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.4 : 1,
            }}
        >
            {children}
        </button>
    );
}

function SwitchRow({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
            }}
        >
            <span
                onClick={() => onChange(!checked)}
                style={{
                    width: 40,
                    height: 22,
                    borderRadius: 999,
                    background: checked ? 'var(--primary)' : 'rgba(148,163,184,0.4)',
                    position: 'relative',
                    flexShrink: 0,
                    transition: 'background 140ms ease',
                }}
            >
                <span
                    style={{
                        position: 'absolute',
                        top: 3,
                        left: checked ? 21 : 3,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: 'left 140ms ease',
                    }}
                />
            </span>
            <span style={{ display: 'grid', gap: 1 }}>
                <span style={{ fontSize: '0.83rem', fontWeight: 600 }}>{label}</span>
                {hint && (
                    <span
                        style={{
                            fontSize: '0.71rem',
                            color: 'var(--foreground-secondary)',
                        }}
                    >
                        {hint}
                    </span>
                )}
            </span>
        </label>
    );
}

/* ── Date helpers ─────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
}

/** ISO → the `YYYY-MM-DDTHH:mm` that <input type="datetime-local"> expects. */
function toLocalInput(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
