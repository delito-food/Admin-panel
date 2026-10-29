'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save, Truck, ShoppingCart } from 'lucide-react';

/*
 * Delivery Charges & Minimum Cart Value — admin page.
 *
 * Saved to Firestore `config/customerPricing` through /api/customer-pricing. The
 * customer app listens to that document (shared/CustomerPricingConfig.kt), so a save
 * reaches every open app within seconds — no release needed. Orders already placed
 * keep the fee they were charged.
 *
 * Fee for an order = clamp(base + distanceKm × rate, min, max), where `rate` is the
 * small-order rate when the item total is at or below the small-order threshold.
 */

interface Values {
    minimumOrderValue: number;
    deliveryBaseFee: number;
    deliveryPerKm: number;
    deliveryPerKmSmallOrder: number;
    smallOrderThreshold: number;
    minDeliveryFee: number;
    maxDeliveryFee: number;
}

const FIELDS: { key: keyof Values; label: string; hint: string; step: number; unit: string }[] = [
    { key: 'deliveryBaseFee', label: 'Base fee', hint: 'Added to every delivery before the per-km part', step: 1, unit: '₹' },
    { key: 'deliveryPerKm', label: 'Per-km rate', hint: 'For orders above the small-order line', step: 0.5, unit: '₹/km' },
    { key: 'deliveryPerKmSmallOrder', label: 'Per-km rate · small orders', hint: 'For orders at or below the small-order line', step: 0.5, unit: '₹/km' },
    { key: 'smallOrderThreshold', label: 'Small-order line', hint: 'Item total at or below this uses the small-order rate', step: 1, unit: '₹' },
    { key: 'minDeliveryFee', label: 'Minimum delivery fee', hint: 'No delivery is charged less than this', step: 1, unit: '₹' },
    { key: 'maxDeliveryFee', label: 'Maximum delivery fee', hint: 'No delivery is charged more than this', step: 1, unit: '₹' },
];

const DISTANCES = [1, 2, 3, 4, 5, 7, 10];

const fld: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.95rem', fontWeight: 600, outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-secondary)' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };

const rupees = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(1)}`;

/** Same formula as PricingCalculator.calculateDeliveryFee. */
function feeFor(v: Values, km: number, itemTotal: number): number {
    const rate = itemTotal <= v.smallOrderThreshold ? v.deliveryPerKmSmallOrder : v.deliveryPerKm;
    const max = Math.max(v.maxDeliveryFee, v.minDeliveryFee);
    const raw = Math.round((v.deliveryBaseFee + km * rate) * 10) / 10;
    return Math.min(Math.max(raw, v.minDeliveryFee), max);
}

export default function DeliveryChargesPage() {
    const [values, setValues] = useState<Values | null>(null);
    const [saved, setSaved] = useState<Values | null>(null);
    const [defaults, setDefaults] = useState<Values | null>(null);
    const [meta, setMeta] = useState<{ updatedAt: string | null; updatedBy: string | null; isDefault: boolean }>({ updatedAt: null, updatedBy: null, isDefault: true });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/customer-pricing');
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to load');
            setValues(json.data.values);
            setSaved(json.data.values);
            setDefaults(json.data.defaults);
            setMeta({ updatedAt: json.data.updatedAt, updatedBy: json.data.updatedBy, isDefault: json.data.isDefault });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Network error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const dirty = useMemo(() => !!values && !!saved && (Object.keys(values) as (keyof Values)[]).some(k => values[k] !== saved[k]), [values, saved]);

    const problem = useMemo(() => {
        if (!values) return '';
        for (const k of Object.keys(values) as (keyof Values)[]) {
            if (!Number.isFinite(values[k]) || values[k] < 0) return 'Every value must be a number of 0 or more.';
        }
        if (values.maxDeliveryFee < values.minDeliveryFee) return 'Maximum delivery fee must be at least the minimum.';
        return '';
    }, [values]);

    const set = (k: keyof Values, raw: string) => setValues(v => (v ? { ...v, [k]: raw === '' ? NaN : Number(raw) } : v));

    const save = async () => {
        if (!values || problem) return;
        if (!window.confirm('Apply these delivery charges to every customer now? Orders already placed are not affected.')) return;
        setBusy(true); setError(''); setNotice('');
        try {
            const res = await fetch('/api/customer-pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
            const json = await res.json().catch(() => ({ success: false, error: 'Bad response' }));
            if (!json.success) throw new Error(json.error || 'Save failed');
            setNotice('Saved. Customer apps pick this up within a few seconds.');
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    if (loading || !values) {
        return <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>{error ? <span style={{ color: '#991B1B' }}>{error}</span> : <Loader2 size={20} className="animate-spin" />}</div>;
    }

    const smallSample = Math.max(values.minimumOrderValue, Math.min(values.smallOrderThreshold, 99));
    const normalSample = Math.max(values.smallOrderThreshold + 1, 249);

    return (
        <div style={{ padding: '24px 28px 48px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Delivery Charges</h1>
                    <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--foreground-secondary)' }}>
                        What customers pay for delivery, and the smallest cart they can check out. Applies to the customer app live.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {defaults && (
                        <button onClick={() => setValues({ ...defaults })} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontWeight: 600, cursor: 'pointer' }}>
                            <RotateCcw size={15} /> App defaults
                        </button>
                    )}
                    <button onClick={save} disabled={busy || !dirty || !!problem} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 18px', borderRadius: 10, border: 'none', background: dirty && !problem ? 'var(--primary)' : 'var(--border)', color: '#fff', fontWeight: 700, cursor: dirty && !problem ? 'pointer' : 'not-allowed' }}>
                        {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save changes
                    </button>
                </div>
            </div>

            {error && <div style={{ padding: '10px 14px', borderRadius: 10, background: '#FEE2E2', color: '#991B1B', fontSize: '0.875rem' }}>{error}</div>}
            {problem && <div style={{ padding: '10px 14px', borderRadius: 10, background: '#FEF3C7', color: '#92400E', fontSize: '0.875rem' }}>{problem}</div>}
            {notice && !dirty && <div style={{ padding: '10px 14px', borderRadius: 10, background: '#D1FAE5', color: '#065F46', fontSize: '0.875rem' }}>{notice}</div>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <section style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><ShoppingCart size={17} /> Minimum cart value</div>
                        <label style={{ ...lbl, maxWidth: 260 }}>
                            Item total needed to check out (₹)
                            <input type="number" min={0} max={2000} step={1} style={fld} value={Number.isFinite(values.minimumOrderValue) ? values.minimumOrderValue : ''} onChange={e => set('minimumOrderValue', e.target.value)} />
                        </label>
                        <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Below this the cart shows “Add ₹X more” and the checkout button stays locked. 0 = no minimum.</span>
                    </section>

                    <section style={{ ...card, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Truck size={17} /> Delivery fee</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                            {FIELDS.map(f => (
                                <label key={f.key} style={lbl}>
                                    {f.label} ({f.unit})
                                    <input type="number" min={0} step={f.step} style={fld} value={Number.isFinite(values[f.key]) ? values[f.key] : ''} onChange={e => set(f.key, e.target.value)} />
                                    <span style={{ fontWeight: 400, fontSize: '0.75rem' }}>{f.hint}</span>
                                </label>
                            ))}
                        </div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                            Fee = base + distance × rate, kept between the minimum and maximum. 18% GST is added on top, as today. Free-delivery offers and surge charges still apply separately.
                        </span>
                    </section>
                </div>

                <section style={{ ...card, flex: '1 1 340px', padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontWeight: 800 }}>What customers will pay</div>
                    {!problem && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', color: 'var(--foreground-secondary)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                                    <th style={{ padding: '6px 0' }}>Distance</th>
                                    <th style={{ padding: '6px 0', textAlign: 'right' }}>Cart {rupees(smallSample)}</th>
                                    <th style={{ padding: '6px 0', textAlign: 'right' }}>Cart {rupees(normalSample)}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {DISTANCES.map(km => {
                                    const a = feeFor(values, km, smallSample);
                                    const b = feeFor(values, km, normalSample);
                                    const was = saved ? feeFor(saved, km, normalSample) : b;
                                    return (
                                        <tr key={km} style={{ borderTop: '1px solid var(--border-light)' }}>
                                            <td style={{ padding: '8px 0' }}>{km} km</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700 }}>{rupees(a)}</td>
                                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700 }}>
                                                {rupees(b)}
                                                {dirty && was !== b && <span style={{ marginLeft: 6, fontWeight: 400, fontSize: '0.75rem', color: 'var(--foreground-secondary)', textDecoration: 'line-through' }}>{rupees(was)}</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                        Before GST. {meta.isDefault ? 'Using the values the app shipped with — nothing saved yet.' : `Last changed ${meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('en-IN') : ''}${meta.updatedBy ? ` by ${meta.updatedBy}` : ''}.`}
                    </span>
                </section>
            </div>
        </div>
    );
}
