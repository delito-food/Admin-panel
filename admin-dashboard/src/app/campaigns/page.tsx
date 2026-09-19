'use client';

/**
 * Co-funded merchant offers — the admin console.
 *
 * Spec: CO_FUNDED_OFFERS_IMPLEMENTATION_PLAN.md §12.
 *
 * Reads come from /api/campaigns (Admin SDK, read only). Every change calls a Cloud
 * Function, so validation, the terms hash and the audit trail have one home and a
 * vendor's consent always refers to terms this screen cannot quietly rewrite.
 *
 * Things on this page that are deliberate:
 *  - The editor shows a LIVE PREVIEW of exactly what customers see — the badge on the
 *    restaurant card, the strip on the restaurant page, the "add ₹X more" nudge and the
 *    bill row — and a worked example of who pays what on a sample cart, while typing.
 *  - Every field explains what it means, in plain words, right under it.
 *  - Colours come from the dashboard's theme variables (--surface, --foreground …), never
 *    from bare Tailwind greys, so every label stays readable in BOTH light and dark mode.
 *    The old page used bg-gray-50 / bg-amber-50 with inherited text, which in dark mode
 *    painted white text on a near-white panel.
 *  - Editing a material term is allowed, but the screen says plainly that every vendor
 *    must accept again and the offer stops for them until they do.
 *  - There is no force-enrol button anywhere, by design.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authenticatedFetch, downloadAuthenticatedFile } from '@/lib/api-client';
import {
    saveCampaign, setCampaignStatus, inviteVendors, simulateCampaign,
    type CampaignDraft, type SimulationRow,
} from '@/lib/campaign-functions';

interface CampaignRow {
    campaignId: string;
    name: string;
    status: string;
    type: string;
    percent: number;
    flat: number;
    maxDiscount: number;
    minOrderValue: number;
    funding: { vendorPercent: number; vendorMaxPerOrder: number; vendorFloorPercent: number };
    commissionRateOverride: number | null;
    platformBudget: number;
    alertAtPercent: number;
    perCustomerLimit: number;
    perCustomerPerDay: number;
    newCustomersOnly: boolean;
    customerAllowlist: string[];
    excludedItemIds: string[];
    priceLockTolerancePercent: number;
    dayOfWeekMask: number;
    startMinuteIst: number;
    endMinuteIst: number;
    customer: { title: string; subtitle: string; badgeText: string; badgeColorHex: string; bannerImageUrl?: string };
    startAt: string | null;
    endAt: string | null;
    termsVersion: number;
    stats: {
        committedPlatform: number; committedVendor: number; accruedPlatform: number;
        accruedVendor: number; redemptions: number; anomalyOrders: number; budgetUsedPercent: number;
    };
    enrollments: Record<string, number>;
}

// ── Theme-safe colour tokens ────────────────────────────────────────────────
// Everything reads the dashboard's CSS variables, so light and dark both work.
const C = {
    surface: 'bg-[var(--surface)]',
    surfaceHover: 'hover:bg-[var(--surface-hover)]',
    subtle: 'bg-[var(--surface-hover)]',
    text: 'text-[var(--foreground)]',
    muted: 'text-[var(--foreground-secondary)]',
    border: 'border border-[var(--border)]',
};
const INPUT =
    `w-full rounded-lg ${C.border} ${C.surface} ${C.text} px-3.5 py-2.5 text-sm outline-none ` +
    'focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 placeholder:text-[var(--foreground-secondary)]';
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50';
const BTN_PRIMARY = `${BTN} bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]`;
const BTN_OUTLINE = `${BTN} ${C.border} ${C.surface} ${C.text} hover:border-[var(--primary)] hover:text-[var(--primary)]`;
const LINK = 'text-sm font-semibold text-[var(--primary)] hover:underline disabled:opacity-50';

const STATUS_STYLE: Record<string, string> = {
    LIVE: 'bg-emerald-600 text-white',
    SCHEDULED: 'bg-sky-600 text-white',
    DRAFT: 'bg-slate-500 text-white',
    PAUSED: 'bg-amber-500 text-black',
    BUDGET_EXHAUSTED: 'bg-orange-600 text-white',
    ENDED: 'bg-slate-700 text-white',
    CANCELLED: 'bg-red-700 text-white',
};

const inr = (n: number) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;
/** Epoch millis → the value a <input type="datetime-local"> expects, in LOCAL time. */
const toLocalInput = (ms: number) => {
    if (!ms) return '';
    const d = new Date(ms);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).getTime() : 0);

const EMPTY_DRAFT: CampaignDraft = {
    name: '',
    type: 'PERCENT',
    percent: 50,
    flat: 0,
    maxDiscount: 120,
    minOrderValue: 199,
    funding: { vendorPercent: 50, vendorMaxPerOrder: 80, vendorFloorPercent: 50 },
    commissionRateOverride: null,
    platformBudget: 2000,
    alertAtPercent: 80,
    // Filled in by freshDraft() at the moment the form opens. Evaluated here, at module
    // load, they go stale in a long-lived tab and the server rejects the save with
    // "endAt must be in the future".
    startAt: 0,
    endAt: 0,
    dayOfWeekMask: 127,
    startMinuteIst: 0,
    endMinuteIst: 1440,
    perCustomerLimit: 3,
    perCustomerPerDay: 1,
    newCustomersOnly: false,
    customerAllowlist: [],
    excludedItemIds: [],
    priceLockTolerancePercent: 5,
    customer: { title: '', subtitle: '', badgeText: '', badgeColorHex: '#E23744', bannerImageUrl: '' },
};

// Same unsigned Cloudinary preset the Hero Banners page uses.
const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dnmuwv56l';
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'platoos_preset';

async function uploadBannerImage(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Image must be under 8 MB.');
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', UPLOAD_PRESET);
    form.append('folder', 'campaign_banners');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Image upload failed. Please try again.');
    const json = await res.json();
    return String(json.secure_url || '');
}

/** A blank draft with dates relative to NOW, not to when this module was loaded. */
function freshDraft(): CampaignDraft {
    return { ...EMPTY_DRAFT, startAt: Date.now() + 24 * 3600_000, endAt: Date.now() + 4 * 24 * 3600_000 };
}

function draftFromRow(row: CampaignRow): CampaignDraft {
    return {
        name: row.name,
        type: (row.type as 'PERCENT' | 'FLAT') || 'PERCENT',
        percent: row.percent,
        flat: row.flat,
        maxDiscount: row.maxDiscount,
        minOrderValue: row.minOrderValue,
        funding: { ...row.funding },
        commissionRateOverride: row.commissionRateOverride,
        platformBudget: row.platformBudget,
        alertAtPercent: row.alertAtPercent || 80,
        startAt: row.startAt ? new Date(row.startAt).getTime() : Date.now(),
        endAt: row.endAt ? new Date(row.endAt).getTime() : Date.now() + 3 * 24 * 3600_000,
        dayOfWeekMask: row.dayOfWeekMask || 127,
        startMinuteIst: row.startMinuteIst || 0,
        endMinuteIst: row.endMinuteIst || 1440,
        perCustomerLimit: row.perCustomerLimit,
        perCustomerPerDay: row.perCustomerPerDay,
        newCustomersOnly: row.newCustomersOnly,
        customerAllowlist: row.customerAllowlist || [],
        excludedItemIds: row.excludedItemIds || [],
        // ?? not ||: 0 is a valid tolerance and means "lock the price exactly". Coercing
        // it to 5 quietly loosened the lock AND, because it is a material term, pushed
        // every enrolled vendor back through OTP re-consent.
        priceLockTolerancePercent: row.priceLockTolerancePercent ?? 5,
        customer: { ...row.customer, bannerImageUrl: row.customer.bannerImageUrl || '' },
    };
}

// ── Preview maths ───────────────────────────────────────────────────────────
// A faithful copy of functions/campaignMath.js computeDiscount + computeSplit, for the
// preview ONLY. The server prices every real order; nothing here is ever sent anywhere.

const round1 = (v: number) => Math.round(v * 10) / 10;

function previewDiscount(d: CampaignDraft, cart: number): number {
    if (!(cart > 0) || cart < (Number(d.minOrderValue) || 0)) return 0;
    let raw = 0;
    if (d.type === 'PERCENT') {
        raw = (cart * (Number(d.percent) || 0)) / 100;
        if (d.maxDiscount > 0) raw = Math.min(raw, d.maxDiscount);
    } else {
        raw = Number(d.flat) || 0;
    }
    raw = Math.min(raw, cart);
    const D = Math.floor(raw + 1e-9);
    return D >= 1 ? D : 0;
}

function previewSplit(d: CampaignDraft, cart: number, commissionRate: number) {
    const D = previewDiscount(d, cart);
    const cut = round1((cart * commissionRate) / 100);
    const gst = round1((cut * 18) / 100);
    const deduction = round1(cut + gst);
    let Dv = Math.floor((D * Math.min(100, Math.max(0, d.funding.vendorPercent))) / 100 + 1e-9);
    if (d.funding.vendorMaxPerOrder > 0) Dv = Math.min(Dv, Math.floor(d.funding.vendorMaxPerOrder));
    Dv = Math.max(0, Math.min(Dv, D, Math.floor(cart - deduction + 1e-9)));
    const floor = (cart * Math.min(100, Math.max(0, d.funding.vendorFloorPercent))) / 100;
    const earning = (dv: number) => round1(Math.max(0, cart - dv - deduction));
    let guard = 0;
    while (Dv > 0 && earning(Dv) < floor - 1e-9 && guard++ < 1000) {
        Dv -= Math.min(Dv, Math.max(1, Math.ceil(floor - earning(Dv) - 1e-9)));
    }
    return {
        D, Dv, Dp: D - Dv, deduction,
        vendorEarning: earning(Dv),
        vendorEarningWithoutOffer: earning(0),
        customerPays: cart - D,
    };
}

/** What the badge should say if the admin leaves it blank. */
function suggestedBadge(d: CampaignDraft): string {
    if (d.type === 'FLAT') return `₹${Math.round(d.flat)} OFF`;
    return d.maxDiscount > 0 ? `${Math.round(d.percent)}% OFF UPTO ₹${Math.round(d.maxDiscount)}` : `${Math.round(d.percent)}% OFF`;
}

/** Relative luminance, for the white-text-on-badge contrast check. */
function contrastWithWhite(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return 21;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    return 1.05 / (L + 0.05);
}

const SWATCHES = ['#E23744', '#F4511E', '#D81B60', '#7B1FA2', '#3949AB', '#00897B', '#2E7D32', '#1A1F26'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const minutesToTime = (m: number) => {
    const mm = Math.max(0, Math.min(1440, m)) % 1440;
    return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
};
const timeToMinutes = (t: string, isEnd: boolean) => {
    const [h, m] = t.split(':').map(Number);
    const v = (h || 0) * 60 + (m || 0);
    return isEnd && v === 0 ? 1440 : v;
};

type EditorTab = 'offer' | 'funding' | 'schedule' | 'limits' | 'appearance' | 'test';
const EDITOR_TABS: { key: EditorTab; label: string }[] = [
    { key: 'offer', label: 'Offer' },
    { key: 'funding', label: 'Who pays' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'limits', label: 'Limits' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'test', label: 'Test & invite' },
];

// ────────────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
    const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState('');
    const [editing, setEditing] = useState<{ draft: CampaignDraft; campaignId?: string; termsVersion?: number } | null>(null);
    const [editorTab, setEditorTab] = useState<EditorTab>('offer');
    const [simulation, setSimulation] = useState<{ samples: SimulationRow[]; totals: Record<string, number> } | null>(null);
    const [vendorIdsInput, setVendorIdsInput] = useState('');
    const [selected, setSelected] = useState<CampaignRow | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [detailError, setDetailError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await authenticatedFetch('/api/campaigns');
            const json = await res.json();
            if (json.success) { setCampaigns(json.data); setError(''); }
            else setError(json.error || 'Failed to load campaigns');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load campaigns');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const openDetail = useCallback(async (row: CampaignRow) => {
        setSelected(row);
        setDetail(null);
        setDetailError('');
        try {
            const res = await authenticatedFetch(`/api/campaigns/${row.campaignId}`);
            // .json() on an HTML error body throws, which used to surface as an unhandled
            // rejection and leave the panel on "Loading…" for ever.
            const json = await res.json();
            if (json.success) setDetail(json.data);
            else setDetailError(json.error || 'Could not load this offer.');
        } catch (e) {
            setDetailError(e instanceof Error ? e.message : 'Could not load this offer.');
        }
    }, []);

    const run = async (label: string, fn: () => Promise<unknown>) => {
        setBusy(label);
        setError('');
        setNotice('');
        try {
            await fn();
            await load();
            if (selected) await openDetail(selected);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy('');
        }
    };

    const editingIsMaterialChange = useMemo(() => {
        if (!editing?.campaignId) return false;
        const row = campaigns.find((c) => c.campaignId === editing.campaignId);
        if (!row) return false;
        const d = editing.draft;
        return d.type !== row.type || d.percent !== row.percent || d.flat !== row.flat ||
            d.maxDiscount !== row.maxDiscount || d.minOrderValue !== row.minOrderValue ||
            d.funding.vendorPercent !== row.funding.vendorPercent ||
            d.funding.vendorMaxPerOrder !== row.funding.vendorMaxPerOrder ||
            d.funding.vendorFloorPercent !== row.funding.vendorFloorPercent ||
            d.commissionRateOverride !== row.commissionRateOverride ||
            d.startAt !== (row.startAt ? new Date(row.startAt).getTime() : 0) ||
            d.endAt !== (row.endAt ? new Date(row.endAt).getTime() : 0) ||
            // These five are material to the server too (campaignMath.materialTerms), and
            // leaving them out meant an admin could change the daily window or the
            // excluded-item list, see no warning, and only discover afterwards that every
            // vendor had been dropped to NEEDS_RECONSENT and the offer had stopped.
            d.dayOfWeekMask !== row.dayOfWeekMask ||
            d.startMinuteIst !== row.startMinuteIst ||
            d.endMinuteIst !== row.endMinuteIst ||
            d.priceLockTolerancePercent !== row.priceLockTolerancePercent ||
            JSON.stringify([...(d.excludedItemIds || [])].sort()) !== JSON.stringify([...(row.excludedItemIds || [])].sort());
    }, [editing, campaigns]);

    /** Patch the draft being edited. */
    const patch = (p: Partial<CampaignDraft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...p } });
    const patchFunding = (p: Partial<CampaignDraft['funding']>) =>
        editing && patch({ funding: { ...editing.draft.funding, ...p } });
    const patchCustomer = (p: Partial<CampaignDraft['customer']>) =>
        editing && patch({ customer: { ...editing.draft.customer, ...p } });

    return (
        <div className={`p-4 md:p-6 space-y-6 ${C.text}`}>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Co-funded offers</h1>
                    <p className={`text-sm ${C.muted} max-w-2xl`}>
                        Discounts that Delito and a restaurant pay for together. You design the offer here; each
                        restaurant reads the terms in its app and joins with an OTP. Nothing on this page can
                        enrol a restaurant on its behalf.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className={BTN_OUTLINE} onClick={load} disabled={loading}>Refresh</button>
                    <button className={BTN_PRIMARY} onClick={() => { setEditing({ draft: freshDraft() }); setEditorTab('offer'); setSimulation(null); setSelected(null); }}>
                        + New offer
                    </button>
                </div>
            </div>

            {error && <Banner tone="error">{error}</Banner>}
            {notice && <Banner tone="info">{notice}</Banner>}

            {/* ── Campaign list ─────────────────────────────────────────── */}
            {loading ? (
                <p className={`text-sm ${C.muted}`}>Loading…</p>
            ) : campaigns.length === 0 ? (
                <div className={`rounded-xl ${C.border} ${C.surface} p-8 text-center`}>
                    <div className="text-lg font-semibold">No offers yet</div>
                    <p className={`text-sm ${C.muted}`}>Create one with “New offer”. It starts as a draft that nobody can see.</p>
                </div>
            ) : (
                <div className={`overflow-x-auto rounded-xl ${C.border} ${C.surface}`}>
                    <table className="min-w-full text-sm">
                        <thead className={`${C.subtle} text-left ${C.muted} text-xs uppercase tracking-wide`}>
                            <tr>
                                <th className="p-3">Offer</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Restaurant pays</th>
                                <th className="p-3">Delito budget used</th>
                                <th className="p-3">Orders</th>
                                <th className="p-3">Restaurants</th>
                                <th className="p-3">Runs</th>
                                <th className="p-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map((c) => (
                                <tr key={c.campaignId} className={`border-t border-[var(--border)] ${C.surfaceHover}`}>
                                    <td className="p-3">
                                        <div className="flex items-center gap-2">
                                            <OfferBadge text={c.customer.badgeText || suggestedBadge(draftFromRow(c))} color={c.customer.badgeColorHex} />
                                        </div>
                                        <div className="font-semibold mt-1">{c.name}</div>
                                        <div className={`text-xs ${C.muted}`}>{c.customer.title}</div>
                                    </td>
                                    <td className="p-3">
                                        <StatusPill status={c.status} />
                                        {c.stats.anomalyOrders > 0 && (
                                            <span className="ml-2 inline-block rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black">
                                                {c.stats.anomalyOrders} flagged
                                            </span>
                                        )}
                                        {c.customerAllowlist?.length > 0 && (
                                            <span className="ml-2 inline-block rounded-full bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">pilot</span>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        {c.funding.vendorPercent}% of the discount
                                        {c.funding.vendorMaxPerOrder > 0 && <div className={`text-xs ${C.muted}`}>max {inr(c.funding.vendorMaxPerOrder)} / order</div>}
                                    </td>
                                    <td className="p-3 min-w-[150px]">
                                        <div>{inr(c.stats.committedPlatform)} / {inr(c.platformBudget)}</div>
                                        <div className="mt-1 h-1.5 w-full rounded-full bg-[var(--border)]">
                                            <div
                                                className={`h-1.5 rounded-full ${c.stats.budgetUsedPercent >= 80 ? 'bg-red-600' : 'bg-emerald-600'}`}
                                                style={{ width: `${Math.min(100, c.stats.budgetUsedPercent)}%` }}
                                            />
                                        </div>
                                    </td>
                                    <td className="p-3">{c.stats.redemptions}</td>
                                    <td className="p-3 text-xs">
                                        {Object.entries(c.enrollments).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ') || '—'}
                                    </td>
                                    <td className="p-3 text-xs whitespace-nowrap">
                                        {c.startAt ? new Date(c.startAt).toLocaleString('en-IN') : '—'}
                                        <br />
                                        <span className={C.muted}>to</span> {c.endAt ? new Date(c.endAt).toLocaleString('en-IN') : '—'}
                                    </td>
                                    <td className="p-3 whitespace-nowrap">
                                        <div className="flex flex-wrap gap-3">
                                            <button className={LINK} onClick={() => openDetail(c)}>Open</button>
                                            <button
                                                className={LINK}
                                                onClick={() => { setEditing({ draft: draftFromRow(c), campaignId: c.campaignId, termsVersion: c.termsVersion }); setEditorTab('offer'); setSimulation(null); }}
                                            >
                                                Edit
                                            </button>
                                            {c.status === 'DRAFT' && (
                                                <button className={LINK} disabled={!!busy} onClick={() => run('publish', () => setCampaignStatus(c.campaignId, 'publish'))}>Publish</button>
                                            )}
                                            {(c.status === 'LIVE' || c.status === 'SCHEDULED' || c.status === 'BUDGET_EXHAUSTED') && (
                                                <button className={LINK} disabled={!!busy} onClick={() => run('pause', () => setCampaignStatus(c.campaignId, 'pause'))}>Pause</button>
                                            )}
                                            {(c.status === 'PAUSED' || c.status === 'BUDGET_EXHAUSTED') && (
                                                <button className={LINK} disabled={!!busy} onClick={() => run('resume', () => setCampaignStatus(c.campaignId, 'resume'))}>Resume</button>
                                            )}
                                            {['SCHEDULED', 'LIVE', 'PAUSED', 'BUDGET_EXHAUSTED'].includes(c.status) && (
                                                <button className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => run('end', () => setCampaignStatus(c.campaignId, 'end'))}>End</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── Editor ────────────────────────────────────────────────── */}
            {editing && (
                <div className={`overflow-hidden rounded-2xl ${C.border} ${C.surface}`}>
                    {/* Header */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
                        <div className="min-w-0">
                            <h2 className="text-xl font-bold leading-tight">{editing.campaignId ? 'Edit offer' : 'New offer'}</h2>
                            <p className={`mt-1 truncate text-sm ${C.muted}`}>
                                {editing.draft.name || 'Untitled offer'}
                                {editing.campaignId && editing.termsVersion ? ` · terms v${editing.termsVersion}` : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button className={BTN_OUTLINE} onClick={() => setEditing(null)}>Cancel</button>
                                    <button
                                className={BTN_PRIMARY}
                                disabled={!!busy}
                                onClick={() => run('save', async () => {
                                    const saved = await saveCampaign(editing.draft, editing.campaignId);
                                    setEditing(null);
                                    setNotice(saved.reconsentRequired
                                        ? `Saved. ${saved.reconsentRequired} restaurant(s) must accept the new terms before the offer runs for them again.`
                                        : 'Saved.');
                                })}
                            >
                                {busy === 'save' ? 'Saving…' : editing.campaignId ? 'Save changes' : 'Save draft'}
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-4">
                        {EDITOR_TABS.map((t, i) => (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setEditorTab(t.key)}
                                className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3.5 text-sm font-semibold transition ${editorTab === t.key
                                    ? 'border-[var(--primary)] text-[var(--primary)]'
                                    : `border-transparent ${C.muted} hover:text-[var(--foreground)]`}`}
                            >
                                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${editorTab === t.key ? 'bg-[var(--primary)] text-white' : 'bg-[var(--surface-hover)]'}`}>{i + 1}</span>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
                        {/* Form — one step at a time */}
                        <div className="min-w-0 space-y-6">
                            {editingIsMaterialChange && (
                                <Banner tone="warn">
                                    This changes a term the restaurants agreed to. Every restaurant that joined will be asked to
                                    accept again, and the offer stops for them until they do.
                                </Banner>
                            )}

                            {editorTab === 'offer' && (
                            <Section step="1" title="The offer" hint="What the customer gets.">
                                <Field label="Internal name" help="Only admins see this. e.g. “Weekend 50% – Koramangala”.">
                                    <input className={INPUT} value={editing.draft.name} onChange={(e) => patch({ name: e.target.value })} />
                                </Field>
                                <Field label="Discount type" help="Percentage = a share of the eligible food. Flat = a fixed rupee amount.">
                                    <select className={INPUT} value={editing.draft.type} onChange={(e) => patch({ type: e.target.value as 'PERCENT' | 'FLAT' })}>
                                        <option value="PERCENT">Percentage off</option>
                                        <option value="FLAT">Flat ₹ off</option>
                                    </select>
                                </Field>
                                {editing.draft.type === 'PERCENT' ? (
                                    <>
                                        <Field label="Percent off" help="How much of the eligible food total is taken off, before the cap.">
                                            <NumberInput value={editing.draft.percent} suffix="%" onChange={(v) => patch({ percent: v })} />
                                        </Field>
                                        <Field label="Maximum discount" help="The most one order can ever save, however big the cart. Required for percentage offers.">
                                            <NumberInput value={editing.draft.maxDiscount} prefix="₹" onChange={(v) => patch({ maxDiscount: v })} />
                                        </Field>
                                    </>
                                ) : (
                                    <Field label="Flat amount off" help="Rupees taken off every qualifying order (never more than the food itself).">
                                        <NumberInput value={editing.draft.flat} prefix="₹" onChange={(v) => patch({ flat: v })} />
                                    </Field>
                                )}
                                <Field label="Minimum order" help="Food total (before discounts) the cart must reach. Below this, customers see “Add ₹X more to unlock”.">
                                    <NumberInput value={editing.draft.minOrderValue} prefix="₹" onChange={(v) => patch({ minOrderValue: v })} />
                                </Field>
                            </Section>
                            )}
                            {editorTab === 'funding' && (
                            <Section step="2" title="Who pays" hint="How each discount is split between the restaurant and Delito.">
                                <Field label="Restaurant's share of the discount" help="e.g. 50% → on a ₹100 discount the restaurant funds ₹50 and Delito ₹50.">
                                    <NumberInput value={editing.draft.funding.vendorPercent} suffix="%" onChange={(v) => patchFunding({ vendorPercent: v })} />
                                </Field>
                                <Field label="Restaurant's cap per order" help="The most a restaurant pays on one order. Anything above moves to Delito. 0 = no cap.">
                                    <NumberInput value={editing.draft.funding.vendorMaxPerOrder} prefix="₹" onChange={(v) => patchFunding({ vendorMaxPerOrder: v })} />
                                </Field>
                                <Field label="Restaurant always keeps at least" help="A safety floor: the restaurant's payout never drops below this % of the order. If it would, Delito covers the gap.">
                                    <NumberInput value={editing.draft.funding.vendorFloorPercent} suffix="%" onChange={(v) => patchFunding({ vendorFloorPercent: v })} />
                                </Field>
                                <Field label="Commission override" help="Leave blank to charge each restaurant its usual commission. Commission is always on the full food price.">
                                    <NumberInput
                                        value={editing.draft.commissionRateOverride}
                                        suffix="%"
                                        allowBlank
                                        onChange={(v) => patch({ commissionRateOverride: v })}
                                    />
                                </Field>
                                <Field label="Delito budget" help="Total Delito will spend on this offer. When used up the offer stops automatically.">
                                    <NumberInput value={editing.draft.platformBudget} prefix="₹" onChange={(v) => patch({ platformBudget: v })} />
                                </Field>
                                <Field label="Budget alert at" help="An alert is raised in campaignAlerts once this much of the budget is spent.">
                                    <NumberInput value={editing.draft.alertAtPercent} suffix="%" onChange={(v) => patch({ alertAtPercent: v })} />
                                </Field>
                            </Section>
                            )}
                            {editorTab === 'schedule' && (
                            <Section step="3" title="When it runs" hint="Times are India Standard Time.">
                                <Field label="Starts" help="The offer switches on at this moment.">
                                    <input type="datetime-local" className={INPUT} value={toLocalInput(editing.draft.startAt)} onChange={(e) => patch({ startAt: fromLocalInput(e.target.value) })} />
                                </Field>
                                <Field label="Ends" help="Switches off here. Max 62 days after start. Extending later makes every restaurant accept again.">
                                    <input type="datetime-local" className={INPUT} value={toLocalInput(editing.draft.endAt)} onChange={(e) => patch({ endAt: fromLocalInput(e.target.value) })} />
                                </Field>
                                <Field label="Days" help="Which days of the week the offer is active." wide>
                                    <div className="flex flex-wrap gap-2">
                                        {DAYS.map((day, i) => {
                                            const on = (editing.draft.dayOfWeekMask & (1 << i)) !== 0;
                                            return (
                                                <button
                                                    key={day}
                                                    type="button"
                                                    className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? 'bg-[var(--primary)] text-white' : `${C.border} ${C.text}`}`}
                                                    onClick={() => {
                                                        const next = editing.draft.dayOfWeekMask ^ (1 << i);
                                                        if (next > 0) patch({ dayOfWeekMask: next });
                                                    }}
                                                >
                                                    {day}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Field>
                                <Field label="Daily hours" help="e.g. 11:00–15:00 for a lunch offer. 00:00–00:00 = all day. A window like 22:00–02:00 runs past midnight.">
                                    <div className="flex items-center gap-2">
                                        <input type="time" className={INPUT} value={minutesToTime(editing.draft.startMinuteIst)} onChange={(e) => patch({ startMinuteIst: timeToMinutes(e.target.value, false) })} />
                                        <span className={C.muted}>to</span>
                                        <input type="time" className={INPUT} value={minutesToTime(editing.draft.endMinuteIst)} onChange={(e) => patch({ endMinuteIst: timeToMinutes(e.target.value, true) })} />
                                    </div>
                                </Field>
                            </Section>
                            )}
                            {editorTab === 'limits' && (
                            <Section step="4" title="Limits & eligibility" hint="Who can use it, and how often.">
                                <Field label="Uses per customer (total)" help="How many orders one customer can get this offer on, over the whole campaign. 0 = unlimited.">
                                    <NumberInput value={editing.draft.perCustomerLimit} onChange={(v) => patch({ perCustomerLimit: v })} />
                                </Field>
                                <Field label="Uses per customer per day" help="Stops the same person using it many times in one day. 0 = unlimited.">
                                    <NumberInput value={editing.draft.perCustomerPerDay} onChange={(v) => patch({ perCustomerPerDay: v })} />
                                </Field>
                                <Field label="New customers only" help="Only customers with no delivered order yet.">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={editing.draft.newCustomersOnly} onChange={(e) => patch({ newCustomersOnly: e.target.checked })} />
                                        First order only
                                    </label>
                                </Field>
                                <Field label="Price-lock tolerance" help="Items only count if their price hasn't risen more than this since the restaurant joined. Stops price hikes to farm discounts.">
                                    <NumberInput value={editing.draft.priceLockTolerancePercent} suffix="%" onChange={(v) => patch({ priceLockTolerancePercent: v })} />
                                </Field>
                                <Field label="Pilot: only these customers" help="Customer UIDs, comma separated. While this has anyone in it, ONLY they get the discount (others still see the badge). Empty = everyone." wide>
                                    <input className={INPUT} value={editing.draft.customerAllowlist.join(',')}
                                        onChange={(e) => patch({ customerAllowlist: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                                </Field>
                                <Field label="Excluded items" help="Menu item IDs, comma separated, that never get the discount (e.g. drinks)." wide>
                                    <input className={INPUT} value={editing.draft.excludedItemIds.join(',')}
                                        onChange={(e) => patch({ excludedItemIds: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                                </Field>
                            </Section>
                            )}
                            {editorTab === 'appearance' && (
                            <Section step="5" title="How customers see it" hint="Watch the preview on the right as you type.">
                                <Field label="Title" help="Headline on the restaurant page and the bill row, e.g. “Delito Weekend Feast”.">
                                    <input className={INPUT} value={editing.draft.customer.title} maxLength={60} onChange={(e) => patchCustomer({ title: e.target.value })} />
                                </Field>
                                <Field label="Subtitle" help="One short line under the title once the cart qualifies, e.g. “Applied automatically at checkout”.">
                                    <input className={INPUT} value={editing.draft.customer.subtitle} maxLength={80} onChange={(e) => patchCustomer({ subtitle: e.target.value })} />
                                </Field>
                                <Field label="Badge text" help="The tag on restaurant cards. Keep it under ~22 characters.">
                                    <div className="flex gap-2">
                                        <input className={INPUT} value={editing.draft.customer.badgeText} maxLength={30} placeholder={suggestedBadge(editing.draft)}
                                            onChange={(e) => patchCustomer({ badgeText: e.target.value })} />
                                        <button type="button" className={BTN_OUTLINE} onClick={() => patchCustomer({ badgeText: suggestedBadge(editing.draft) })}>Auto</button>
                                    </div>
                                </Field>
                                <Field label="Badge colour" help="Badge text is white, so pick a dark enough colour. We warn you if it's hard to read.">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <input type="color" className="h-10 w-12 cursor-pointer rounded border border-[var(--border)] bg-transparent"
                                                value={/^#[0-9a-f]{6}$/i.test(editing.draft.customer.badgeColorHex) ? editing.draft.customer.badgeColorHex : '#E23744'}
                                                onChange={(e) => patchCustomer({ badgeColorHex: e.target.value.toUpperCase() })} />
                                            <input className={INPUT} value={editing.draft.customer.badgeColorHex} onChange={(e) => patchCustomer({ badgeColorHex: e.target.value })} />
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {SWATCHES.map((s) => (
                                                <button key={s} type="button" title={s} onClick={() => patchCustomer({ badgeColorHex: s })}
                                                    className="h-6 w-6 rounded-full border-2 border-[var(--surface)] ring-1 ring-[var(--border)]" style={{ background: s }} />
                                            ))}
                                        </div>
                                        {contrastWithWhite(editing.draft.customer.badgeColorHex) < 3 && (
                                            <p className="text-xs font-semibold text-red-600">White text on this colour is hard to read — choose a darker shade.</p>
                                        )}
                                    </div>
                                </Field>
                                <Field
                                    label="Home slideshow background"
                                    help="A plain photo with NO text on it (food, the restaurant, a mood shot). The app blurs it, darkens it and writes the saving on top, so any text baked into the image would be unreadable. Landscape, at least 1200×500 px. Optional — without it the slide uses the badge colour."
                                    wide
                                >
                                    <BannerUpload
                                        value={editing.draft.customer.bannerImageUrl || ''}
                                        onChange={(url) => patchCustomer({ bannerImageUrl: url })}
                                    />
                                </Field>
                            </Section>
                            )}
                            {editorTab === 'test' && (
                                <div className="space-y-6">
                            <Section step="6" title="Test & invite" hint="Check the money on real orders, then invite restaurants.">
                                <Field label="Restaurants (vendor IDs)" help="Comma separated. Used by “Simulate” (their last 30 days of orders) and “Invite”." wide>
                                    <input className={INPUT} placeholder="vendorId1, vendorId2" value={vendorIdsInput} onChange={(e) => setVendorIdsInput(e.target.value)} />
                                </Field>
                                <div className="flex flex-wrap gap-3 md:col-span-2">
                                    <button
                                        className={BTN_OUTLINE}
                                        disabled={!!busy}
                                        onClick={() => run('simulate', async () => {
                                            const ids = vendorIdsInput.split(',').map((x) => x.trim()).filter(Boolean);
                                            const result = await simulateCampaign(editing.draft, ids, 30);
                                            setSimulation({ samples: result.samplesAt15Percent, totals: result.totals as unknown as Record<string, number> });
                                        })}
                                    >
                                        {busy === 'simulate' ? 'Simulating…' : 'Simulate on last 30 days'}
                                    </button>
                                    {editing.campaignId && (
                                        <button
                                            className={BTN_OUTLINE}
                                            disabled={!!busy}
                                            onClick={() => run('invite', async () => {
                                                const ids = vendorIdsInput.split(',').map((x) => x.trim()).filter(Boolean);
                                                const r = await inviteVendors(editing.campaignId!, ids);
                                                setNotice(`Invited ${r.invited}, re-invited ${r.reinvited}, unchanged ${r.unchanged}${r.missingVendors.length ? `, not found: ${r.missingVendors.join(', ')}` : ''}`);
                                            })}
                                        >
                                            Invite these restaurants
                                        </button>
                                    )}
                                </div>
                            
                            </Section>
                            {simulation && (
                                <div className="space-y-3 text-sm">
                                    <div className="font-semibold">What a restaurant earns (at 15% commission)</div>
                                    <div className={`overflow-x-auto rounded-lg ${C.border}`}>
                                        <table className="min-w-full">
                                            <thead className={`${C.subtle} ${C.muted} text-xs uppercase`}>
                                                <tr>
                                                    <th className="px-3 py-2.5 text-left">Cart</th>
                                                    <th className="px-3 py-2.5 text-left">Customer saves</th>
                                                    <th className="px-3 py-2.5 text-left">Restaurant funds</th>
                                                    <th className="px-3 py-2.5 text-left">Delito funds</th>
                                                    <th className="px-3 py-2.5 text-left">Restaurant earns</th>
                                                    <th className="px-3 py-2.5 text-left">Without offer</th>
                                                    <th className="px-3 py-2.5 text-left">Delito on food</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {simulation.samples.map((row) => (
                                                    <tr key={row.cartValue} className="border-t border-[var(--border)]">
                                                        <td className="px-3 py-2.5">{inr(row.cartValue)}</td>
                                                        <td className="px-3 py-2.5">{inr(row.customerDiscount)}</td>
                                                        <td className="px-3 py-2.5">{inr(row.vendorFunded)}</td>
                                                        <td className="px-3 py-2.5">{inr(row.platformFunded)}</td>
                                                        <td className="px-3 py-2.5 font-semibold">{inr(row.vendorEarning)}</td>
                                                        <td className={`p-2 ${C.muted}`}>{inr(row.vendorEarningWithoutOffer)}</td>
                                                        <td className={`p-2 font-semibold ${row.platformFoodNet < 0 ? 'text-red-600' : ''}`}>{inr(row.platformFoodNet)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className={`text-xs ${C.muted}`}>
                                        Over the last 30 days for the restaurants listed: {simulation.totals.qualifying} of {simulation.totals.orders} delivered
                                        orders would have qualified · customers would have saved {inr(simulation.totals.customerDiscount)} ·
                                        restaurants would have funded {inr(simulation.totals.vendorFunded)} · Delito {inr(simulation.totals.platformFunded)} ·
                                        Delito would have lost money on the food of {simulation.totals.platformLossOrders} order(s).
                                    </p>
                                </div>
                            )}

                                </div>
                            )}

                            {/* Step navigation */}
                            <div className="flex items-center justify-between border-t border-[var(--border)] pt-6">
                                <button
                                    type="button"
                                    className={BTN_OUTLINE}
                                    disabled={EDITOR_TABS[0].key === editorTab}
                                    onClick={() => setEditorTab(EDITOR_TABS[Math.max(0, EDITOR_TABS.findIndex((t) => t.key === editorTab) - 1)].key)}
                                >
                                    ← Back
                                </button>
                                <span className={`text-xs ${C.muted}`}>
                                    Step {EDITOR_TABS.findIndex((t) => t.key === editorTab) + 1} of {EDITOR_TABS.length}
                                </span>
                                <button
                                    type="button"
                                    className={BTN_OUTLINE}
                                    disabled={EDITOR_TABS[EDITOR_TABS.length - 1].key === editorTab}
                                    onClick={() => setEditorTab(EDITOR_TABS[Math.min(EDITOR_TABS.length - 1, EDITOR_TABS.findIndex((t) => t.key === editorTab) + 1)].key)}
                                >
                                    Next →
                                </button>
                            </div>
                        </div>

                        {/* Live preview */}
                        <div className="self-start lg:sticky lg:top-6">
                            <CustomerPreview draft={editing.draft} />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Detail ────────────────────────────────────────────────── */}
            {selected && (
                <div className={`rounded-xl ${C.border} ${C.surface} p-4 md:p-6 space-y-4`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold">{selected.name}</h2>
                            <StatusPill status={selected.status} />
                        </div>
                        <div className="flex gap-2">
                            <button
                                className={BTN_OUTLINE}
                                onClick={() => downloadAuthenticatedFile(`/api/campaigns/${selected.campaignId}?format=csv`, `campaign-${selected.campaignId}.csv`)}
                            >
                                Export orders (CSV)
                            </button>
                            <button className={BTN_OUTLINE} onClick={() => { setSelected(null); setDetail(null); }}>Close</button>
                        </div>
                    </div>

                    {detailError ? (
                        <div className="text-sm text-red-600">
                            <p>{detailError}</p>
                            <button className={LINK} onClick={() => selected && openDetail(selected)}>Try again</button>
                        </div>
                    ) : !detail ? <p className={`text-sm ${C.muted}`}>Loading…</p> : (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                                <Stat label="Delito committed" value={inr(detail.stats.committedPlatform)} help="Delito's share on orders placed (not yet cancelled)." />
                                <Stat label="Delito accrued" value={inr(detail.stats.accruedPlatform)} help="Delito's share on delivered orders." />
                                <Stat label="Restaurants committed" value={inr(detail.stats.committedVendor)} help="Restaurants' share on orders placed." />
                                <Stat label="Orders" value={String(detail.stats.redemptions)} help="Orders that used this offer." />
                                <Stat label="Flagged" value={String(detail.stats.anomalyOrders)} help="Orders with an anomaly — Delito funded those in full." />
                            </div>

                            <h3 className="font-semibold mt-2">Restaurants</h3>
                            <div className={`overflow-x-auto rounded-lg ${C.border}`}>
                                <table className="min-w-full text-sm">
                                    <thead className={`${C.subtle} ${C.muted} text-xs uppercase`}>
                                        <tr>
                                            <th className="p-2 text-left">Restaurant</th>
                                            <th className="p-2 text-left">Status</th>
                                            <th className="p-2 text-left">Consent</th>
                                            <th className="p-2 text-left">Orders</th>
                                            <th className="p-2 text-left">They funded</th>
                                            <th className="p-2 text-left">Delito funded</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.enrollments.map((e: any) => (
                                            <tr key={e.enrollmentId} className="border-t border-[var(--border)]">
                                                <td className="p-2">{e.vendorName || e.vendorId}</td>
                                                <td className="p-2"><StatusPill status={e.status} /></td>
                                                <td className="p-2 text-xs">
                                                    {e.consentAt ? `${new Date(e.consentAt).toLocaleString('en-IN')} · OTP ••${e.consentPhoneLast4}` : '—'}
                                                    {e.status === 'ACCEPTED' && e.consentTermsHash !== e.proposedTermsHash && (
                                                        <span className="font-semibold text-amber-600"> · terms moved on</span>
                                                    )}
                                                </td>
                                                <td className="p-2">{e.totals.orders}</td>
                                                <td className="p-2">{inr(e.totals.vendorFunded)}</td>
                                                <td className="p-2">{inr(e.totals.platformFunded)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <h3 className="font-semibold mt-2">Recent orders</h3>
                            <div className={`overflow-x-auto rounded-lg ${C.border}`}>
                                <table className="min-w-full text-sm">
                                    <thead className={`${C.subtle} ${C.muted} text-xs uppercase`}>
                                        <tr>
                                            <th className="p-2 text-left">Order</th>
                                            <th className="p-2 text-left">Cart</th>
                                            <th className="p-2 text-left">Discount</th>
                                            <th className="p-2 text-left">Restaurant</th>
                                            <th className="p-2 text-left">Delito</th>
                                            <th className="p-2 text-left">Restaurant earns</th>
                                            <th className="p-2 text-left">State</th>
                                            <th className="p-2 text-left">Flags</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.redemptions.slice(0, 50).map((r: any) => (
                                            <tr key={r.orderId} className="border-t border-[var(--border)]">
                                                <td className="p-2 font-mono text-xs">{r.orderId}</td>
                                                <td className="p-2">{inr(r.grossItemTotal)}</td>
                                                <td className="p-2">{inr(r.discount)}</td>
                                                <td className="p-2">{inr(r.vendorFunded)}</td>
                                                <td className="p-2">{inr(r.platformFunded)}</td>
                                                <td className="p-2">{inr(r.vendorEarning)}</td>
                                                <td className="p-2">{r.status}</td>
                                                <td className="p-2 text-xs font-semibold text-amber-600">{r.anomalies.join(', ')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Customer-app preview ────────────────────────────────────────────────────

/**
 * A phone mock that mirrors the customer app's CampaignUi.kt: the badge on a
 * restaurant card, the offer strip with its "add ₹X more" progress bar, and the bill row.
 * Drag the sample-cart slider to see the locked and unlocked states.
 */
function CustomerPreview({ draft }: { draft: CampaignDraft }) {
    const min = Math.max(0, Number(draft.minOrderValue) || 0);
    const [cart, setCart] = useState<number>(Math.max(100, Math.round(min * 0.7)));
    const [commission, setCommission] = useState<number>(draft.commissionRateOverride ?? 15);
    useEffect(() => { if (draft.commissionRateOverride != null) setCommission(draft.commissionRateOverride); }, [draft.commissionRateOverride]);

    const color = /^#?[0-9a-f]{6}$/i.test(draft.customer.badgeColorHex.trim())
        ? (draft.customer.badgeColorHex.trim().startsWith('#') ? draft.customer.badgeColorHex.trim() : `#${draft.customer.badgeColorHex.trim()}`)
        : '#E23744';
    const badge = draft.customer.badgeText || suggestedBadge(draft);
    const title = draft.customer.title || 'Your offer title';
    const needed = Math.max(0, min - cart);
    const unlocked = needed <= 0;
    const progress = min > 0 ? Math.min(1, cart / min) : 1;
    const split = previewSplit(draft, cart, commission);
    const sliderMax = Math.max(1000, Math.ceil(min * 3 / 50) * 50);

    return (
        <div className={`rounded-xl ${C.border} ${C.subtle} p-4 space-y-4`}>
            <div>
                <div className="font-bold">Live preview</div>
                <p className={`text-xs ${C.muted}`}>Exactly how the customer app shows this offer. Nothing here is saved.</p>
            </div>

            <label className="block text-xs font-semibold">
                Sample cart value: <span className="text-[var(--primary)]">{inr(cart)}</span>
                <input type="range" min={0} max={sliderMax} step={10} value={cart} onChange={(e) => setCart(Number(e.target.value))}
                    className="mt-1 w-full accent-[var(--primary)]" />
            </label>

            {/* Phone — always light, like the app, so it previews real colours */}
            <div className="mx-auto w-full max-w-[340px] rounded-[28px] border-[6px] border-[#1A1F26] bg-[#F5F5F5] p-3 text-[#1A1F26] shadow-lg">
                <div className="mb-2 text-center text-[10px] font-semibold text-[#6B7280]">Home · offer slideshow</div>
                <OfferSlidePreview draft={draft} color={color} />

                <div className="mb-2 mt-4 text-center text-[10px] font-semibold text-[#6B7280]">Home · restaurant card</div>
                <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
                    <div className="relative h-28 bg-gradient-to-br from-[#FFB74D] to-[#F4511E]">
                        <span className="absolute right-2 top-2 rounded-md bg-[#1D7A3F] px-1.5 py-0.5 text-[10px] font-bold text-white">4.3 ★</span>
                        <SavingsOverlay draft={draft} color={color} />
                    </div>
                    <div className="p-2.5">
                        <div className="text-sm font-bold">Sample Restaurant</div>
                        <div className="text-[11px] text-[#6B7280]">North Indian · 25–30 min</div>
                    </div>
                </div>

                <div className="mb-2 mt-4 text-center text-[10px] font-semibold text-[#6B7280]">Restaurant page & cart · offer strip</div>
                <div className="rounded-xl p-3" style={{ background: `${color}1A`, border: `1px solid ${color}40` }}>
                    <div className="flex items-center gap-2">
                        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-extrabold text-white" style={{ background: color }}>{badge}</span>
                        <div className="min-w-0">
                            <div className="truncate text-[13px] font-bold">{title}</div>
                            <div className="text-[11px] text-[#4B5563]">
                                {unlocked
                                    ? (split.D > 0 ? `🎉 You're saving ₹${split.D} on this order` : (draft.customer.subtitle || 'Applied automatically at checkout'))
                                    : <>Add <b style={{ color }}>₹{Math.ceil(needed)}</b> more to unlock</>}
                            </div>
                        </div>
                    </div>
                    {min > 0 && (
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white">
                            <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${progress * 100}%`, background: color }} />
                        </div>
                    )}
                </div>

                <div className="mb-2 mt-4 text-center text-[10px] font-semibold text-[#6B7280]">Checkout · bill</div>
                <div className="space-y-1 rounded-xl bg-white p-3 text-[12px]">
                    <div className="flex justify-between"><span>Item total</span><span>₹{cart}</span></div>
                    {split.D > 0 && (
                        <div className="flex justify-between font-semibold text-[#15803D]"><span>{title}</span><span>-₹{split.D}</span></div>
                    )}
                    <div className="flex justify-between border-t border-dashed border-[#E5E7EB] pt-1 font-bold"><span>Food to pay</span><span>₹{split.customerPays}</span></div>
                </div>
            </div>

            {/* Who pays, for this sample cart */}
            <div className={`rounded-lg ${C.border} ${C.surface} p-3 text-xs space-y-1`}>
                <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">Who pays on {inr(cart)}</span>
                    <label className={`flex items-center gap-1 ${C.muted}`}>
                        commission
                        <input type="number" className={`${INPUT} !w-16 !px-1.5 !py-0.5`} value={commission} onChange={(e) => setCommission(Number(e.target.value) || 0)} />%
                    </label>
                </div>
                {split.D === 0 ? (
                    <p className={C.muted}>{unlocked ? 'No discount on this cart.' : `Below the ₹${min} minimum — no discount yet.`}</p>
                ) : (
                    <>
                        <Row k="Customer saves" v={inr(split.D)} strong />
                        <Row k="Restaurant funds" v={inr(split.Dv)} />
                        <Row k="Delito funds" v={inr(split.Dp)} />
                        <Row k="Commission + GST" v={inr(split.deduction)} />
                        <Row k="Restaurant earns" v={`${inr(split.vendorEarning)}  (${inr(split.vendorEarningWithoutOffer)} without offer)`} strong />
                    </>
                )}
                <p className={`pt-1 ${C.muted}`}>Estimate for a cart where every item is eligible. The server prices real orders.</p>
            </div>
        </div>
    );
}

/** "70%" + "OFF" / "₹75" + "OFF", and the cap line — the same split the app draws. */
function savingParts(d: CampaignDraft): { big: string; small: string } {
    if (d.type === 'FLAT') return { big: `₹${Math.round(d.flat)}`, small: d.minOrderValue > 0 ? `ABOVE ₹${Math.round(d.minOrderValue)}` : '' };
    return { big: `${Math.round(d.percent)}%`, small: d.maxDiscount > 0 ? `UPTO ₹${Math.round(d.maxDiscount)}` : '' };
}

/** Mirrors CampaignSavingsOverlay in CampaignUi.kt: dark gradient, big saving, accent bar. */
function SavingsOverlay({ draft, color }: { draft: CampaignDraft; color: string }) {
    const { big, small } = savingParts(draft);
    return (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2.5 pb-2 pt-8">
            <div className="flex items-end gap-2">
                <span className="mb-1 h-7 w-1 rounded-full" style={{ background: color }} />
                <div className="leading-none text-white">
                    <div className="flex items-baseline gap-1">
                        <span className="text-[26px] font-black tracking-tight [text-shadow:0_1px_4px_rgba(0,0,0,.45)]">{big}</span>
                        <span className="text-[13px] font-extrabold tracking-wide">OFF</span>
                    </div>
                    {small && <div className="mt-0.5 text-[10px] font-bold tracking-wider text-white/85">{small}</div>}
                </div>
            </div>
        </div>
    );
}

/** Mirrors CampaignOfferSlide in CampaignUi.kt: blurred full-bleed photo, scrim, saving + CTA. */
function OfferSlidePreview({ draft, color }: { draft: CampaignDraft; color: string }) {
    const { big, small } = savingParts(draft);
    const img = draft.customer.bannerImageUrl;
    return (
        <div className="relative h-[124px] overflow-hidden rounded-2xl text-white shadow-md" style={{ background: `linear-gradient(135deg, ${color}, #1A1F26)` }}>
            {img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover" style={{ filter: 'blur(7px)' }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/20" />
            <div className="relative flex h-full items-center gap-3 px-4">
                <div className="leading-none">
                    <div className="text-[10px] font-bold tracking-[0.18em] text-white/80">{draft.type === 'FLAT' ? 'FLAT' : 'GET'}</div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-[38px] font-black tracking-tight">{big}</span>
                        <span className="text-base font-extrabold">OFF</span>
                    </div>
                    {small && <div className="mt-1 text-[10px] font-bold tracking-wider text-white/85">{small}</div>}
                </div>
                <div className="h-14 w-px bg-white/30" />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">Sample Restaurant</div>
                    <div className="truncate text-[11px] text-white/80">{draft.customer.title || 'Your offer title'}</div>
                    <span className="mt-2 inline-block rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: color }}>ORDER NOW →</span>
                </div>
            </div>
        </div>
    );
}

function BannerUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
                <div className={`relative h-20 w-44 overflow-hidden rounded-lg ${C.border} ${C.subtle}`}>
                    {value ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={value} alt="Banner background" className="h-full w-full object-cover" />
                    ) : (
                        <div className={`flex h-full items-center justify-center text-xs ${C.muted}`}>No image</div>
                    )}
                </div>
                <label className={`${BTN_OUTLINE} cursor-pointer`}>
                    {busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={busy}
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            setBusy(true);
                            setErr('');
                            try { onChange(await uploadBannerImage(file)); }
                            catch (x) { setErr(x instanceof Error ? x.message : 'Upload failed'); }
                            finally { setBusy(false); }
                        }}
                    />
                </label>
                {value && <button type="button" className="text-sm font-semibold text-red-600 hover:underline" onClick={() => onChange('')}>Remove</button>}
            </div>
            {err && <p className="text-xs font-semibold text-red-600">{err}</p>}
        </div>
    );
}

// ── Small building blocks ───────────────────────────────────────────────────

function Section({ step, title, hint, children }: { step: string; title: string; hint: string; children: ReactNode }) {
    return (
        <section aria-label={`Step ${step}: ${title}`}>
            <div className="mb-6">
                <h3 className="text-lg font-bold leading-tight">{title}</h3>
                <p className={`mt-1 text-sm ${C.muted}`}>{hint}</p>
            </div>
            <div className="grid gap-x-6 gap-y-7 md:grid-cols-2">{children}</div>
        </section>
    );
}

function Field({ label, help, wide, children }: { label: string; help: string; wide?: boolean; children: ReactNode }) {
    return (
        <div className={`flex min-w-0 flex-col ${wide ? 'md:col-span-2' : ''}`}>
            <label className="mb-2 text-sm font-semibold">{label}</label>
            {children}
            <p className={`mt-2 text-xs leading-relaxed ${C.muted}`}>{help}</p>
        </div>
    );
}

function NumberInput({ value, onChange, prefix, suffix, allowBlank }: {
    value: number | null; prefix?: string; suffix?: string; allowBlank?: boolean;
    onChange: (v: any) => void;
}) {
    return (
        <div className="relative flex items-center">
            {prefix && <span className={`pointer-events-none absolute left-3 text-sm ${C.muted}`}>{prefix}</span>}
            <input
                type="number"
                className={`${INPUT} ${prefix ? 'pl-7' : ''} ${suffix ? 'pr-8' : ''}`}
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value === '' ? (allowBlank ? null : 0) : Number(e.target.value))}
            />
            {suffix && <span className={`pointer-events-none absolute right-3 text-sm ${C.muted}`}>{suffix}</span>}
        </div>
    );
}

function Banner({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: ReactNode }) {
    const style = tone === 'error'
        ? 'border-red-600 bg-red-600/10 text-red-600'
        : tone === 'warn' ? 'border-amber-500 bg-amber-500/15 text-amber-600'
            : 'border-sky-600 bg-sky-600/10 text-sky-600';
    return <div className={`rounded-lg border-l-4 p-3 text-sm font-medium ${style}`}>{children}</div>;
}

function StatusPill({ status }: { status: string }) {
    return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] || 'bg-slate-500 text-white'}`}>
            {status.replace('_', ' ').toLowerCase()}
        </span>
    );
}

function OfferBadge({ text, color }: { text: string; color: string }) {
    return (
        <span className="inline-block rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white"
            style={{ background: /^#[0-9a-f]{6}$/i.test(color) ? color : '#E23744' }}>
            {text}
        </span>
    );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
    return (
        <div className={`flex justify-between gap-3 ${strong ? 'font-bold' : ''}`}>
            <span className={strong ? '' : C.muted}>{k}</span><span>{v}</span>
        </div>
    );
}

function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
    return (
        <div className={`rounded-lg ${C.border} ${C.surface} p-3`} title={help}>
            <div className={`text-xs ${C.muted}`}>{label}</div>
            <div className="text-lg font-bold">{value}</div>
            {help && <div className={`text-[11px] leading-snug ${C.muted}`}>{help}</div>}
        </div>
    );
}
