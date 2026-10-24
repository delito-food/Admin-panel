'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudRain, Flame, Moon, PartyPopper, Plus, Play, Square, Pencil, Trash2, Loader2, X, Zap } from 'lucide-react';

/*
 * Surge Charges — admin page.
 *
 * Rules are stored in Firestore `surgeRules` through /api/surge. The customer app
 * prices the live rule into the order (shared/SurgeRepository.kt), shows the chosen
 * animation on its home header and one short line; the rider app shows the bonus.
 */

type SurgeType = 'rain' | 'demand' | 'night' | 'festival' | 'custom';
type Trigger = 'manual' | 'schedule';
type Animation = 'rain' | 'redTint' | 'night' | 'confetti' | 'none';

interface SurgeRule {
    id: string;
    name: string;
    type: SurgeType;
    trigger: Trigger;
    amount: number;
    riderPercent: number;
    riderShare: number;
    platformShare: number;
    animation: Animation;
    message: string;
    zones: string[];
    startMinute: number;
    endMinute: number;
    days: number[];
    showRiderShare: boolean;
    enabled: boolean;
    activeUntil: string | null;
    live: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
}

type Draft = Omit<SurgeRule, 'id' | 'riderShare' | 'platformShare' | 'activeUntil' | 'live' | 'updatedAt' | 'updatedBy'> & { id?: string };

const TYPE_DEFAULTS: Record<SurgeType, { name: string; animation: Animation; message: string; amount: number; riderPercent: number }> = {
    rain: { name: 'Rain', animation: 'rain', message: 'It’s raining in your area', amount: 20, riderPercent: 75 },
    demand: { name: 'High demand', animation: 'redTint', message: 'Lots of orders right now', amount: 15, riderPercent: 70 },
    night: { name: 'Late night', animation: 'night', message: 'Late-night delivery', amount: 10, riderPercent: 100 },
    festival: { name: 'Festival rush', animation: 'confetti', message: 'Festival rush', amount: 25, riderPercent: 60 },
    custom: { name: 'Surge', animation: 'none', message: 'Surge pricing is on', amount: 10, riderPercent: 50 },
};

const ANIMS: { key: Animation; label: string }[] = [
    { key: 'rain', label: 'Rain drops' },
    { key: 'redTint', label: 'Red tint' },
    { key: 'night', label: 'Night stars' },
    { key: 'confetti', label: 'Confetti' },
    { key: 'none', label: 'None' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DURATIONS = [30, 60, 120, 240];

const fld: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-secondary)' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };

function typeIcon(t: SurgeType, size = 16) {
    switch (t) {
        case 'rain': return <CloudRain size={size} />;
        case 'demand': return <Flame size={size} />;
        case 'night': return <Moon size={size} />;
        case 'festival': return <PartyPopper size={size} />;
        default: return <Zap size={size} />;
    }
}

const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return ((h || 0) * 60 + (m || 0)) % 1440; };
const rupees = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(1)}`;
/** Same rounding as SurgeRepository.riderShareOf. */
const share = (amount: number, pct: number) => Math.round(amount * pct / 10) / 10;

function newDraft(type: SurgeType = 'rain'): Draft {
    const d = TYPE_DEFAULTS[type];
    return {
        name: d.name, type, trigger: type === 'night' ? 'schedule' : 'manual',
        amount: d.amount, riderPercent: d.riderPercent, animation: d.animation, message: d.message,
        zones: [], startMinute: 23 * 60, endMinute: 5 * 60, days: [], showRiderShare: true, enabled: type === 'night',
    };
}

function triggerText(r: SurgeRule) {
    if (r.trigger === 'manual') {
        if (r.live && r.activeUntil) return `Manual · until ${new Date(r.activeUntil).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
        return 'Manual';
    }
    const days = r.days.length === 0 || r.days.length === 7 ? 'daily' : r.days.map(d => DAYS[d]).join(', ');
    return `${toHHMM(r.startMinute)}–${toHHMM(r.endMinute)} · ${days}`;
}

function status(r: SurgeRule): { text: string; fg: string; bg: string } {
    if (r.live) return { text: 'Live', fg: '#065F46', bg: '#D1FAE5' };
    if (r.enabled && r.trigger === 'schedule') return { text: 'Scheduled', fg: '#92400E', bg: '#FEF3C7' };
    return { text: 'Off', fg: '#4B5563', bg: '#F3F4F6' };
}

/** Customer-app preview: the same looks SurgeUi.kt draws on the home header. */
function Preview({ draft }: { draft: Draft }) {
    const rider = share(draft.amount, draft.riderPercent);
    const sky: Record<Animation, string> = {
        rain: 'linear-gradient(180deg,#2B4A55,#3C6470)',
        redTint: 'linear-gradient(180deg,#25671E,#1B4D15)',
        night: 'linear-gradient(180deg,#14163A,#3D3A7A)',
        confetti: 'linear-gradient(180deg,#25671E,#1B4D15)',
        none: 'linear-gradient(180deg,#25671E,#1B4D15)',
    };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--foreground-secondary)' }}>Customer app preview</span>
            <div style={{ borderRadius: 22, overflow: 'hidden', border: '1px solid var(--border)', background: '#FBF7EF' }}>
                <div className="sg-sky" style={{ background: sky[draft.animation] }}>
                    {draft.animation === 'rain' && Array.from({ length: 10 }).map((_, i) => <i key={i} className="sg-drop" style={{ left: `${6 + i * 9.5}%`, animationDelay: `${(i * 0.37) % 0.9}s` }} />)}
                    {draft.animation === 'redTint' && <i className="sg-red" />}
                    {draft.animation === 'night' && Array.from({ length: 8 }).map((_, i) => <i key={i} className="sg-star" style={{ left: `${8 + i * 11}%`, top: `${12 + ((i * 37) % 60)}%`, animationDelay: `${(i * 0.4) % 2}s` }} />)}
                    {draft.animation === 'confetti' && Array.from({ length: 9 }).map((_, i) => <i key={i} className="sg-bit" style={{ left: `${5 + i * 10.5}%`, animationDelay: `${(i * 0.53) % 2.4}s`, background: ['#F2B50B', '#FFFFFF', '#48A111', '#FFD54F', '#C0562F'][i % 5] }} />)}
                    <span style={{ position: 'relative', fontSize: 12, color: 'rgba(255,255,255,.85)' }}>Delivering to · Home</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid #EDE5D8', background: '#FFFDFA', fontFamily: 'Roboto, system-ui, sans-serif' }}>
                    <span style={{ color: '#5F574C', display: 'flex' }}>{typeIcon(draft.type, 14)}</span>
                    <span style={{ fontSize: 13, color: '#1F1B16', flex: 1 }}>{draft.message || TYPE_DEFAULTS[draft.type].message}</span>
                    <span style={{ fontSize: 13, color: '#5F574C' }}>+{rupees(draft.amount)} fee</span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontFamily: 'Roboto, system-ui, sans-serif', color: '#5F574C' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Delivery fee</span><span style={{ color: '#16130F' }}>₹25</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{draft.name} surge fee{draft.showRiderShare && rider > 0 ? <span style={{ display: 'block', fontSize: 11.5, color: '#9A9083' }}>{rupees(rider)} goes to your rider</span> : null}</span>
                        <span style={{ color: '#16130F' }}>{rupees(draft.amount)}</span>
                    </div>
                </div>
            </div>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--foreground-secondary)', marginTop: 6 }}>Rider app</span>
            <div style={{ borderRadius: 14, background: '#16301A', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#B9CDB3' }}>{draft.name} bonus per order</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#F2B50B' }}>+{rupees(rider)}</span>
            </div>
        </div>
    );
}

export default function SurgePage() {
    const [rules, setRules] = useState<SurgeRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [draft, setDraft] = useState<Draft | null>(null);
    const [duration, setDuration] = useState<Record<string, number>>({});
    const [zonesText, setZonesText] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/surge');
            const json = await res.json();
            if (json.success) setRules(json.data.rules); else setError(json.error || 'Failed to load');
        } catch {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    }, []);

    // Re-read every 30 s so a manual rule that ran out flips to "Off" without a reload.
    useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

    const call = async (method: string, body?: unknown, query = '') => {
        setError('');
        const res = await fetch(`/api/surge${query}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({ success: false, error: 'Bad response' }));
        if (!json.success) throw new Error(json.error || 'Request failed');
        return json;
    };

    const run = async (key: string, fn: () => Promise<unknown>) => {
        setBusy(key);
        try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(null); }
    };

    const openNew = () => { setDraft(newDraft('rain')); setZonesText(''); };
    const openEdit = (r: SurgeRule) => {
        setDraft({
            id: r.id, name: r.name, type: r.type, trigger: r.trigger, amount: r.amount, riderPercent: r.riderPercent,
            animation: r.animation, message: r.message, zones: r.zones, startMinute: r.startMinute, endMinute: r.endMinute,
            days: r.days, showRiderShare: r.showRiderShare, enabled: r.enabled,
        });
        setZonesText(r.zones.join(', '));
    };

    const save = () => {
        if (!draft) return;
        const rule = { ...draft, zones: zonesText.split(',').map(z => z.trim()).filter(Boolean) };
        run('save', async () => {
            if (draft.id) await call('PATCH', { id: draft.id, rule });
            else await call('POST', { rule });
            setDraft(null);
        });
    };

    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => (d ? { ...d, [k]: v } : d));
    const pickType = (t: SurgeType) => setDraft(d => {
        if (!d) return d;
        const def = TYPE_DEFAULTS[t];
        // Only replace the name / text / look the admin has not customised.
        const prev = TYPE_DEFAULTS[d.type];
        return {
            ...d, type: t,
            name: d.name === prev.name ? def.name : d.name,
            message: d.message === prev.message ? def.message : d.message,
            animation: d.animation === prev.animation ? def.animation : d.animation,
        };
    });

    const live = useMemo(() => rules.filter(r => r.live), [rules]);
    const riderShare = draft ? share(draft.amount, draft.riderPercent) : 0;

    return (
        <div style={{ padding: '24px 28px 48px', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <style>{`
                .sg-sky{position:relative;overflow:hidden;height:96px;padding:12px;display:flex;align-items:flex-end;box-sizing:border-box}
                .sg-drop{position:absolute;top:0;width:1.5px;height:14px;border-radius:2px;background:rgba(255,255,255,.7);animation:sgFall .85s linear infinite}
                .sg-red{position:absolute;inset:0;background:rgba(211,47,47,.28)}
                .sg-star{position:absolute;width:3px;height:3px;border-radius:2px;background:#fff;animation:sgTw 2s ease-in-out infinite}
                .sg-bit{position:absolute;top:0;width:6px;height:9px;border-radius:2px;animation:sgConf 2.4s linear infinite}
                @keyframes sgFall{0%{transform:translate(0,-20px)}100%{transform:translate(-10px,110px)}}
                @keyframes sgTw{0%,100%{opacity:.2}50%{opacity:1}}
                @keyframes sgConf{0%{transform:translateY(-14px) rotate(0)}100%{transform:translateY(110px) rotate(400deg)}}
            `}</style>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Surge Charges</h1>
                    <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--foreground-secondary)' }}>
                        Extra fee per order during rain, rush or late hours, split between the rider and Delito. Shown to customers before they pay.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {live.length > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', fontWeight: 600, color: '#065F46', background: '#D1FAE5', borderRadius: 999, padding: '7px 12px' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#10B981' }} />
                            Live now: {live.map(r => r.name).join(', ')}
                        </span>
                    )}
                    <button onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 16px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                        <Plus size={16} /> New surge rule
                    </button>
                </div>
            </div>

            {error && <div style={{ padding: '10px 14px', borderRadius: 10, background: '#FEE2E2', color: '#991B1B', fontSize: '0.875rem' }}>{error}</div>}

            <section style={{ ...card, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820, fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--foreground-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            <th style={{ padding: '12px 16px' }}>Rule</th>
                            <th style={{ padding: '12px 8px' }}>When</th>
                            <th style={{ padding: '12px 8px' }}>Fee</th>
                            <th style={{ padding: '12px 8px' }}>Rider / Delito</th>
                            <th style={{ padding: '12px 8px' }}>Animation</th>
                            <th style={{ padding: '12px 8px' }}>Status</th>
                            <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center' }}><Loader2 size={18} className="animate-spin" /></td></tr>}
                        {!loading && rules.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No surge rules yet. Create one — it stays off until you start it.</td></tr>
                        )}
                        {rules.map(r => {
                            const st = status(r);
                            const running = r.live || (r.enabled && r.trigger === 'schedule');
                            return (
                                <tr key={r.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                                    <td style={{ padding: '12px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>{typeIcon(r.type)} {r.name}</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{r.zones.length ? r.zones.join(', ') : 'All areas'}</div>
                                    </td>
                                    <td style={{ padding: '12px 8px' }}>{triggerText(r)}</td>
                                    <td style={{ padding: '12px 8px', fontWeight: 700 }}>{rupees(r.amount)}</td>
                                    <td style={{ padding: '12px 8px' }}>{rupees(r.riderShare)} / {rupees(r.platformShare)}</td>
                                    <td style={{ padding: '12px 8px' }}>{ANIMS.find(a => a.key === r.animation)?.label}</td>
                                    <td style={{ padding: '12px 8px' }}><span style={{ fontSize: '0.75rem', fontWeight: 700, color: st.fg, background: st.bg, borderRadius: 999, padding: '4px 10px' }}>{st.text}</span></td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                                            {running ? (
                                                <button title="Stop" disabled={busy !== null} onClick={() => run(`stop-${r.id}`, () => call('PATCH', { id: r.id, action: 'stop' }))}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C', fontWeight: 600, cursor: 'pointer' }}>
                                                    <Square size={13} /> Stop
                                                </button>
                                            ) : (
                                                <>
                                                    {r.trigger === 'manual' && (
                                                        <select aria-label="Duration" value={duration[r.id] ?? 60} onChange={e => setDuration(d => ({ ...d, [r.id]: Number(e.target.value) }))} style={{ ...fld, width: 'auto', padding: '6px 8px', height: 32 }}>
                                                            {DURATIONS.map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
                                                        </select>
                                                    )}
                                                    <button title="Start" disabled={busy !== null} onClick={() => run(`start-${r.id}`, () => call('PATCH', { id: r.id, action: 'start', minutes: duration[r.id] ?? 60 }))}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #6EE7B7', background: '#fff', color: '#047857', fontWeight: 600, cursor: 'pointer' }}>
                                                        <Play size={13} /> {r.trigger === 'manual' ? 'Start' : 'Turn on'}
                                                    </button>
                                                </>
                                            )}
                                            <button title="Edit" aria-label="Edit" onClick={() => openEdit(r)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Pencil size={14} /></button>
                                            <button title="Delete" aria-label="Delete" disabled={busy !== null} onClick={() => { if (window.confirm(`Delete "${r.name}"?`)) run(`del-${r.id}`, () => call('DELETE', undefined, `?id=${encodeURIComponent(r.id)}`)); }}
                                                style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B91C1C' }}><Trash2 size={14} /></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>

            {draft && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
                    <section style={{ ...card, flex: '999 1 520px', minWidth: 0, padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>{draft.id ? `Edit: ${draft.name}` : 'New surge rule'}</h2>
                            <button aria-label="Close" onClick={() => setDraft(null)} style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={16} /></button>
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {(Object.keys(TYPE_DEFAULTS) as SurgeType[]).map(t => (
                                <button key={t} onClick={() => pickType(t)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', border: draft.type === t ? '2px solid var(--primary)' : '1px solid var(--border)', background: draft.type === t ? 'rgba(244,81,30,.06)' : 'var(--surface)', color: 'var(--foreground)' }}>
                                    {typeIcon(t, 14)} {TYPE_DEFAULTS[t].name}
                                </button>
                            ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                            <label style={lbl}>Rule name<input style={fld} value={draft.name} maxLength={40} onChange={e => set('name', e.target.value)} /></label>
                            <label style={lbl}>Message customers see (short)<input style={fld} value={draft.message} maxLength={80} onChange={e => set('message', e.target.value)} placeholder={TYPE_DEFAULTS[draft.type].message} /></label>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <span style={lbl}>When does it run?</span>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {(['manual', 'schedule'] as Trigger[]).map(t => (
                                    <button key={t} onClick={() => set('trigger', t)} style={{ flex: '1 1 200px', textAlign: 'left', padding: 12, borderRadius: 12, cursor: 'pointer', border: draft.trigger === t ? '2px solid var(--primary)' : '1px solid var(--border)', background: draft.trigger === t ? 'rgba(244,81,30,.06)' : 'var(--surface)', color: 'var(--foreground)' }}>
                                        <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{t === 'manual' ? 'Manual' : 'Schedule'}</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>{t === 'manual' ? 'You press Start (e.g. when it rains). Stops by itself.' : 'Same time window on the chosen days (IST).'}</div>
                                    </button>
                                ))}
                            </div>
                            {draft.trigger === 'schedule' && (
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                    <label style={{ ...lbl, width: 130 }}>From<input type="time" style={fld} value={toHHMM(draft.startMinute)} onChange={e => set('startMinute', fromHHMM(e.target.value))} /></label>
                                    <label style={{ ...lbl, width: 130 }}>To<input type="time" style={fld} value={toHHMM(draft.endMinute)} onChange={e => set('endMinute', fromHHMM(e.target.value))} /></label>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {DAYS.map((d, i) => {
                                            const on = draft.days.length === 0 || draft.days.includes(i);
                                            return (
                                                <button key={d} onClick={() => {
                                                    const cur = draft.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : draft.days;
                                                    const next = cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort();
                                                    if (next.length === 0) return; // keep at least one day
                                                    set('days', next.length === 7 ? [] : next);
                                                }} style={{ height: 36, minWidth: 44, borderRadius: 8, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, border: on ? '1px solid var(--primary)' : '1px solid var(--border)', background: on ? 'rgba(244,81,30,.08)' : 'var(--surface)', color: 'var(--foreground)' }}>{d}</button>
                                            );
                                        })}
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                                        <input type="checkbox" checked={draft.enabled} onChange={e => set('enabled', e.target.checked)} /> Schedule is on
                                    </label>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
                            <label style={lbl}>Surge fee per order (₹1–100, + 18% GST)
                                <input type="number" min={1} max={100} step={1} style={fld} value={draft.amount} onChange={e => set('amount', Math.max(0, Math.min(100, Number(e.target.value))))} />
                            </label>
                            <div style={lbl}>
                                <label htmlFor="sg-split">Split — rider gets {draft.riderPercent}%</label>
                                <input id="sg-split" type="range" min={0} max={100} step={5} value={draft.riderPercent} onChange={e => set('riderPercent', Number(e.target.value))} style={{ accentColor: 'var(--primary)' }} />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#065F46', background: '#D1FAE5', borderRadius: 999, padding: '3px 10px' }}>Rider {rupees(riderShare)}</span>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--foreground)', background: 'var(--border-light)', borderRadius: 999, padding: '3px 10px' }}>Delito {rupees(Math.round((draft.amount - riderShare) * 10) / 10)}</span>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <span style={lbl}>Animation on the customer home screen</span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                                {ANIMS.map(a => (
                                    <button key={a.key} onClick={() => set('animation', a.key)} style={{ height: 44, borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', border: draft.animation === a.key ? '2px solid var(--primary)' : '1px solid var(--border)', background: draft.animation === a.key ? 'rgba(244,81,30,.06)' : 'var(--surface)', color: 'var(--foreground)' }}>{a.label}</button>
                                ))}
                            </div>
                        </div>

                        <label style={lbl}>Areas (comma separated — area names, pincodes or city; blank = everywhere)
                            <input style={fld} value={zonesText} onChange={e => setZonesText(e.target.value)} placeholder="Gomti Nagar, Hazratganj, 226010" />
                            <span style={{ fontWeight: 400, fontSize: '0.75rem' }}>Matched against the customer’s delivery address and the restaurant’s city.</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                            <input type="checkbox" checked={draft.showRiderShare} onChange={e => set('showRiderShare', e.target.checked)} /> Tell customers how much goes to the rider
                        </label>

                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: 14 }}>
                            <button onClick={save} disabled={busy !== null} style={{ height: 42, padding: '0 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                {busy === 'save' && <Loader2 size={15} className="animate-spin" />} Save rule
                            </button>
                            <button onClick={() => setDraft(null)} style={{ height: 42, padding: '0 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                            <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', alignSelf: 'center' }}>
                                {draft.trigger === 'manual' ? 'Saving does not start it — press Start in the list.' : 'Runs automatically in its window while “Schedule is on”.'}
                            </span>
                        </div>
                    </section>
                    <aside style={{ flex: '1 1 280px', maxWidth: 360 }}>
                        <Preview draft={draft} />
                    </aside>
                </div>
            )}
        </div>
    );
}
