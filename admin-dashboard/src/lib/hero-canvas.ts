/**
 * Hero canvas geometry — the single source of truth shared by the admin
 * alignment editor and (by mirrored implementation) the customer app.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * THE PROBLEM THIS SOLVES
 *
 * The customer app's hero canvas is
 * `Modifier.fillMaxWidth().aspectRatio(HeroCanvasAspect)`, clipped to a shape
 * with a zigzag bottom edge. It fills the device width and takes its height
 * from that, so the box is the same 1.37:1 shape everywhere and only its
 * absolute size changes:
 *
 *     360dp wide → 360 × 262        412dp wide → 412 × 300
 *     392dp wide → 392 × 285        480dp wide → 480 × 350
 *
 * Since the canvas became a fixed aspect ratio (see `HERO_ASPECT`) every device
 * shares one box shape, so one crop suits all of them — but the *source* files
 * don't share that shape, so the admin still saves a *fit* rather than exporting
 * a crop, and both sides paint it identically:
 *
 *     scale  = max(boxW / imgW, boxH / imgH) * zoom      // cover, then zoom
 *     width  = imgW * scale
 *     height = imgH * scale
 *     left   = (boxW - width)  / 2 + offsetX * boxW
 *     top    = (boxH - height) / 2 + offsetY * boxH
 *
 * and the media is painted at exactly that rect inside a clipped box. Both
 * sides position explicitly — CSS with absolute left/top/width/height, Compose
 * with `.requiredSize().offset()` (required, not plain `.size()`: that is only a
 * preferred size and Compose coerces it back into the hero box, which squashes
 * the rect and reopens the very gap this model exists to prevent) — rather than
 * leaning on `object-fit: cover` or `ContentScale.Crop` plus a transform. That
 * combination looks equivalent and is not: `object-fit: cover` crops the
 * overflow away *before* the transform runs, so scaling afterwards can pull a
 * real gap into view. Positioning the
 * painted rect directly has one meaning on both platforms.
 *
 * Two guarantees follow:
 *   • No empty space, ever. Step 1 is a cover fit, and `clampFit` below stops
 *     panning before an edge of the media can enter the box. Both the editor
 *     and the app apply the same clamp.
 *   • Cropping is visible before you save. `visibleImageRect` reports exactly
 *     which slice of the source each device shows, and `safeImageRect`
 *     intersects those slices so the editor can draw the region that survives
 *     on every device.
 */

/**
 * Nominal canvas size in dp, at the design width. The height is not fixed on the
 * device — see `HERO_ASPECT` — but these two numbers define the shape.
 */
export const HERO_HEIGHT_DP = 300;

/** Device widths the editor checks against, in dp. */
export const DEVICE_WIDTHS_DP = [360, 392, 412, 480] as const;

export const DEVICE_LABELS: Record<number, string> = {
    360: 'Small (360dp)',
    392: 'Pixel 7/8 (392dp)',
    412: 'Common (412dp)',
    480: 'Large / foldable (480dp)',
};

/** The width the editor opens at — the most common Android width. */
export const DESIGN_WIDTH_DP = 412;

/**
 * The canvas's shape, width ÷ height. Mirrors `HeroCanvasAspect` in
 * HeroBanner.kt, where the canvas is `fillMaxWidth().aspectRatio(...)`.
 *
 * This is what makes the editor honest. The canvas used to be full-width with a
 * fixed 300dp height, which meant the *box* was a different shape on every
 * device — 1.20:1 at 360dp, 1.60:1 at 480dp — and a cover fit into differently
 * shaped boxes shows different slices of the same file. Alignment set here at
 * 412dp lost ~13% off each side at 360dp. Deriving the height from the width
 * gives every device one box shape, one crop, and a preview that is exactly
 * what ships.
 */
export const HERO_ASPECT = DESIGN_WIDTH_DP / HERO_HEIGHT_DP;

/** The canvas box for a given device width, in dp. */
export function heroBox(widthDp: number): Box {
    return { w: widthDp, h: widthDp / HERO_ASPECT };
}

/**
 * The feed's first section shrinks the hero's layout box by 24dp so it tucks
 * under the zigzag (`Modifier.overlapBelow(24.dp)`), so the bottom 24dp of the
 * canvas is behind the coupon rail whenever offers exist.
 */
export const HERO_OVERLAP_DP = 24;

/** Recommended source media, in pixels. 412dp × 300dp at 3x, rounded. */
export const RECOMMENDED_WIDTH_PX = 1240;
export const RECOMMENDED_HEIGHT_PX = 900;
export const MIN_WIDTH_PX = 900;

/** Largest GIF we'll let through without complaining, in bytes. */
export const MAX_GIF_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * The zigzag along the bottom of the canvas. Mirrors `HeroZigzagTooth` and
 * `HeroZigzagDepth` in HeroBanner.kt — one V is TOOTH dp wide and drops DEPTH dp
 * below the flat part of the edge. Change these and the Compose values together
 * or the panel stops telling the truth about what gets cropped.
 */
export const HERO_ZIGZAG_TOOTH_DP = 26;
export const HERO_ZIGZAG_DEPTH_DP = 14;

/**
 * The corner points of the canvas outline, in CSS pixels: square across the top
 * and sides, teeth along the bottom.
 *
 * The tooth count is rounded, not floored, so the pattern always ends flush with
 * both bottom corners — exactly what `HeroCanvasShape.createOutline` does.
 */
export function heroOutlinePoints(w: number, h: number, pxPerDp = 1): Array<[number, number]> {
    const depth = Math.min(HERO_ZIGZAG_DEPTH_DP * pxPerDp, h);
    const tooth = Math.max(1, HERO_ZIGZAG_TOOTH_DP * pxPerDp);
    const teeth = Math.max(1, Math.round(w / tooth));
    const tw = w / teeth;
    const baseY = h - depth;

    const points: Array<[number, number]> = [
        [0, 0],
        [w, 0],
        [w, baseY],
    ];
    for (let i = teeth - 1; i >= 0; i--) {
        const left = i * tw;
        points.push([left + tw / 2, h]);
        points.push([left, baseY]);
    }
    return points;
}

/** The same outline as a CSS `clip-path`, for previews. */
export function heroClipPath(w: number, h: number, pxPerDp = 1): string {
    const pts = heroOutlinePoints(w, h, pxPerDp)
        .map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`)
        .join(', ');
    return `polygon(${pts})`;
}

/** And as an SVG path, for the dashed guide the editor strokes over the preview. */
export function heroOutlinePath(w: number, h: number, pxPerDp = 1): string {
    const pts = heroOutlinePoints(w, h, pxPerDp);
    return (
        pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') +
        ' Z'
    );
}

/**
 * The header bar — the address / coin balance / profile avatar row. It sits
 * ABOVE the canvas, not over it, so it never crops the artwork; it's previewed
 * here only so the colour can be judged against the artwork. Height is
 * statusBar(~28) + top padding(8) + row(44) + bottom padding(12).
 *
 * Each banner carries its own `headerColor` / `headerOpacity` and there is no
 * platform default: a banner either sets a colour or the bar stays the app's
 * green. The app mirrors this in `resolveHeaderTint`.
 */
export const HEADER_BAND_HEIGHT_DP = 92;

/**
 * 1 = the chosen colour flat. Opacity blends the colour toward the app's green,
 * it does not make the bar see-through — there is no artwork behind it to show.
 */
export const DEFAULT_HEADER_TINT_OPACITY = 1;

/** The app's green, the base every header tint is blended over. */
export const APP_GREEN = '#25671E';

function toRgb(hex: string, fallback: string): [number, number, number] {
    const clean = (hex || '').trim().replace('#', '');
    const full =
        clean.length === 3
            ? clean
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : clean;
    const valid = /^[0-9a-fA-F]{6}$/.test(full) ? full : fallback.replace('#', '');
    return [
        parseInt(valid.slice(0, 2), 16),
        parseInt(valid.slice(2, 4), 16),
        parseInt(valid.slice(4, 6), 16),
    ];
}

/**
 * The bar's actual fill: `hex` blended over the app green by `opacity`.
 * Mirrors `resolveHeaderTint` in HeroBanner.kt — same inputs, same pixel.
 */
export function headerTintCss(hex: string, opacity: number, base: string = APP_GREEN): string {
    const [br, bg, bb] = toRgb(base, APP_GREEN);
    if (!/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test((hex || '').trim())) {
        return `rgb(${br}, ${bg}, ${bb})`;
    }
    const [r, g, b] = toRgb(hex, base);
    const t = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : DEFAULT_HEADER_TINT_OPACITY));
    const mix = (from: number, to: number) => Math.round(from + (to - from) * t);
    return `rgb(${mix(br, r)}, ${mix(bg, g)}, ${mix(bb, b)})`;
}

/**
 * Nothing of the app's own UI covers the canvas any more — the address row sits
 * on the bar above it and the search bar moved down into the feed, between the
 * cuisine categories and the filter chips. The only thing still eating into the
 * artwork is the coupon rail tucking under the bottom edge, which
 * `HERO_OVERLAP_DP` above covers.
 */

export interface HeroFit {
    /** ≥ 1. 1 = plain cover fit. */
    zoom: number;
    /** Fraction of box width. Positive moves the media right. */
    offsetX: number;
    /** Fraction of box height. Positive moves the media down. */
    offsetY: number;
}

export const DEFAULT_FIT: HeroFit = { zoom: 1, offsetX: 0, offsetY: 0 };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface Box {
    w: number;
    h: number;
}

/** Cover-fit scale: the smallest scale at which the media covers the box. */
export function coverScale(box: Box, imgW: number, imgH: number): number {
    if (!imgW || !imgH) return 1;
    return Math.max(box.w / imgW, box.h / imgH);
}

/** Size the media is actually painted at, after cover fit × zoom. */
export function renderedSize(box: Box, imgW: number, imgH: number, zoom: number) {
    const scale = coverScale(box, imgW, imgH) * zoom;
    return { scale, w: imgW * scale, h: imgH * scale };
}

/**
 * The furthest the media can be panned before an empty edge would appear,
 * expressed in the same fraction-of-box units as `HeroFit`.
 */
export function maxOffset(box: Box, imgW: number, imgH: number, zoom: number) {
    const { w, h } = renderedSize(box, imgW, imgH, zoom);
    return {
        x: box.w > 0 ? Math.max(0, (w - box.w) / 2) / box.w : 0,
        y: box.h > 0 ? Math.max(0, (h - box.h) / 2) / box.h : 0,
    };
}

/** Clamp a fit so it can never expose an empty edge. Mirrored in the app. */
export function clampFit(fit: HeroFit, box: Box, imgW: number, imgH: number): HeroFit {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit.zoom || 1));
    const limit = maxOffset(box, imgW, imgH, zoom);
    return {
        zoom,
        offsetX: Math.min(limit.x, Math.max(-limit.x, fit.offsetX || 0)),
        offsetY: Math.min(limit.y, Math.max(-limit.y, fit.offsetY || 0)),
    };
}

/**
 * A fit that is safe on EVERY device width, not just the one being previewed.
 *
 * Since the canvas became a fixed aspect ratio, every width has the same box
 * shape, so all four limits agree and this reduces to a plain clamp. It stays
 * as the entry point because it is the one place that would catch a future
 * change back to per-device box shapes.
 */
export function clampFitAllDevices(fit: HeroFit, imgW: number, imgH: number): HeroFit {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit.zoom || 1));
    let limitX = Infinity;
    let limitY = Infinity;

    for (const width of DEVICE_WIDTHS_DP) {
        const limit = maxOffset(heroBox(width), imgW, imgH, zoom);
        limitX = Math.min(limitX, limit.x);
        limitY = Math.min(limitY, limit.y);
    }

    if (!Number.isFinite(limitX)) limitX = 0;
    if (!Number.isFinite(limitY)) limitY = 0;

    return {
        zoom,
        offsetX: Math.min(limitX, Math.max(-limitX, fit.offsetX || 0)),
        offsetY: Math.min(limitY, Math.max(-limitY, fit.offsetY || 0)),
    };
}

export interface NormRect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/**
 * Which slice of the source media a given box shows, in normalised (0…1)
 * source-image coordinates. Values outside 0…1 mean the box would show empty
 * space — which `clampFit` prevents, so in practice this stays inside 0…1.
 */
export function visibleImageRect(
    box: Box,
    imgW: number,
    imgH: number,
    fit: HeroFit
): NormRect {
    if (!imgW || !imgH) return { x0: 0, y0: 0, x1: 1, y1: 1 };

    const { scale, w, h } = renderedSize(box, imgW, imgH, fit.zoom);
    // Top-left of the painted media, in box coordinates.
    const left = (box.w - w) / 2 + fit.offsetX * box.w;
    const top = (box.h - h) / 2 + fit.offsetY * box.h;

    return {
        x0: -left / scale / imgW,
        y0: -top / scale / imgH,
        x1: (box.w - left) / scale / imgW,
        y1: (box.h - top) / scale / imgH,
    };
}

/**
 * The slice of the source that survives on EVERY device width — the
 * intersection of each device's visible rect.
 *
 * With a fixed-aspect canvas every device sees the same rect, so this now
 * reports exactly what one device shows: the crop, not a compromise between
 * four of them.
 */
export function safeImageRect(imgW: number, imgH: number, fit: HeroFit): NormRect {
    let rect: NormRect = { x0: 0, y0: 0, x1: 1, y1: 1 };

    for (const width of DEVICE_WIDTHS_DP) {
        const r = visibleImageRect(heroBox(width), imgW, imgH, fit);
        rect = {
            x0: Math.max(rect.x0, r.x0),
            y0: Math.max(rect.y0, r.y0),
            x1: Math.min(rect.x1, r.x1),
            y1: Math.min(rect.y1, r.y1),
        };
    }

    return rect;
}

/**
 * Map a rect in source-image coords into box coords, so the editor can draw the
 * cross-device safe area on top of the preview.
 */
export function imageRectToBox(
    rect: NormRect,
    box: Box,
    imgW: number,
    imgH: number,
    fit: HeroFit
) {
    const { scale, w, h } = renderedSize(box, imgW, imgH, fit.zoom);
    const left = (box.w - w) / 2 + fit.offsetX * box.w;
    const top = (box.h - h) / 2 + fit.offsetY * box.h;

    return {
        left: left + rect.x0 * imgW * scale,
        top: top + rect.y0 * imgH * scale,
        width: (rect.x1 - rect.x0) * imgW * scale,
        height: (rect.y1 - rect.y0) * imgH * scale,
    };
}

/**
 * Auto-fit: centre the media and pick the smallest zoom that keeps the *whole*
 * source visible on the widest device the app supports, if that's possible
 * without leaving a gap. In practice this is always zoom 1 centred — cover fit
 * already fills the box — so this exists mainly as the editor's Reset.
 */
export function autoFit(): HeroFit {
    return { ...DEFAULT_FIT };
}

/**
 * How far above the hero's top edge the bundled hero11/hero12 artwork is
 * pinned, in dp.
 *
 * This was -27.5, lifting the art clear of the wave that used to cut across the
 * bottom of the canvas. The canvas now ends in a straight rounded edge, so the
 * art is simply top-anchored (`ContentScale.Crop` + `Alignment.TopCenter` in
 * FirebaseHomeScreen.kt) and the nudge is zero.
 */
export const BUNDLED_TOP_NUDGE_DP = 0;

/**
 * The placement the built-in artwork used, expressed in the fit model.
 *
 * The old rule was `ContentScale.FillWidth` + `wrapContentHeight(Top)` +
 * `offset(y = -27.5.dp)`: scale to the hero's width, pin the top slightly above
 * the top edge. For any source taller than the hero box — which the bundled
 * 1079×1458 art is, and most banner artwork is — scaling to width *is* the
 * cover fit, so zoom stays at 1 and only the vertical offset differs from
 * centred.
 *
 * For a source wider than the box, the old rule would have left green showing
 * below the image. There is no honest way to reproduce a gap in a model whose
 * whole point is that gaps are impossible, so the clamp pulls those back to
 * centred — the closest gap-free placement.
 *
 * Computed at the design width and then clamped across every device, because
 * a fixed dp nudge lands differently on each screen width; the app re-clamps
 * against the box it actually measures.
 */
export function bundledHeroFit(imgW: number, imgH: number): HeroFit {
    if (!imgW || !imgH) return { ...DEFAULT_FIT };

    const box: Box = heroBox(DESIGN_WIDTH_DP);
    const { h: paintedH } = renderedSize(box, imgW, imgH, 1);

    // Solve `top = (boxH - paintedH) / 2 + offsetY * boxH` for the nudge.
    const offsetY = (BUNDLED_TOP_NUDGE_DP - (box.h - paintedH) / 2) / box.h;

    return clampFitAllDevices({ zoom: 1, offsetX: 0, offsetY }, imgW, imgH);
}

export interface FitWarning {
    level: 'error' | 'warn' | 'info';
    message: string;
}

/** Everything the editor should tell the admin before they hit Save. */
export function analyseFit(
    imgW: number,
    imgH: number,
    fit: HeroFit,
    fileBytes: number,
    mediaType: 'image' | 'gif'
): FitWarning[] {
    const warnings: FitWarning[] = [];

    if (!imgW || !imgH) return warnings;

    if (imgW < MIN_WIDTH_PX) {
        warnings.push({
            level: 'error',
            message: `Source is only ${imgW}px wide. It will look soft on most phones — use at least ${MIN_WIDTH_PX}px (ideal: ${RECOMMENDED_WIDTH_PX}×${RECOMMENDED_HEIGHT_PX}).`,
        });
    }

    const aspect = imgW / imgH;
    if (aspect > 2.2) {
        warnings.push({
            level: 'warn',
            message: `This is a very wide ${aspect.toFixed(2)}:1 image but the hero canvas is roughly 1.37:1, so the left and right edges get cut on every phone. Zoom out is not possible — reframe the source instead.`,
        });
    } else if (aspect < 0.9) {
        warnings.push({
            level: 'warn',
            message: `This is a tall ${aspect.toFixed(2)}:1 image but the hero canvas is roughly 1.37:1 (wider than tall), so the top and bottom get cut on every phone.`,
        });
    }

    const safe = safeImageRect(imgW, imgH, fit);
    const safeArea = Math.max(0, safe.x1 - safe.x0) * Math.max(0, safe.y1 - safe.y0);
    if (safeArea < 0.45) {
        warnings.push({
            level: 'warn',
            message: `Only ${Math.round(safeArea * 100)}% of the source is visible — the rest is cropped on every phone. Zoom out or reframe the source.`,
        });
    }

    if (fit.zoom > 2.2) {
        warnings.push({
            level: 'warn',
            message: `Zoomed to ${fit.zoom.toFixed(1)}× — the media is being upscaled well past its own resolution and will look blurry.`,
        });
    }

    const cap = mediaType === 'gif' ? MAX_GIF_BYTES : MAX_IMAGE_BYTES;
    if (fileBytes > cap) {
        warnings.push({
            level: 'warn',
            message: `${(fileBytes / 1024 / 1024).toFixed(1)}MB is heavy for a banner that loads on app open. Aim for under ${(cap / 1024 / 1024).toFixed(0)}MB.`,
        });
    }

    if (mediaType === 'gif') {
        warnings.push({
            level: 'info',
            message: 'GIFs play automatically and loop forever in the app. Keep them short and avoid hard flashes.',
        });
    }

    return warnings;
}

export interface PaintedRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Exactly where the media is painted inside the box — the one formula the app
 * mirrors. `box` may be in any unit (dp for the real hero, CSS pixels for a
 * scaled preview); the result comes back in the same unit, because every term
 * is either a fraction of the box or derived from the box's own aspect ratio.
 */
export function paintedRect(
    box: Box,
    imgW: number,
    imgH: number,
    fit: HeroFit
): PaintedRect {
    if (!imgW || !imgH) {
        return { left: 0, top: 0, width: box.w, height: box.h };
    }
    const { w, h } = renderedSize(box, imgW, imgH, fit.zoom);
    return {
        left: (box.w - w) / 2 + fit.offsetX * box.w,
        top: (box.h - h) / 2 + fit.offsetY * box.h,
        width: w,
        height: h,
    };
}

/**
 * Inline styles that paint the media exactly as the app will. Falls back to a
 * plain cover fit until the browser has reported the media's intrinsic size,
 * which is the same thing `paintedRect` describes at zoom 1 with no offset.
 */
export function fitToImageStyle(
    box: Box,
    imgW: number,
    imgH: number,
    fit: HeroFit
): Record<string, string> {
    if (!imgW || !imgH) {
        return {
            position: 'absolute',
            left: '0px',
            top: '0px',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
        };
    }

    const r = paintedRect(box, imgW, imgH, fit);
    return {
        position: 'absolute',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        maxWidth: 'none',
    };
}
