'use client';

/**
 * Hero Canvas Editor
 * ────────────────────────────────────────────────────────────────────────────
 * A true-to-app preview of the customer home screen's green hero, with the
 * banner media rendered through the exact same maths the app uses. Drag to pan,
 * scroll or use the slider to zoom, and the editor keeps the media locked to a
 * cover fit so an empty edge can never appear.
 *
 * The overlays answer the two questions that actually matter:
 *   • "will this get cropped?"  → the green box is the slice of the source that
 *     actually shows; everything outside it is cut. The canvas is a fixed aspect
 *     ratio, so that answer is the same on every phone — the device strip along
 *     the bottom shows the same crop at four sizes, not four different crops.
 *   • "what does it sit next to?" → the tinted bar above the canvas is the real
 *     header (address, coins, avatar) at this banner's own colour. Nothing of
 *     the app's UI covers the artwork any more — the search bar moved down into
 *     the feed — so the only edge to design around is the zigzag the dashed line
 *     traces, plus the shaded band the coupon rail tucks under.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Crosshair,
    Grid3x3,
    Layers,
    Maximize2,
    Minus,
    Plus,
    RotateCcw,
    Smartphone,
    Anchor,
    Info,
    AlertTriangle,
    XCircle,
} from 'lucide-react';
import {
    APP_GREEN,
    DEFAULT_HEADER_TINT_OPACITY,
    DEVICE_LABELS,
    DEVICE_WIDTHS_DP,
    DESIGN_WIDTH_DP,
    HEADER_BAND_HEIGHT_DP,
    HERO_ASPECT,
    HERO_OVERLAP_DP,
    MAX_ZOOM,
    MIN_ZOOM,
    RECOMMENDED_HEIGHT_PX,
    RECOMMENDED_WIDTH_PX,
    analyseFit,
    autoFit,
    bundledHeroFit,
    clampFitAllDevices,
    fitToImageStyle,
    headerTintCss,
    heroBox,
    heroClipPath,
    heroOutlinePath,
    imageRectToBox,
    safeImageRect,
    type HeroFit,
} from '@/lib/hero-canvas';

/** Preview scale: CSS pixels per Android dp. */
const PX_PER_DP = 1.15;
const THUMB_PX_PER_DP = 0.42;

interface Props {
    mediaUrl: string;
    mediaType: 'image' | 'gif';
    fileBytes?: number;
    fit: HeroFit;
    onChange: (fit: HeroFit) => void;
    /** Reported upward once the browser knows the media's real pixel size. */
    onNaturalSize?: (w: number, h: number) => void;
    naturalWidth?: number;
    naturalHeight?: number;
    /**
     * This banner's own header bar colour. The bar sits above the canvas, so it
     * crops nothing — it's drawn here purely so the colour can be judged
     * against the artwork it ships with. Empty means the app's green.
     */
    headerBandColor?: string;
    headerBandOpacity?: number;
}

export default function HeroCanvasEditor({
    mediaUrl,
    mediaType,
    fileBytes = 0,
    fit,
    onChange,
    onNaturalSize,
    naturalWidth = 0,
    naturalHeight = 0,
    headerBandColor = '',
    headerBandOpacity = DEFAULT_HEADER_TINT_OPACITY,
}: Props) {
    const [deviceWidth, setDeviceWidth] = useState<number>(DESIGN_WIDTH_DP);
    const [imgW, setImgW] = useState(naturalWidth);
    const [imgH, setImgH] = useState(naturalHeight);

    const [showSafe, setShowSafe] = useState(true);
    const [showGrid, setShowGrid] = useState(false);

    const dragRef = useRef<{ x: number; y: number; fit: HeroFit } | null>(null);
    const surfaceRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setImgW(naturalWidth);
        setImgH(naturalHeight);
    }, [naturalWidth, naturalHeight, mediaUrl]);

    // The canvas takes its height from its width, so the preview must too —
    // otherwise the editor would be framing against a box shape no phone has.
    const box = useMemo(() => heroBox(deviceWidth), [deviceWidth]);
    const previewW = box.w * PX_PER_DP;
    const previewH = box.h * PX_PER_DP;

    const apply = useCallback(
        (next: HeroFit) => {
            if (!imgW || !imgH) {
                onChange({
                    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.zoom)),
                    offsetX: next.offsetX,
                    offsetY: next.offsetY,
                });
                return;
            }
            // Clamped against every device width, not just the previewed one —
            // a pan that is legal at 412dp can expose an edge at 480dp.
            onChange(clampFitAllDevices(next, imgW, imgH));
        },
        [imgW, imgH, onChange]
    );

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const el = e.currentTarget;
        if (!el.naturalWidth || !el.naturalHeight) return;
        setImgW(el.naturalWidth);
        setImgH(el.naturalHeight);
        onNaturalSize?.(el.naturalWidth, el.naturalHeight);
    };

    // ── Pan ──────────────────────────────────────────────────────────────────
    const onPointerDown = (e: React.PointerEvent) => {
        if (!mediaUrl) return;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragRef.current = { x: e.clientX, y: e.clientY, fit };
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const start = dragRef.current;
        if (!start) return;
        // Screen pixels → dp → fraction of the box, so a drag moves the media
        // by exactly the distance under the cursor.
        const dxDp = (e.clientX - start.x) / PX_PER_DP;
        const dyDp = (e.clientY - start.y) / PX_PER_DP;
        apply({
            zoom: start.fit.zoom,
            offsetX: start.fit.offsetX + dxDp / box.w,
            offsetY: start.fit.offsetY + dyDp / box.h,
        });
    };

    const endDrag = () => {
        dragRef.current = null;
    };

    /**
     * Zoom while holding one point of the artwork still.
     *
     * Changing `zoom` and leaving `offsetX/offsetY` alone looks like it should
     * be neutral, and isn't: those offsets are a displacement of the media's own
     * centre, so keeping them fixed pins the *media's* centre while the media
     * grows around it. Anything panned off-centre then marches further
     * off-centre with every zoom step — "I zoomed and it shifted left" — and you
     * chase it back with the mouse, which is the inconsistency this editor kept
     * producing.
     *
     * So: solve for the offsets that keep the source point at [anchorX, anchorY]
     * (in dp, from the box's top-left) under that same spot after the zoom. The
     * wheel passes the cursor; the slider and buttons pass the box centre, which
     * is the anchor you expect when you're not pointing at anything.
     */
    const zoomAbout = (nextZoom: number, anchorX: number, anchorY: number) => {
        const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
        if (!imgW || !imgH) {
            apply({ ...fit, zoom: z1 });
            return;
        }

        const cover = Math.max(box.w / imgW, box.h / imgH);
        const w0 = imgW * cover * fit.zoom;
        const h0 = imgH * cover * fit.zoom;
        const left0 = (box.w - w0) / 2 + fit.offsetX * box.w;
        const top0 = (box.h - h0) / 2 + fit.offsetY * box.h;

        // Where the anchor sits within the painted media, as a 0…1 fraction.
        const u = (anchorX - left0) / w0;
        const v = (anchorY - top0) / h0;

        const w1 = imgW * cover * z1;
        const h1 = imgH * cover * z1;
        const left1 = anchorX - u * w1;
        const top1 = anchorY - v * h1;

        apply({
            zoom: z1,
            offsetX: (left1 - (box.w - w1) / 2) / box.w,
            offsetY: (top1 - (box.h - h1) / 2) / box.h,
        });
    };

    /** Zoom from a control rather than the cursor: hold the middle of the view. */
    const zoomFromControl = (nextZoom: number) => zoomAbout(nextZoom, box.w / 2, box.h / 2);

    const onWheel = (e: React.WheelEvent) => {
        if (!mediaUrl) return;
        const delta = e.deltaY > 0 ? -0.06 : 0.06;
        const rect = surfaceRef.current?.getBoundingClientRect();
        if (!rect) {
            zoomFromControl(fit.zoom + delta);
            return;
        }
        // Cursor → box dp, so the pixel under the pointer stays under it.
        zoomAbout(
            fit.zoom + delta,
            (e.clientX - rect.left) / PX_PER_DP,
            (e.clientY - rect.top) / PX_PER_DP
        );
    };

    // Arrow-key nudging, 1dp at a time — for the last pixel of alignment.
    const onKeyDown = (e: React.KeyboardEvent) => {
        const step = e.shiftKey ? 8 : 1;
        const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
        };
        const move = moves[e.key];
        if (!move) return;
        e.preventDefault();
        apply({
            zoom: fit.zoom,
            offsetX: fit.offsetX + move[0] / box.w,
            offsetY: fit.offsetY + move[1] / box.h,
        });
    };

    // ── Derived overlays ─────────────────────────────────────────────────────
    const safeRect = useMemo(
        () => (imgW && imgH ? safeImageRect(imgW, imgH, fit) : null),
        [imgW, imgH, fit]
    );

    const safeBox = useMemo(() => {
        if (!safeRect || !imgW || !imgH) return null;
        const r = imageRectToBox(safeRect, box, imgW, imgH, fit);
        return {
            left: r.left * PX_PER_DP,
            top: r.top * PX_PER_DP,
            width: r.width * PX_PER_DP,
            height: r.height * PX_PER_DP,
        };
    }, [safeRect, box, imgW, imgH, fit]);

    const warnings = useMemo(() => {
        if (!imgW || !imgH) return [];
        const list = analyseFit(imgW, imgH, fit, fileBytes, mediaType);

        // The saved size is what every stored offset was authored against, and
        // what the app falls back to before the image decodes. If it disagrees
        // with the file we just measured, the two sides are fitting different
        // aspect ratios — a dp or two at zoom 1, multiplied by the zoom after
        // that. Saving re-records it.
        const savedAspect = naturalWidth && naturalHeight ? naturalWidth / naturalHeight : 0;
        const realAspect = imgW / imgH;
        if (savedAspect && Math.abs(savedAspect - realAspect) / realAspect > 0.005) {
            list.unshift({
                level: 'error',
                message: `Saved size (${naturalWidth}×${naturalHeight}) doesn't match this file (${imgW}×${imgH}) — they're different shapes, so the alignment drifts, and the further you zoom the more it drifts. Save this banner to re-record it.`,
            });
        }

        return list;
    }, [imgW, imgH, fit, fileBytes, mediaType, naturalWidth, naturalHeight]);

    // Painted against the PREVIEW box in CSS pixels, not the dp box — the two
    // differ by PX_PER_DP, and mixing them silently under-applies the pan.
    const imageStyle = fitToImageStyle({ w: previewW, h: previewH }, imgW, imgH, fit);

    const safeCoverage = safeRect
        ? Math.round(
              Math.max(0, safeRect.x1 - safeRect.x0) *
                  Math.max(0, safeRect.y1 - safeRect.y0) *
                  100
          )
        : 0;

    return (
        <div style={{ display: 'grid', gap: 18 }}>
            <div
                style={{
                    display: 'flex',
                    gap: 20,
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                }}
            >
                {/* ── Main preview ─────────────────────────────────────────── */}
                <div style={{ display: 'grid', gap: 10 }}>
                    {/* The header bar, above the canvas exactly as the app
                        stacks them. It crops nothing — it's here so the tint
                        can be judged against the artwork it ships with. */}
                    <div
                        style={{
                            width: previewW,
                            height: HEADER_BAND_HEIGHT_DP * PX_PER_DP,
                            marginBottom: -10,
                            background: headerTintCss(headerBandColor, headerBandOpacity),
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'space-between',
                            padding: '0 14px 12px',
                            boxSizing: 'border-box',
                            color: 'rgba(255,255,255,0.92)',
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: 0.2,
                            transition: 'width 160ms ease, background 160ms ease',
                        }}
                    >
                        <span>📍 Home · address</span>
                        <span>🪙 · 👤</span>
                    </div>

                    <div
                        ref={surfaceRef}
                        tabIndex={0}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onWheel={onWheel}
                        onKeyDown={onKeyDown}
                        style={{
                            position: 'relative',
                            width: previewW,
                            height: previewH,
                            cursor: mediaUrl ? 'grab' : 'default',
                            touchAction: 'none',
                            outline: 'none',
                            borderRadius: 4,
                            transition: 'width 160ms ease',
                        }}
                    >
                        {/* Hero body, clipped exactly like the app: square top
                            and sides, zigzag along the bottom. */}
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                clipPath: heroClipPath(previewW, previewH, PX_PER_DP),
                                background:
                                    'linear-gradient(180deg, #1B7A3E 0%, #1B7A3E 60%, #2E9C55 100%)',
                                overflow: 'hidden',
                            }}
                        >
                            {mediaUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={mediaUrl}
                                    alt="Hero banner preview"
                                    onLoad={handleImageLoad}
                                    draggable={false}
                                    style={{
                                        ...imageStyle,
                                        userSelect: 'none',
                                        pointerEvents: 'none',
                                    }}
                                />
                            ) : (
                                <div
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        display: 'grid',
                                        placeItems: 'center',
                                        color: 'rgba(255,255,255,0.75)',
                                        fontSize: '0.85rem',
                                    }}
                                >
                                    Upload an image or GIF to begin
                                </div>
                            )}
                        </div>

                        {/* Overlays sit above the clip so the guides stay crisp */}
                        <svg
                            width={previewW}
                            height={previewH}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                pointerEvents: 'none',
                            }}
                        >
                            {/* The canvas outline itself */}
                            <path
                                d={heroOutlinePath(previewW - 1, previewH - 1, PX_PER_DP)}
                                fill="none"
                                stroke="rgba(255,255,255,0.9)"
                                strokeWidth={1.5}
                                strokeDasharray="6 4"
                            />

                            {showGrid && (
                                <g stroke="rgba(255,255,255,0.35)" strokeWidth={1}>
                                    <line x1={previewW / 3} y1={0} x2={previewW / 3} y2={previewH} />
                                    <line
                                        x1={(previewW * 2) / 3}
                                        y1={0}
                                        x2={(previewW * 2) / 3}
                                        y2={previewH}
                                    />
                                    <line x1={0} y1={previewH / 3} x2={previewW} y2={previewH / 3} />
                                    <line
                                        x1={0}
                                        y1={(previewH * 2) / 3}
                                        x2={previewW}
                                        y2={(previewH * 2) / 3}
                                    />
                                </g>
                            )}

                            {/* Cross-device safe area */}
                            {showSafe && safeBox && (
                                <>
                                    <rect
                                        x={safeBox.left}
                                        y={safeBox.top}
                                        width={safeBox.width}
                                        height={safeBox.height}
                                        fill="none"
                                        stroke="#4ADE80"
                                        strokeWidth={2}
                                    />
                                    <text
                                        x={safeBox.left + 6}
                                        y={safeBox.top + 16}
                                        fill="#4ADE80"
                                        fontSize={11}
                                        fontWeight={700}
                                    >
                                        SAFE ON ALL SIZES
                                    </text>
                                </>
                            )}

                            {/* Overlap band — hidden behind the coupon rail */}
                            <rect
                                x={0}
                                y={previewH - HERO_OVERLAP_DP * PX_PER_DP}
                                width={previewW}
                                height={HERO_OVERLAP_DP * PX_PER_DP}
                                fill="rgba(0,0,0,0.28)"
                            />
                        </svg>

                    </div>

                    <div
                        style={{
                            fontSize: '0.72rem',
                            color: 'var(--foreground-secondary)',
                            textAlign: 'center',
                        }}
                    >
                        Drag to reposition · scroll to zoom · arrow keys nudge 1dp (shift = 8dp)
                    </div>
                </div>

                {/* ── Controls ─────────────────────────────────────────────── */}
                <div style={{ flex: '1 1 320px', minWidth: 300, display: 'grid', gap: 16 }}>
                    <section style={{ display: 'grid', gap: 8 }}>
                        <Label icon={<Smartphone size={14} />} text="Preview width" />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {DEVICE_WIDTHS_DP.map((w) => (
                                <button
                                    key={w}
                                    onClick={() => setDeviceWidth(w)}
                                    style={{
                                        padding: '7px 12px',
                                        borderRadius: 8,
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        border: `1px solid ${deviceWidth === w ? 'var(--primary)' : 'var(--border)'}`,
                                        background:
                                            deviceWidth === w ? 'var(--primary)' : 'var(--surface)',
                                        color: deviceWidth === w ? '#fff' : 'var(--foreground)',
                                    }}
                                >
                                    {DEVICE_LABELS[w]}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section style={{ display: 'grid', gap: 8 }}>
                        <Label icon={<Maximize2 size={14} />} text={`Zoom · ${fit.zoom.toFixed(2)}×`} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <IconBtn
                                onClick={() => zoomFromControl(fit.zoom - 0.1)}
                                title="Zoom out"
                            >
                                <Minus size={14} />
                            </IconBtn>
                            <input
                                type="range"
                                min={MIN_ZOOM}
                                max={MAX_ZOOM}
                                step={0.01}
                                value={fit.zoom}
                                onChange={(e) => zoomFromControl(Number(e.target.value))}
                                style={{ flex: 1, accentColor: 'var(--primary)' }}
                            />
                            <IconBtn
                                onClick={() => zoomFromControl(fit.zoom + 0.1)}
                                title="Zoom in"
                            >
                                <Plus size={14} />
                            </IconBtn>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>
                            1.00× is a plain cover fit — the media exactly fills the canvas with
                            nothing to spare. Zooming in trades visible area for size, and holds
                            the middle of the view still; scroll on the preview to zoom about the
                            cursor instead.
                        </div>
                    </section>

                    <section style={{ display: 'grid', gap: 8 }}>
                        <Label icon={<Layers size={14} />} text="Guides" />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Toggle on={showSafe} onClick={() => setShowSafe((v) => !v)} icon={<Crosshair size={13} />}>
                                Safe area
                            </Toggle>
                            <Toggle on={showGrid} onClick={() => setShowGrid((v) => !v)} icon={<Grid3x3 size={13} />}>
                                Thirds grid
                            </Toggle>
                        </div>
                    </section>

                    <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                            onClick={() => apply(autoFit())}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '9px 14px',
                                borderRadius: 9,
                                border: '1px solid var(--border)',
                                background: 'var(--surface)',
                                color: 'var(--foreground)',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            <RotateCcw size={14} /> Auto fit (reset)
                        </button>
                        <button
                            onClick={() => imgW && imgH && apply(bundledHeroFit(imgW, imgH))}
                            disabled={!imgW || !imgH}
                            title="Place this exactly where the app's built-in hero artwork used to sit"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '9px 14px',
                                borderRadius: 9,
                                border: '1px solid var(--border)',
                                background: 'var(--surface)',
                                color: 'var(--foreground)',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                cursor: imgW && imgH ? 'pointer' : 'not-allowed',
                                opacity: imgW && imgH ? 1 : 0.5,
                            }}
                        >
                            <Anchor size={14} /> Match built-in placement
                        </button>
                        <button
                            onClick={() => apply({ ...fit, offsetX: 0 })}
                            style={ghostBtn}
                        >
                            Centre horizontally
                        </button>
                        <button onClick={() => apply({ ...fit, offsetY: 0 })} style={ghostBtn}>
                            Centre vertically
                        </button>
                    </section>

                    {/* Facts */}
                    <section
                        style={{
                            border: '1px solid var(--border)',
                            borderRadius: 12,
                            padding: 12,
                            display: 'grid',
                            gap: 6,
                            fontSize: '0.75rem',
                        }}
                    >
                        <Row
                            k="Source"
                            v={imgW && imgH ? `${imgW} × ${imgH} px (${(imgW / imgH).toFixed(2)}:1)` : '—'}
                        />
                        <Row k="Recommended" v={`${RECOMMENDED_WIDTH_PX} × ${RECOMMENDED_HEIGHT_PX} px (1.06:1)`} />
                        <Row k="Visible on all phones" v={`${safeCoverage}% of the source`} />
                        <Row
                            k="Offset"
                            v={`${(fit.offsetX * 100).toFixed(1)}% × ${(fit.offsetY * 100).toFixed(1)}%`}
                        />
                    </section>

                    {warnings.length > 0 && (
                        <section style={{ display: 'grid', gap: 6 }}>
                            {warnings.map((w, i) => (
                                <div
                                    key={i}
                                    style={{
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'flex-start',
                                        padding: '9px 11px',
                                        borderRadius: 9,
                                        fontSize: '0.73rem',
                                        lineHeight: 1.45,
                                        background:
                                            w.level === 'error'
                                                ? 'rgba(239,68,68,0.10)'
                                                : w.level === 'warn'
                                                  ? 'rgba(245,158,11,0.10)'
                                                  : 'rgba(59,130,246,0.10)',
                                        color:
                                            w.level === 'error'
                                                ? '#EF4444'
                                                : w.level === 'warn'
                                                  ? '#D97706'
                                                  : '#3B82F6',
                                    }}
                                >
                                    {w.level === 'error' ? (
                                        <XCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                    ) : w.level === 'warn' ? (
                                        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                    ) : (
                                        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                                    )}
                                    <span>{w.message}</span>
                                </div>
                            ))}
                        </section>
                    )}
                </div>
            </div>

            {/* ── Every device size at once ────────────────────────────────── */}
            {mediaUrl && (
                <section style={{ display: 'grid', gap: 8 }}>
                    <Label icon={<Smartphone size={14} />} text="How it lands on every screen size" />
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {DEVICE_WIDTHS_DP.map((w) => (
                            <Thumb
                                key={w}
                                widthDp={w}
                                mediaUrl={mediaUrl}
                                fit={fit}
                                imgW={imgW}
                                imgH={imgH}
                                bandColor={headerBandColor}
                                bandOpacity={headerBandOpacity}
                                active={w === deviceWidth}
                                onClick={() => setDeviceWidth(w)}
                            />
                        ))}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                        The canvas keeps one shape on every phone and only changes size, so
                        these four crops are identical — what you frame above is what ships.
                    </div>
                </section>
            )}
        </div>
    );
}

/* ── Small presentational helpers ─────────────────────────────────────────── */

const ghostBtn: React.CSSProperties = {
    padding: '9px 14px',
    borderRadius: 9,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--foreground-secondary)',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
};

function Label({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: 'var(--foreground-secondary)',
            }}
        >
            {icon}
            {text}
        </div>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--foreground-secondary)' }}>{k}</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
        </div>
    );
}

function IconBtn({
    children,
    onClick,
    title,
}: {
    children: React.ReactNode;
    onClick: () => void;
    title: string;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            style={{
                width: 30,
                height: 30,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--foreground)',
                cursor: 'pointer',
            }}
        >
            {children}
        </button>
    );
}

function Toggle({
    on,
    onClick,
    icon,
    children,
}: {
    on: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 11px',
                borderRadius: 8,
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                background: on ? 'rgba(34,197,94,0.12)' : 'var(--surface)',
                color: on ? 'var(--primary)' : 'var(--foreground-secondary)',
            }}
        >
            {icon}
            {children}
        </button>
    );
}

function Thumb({
    widthDp,
    mediaUrl,
    fit,
    imgW,
    imgH,
    bandColor,
    bandOpacity,
    active,
    onClick,
}: {
    widthDp: number;
    mediaUrl: string;
    fit: HeroFit;
    imgW: number;
    imgH: number;
    bandColor: string;
    bandOpacity: number;
    active: boolean;
    onClick: () => void;
}) {
    const w = widthDp * THUMB_PX_PER_DP;
    const h = (widthDp / HERO_ASPECT) * THUMB_PX_PER_DP;
    const imageStyle = fitToImageStyle({ w, h }, imgW, imgH, fit);

    return (
        <button
            onClick={onClick}
            style={{
                display: 'grid',
                gap: 5,
                padding: 6,
                borderRadius: 10,
                cursor: 'pointer',
                background: 'transparent',
                border: `1px solid ${active ? 'var(--primary)' : 'transparent'}`,
            }}
        >
            {/* Header bar above the canvas, to scale. */}
            <div
                style={{
                    width: w,
                    height: HEADER_BAND_HEIGHT_DP * THUMB_PX_PER_DP,
                    background: headerTintCss(bandColor, bandOpacity, APP_GREEN),
                }}
            />
            <div
                style={{
                    position: 'relative',
                    width: w,
                    height: h,
                    clipPath: heroClipPath(w, h, THUMB_PX_PER_DP),
                    background: 'linear-gradient(180deg, #1B7A3E 0%, #2E9C55 100%)',
                    overflow: 'hidden',
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={mediaUrl}
                    alt=""
                    draggable={false}
                    style={imageStyle}
                />
            </div>
            <span
                style={{
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    color: active ? 'var(--primary)' : 'var(--foreground-secondary)',
                }}
            >
                {widthDp}dp
            </span>
        </button>
    );
}
