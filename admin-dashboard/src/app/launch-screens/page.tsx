'use client';

/**
 * Launch Screen — admin page
 * ────────────────────────────────────────────────────────────────────────────
 * Controls what customers see while the Delito app opens:
 *
 *   • The built-in gate animation (Pink / Green / Night), either fixed or
 *     switching by the phone's time of day.
 *   • Uploaded Lottie launch screens (.lottie or .json) with a schedule — for
 *     festivals and campaigns. While one is live it replaces the gate.
 *
 * The app chooses from what it saved on the previous launch and downloads new
 * files in the background, so a change shows from the next time a customer
 * opens the app (once the phone has the file). See LaunchScreenRepository.kt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    DoorOpen,
    Eye,
    EyeOff,
    FileJson,
    ImageIcon,
    Loader2,
    Moon,
    Pencil,
    RefreshCw,
    Save,
    Sun,
    Trash2,
    Upload,
    X,
} from 'lucide-react';

type Mode = 'auto' | 'pink' | 'green' | 'night';
type GateTheme = 'pink' | 'green' | 'night';

interface LaunchConfig {
    mode: Mode;
    dayTheme: 'pink' | 'green';
    dayStartHour: number;
    nightStartHour: number;
    tagline: string;
    customEnabled: boolean;
}

interface LaunchScreen {
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
}

interface FileInfo {
    width?: number;
    height?: number;
    durationMs?: number;
}

const DEFAULT_TAGLINE = "Craving? We're on it!";

const DEFAULT_CONFIG: LaunchConfig = {
    mode: 'auto',
    dayTheme: 'pink',
    dayStartHour: 6,
    nightStartHour: 19,
    tagline: DEFAULT_TAGLINE,
    customEnabled: true,
};

/** Same colours as GateLaunchAnimation.kt, for the little previews. */
const THEMES: Record<GateTheme, { name: string; wall: string; frame: string; door: string; trim: string; sky: string }> = {
    pink: { name: 'Jaipur Pink', wall: '#EE9E96', frame: '#B0124F', door: '#1F6B2A', trim: '#E8B64C', sky: '#FDECDF' },
    green: { name: 'Delito Green', wall: '#25671E', frame: '#F2D28A', door: '#EE9DB0', trim: '#FFFFFF', sky: '#F3F8EC' },
    night: { name: 'Night', wall: '#2B2452', frame: '#C9962E', door: '#1D5F27', trim: '#E8B64C', sky: '#1A1638' },
};

const emptyDraft = (): LaunchScreen => ({
    id: '',
    label: '',
    mediaUrl: '',
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
});

export default function LaunchScreensPage() {
    const [config, setConfig] = useState<LaunchConfig>(DEFAULT_CONFIG);
    const [savedConfig, setSavedConfig] = useState<LaunchConfig>(DEFAULT_CONFIG);
    const [screens, setScreens] = useState<LaunchScreen[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingConfig, setSavingConfig] = useState(false);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');

    const [draft, setDraft] = useState<LaunchScreen | null>(null);
    const [draftInfo, setDraftInfo] = useState<FileInfo>({});
    const [isNew, setIsNew] = useState(false);
    const [uploading, setUploading] = useState<'animation' | 'fallback' | null>(null);
    const [savingDraft, setSavingDraft] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const animationInput = useRef<HTMLInputElement | null>(null);
    const fallbackInput = useRef<HTMLInputElement | null>(null);

    // Re-render once a minute so "Live now" stays truthful on an open tab.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);

    const flash = (message: string) => {
        setToast(message);
        setTimeout(() => setToast(''), 2600);
    };

    /* ── Data ─────────────────────────────────────────────────────────────── */

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/launch-screens');
            const result = await res.json();
            if (!result.success) throw new Error(result.error || 'Failed to load launch screens');
            setScreens(result.data.screens);
            setConfig(result.data.config);
            setSavedConfig(result.data.config);
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error while loading');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const call = async (url: string, init: RequestInit): Promise<boolean> => {
        try {
            const res = await fetch(url, init);
            const result = await res.json().catch(() => null);
            if (!res.ok || !result?.success) throw new Error(result?.error || `Request failed (${res.status})`);
            setError('');
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error — change not saved');
            return false;
        }
    };

    /* ── Built-in gate ────────────────────────────────────────────────────── */

    const configDirty = JSON.stringify(config) !== JSON.stringify(savedConfig);

    const saveConfig = async () => {
        if (config.mode === 'auto' && config.dayStartHour === config.nightStartHour) {
            setError('Day and night can’t start at the same hour.');
            return;
        }
        setSavingConfig(true);
        const ok = await call('/api/launch-screens', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config }),
        });
        setSavingConfig(false);
        if (ok) {
            setSavedConfig(config);
            flash('Launch screen settings saved');
        }
    };

    /* ── Uploads ──────────────────────────────────────────────────────────── */

    const upload = async (file: File, kind: 'animation' | 'fallback') => {
        const form = new FormData();
        form.append('kind', kind);
        form.append('file', file);
        setUploading(kind);
        setError('');
        try {
            const res = await fetch('/api/launch-screens/upload', { method: 'POST', body: form });
            const result = await res.json().catch(() => null);
            if (!res.ok || !result?.success) throw new Error(result?.error || `Upload failed (${res.status})`);
            return result.data as { url: string; bytes: number; format?: 'lottie' | 'json' } & FileInfo;
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Upload failed');
            return null;
        } finally {
            setUploading(null);
        }
    };

    const handleAnimationFile = async (file: File) => {
        const lower = file.name.toLowerCase();
        if (!lower.endsWith('.lottie') && !lower.endsWith('.json')) {
            setError('Upload a .lottie or .json Lottie file.');
            return;
        }
        const data = await upload(file, 'animation');
        if (!data) return;
        const info: FileInfo = { width: data.width, height: data.height, durationMs: data.durationMs };
        setDraftInfo(info);
        if (draft) {
            // Replacing the file of the screen being edited.
            setDraft({ ...draft, mediaUrl: data.url, format: data.format || 'lottie', mediaBytes: data.bytes });
        } else {
            setIsNew(true);
            setDraft({
                ...emptyDraft(),
                label: file.name.replace(/\.[^.]+$/, ''),
                mediaUrl: data.url,
                format: data.format || 'lottie',
                mediaBytes: data.bytes,
                maxDurationMs: data.durationMs ? clamp(Math.ceil(data.durationMs / 100) * 100, 1000, 8000) : 4000,
            });
        }
    };

    const handleFallbackFile = async (file: File) => {
        if (!draft) return;
        const data = await upload(file, 'fallback');
        if (data) setDraft({ ...draft, fallbackImageUrl: data.url });
    };

    /* ── Screens ──────────────────────────────────────────────────────────── */

    const saveDraft = async () => {
        if (!draft) return;
        if (draft.startAt && draft.endAt && new Date(draft.endAt) <= new Date(draft.startAt)) {
            setError('The end time must be after the start time.');
            return;
        }
        setSavingDraft(true);
        const ok = await call('/api/launch-screens', {
            method: isNew ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
        });
        setSavingDraft(false);
        if (ok) {
            setDraft(null);
            await fetchData();
            flash(isNew ? 'Launch screen added' : 'Launch screen updated');
        }
    };

    const toggleActive = async (screen: LaunchScreen) => {
        const before = screens;
        setScreens((list) => list.map((s) => (s.id === screen.id ? { ...s, isActive: !s.isActive } : s)));
        const ok = await call('/api/launch-screens', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: screen.id, isActive: !screen.isActive }),
        });
        if (!ok) setScreens(before);
    };

    const remove = async (screen: LaunchScreen) => {
        if (!window.confirm(`Delete “${screen.label}”? Phones remove it the next time they sync.`)) return;
        const before = screens;
        setScreens((list) => list.filter((s) => s.id !== screen.id));
        const ok = await call(`/api/launch-screens?id=${encodeURIComponent(screen.id)}`, { method: 'DELETE' });
        if (ok) flash('Launch screen deleted');
        else setScreens(before);
    };

    /* ── What shows right now ─────────────────────────────────────────────── */

    const nightNow = isNight(config, new Date(now));
    const builtInNow: GateTheme =
        config.mode === 'auto' ? (nightNow ? 'night' : config.dayTheme) : (config.mode as GateTheme);

    const liveCustom = useMemo(() => {
        if (!config.customEnabled) return null;
        return (
            screens
                .filter((s) => screenStatus(s, now) === 'live')
                .filter((s) => s.showOn === 'all' || (s.showOn === 'night') === nightNow)
                .sort((a, b) => b.priority - a.priority || (b.startAt || '').localeCompare(a.startAt || ''))[0] ||
            null
        );
    }, [screens, config.customEnabled, now, nightNow]);

    /* ── Render ───────────────────────────────────────────────────────────── */

    return (
        <div style={{ display: 'grid', gap: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <DoorOpen size={24} /> Launch Screen
                    </h1>
                    <p style={{ color: 'var(--foreground-secondary)', fontSize: '0.85rem', marginTop: 4, maxWidth: 680 }}>
                        What customers see while the Delito app opens. Changes show from the next time a customer
                        opens the app, once their phone has downloaded them in the background.
                    </p>
                </div>
                <button onClick={fetchData} style={secondaryBtn} disabled={loading}>
                    <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} /> Refresh
                </button>
            </div>

            {error && (
                <div style={bannerStyle('error')}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}
            <AnimatePresence>
                {toast && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} style={bannerStyle('success')}>
                        <CheckCircle2 size={16} /> {toast}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Showing now */}
            <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                {liveCustom ? (
                    <ScreenThumb screen={liveCustom} size={56} />
                ) : (
                    <GatePreview theme={builtInNow} width={44} />
                )}
                <div style={{ display: 'grid', gap: 3 }}>
                    <span style={labelStyle}>Showing right now</span>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                        {liveCustom ? liveCustom.label : `${THEMES[builtInNow].name} gate`}
                    </span>
                    <span style={{ fontSize: '0.74rem', color: 'var(--foreground-secondary)' }}>
                        {liveCustom
                            ? 'Uploaded screen — live until its end time, then the gate returns.'
                            : config.mode === 'auto'
                              ? `Auto: ${THEMES[config.dayTheme].name} from ${hourLabel(config.dayStartHour)}, Night from ${hourLabel(config.nightStartHour)}. Phones use their own clock.`
                              : 'Fixed theme, all day.'}
                    </span>
                </div>
            </div>

            {/* Built-in gate */}
            <div style={{ ...cardStyle, display: 'grid', gap: 18 }}>
                <div>
                    <h2 style={sectionTitle}>Built-in gate animation</h2>
                    <p style={sectionHint}>Plays whenever no uploaded screen is live.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                    {(['auto', 'pink', 'green', 'night'] as Mode[]).map((m) => {
                        const selected = config.mode === m;
                        return (
                            <button
                                key={m}
                                onClick={() => setConfig({ ...config, mode: m })}
                                aria-pressed={selected}
                                style={{
                                    display: 'grid',
                                    justifyItems: 'center',
                                    gap: 8,
                                    padding: '14px 10px',
                                    borderRadius: 12,
                                    border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                                    background: selected ? 'rgba(34,197,94,0.06)' : 'var(--surface)',
                                    color: 'var(--foreground)',
                                    cursor: 'pointer',
                                }}
                            >
                                {m === 'auto' ? (
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <GatePreview theme={config.dayTheme} width={34} />
                                        <GatePreview theme="night" width={34} />
                                    </div>
                                ) : (
                                    <GatePreview theme={m} width={40} />
                                )}
                                <span style={{ fontWeight: 700, fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {m === 'auto' ? <Clock size={13} /> : m === 'night' ? <Moon size={13} /> : <Sun size={13} />}
                                    {m === 'auto' ? 'Auto by time' : `Always ${THEMES[m].name}`}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {config.mode === 'auto' && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <Field label="Daytime look">
                            <select
                                value={config.dayTheme}
                                onChange={(e) => setConfig({ ...config, dayTheme: e.target.value as 'pink' | 'green' })}
                                style={{ ...inputStyle, width: 180 }}
                            >
                                <option value="pink">Jaipur Pink</option>
                                <option value="green">Delito Green</option>
                            </select>
                        </Field>
                        <Field label="Day starts at">
                            <HourSelect value={config.dayStartHour} onChange={(h) => setConfig({ ...config, dayStartHour: h })} />
                        </Field>
                        <Field label="Night starts at">
                            <HourSelect value={config.nightStartHour} onChange={(h) => setConfig({ ...config, nightStartHour: h })} />
                        </Field>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <Field label="Tagline under DELITO">
                        <input
                            value={config.tagline}
                            maxLength={60}
                            onChange={(e) => setConfig({ ...config, tagline: e.target.value })}
                            placeholder={DEFAULT_TAGLINE}
                            style={{ ...inputStyle, width: 320 }}
                        />
                    </Field>
                    <SwitchRow
                        label="Use uploaded launch screens"
                        hint="Off = always the gate, even if a screen is scheduled."
                        checked={config.customEnabled}
                        onChange={(v) => setConfig({ ...config, customEnabled: v })}
                    />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={saveConfig} disabled={!configDirty || savingConfig} style={{ ...primaryBtn, opacity: !configDirty || savingConfig ? 0.5 : 1 }}>
                        {savingConfig ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save settings
                    </button>
                    {configDirty && (
                        <button onClick={() => setConfig(savedConfig)} style={secondaryBtn}>
                            Discard changes
                        </button>
                    )}
                </div>
            </div>

            {/* Upload */}
            <div style={{ ...cardStyle, display: 'grid', gap: 14 }}>
                <div>
                    <h2 style={sectionTitle}>Uploaded launch screens</h2>
                    <p style={sectionHint}>
                        For festivals and campaigns. Upload a Lottie file — <b>.lottie</b> (recommended) or <b>.json</b> with
                        images embedded — portrait 1080 × 1920, 2–4 seconds, ideally under 500 KB. Check it on lottiefiles.com
                        first: if it plays there, it plays in the app.
                    </p>
                </div>

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
                        if (file) handleAnimationFile(file);
                    }}
                    onClick={() => animationInput.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') animationInput.current?.click();
                    }}
                    style={{
                        border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border)'}`,
                        background: dragOver ? 'rgba(34,197,94,0.06)' : 'transparent',
                        borderRadius: 14,
                        padding: '26px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                    }}
                >
                    <input
                        ref={animationInput}
                        type="file"
                        accept=".lottie,.json,application/json"
                        hidden
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleAnimationFile(file);
                            e.target.value = '';
                        }}
                    />
                    {uploading === 'animation' ? (
                        <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
                            <Loader2 size={22} className="animate-spin" />
                            <span style={{ fontSize: '0.85rem' }}>Uploading and checking the file…</span>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', placeItems: 'center', gap: 6 }}>
                            <Upload size={22} style={{ color: 'var(--primary)' }} />
                            <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Drop a .lottie or .json file, or click to choose</span>
                            <span style={{ fontSize: '0.74rem', color: 'var(--foreground-secondary)' }}>Up to 3 MB</span>
                        </div>
                    )}
                </div>

                {/* List */}
                {loading && screens.length === 0 ? (
                    <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                ) : screens.length === 0 ? (
                    <p style={{ ...sectionHint, textAlign: 'center', padding: '8px 0' }}>
                        No uploaded screens yet — customers see the gate animation.
                    </p>
                ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                        {screens.map((s) => {
                            const status = screenStatus(s, now);
                            return (
                                <div
                                    key={s.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 14,
                                        padding: 12,
                                        borderRadius: 12,
                                        border: '1px solid var(--border)',
                                        flexWrap: 'wrap',
                                        opacity: status === 'ended' ? 0.6 : 1,
                                    }}
                                >
                                    <ScreenThumb screen={s} size={48} />
                                    <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 4 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{s.label}</span>
                                            <StatusPill status={status} />
                                            {liveCustom?.id === s.id && <Pill tone="green">Showing now</Pill>}
                                        </div>
                                        <span style={{ fontSize: '0.74rem', color: 'var(--foreground-secondary)' }}>
                                            {scheduleText(s)} · {showOnText(s.showOn)} · Priority {s.priority} · .{s.format === 'json' ? 'json' : 'lottie'}{' '}
                                            {formatBytes(s.mediaBytes)}
                                            {!s.fallbackImageUrl && ' · no backup image'}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <IconAction title={s.isActive ? 'Pause' : 'Turn on'} onClick={() => toggleActive(s)}>
                                            {s.isActive ? <Eye size={15} /> : <EyeOff size={15} />}
                                        </IconAction>
                                        <IconAction
                                            title="Edit"
                                            onClick={() => {
                                                setIsNew(false);
                                                setDraftInfo({});
                                                setDraft({ ...s });
                                            }}
                                        >
                                            <Pencil size={15} />
                                        </IconAction>
                                        <IconAction title="Delete" danger onClick={() => remove(s)}>
                                            <Trash2 size={15} />
                                        </IconAction>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Editor */}
            <AnimatePresence>
                {draft && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => !savingDraft && setDraft(null)}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(15,23,42,0.45)',
                            zIndex: 60,
                            display: 'grid',
                            placeItems: 'center',
                            padding: 16,
                        }}
                    >
                        <motion.div
                            initial={{ y: 16, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 16, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            role="dialog"
                            aria-label={isNew ? 'New launch screen' : 'Edit launch screen'}
                            style={{
                                ...cardStyle,
                                width: 'min(860px, 100%)',
                                maxHeight: 'calc(100vh - 32px)',
                                overflowY: 'auto',
                                padding: 20,
                                display: 'grid',
                                gap: 16,
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2 style={{ ...sectionTitle, fontSize: '1.05rem' }}>{isNew ? 'New launch screen' : 'Edit launch screen'}</h2>
                                <IconAction title="Close" onClick={() => setDraft(null)} disabled={savingDraft}>
                                    <X size={15} />
                                </IconAction>
                            </div>

                            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                                {/* Phone preview */}
                                <div style={{ display: 'grid', gap: 8, justifyItems: 'center', flex: '0 0 auto' }}>
                                    <div
                                        style={{
                                            width: 150,
                                            height: 300,
                                            borderRadius: 22,
                                            border: '6px solid #16181A',
                                            background: draft.backgroundColor,
                                            overflow: 'hidden',
                                            display: 'grid',
                                            placeItems: 'center',
                                        }}
                                    >
                                        {draft.fallbackImageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={draft.fallbackImageUrl}
                                                alt="Backup image preview"
                                                style={{ width: '100%', height: '100%', objectFit: draft.scaleMode === 'crop' ? 'cover' : 'contain' }}
                                            />
                                        ) : (
                                            <FileJson size={34} color={readableOn(draft.backgroundColor)} />
                                        )}
                                    </div>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', maxWidth: 150, textAlign: 'center' }}>
                                        Background + backup image. Preview the animation itself on lottiefiles.com.
                                    </span>
                                </div>

                                <div style={{ flex: '1 1 380px', display: 'grid', gap: 14, minWidth: 0 }}>
                                    <div style={{ ...bannerStyle('success'), background: 'rgba(148,163,184,0.12)', color: 'var(--foreground)', fontWeight: 500 }}>
                                        <FileJson size={16} />
                                        <span style={{ flex: 1 }}>
                                            .{draft.format === 'json' ? 'json' : 'lottie'} · {formatBytes(draft.mediaBytes)}
                                            {draftInfo.width && draftInfo.height ? ` · ${draftInfo.width} × ${draftInfo.height}` : ''}
                                            {draftInfo.durationMs ? ` · ${(draftInfo.durationMs / 1000).toFixed(1)} s` : ''}
                                            {draft.mediaBytes > 1024 * 1024 && (
                                                <span style={{ color: '#D97706' }}> — large; aim for under 1 MB</span>
                                            )}
                                        </span>
                                        <button onClick={() => animationInput.current?.click()} style={miniBtn} disabled={!!uploading}>
                                            {uploading === 'animation' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Replace
                                        </button>
                                    </div>

                                    <Field label="Name (admin only)">
                                        <input
                                            value={draft.label}
                                            maxLength={80}
                                            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                                            placeholder="Diwali 2026"
                                            style={inputStyle}
                                        />
                                    </Field>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                                        <Field label="Starts">
                                            <input
                                                type="datetime-local"
                                                value={toLocalInput(draft.startAt)}
                                                onChange={(e) => setDraft({ ...draft, startAt: fromLocalInput(e.target.value) })}
                                                style={inputStyle}
                                            />
                                        </Field>
                                        <Field label="Ends">
                                            <input
                                                type="datetime-local"
                                                value={toLocalInput(draft.endAt)}
                                                onChange={(e) => setDraft({ ...draft, endAt: fromLocalInput(e.target.value) })}
                                                style={inputStyle}
                                            />
                                        </Field>
                                        <Field label="Show">
                                            <select
                                                value={draft.showOn}
                                                onChange={(e) => setDraft({ ...draft, showOn: e.target.value as LaunchScreen['showOn'] })}
                                                style={inputStyle}
                                            >
                                                <option value="all">All day</option>
                                                <option value="day">Daytime only</option>
                                                <option value="night">Night only</option>
                                            </select>
                                        </Field>
                                        <Field label="Priority (0–100)">
                                            <input
                                                type="number"
                                                min={0}
                                                max={100}
                                                value={draft.priority}
                                                onChange={(e) => setDraft({ ...draft, priority: clamp(Number(e.target.value) || 0, 0, 100) })}
                                                style={inputStyle}
                                            />
                                        </Field>
                                        <Field label="Background" group>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <input
                                                    type="color"
                                                    value={draft.backgroundColor}
                                                    onChange={(e) => setDraft({ ...draft, backgroundColor: e.target.value.toUpperCase() })}
                                                    style={{ width: 42, height: 38, border: '1px solid var(--border)', borderRadius: 9, background: 'none', padding: 2 }}
                                                    aria-label="Background colour"
                                                />
                                                <input
                                                    value={draft.backgroundColor}
                                                    onChange={(e) => setDraft({ ...draft, backgroundColor: e.target.value })}
                                                    style={inputStyle}
                                                    aria-label="Background colour hex"
                                                />
                                            </div>
                                        </Field>
                                        <Field label="Fit">
                                            <select
                                                value={draft.scaleMode}
                                                onChange={(e) => setDraft({ ...draft, scaleMode: e.target.value as 'fit' | 'crop' })}
                                                style={inputStyle}
                                            >
                                                <option value="fit">Show whole animation</option>
                                                <option value="crop">Fill the screen (edges may crop)</option>
                                            </select>
                                        </Field>
                                        <Field label="Max length (seconds)">
                                            <input
                                                type="number"
                                                min={1}
                                                max={8}
                                                step={0.5}
                                                value={draft.maxDurationMs / 1000}
                                                onChange={(e) =>
                                                    setDraft({ ...draft, maxDurationMs: clamp(Math.round((Number(e.target.value) || 4) * 1000), 1000, 8000) })
                                                }
                                                style={inputStyle}
                                            />
                                        </Field>
                                    </div>

                                    <Field label="Backup image (optional)" group>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <input
                                                ref={fallbackInput}
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp"
                                                hidden
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handleFallbackFile(file);
                                                    e.target.value = '';
                                                }}
                                            />
                                            <button onClick={() => fallbackInput.current?.click()} style={secondaryBtn} disabled={!!uploading}>
                                                {uploading === 'fallback' ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
                                                {draft.fallbackImageUrl ? 'Replace image' : 'Upload image'}
                                            </button>
                                            {draft.fallbackImageUrl && (
                                                <button onClick={() => setDraft({ ...draft, fallbackImageUrl: '' })} style={secondaryBtn}>
                                                    Remove
                                                </button>
                                            )}
                                            <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                                PNG, JPEG or WebP under 1 MB. Shown if the animation can’t play.
                                            </span>
                                        </div>
                                    </Field>

                                    <SwitchRow
                                        label="Active"
                                        hint="Off = saved but never shown."
                                        checked={draft.isActive}
                                        onChange={(v) => setDraft({ ...draft, isActive: v })}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                <button onClick={() => setDraft(null)} style={secondaryBtn} disabled={savingDraft}>
                                    Cancel
                                </button>
                                <button onClick={saveDraft} style={{ ...primaryBtn, opacity: savingDraft || !!uploading ? 0.6 : 1 }} disabled={savingDraft || !!uploading}>
                                    {savingDraft ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                    {isNew ? 'Add launch screen' : 'Save changes'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

type Status = 'live' | 'scheduled' | 'ended' | 'paused';

function screenStatus(s: LaunchScreen, now: number): Status {
    if (!s.isActive) return 'paused';
    if (s.endAt && new Date(s.endAt).getTime() <= now) return 'ended';
    if (s.startAt && new Date(s.startAt).getTime() > now) return 'scheduled';
    return 'live';
}

/** Mirrors LaunchScreenRepository.isNight in the app. */
function isNight(c: LaunchConfig, date: Date): boolean {
    const h = date.getHours();
    if (c.dayStartHour === c.nightStartHour) return false;
    return c.dayStartHour < c.nightStartHour
        ? h < c.dayStartHour || h >= c.nightStartHour
        : h >= c.nightStartHour && h < c.dayStartHour;
}

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

function hourLabel(h: number): string {
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${suffix}`;
}

function formatBytes(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showOnText(v: LaunchScreen['showOn']): string {
    return v === 'day' ? 'Daytime only' : v === 'night' ? 'Night only' : 'All day';
}

function fmtDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function scheduleText(s: LaunchScreen): string {
    if (!s.startAt && !s.endAt) return 'No end date';
    if (s.startAt && s.endAt) return `${fmtDateTime(s.startAt)} → ${fmtDateTime(s.endAt)}`;
    if (s.startAt) return `From ${fmtDateTime(s.startAt)}`;
    return `Until ${fmtDateTime(s.endAt as string)}`;
}

/** Black or white, whichever reads on the given background. */
function readableOn(hex: string): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#475569';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? '#334155' : '#F8FAFC';
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

/* ── Small components ─────────────────────────────────────────────────────── */

/** A tiny drawing of the gate in a theme's colours. */
function GatePreview({ theme, width }: { theme: GateTheme; width: number }) {
    const t = THEMES[theme];
    return (
        <svg width={width} height={width * 1.45} viewBox="0 0 100 145" role="img" aria-label={`${t.name} gate`} style={{ borderRadius: 8, flexShrink: 0 }}>
            <rect width="100" height="145" fill={t.wall} />
            {theme === 'night' && (
                <g fill="#FFF6D6">
                    <circle cx="14" cy="16" r="1.6" />
                    <circle cx="84" cy="12" r="1.3" />
                    <circle cx="90" cy="40" r="1.1" />
                    <circle cx="10" cy="52" r="1.2" />
                </g>
            )}
            <path d="M18 128 V62 Q18 26 50 14 Q82 26 82 62 V128 Z" fill={t.frame} />
            <path d="M27 128 V64 Q27 36 50 26 Q73 36 73 64 V128 Z" fill={t.door} />
            <line x1="50" y1="27" x2="50" y2="128" stroke={t.trim} strokeWidth="2" />
            <rect x="32" y="74" width="14" height="22" fill="none" stroke={t.trim} strokeWidth="1.4" />
            <rect x="54" y="74" width="14" height="22" fill="none" stroke={t.trim} strokeWidth="1.4" />
            <rect x="12" y="128" width="76" height="6" fill={t.frame} opacity="0.55" />
            {theme === 'night' && (
                <g>
                    <path d="M9 131 Q13 137 17 131 Z" fill="#C9962E" />
                    <path d="M13 122 C15 125 15 128 13 130 C11 128 11 125 13 122 Z" fill="#FFB938" />
                    <path d="M83 131 Q87 137 91 131 Z" fill="#C9962E" />
                    <path d="M87 122 C89 125 89 128 87 130 C85 128 85 125 87 122 Z" fill="#FFB938" />
                </g>
            )}
        </svg>
    );
}

function ScreenThumb({ screen, size }: { screen: LaunchScreen; size: number }) {
    return (
        <div
            style={{
                width: size,
                height: size * 1.6,
                borderRadius: 9,
                background: screen.backgroundColor,
                border: '1px solid var(--border)',
                overflow: 'hidden',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
            }}
        >
            {screen.fallbackImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={screen.fallbackImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
                <FileJson size={size * 0.4} color={readableOn(screen.backgroundColor)} />
            )}
        </div>
    );
}

function HourSelect({ value, onChange }: { value: number; onChange: (h: number) => void }) {
    return (
        <select value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...inputStyle, width: 140 }}>
            {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                    {hourLabel(h)}
                </option>
            ))}
        </select>
    );
}

function StatusPill({ status }: { status: Status }) {
    if (status === 'live') return <Pill tone="green">Live</Pill>;
    if (status === 'scheduled') return <Pill tone="purple">Scheduled</Pill>;
    if (status === 'ended') return <Pill tone="grey">Ended</Pill>;
    return <Pill tone="grey">Paused</Pill>;
}

/** `group` = several controls inside, so a <label> would hijack clicks for the first one. */
function Field({ label, children, group }: { label: string; children: React.ReactNode; group?: boolean }) {
    if (group) {
        return (
            <div role="group" aria-label={label} style={{ display: 'grid', gap: 5 }}>
                <span style={labelStyle}>{label}</span>
                {children}
            </div>
        );
    }
    return (
        <label style={{ display: 'grid', gap: 5 }}>
            <span style={labelStyle}>{label}</span>
            {children}
        </label>
    );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'green' | 'grey' | 'purple' }) {
    const map = {
        green: { bg: 'rgba(34,197,94,0.14)', fg: '#16A34A' },
        grey: { bg: 'rgba(148,163,184,0.16)', fg: 'var(--foreground-secondary)' },
        purple: { bg: 'rgba(168,85,247,0.14)', fg: '#A855F7' },
    }[tone];
    return (
        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, background: map.bg, color: map.fg }}>
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
            aria-label={title}
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
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: 'none', border: 'none', padding: 0, color: 'var(--foreground)', textAlign: 'left' }}
        >
            <span
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
                {hint && <span style={{ fontSize: '0.71rem', color: 'var(--foreground-secondary)' }}>{hint}</span>}
            </span>
        </button>
    );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: 16,
};

const sectionTitle: React.CSSProperties = { fontSize: '0.98rem', fontWeight: 800, margin: 0 };
const sectionHint: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 3 };

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

const miniBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 11px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--foreground)',
    fontWeight: 700,
    fontSize: '0.72rem',
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
