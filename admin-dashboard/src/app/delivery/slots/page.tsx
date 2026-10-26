'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Plus, RefreshCw, X, AlertTriangle, Users, Settings2, ClipboardList, LayoutGrid } from 'lucide-react';

/*
 * Rider Slots — admin page.
 *
 * Riders book shifts ("slots") per pincode in the rider app; this page sets up the
 * slots, shows who booked and who turned up, and holds the switches. Everything goes
 * through /api/delivery/slots, which uses the same booking code as the Cloud Functions
 * (functions/riderSlotsStore.js).
 */

type Mode = 'off' | 'soft' | 'hard';

interface Config {
    mode: Mode; pilotPincodes: string[]; bookingOpensAt: string; allowTomorrow: boolean;
    cancelCutoffMin: number; checkInGraceMin: number; maxPerDay: number; strikeLimit: number;
    strikeWindowDays: number; blockDays: number; autoOfflineMin: number; hardFallback: boolean;
    openToAllAfterAttempts: number;
}
interface Template {
    id: string; pincode: string; label: string; labelHi: string; start: string; end: string;
    capacity: number; daysOfWeek: number[]; isPeak: boolean; active: boolean; overlapsWith: string[];
}
interface Booking {
    id: string; riderId: string; riderName: string; riderPhone: string; riderOnline: boolean; status: string;
    bookedBy: string; checkedInAt: string | null; late: boolean; noShowMarked: boolean; onlineMinutes: number;
    deliveriesInSlot: number | null; cancelReason: string | null;
}
interface Slot {
    id: string; date: string; pincode: string; label: string; start: string; end: string; capacity: number;
    bookedCount: number; capacityOverridden: boolean; status: string; isPeak: boolean;
    phase: 'upcoming' | 'running' | 'ended'; bookings: Booking[];
}
interface BoardData { date: string; today: string; config: Config; templates: Template[]; pincodes: string[]; slots: Slot[] }
interface AttendanceRow {
    riderId: string; riderName: string; riderPhone: string; pincode: string; booked: number; completed: number;
    noShow: number; late: number; lateCancel: number; cancelled: number; adminCancelled: number; upcoming: number;
    onlineMinutes: number; deliveries: number; strikes: number; blockedUntil: string | null;
}

const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-secondary)' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' };
const primary: React.CSSProperties = { ...btn, background: '#25671E', borderColor: '#25671E', color: '#fff' };
const danger: React.CSSProperties = { ...btn, color: '#B42318', borderColor: '#F3C4C0' };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmt12(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function istToday() {
    return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(date: string, n: number) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function chip(text: string, fg: string, bg: string) {
    return <span style={{ fontSize: '0.72rem', fontWeight: 700, color: fg, background: bg, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>{text}</span>;
}

function bookingChip(b: Booking, phase: Slot['phase']) {
    switch (b.status) {
        case 'ACTIVE': return chip(b.late ? 'On · late' : 'On', '#065F46', '#D1FAE5');
        case 'BOOKED':
            if (phase === 'upcoming') return chip('Booked', '#1E40AF', '#DBEAFE');
            return b.noShowMarked ? chip('Not online · strike', '#B42318', '#FEE4E2') : chip('Not online yet', '#92400E', '#FEF3C7');
        case 'COMPLETED': return chip('Completed', '#065F46', '#D1FAE5');
        case 'NO_SHOW': return chip('No-show', '#B42318', '#FEE4E2');
        case 'LATE_CANCEL': return chip('Late cancel', '#B42318', '#FEE4E2');
        case 'CANCELLED': return chip('Cancelled', '#4B5563', '#F3F4F6');
        case 'ADMIN_CANCELLED': return chip('Removed', '#4B5563', '#F3F4F6');
        default: return chip(b.status || '—', '#4B5563', '#F3F4F6');
    }
}

const emptyTemplate = (pincode = ''): Omit<Template, 'id' | 'overlapsWith'> & { id?: string } => ({
    pincode, label: '', labelHi: '', start: '11:00', end: '15:00', capacity: 10, daysOfWeek: [1, 2, 3, 4, 5, 6, 7], isPeak: false, active: true,
});

export default function RiderSlotsPage() {
    const [tab, setTab] = useState<'board' | 'templates' | 'attendance' | 'settings'>('board');
    const [date, setDate] = useState(istToday());
    const [pincode, setPincode] = useState('');
    const [data, setData] = useState<BoardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    // Fetch only; state is applied in callbacks (keeps effects free of synchronous setState).
    const fetchBoard = useCallback(async () => {
        const q = new URLSearchParams({ view: 'board', date });
        if (pincode) q.set('pincode', pincode);
        const res = await fetch(`/api/delivery/slots?${q}`);
        return res.json();
    }, [date, pincode]);

    const applyBoard = useCallback((json: { success?: boolean; data?: BoardData; error?: string }) => {
        if (json && json.success && json.data) { setData(json.data); setError(''); } else setError((json && json.error) || 'Failed to load');
        setLoading(false);
    }, []);

    const load = useCallback(
        () => fetchBoard().then(applyBoard, () => { setError('Network error'); setLoading(false); }),
        [fetchBoard, applyBoard]
    );

    // Board refreshes every 20 s so check-ins and bookings appear without a reload.
    useEffect(() => {
        let alive = true;
        const tick = () => fetchBoard().then(
            (json) => { if (alive) applyBoard(json); },
            () => { if (alive) { setError('Network error'); setLoading(false); } }
        );
        tick();
        const t = setInterval(tick, 20000);
        return () => { alive = false; clearInterval(t); };
    }, [fetchBoard, applyBoard]);

    const post = async (body: Record<string, unknown>) => {
        const res = await fetch('/api/delivery/slots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = await res.json().catch(() => ({ success: false, error: 'Bad response' }));
        if (!json.success) throw new Error(json.error || 'Request failed');
        return json;
    };

    const run = async (key: string, fn: () => Promise<unknown>, okText?: string) => {
        setBusy(key); setError(''); setNotice('');
        try { await fn(); if (okText) setNotice(okText); await load(); }
        catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); }
        finally { setBusy(null); }
    };

    const mode = data?.config.mode ?? 'off';
    const modeChip = mode === 'hard' ? chip('Hard — slot riders first', '#065F46', '#D1FAE5')
        : mode === 'soft' ? chip('Soft — booking & attendance only', '#92400E', '#FEF3C7')
        : chip('Off — riders see nothing', '#4B5563', '#F3F4F6');

    const tabs: { key: typeof tab; label: string; icon: React.ReactNode }[] = [
        { key: 'board', label: 'Board', icon: <LayoutGrid size={15} /> },
        { key: 'templates', label: 'Slot setup', icon: <CalendarClock size={15} /> },
        { key: 'attendance', label: 'Attendance', icon: <ClipboardList size={15} /> },
        { key: 'settings', label: 'Settings', icon: <Settings2 size={15} /> },
    ];

    return (
        <div style={{ padding: '24px 28px 48px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Rider Slots</h1>
                    <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--foreground-secondary)' }}>
                        Riders book the hours they will work each morning. Set the slots per pincode, watch who turns up.
                    </p>
                </div>
                {data && modeChip}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {tabs.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} style={{ ...btn, ...(tab === t.key ? { background: 'var(--foreground)', color: 'var(--surface)', borderColor: 'var(--foreground)' } : {}) }}>
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {error && (
                <div style={{ ...card, padding: '10px 14px', borderColor: '#F3C4C0', color: '#B42318', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
                    <AlertTriangle size={16} /> {error}
                    <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={15} /></button>
                </div>
            )}
            {notice && (
                <div style={{ ...card, padding: '10px 14px', borderColor: '#A7F3D0', color: '#065F46', fontSize: '0.875rem' }}>{notice}</div>
            )}

            {loading && !data && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} className="animate-spin" /></div>}

            {data && tab === 'board' && (
                <BoardTab data={data} date={date} setDate={setDate} pincode={pincode} setPincode={setPincode} busy={busy} run={run} post={post} reload={load} />
            )}
            {data && tab === 'templates' && <TemplatesTab data={data} busy={busy} run={run} post={post} />}
            {tab === 'attendance' && <AttendanceTab busy={busy} run={run} post={post} />}
            {data && tab === 'settings' && <SettingsTab key={JSON.stringify(data.config)} config={data.config} busy={busy} run={run} post={post} />}
        </div>
    );
}

type RunFn = (key: string, fn: () => Promise<unknown>, okText?: string) => Promise<void>;
type PostFn = (body: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>;

/* ── Board ─────────────────────────────────────────────────────────── */

function BoardTab({ data, date, setDate, pincode, setPincode, busy, run, post, reload }: {
    data: BoardData; date: string; setDate: (d: string) => void; pincode: string; setPincode: (p: string) => void;
    busy: string | null; run: RunFn; post: PostFn; reload: () => Promise<void>;
}) {
    const [capacity, setCapacity] = useState<Record<string, string>>({});
    const [addRider, setAddRider] = useState<Record<string, string>>({});
    const totals = useMemo(() => {
        const live = data.slots.flatMap(s => s.bookings).filter(b => b.status === 'BOOKED' || b.status === 'ACTIVE' || b.status === 'COMPLETED' || b.status === 'NO_SHOW');
        return {
            places: data.slots.filter(s => s.status === 'OPEN').reduce((a, s) => a + s.capacity, 0),
            booked: data.slots.reduce((a, s) => a + s.bookedCount, 0),
            online: live.filter(b => b.status === 'ACTIVE').length,
            noShow: live.filter(b => b.status === 'NO_SHOW' || b.noShowMarked).length,
        };
    }, [data]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ ...lbl, width: 170 }}>Date
                    <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} style={fld} />
                </label>
                <button style={btn} onClick={() => setDate(istToday())}>Today</button>
                <button style={btn} onClick={() => setDate(addDays(istToday(), 1))}>Tomorrow</button>
                <label style={{ ...lbl, width: 170 }}>Pincode
                    <select value={pincode} onChange={e => setPincode(e.target.value)} style={fld}>
                        <option value="">All</option>
                        {data.pincodes.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </label>
                <button style={btn} onClick={() => reload()}><RefreshCw size={14} /> Refresh</button>
                <button style={btn} disabled={busy === 'gen'} onClick={() => run('gen', async () => {
                    const r = await post({ action: 'generateNow' });
                    return r;
                }, 'Slots for today and tomorrow are created from the slot setup.')}>
                    {busy === 'gen' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create today &amp; tomorrow
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                {[
                    ['Places (open slots)', totals.places],
                    ['Booked', totals.booked],
                    ['On a slot now', totals.online],
                    ['No-shows', totals.noShow],
                ].map(([k, v]) => (
                    <div key={String(k)} style={{ ...card, padding: '12px 14px' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{k}</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{v}</div>
                    </div>
                ))}
            </div>

            {data.slots.length === 0 && (
                <div style={{ ...card, padding: 24, textAlign: 'center', color: 'var(--foreground-secondary)', fontSize: '0.875rem' }}>
                    No slots on {date}. Add slots in <b>Slot setup</b>; they are created for today and tomorrow automatically.
                </div>
            )}

            {data.slots.map(s => {
                const pct = s.capacity > 0 ? Math.min(100, Math.round(s.bookedCount * 100 / s.capacity)) : 100;
                const live = s.bookings.filter(b => b.status === 'BOOKED' || b.status === 'ACTIVE');
                return (
                    <div key={s.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, opacity: s.status === 'CANCELLED' ? 0.6 : 1 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>{fmt12(s.start)} – {fmt12(s.end)}</div>
                            {s.label && <span style={{ color: 'var(--foreground-secondary)', fontSize: '0.875rem' }}>{s.label}</span>}
                            {chip(s.pincode, '#374151', '#F3F4F6')}
                            {s.isPeak && chip('Busy time', '#8A6100', '#FDF6E3')}
                            {s.phase === 'running' ? chip('Running', '#065F46', '#D1FAE5') : s.phase === 'ended' ? chip('Ended', '#4B5563', '#F3F4F6') : chip('Upcoming', '#1E40AF', '#DBEAFE')}
                            {s.status !== 'OPEN' && chip(s.status === 'CLOSED' ? 'Closed to booking' : 'Cancelled', '#B42318', '#FEE4E2')}
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {s.phase !== 'ended' && s.status !== 'CANCELLED' && (
                                    <>
                                        <button style={btn} disabled={!!busy} onClick={() => run(`st-${s.id}`, () => post({ action: 'setSlotStatus', slotId: s.id, status: s.status === 'OPEN' ? 'CLOSED' : 'OPEN' }))}>
                                            {s.status === 'OPEN' ? 'Close booking' : 'Reopen booking'}
                                        </button>
                                        <button style={danger} disabled={!!busy} onClick={() => {
                                            const reason = window.prompt(`Cancel this slot for all ${live.length} rider(s)? They get a notification and no strike.\n\nReason (optional):`, '');
                                            if (reason === null) return;
                                            run(`cx-${s.id}`, () => post({ action: 'cancelSlot', slotId: s.id, reason }), 'Slot cancelled and riders told.');
                                        }}>Cancel slot</button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 240px' }}>
                                <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                                    <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#9A9187' : '#25671E' }} />
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                                    <b>{s.bookedCount}</b> of {s.capacity} booked{s.capacityOverridden ? ' · capacity set for this day' : ''}
                                </div>
                            </div>
                            {s.phase !== 'ended' && s.status !== 'CANCELLED' && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input type="number" min={s.bookedCount} max={500} placeholder={String(s.capacity)} value={capacity[s.id] ?? ''} onChange={e => setCapacity(c => ({ ...c, [s.id]: e.target.value }))} style={{ ...fld, width: 90 }} />
                                    <button style={btn} disabled={!!busy || !capacity[s.id]} onClick={() => run(`cap-${s.id}`, async () => {
                                        await post({ action: 'setCapacity', slotId: s.id, capacity: Number(capacity[s.id]) });
                                        setCapacity(c => ({ ...c, [s.id]: '' }));
                                    })}>Set capacity</button>
                                </div>
                            )}
                            {s.phase !== 'ended' && s.status !== 'CANCELLED' && (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input placeholder="Rider phone" value={addRider[s.id] ?? ''} onChange={e => setAddRider(c => ({ ...c, [s.id]: e.target.value }))} style={{ ...fld, width: 150 }} />
                                    <button style={btn} disabled={!!busy || !addRider[s.id]} onClick={() => run(`add-${s.id}`, async () => {
                                        await post({ action: 'addRider', slotId: s.id, rider: addRider[s.id] });
                                        setAddRider(c => ({ ...c, [s.id]: '' }));
                                    }, 'Rider added to the slot.')}><Users size={14} /> Add</button>
                                </div>
                            )}
                        </div>

                        {s.bookings.length > 0 && (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ textAlign: 'left', color: 'var(--foreground-secondary)', fontSize: '0.75rem' }}>
                                            <th style={{ padding: '6px 8px' }}>Rider</th><th style={{ padding: '6px 8px' }}>Phone</th><th style={{ padding: '6px 8px' }}>Status</th>
                                            <th style={{ padding: '6px 8px' }}>Online now</th><th style={{ padding: '6px 8px' }}>Online min</th><th style={{ padding: '6px 8px' }}>Deliveries</th><th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {s.bookings.map(b => (
                                            <tr key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                                                <td style={{ padding: '8px' }}>{b.riderName || b.riderId}{b.bookedBy.startsWith('admin') ? <span style={{ color: 'var(--foreground-secondary)' }}> · added by admin</span> : null}</td>
                                                <td style={{ padding: '8px' }}>{b.riderPhone}</td>
                                                <td style={{ padding: '8px' }}>{bookingChip(b, s.phase)}</td>
                                                <td style={{ padding: '8px' }}>{b.riderOnline ? chip('Online', '#065F46', '#D1FAE5') : chip('Offline', '#4B5563', '#F3F4F6')}</td>
                                                <td style={{ padding: '8px' }}>{b.onlineMinutes}</td>
                                                <td style={{ padding: '8px' }}>{b.deliveriesInSlot ?? '—'}</td>
                                                <td style={{ padding: '8px', textAlign: 'right' }}>
                                                    {(b.status === 'BOOKED' || b.status === 'ACTIVE') && (
                                                        <button style={danger} disabled={!!busy} onClick={() => {
                                                            if (!window.confirm(`Remove ${b.riderName || 'this rider'} from the slot? No strike; they get a notification.`)) return;
                                                            run(`rm-${b.id}`, () => post({ action: 'removeBooking', bookingId: b.id }));
                                                        }}>Remove</button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* ── Slot setup (templates) ────────────────────────────────────────── */

function TemplatesTab({ data, busy, run, post }: { data: BoardData; busy: string | null; run: RunFn; post: PostFn }) {
    const [draft, setDraft] = useState<(Omit<Template, 'id' | 'overlapsWith'> & { id?: string }) | null>(null);
    const byId = useMemo(() => new Map(data.templates.map(t => [t.id, t])), [data.templates]);
    const set = <K extends keyof NonNullable<typeof draft>>(k: K, v: NonNullable<typeof draft>[K]) => setDraft(d => (d ? { ...d, [k]: v } : d));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--foreground-secondary)', maxWidth: 760 }}>
                    Each row is a daily shift for one pincode. Slots for today and tomorrow are created from these automatically.
                    Edits apply to slots nobody has booked yet; booked slots keep their hours and never go below their booked count.
                </p>
                <button style={primary} onClick={() => setDraft(emptyTemplate(data.pincodes[0] || ''))}><Plus size={14} /> Add slot</button>
            </div>

            {draft && (
                <div style={{ ...card, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                    <label style={lbl}>Pincode<input value={draft.pincode} disabled={!!draft.id} onChange={e => set('pincode', e.target.value.trim())} style={fld} placeholder="204101" /></label>
                    <label style={lbl}>Name (English)<input value={draft.label} onChange={e => set('label', e.target.value)} style={fld} placeholder="Lunch" /></label>
                    <label style={lbl}>Name (Hindi)<input value={draft.labelHi} onChange={e => set('labelHi', e.target.value)} style={fld} placeholder="दोपहर" /></label>
                    <label style={lbl}>Starts<input type="time" value={draft.start} onChange={e => set('start', e.target.value)} style={fld} /></label>
                    <label style={lbl}>Ends<input type="time" value={draft.end} onChange={e => set('end', e.target.value)} style={fld} /></label>
                    <label style={lbl}>Riders per slot<input type="number" min={1} max={500} value={draft.capacity} onChange={e => set('capacity', Number(e.target.value))} style={fld} /></label>
                    <div style={{ ...lbl, gridColumn: '1 / -1' }}>Days
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {DAYS.map((d, i) => {
                                const on = draft.daysOfWeek.includes(i + 1);
                                return (
                                    <button key={d} type="button" onClick={() => set('daysOfWeek', on ? draft.daysOfWeek.filter(x => x !== i + 1) : [...draft.daysOfWeek, i + 1].sort())}
                                        style={{ ...btn, ...(on ? { background: '#25671E', color: '#fff', borderColor: '#25671E' } : {}) }}>{d}</button>
                                );
                            })}
                        </div>
                    </div>
                    <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={draft.isPeak} onChange={e => set('isPeak', e.target.checked)} /> Busy time tag</label>
                    <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={draft.active} onChange={e => set('active', e.target.checked)} /> Active</label>
                    <div style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                        An end time earlier than the start runs past midnight (23:00 – 02:00). Slots are 30 min to 12 h.
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                        <button style={primary} disabled={busy === 'tpl'} onClick={() => run('tpl', async () => {
                            const { id, ...template } = draft;
                            await post({ action: 'saveTemplate', id, template });
                            setDraft(null);
                        }, 'Saved. Today’s and tomorrow’s slots are updated.')}>
                            {busy === 'tpl' && <Loader2 size={14} className="animate-spin" />} Save
                        </button>
                        <button style={btn} onClick={() => setDraft(null)}>Close</button>
                    </div>
                </div>
            )}

            <div style={{ ...card, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--foreground-secondary)', fontSize: '0.75rem' }}>
                            <th style={{ padding: '10px 12px' }}>Pincode</th><th style={{ padding: '10px 12px' }}>Slot</th><th style={{ padding: '10px 12px' }}>Name</th>
                            <th style={{ padding: '10px 12px' }}>Riders</th><th style={{ padding: '10px 12px' }}>Days</th><th style={{ padding: '10px 12px' }}>Status</th><th />
                        </tr>
                    </thead>
                    <tbody>
                        {data.templates.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No slots set up yet.</td></tr>}
                        {data.templates.map(t => (
                            <tr key={t.id} style={{ borderTop: '1px solid var(--border)', opacity: t.active ? 1 : 0.55 }}>
                                <td style={{ padding: '10px 12px' }}>{t.pincode}</td>
                                <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                                    {fmt12(t.start)} – {fmt12(t.end)} {t.isPeak && chip('Busy', '#8A6100', '#FDF6E3')}
                                    {t.overlapsWith.length > 0 && (
                                        <div style={{ fontWeight: 500, fontSize: '0.75rem', color: '#92400E' }}>
                                            Overlaps {t.overlapsWith.map(id => { const o = byId.get(id); return o ? `${fmt12(o.start)}–${fmt12(o.end)}` : id; }).join(', ')} — a rider can only book one of them
                                        </div>
                                    )}
                                </td>
                                <td style={{ padding: '10px 12px' }}>{t.label}{t.labelHi ? ` · ${t.labelHi}` : ''}</td>
                                <td style={{ padding: '10px 12px' }}>{t.capacity}</td>
                                <td style={{ padding: '10px 12px' }}>{t.daysOfWeek.length === 7 ? 'Every day' : t.daysOfWeek.map(d => DAYS[d - 1]).join(', ')}</td>
                                <td style={{ padding: '10px 12px' }}>{t.active ? chip('Active', '#065F46', '#D1FAE5') : chip('Off', '#4B5563', '#F3F4F6')}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <button style={btn} onClick={() => setDraft({ id: t.id, pincode: t.pincode, label: t.label, labelHi: t.labelHi, start: t.start, end: t.end, capacity: t.capacity, daysOfWeek: t.daysOfWeek, isPeak: t.isPeak, active: t.active })}>Edit</button>{' '}
                                    {t.active && (
                                        <button style={danger} disabled={!!busy} onClick={() => {
                                            if (!window.confirm('Turn this slot off? No new days are created; upcoming slots nobody booked are closed. Booked slots stay.')) return;
                                            run(`del-${t.id}`, () => post({ action: 'deleteTemplate', id: t.id }));
                                        }}>Turn off</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ── Attendance ────────────────────────────────────────────────────── */

function AttendanceTab({ busy, run, post }: { busy: string | null; run: RunFn; post: PostFn }) {
    const [from, setFrom] = useState(addDays(istToday(), -6));
    const [to, setTo] = useState(istToday());
    const [rows, setRows] = useState<AttendanceRow[] | null>(null);
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(true);

    const fetchRows = useCallback(async () => {
        const res = await fetch(`/api/delivery/slots?${new URLSearchParams({ view: 'attendance', from, to })}`);
        return res.json();
    }, [from, to]);
    const applyRows = useCallback((json: { success?: boolean; data?: { riders: AttendanceRow[] }; error?: string }) => {
        if (json && json.success && json.data) { setRows(json.data.riders); setErr(''); } else setErr((json && json.error) || 'Failed to load');
        setLoading(false);
    }, []);
    const load = useCallback(() => {
        setLoading(true);
        return fetchRows().then(applyRows, () => { setErr('Network error'); setLoading(false); });
    }, [fetchRows, applyRows]);

    useEffect(() => {
        let alive = true;
        fetchRows().then(
            (json) => { if (alive) applyRows(json); },
            () => { if (alive) { setErr('Network error'); setLoading(false); } }
        );
        return () => { alive = false; };
    }, [fetchRows, applyRows]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ ...lbl, width: 170 }}>From<input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} style={fld} /></label>
                <label style={{ ...lbl, width: 170 }}>To<input type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} style={fld} /></label>
                <button style={btn} onClick={() => { load(); }}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh</button>
            </div>
            {err && <div style={{ color: '#B42318', fontSize: '0.875rem' }}>{err}</div>}
            <div style={{ ...card, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--foreground-secondary)', fontSize: '0.75rem' }}>
                            {['Rider', 'Pincode', 'Booked', 'Done', 'No-show', 'Late', 'Late cancel', 'Cancelled', 'Online h', 'Deliveries', 'Strikes', 'Blocked till', ''].map(h => <th key={h} style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows && rows.length === 0 && <tr><td colSpan={13} style={{ padding: 20, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No bookings in this range.</td></tr>}
                        {(rows || []).map(r => (
                            <tr key={r.riderId} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '9px 10px' }}><div style={{ fontWeight: 600 }}>{r.riderName || r.riderId}</div><div style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>{r.riderPhone}</div></td>
                                <td style={{ padding: '9px 10px' }}>{r.pincode}</td>
                                <td style={{ padding: '9px 10px' }}>{r.booked}</td>
                                <td style={{ padding: '9px 10px' }}>{r.completed}</td>
                                <td style={{ padding: '9px 10px', color: r.noShow ? '#B42318' : undefined, fontWeight: r.noShow ? 700 : undefined }}>{r.noShow}</td>
                                <td style={{ padding: '9px 10px' }}>{r.late}</td>
                                <td style={{ padding: '9px 10px', color: r.lateCancel ? '#B42318' : undefined }}>{r.lateCancel}</td>
                                <td style={{ padding: '9px 10px' }}>{r.cancelled + r.adminCancelled}</td>
                                <td style={{ padding: '9px 10px' }}>{(r.onlineMinutes / 60).toFixed(1)}</td>
                                <td style={{ padding: '9px 10px' }}>{r.deliveries}</td>
                                <td style={{ padding: '9px 10px' }}>{r.strikes}</td>
                                <td style={{ padding: '9px 10px' }}>{r.blockedUntil ? new Date(r.blockedUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</td>
                                <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                                    {(r.strikes > 0 || r.blockedUntil) && (
                                        <button style={btn} disabled={!!busy} onClick={() => run(`clr-${r.riderId}`, async () => { await post({ action: 'clearStrikes', riderId: r.riderId }); await load(); }, 'Strikes cleared.')}>Clear strikes</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ── Settings ──────────────────────────────────────────────────────── */

function SettingsTab({ config, busy, run, post }: { config: Config; busy: string | null; run: RunFn; post: PostFn }) {
    // Remounted (key) when the saved config changes, so local edits start from it.
    const [c, setC] = useState<Config>(config);
    const [pilots, setPilots] = useState(config.pilotPincodes.join(', '));
    const set = <K extends keyof Config>(k: K, v: Config[K]) => setC(x => ({ ...x, [k]: v }));
    const num = (k: keyof Config, label: string, hint: string, min: number, max: number) => (
        <label style={lbl}>{label}
            <input type="number" min={min} max={max} value={Number(c[k])} onChange={e => set(k, Number(e.target.value) as never)} style={fld} />
            <span style={{ fontWeight: 400, fontSize: '0.75rem' }}>{hint}</span>
        </label>
    );

    const save = () => {
        if (c.mode === 'hard' && config.mode !== 'hard' &&
            !window.confirm('Hard mode: orders go to riders on a slot first. Riders on an old app version cannot book — raise the minimum delivery app version first. Continue?')) return;
        run('settings', () => post({
            action: 'saveSettings',
            settings: {
                riderSlotMode: c.mode,
                riderSlotPilotPincodes: pilots.split(',').map(p => p.trim()).filter(Boolean),
                slotBookingOpensAt: c.bookingOpensAt,
                slotAllowTomorrow: c.allowTomorrow,
                slotCancelCutoffMin: c.cancelCutoffMin,
                slotCheckInGraceMin: c.checkInGraceMin,
                slotMaxPerDay: c.maxPerDay,
                slotStrikeLimit: c.strikeLimit,
                slotBlockDays: c.blockDays,
                slotAutoOfflineMin: c.autoOfflineMin,
                slotHardFallback: c.hardFallback,
                slotOpenToAllAfterAttempts: c.openToAllAfterAttempts,
            },
        }), 'Settings saved. Rider apps pick them up within about 5 minutes.');
    };

    const modes: { key: Mode; title: string; body: string }[] = [
        { key: 'off', title: 'Off', body: 'Riders see nothing. Dispatch exactly as today.' },
        { key: 'soft', title: 'Soft', body: 'Riders book slots, get reminders and strikes. Anyone can still go online and get orders.' },
        { key: 'hard', title: 'Hard', body: 'Orders go to riders on a slot first. Others get an order only when no slot rider can take it (if the fallback below is on).' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {modes.map(m => (
                    <button key={m.key} onClick={() => set('mode', m.key)} style={{ ...card, padding: 14, textAlign: 'left', cursor: 'pointer', borderColor: c.mode === m.key ? '#25671E' : 'var(--border)', boxShadow: c.mode === m.key ? '0 0 0 2px #25671E33' : 'none' }}>
                        <div style={{ fontWeight: 800, marginBottom: 4 }}>{m.title}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>{m.body}</div>
                    </button>
                ))}
            </div>

            <div style={{ ...card, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                <label style={{ ...lbl, gridColumn: '1 / -1' }}>Pilot pincodes
                    <input value={pilots} onChange={e => setPilots(e.target.value)} style={fld} placeholder="Empty = every pincode. Example: 204101, 204102" />
                    <span style={{ fontWeight: 400, fontSize: '0.75rem' }}>Slots apply only in these pincodes. Leave empty to apply everywhere.</span>
                </label>
                <label style={lbl}>Booking opens at
                    <input type="time" value={c.bookingOpensAt} onChange={e => set('bookingOpensAt', e.target.value)} style={fld} />
                    <span style={{ fontWeight: 400, fontSize: '0.75rem' }}>India time. Riders get a push at this time.</span>
                </label>
                <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={c.allowTomorrow} onChange={e => set('allowTomorrow', e.target.checked)} /> Riders can also book tomorrow
                </label>
                {num('cancelCutoffMin', 'Free cancel until (min before start)', 'Later than this counts as a strike.', 0, 720)}
                {num('checkInGraceMin', 'Grace to go online (min)', 'Not online this long after start = no-show + strike.', 5, 120)}
                {num('maxPerDay', 'Max slots per rider per day', '1–6', 1, 6)}
                {num('strikeLimit', 'Strikes before booking is paused', 'Counted over the last 7 days.', 1, 20)}
                {num('blockDays', 'Days booking is paused', '0 = never pause.', 0, 30)}
                <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 8, gridColumn: '1 / -1' }}>
                    <input type="checkbox" checked={c.hardFallback} onChange={e => set('hardFallback', e.target.checked)} />
                    Hard mode fallback: if no rider on a slot can take an order, offer it to every online rider (recommended)
                </label>
                {num('openToAllAfterAttempts', 'Open to everyone after N offers', 'Hard mode: if slot riders let an order go this many times, offer it to all. 0 = never.', 0, 20)}
                {num('autoOfflineMin', 'Auto-offline after slot ends (min)', 'Only hard mode WITHOUT fallback. Never during a delivery.', 0, 120)}
            </div>

            <div>
                <button style={primary} disabled={busy === 'settings'} onClick={save}>
                    {busy === 'settings' && <Loader2 size={14} className="animate-spin" />} Save settings
                </button>
            </div>
        </div>
    );
}
