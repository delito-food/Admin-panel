'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Clock, Store, Search, RefreshCw, X, Plus, Trash2, Copy, Check,
    AlertTriangle, Pause, Play, Calendar, Loader2, Zap, ShieldAlert,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { authenticatedFetch } from '@/lib/api-client';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface TimeSlot { open: string; close: string; }
interface DayHours { isOpen: boolean; slots?: TimeSlot[]; openTime?: string; closeTime?: string; }
type BusinessHoursMap = Record<string, DayHours>;

interface VendorSchedule {
    vendorId: string;
    shopName: string;
    city: string;
    isOnline: boolean;
    shouldBeOpen: boolean;
    scheduleReason: string;
    autoScheduleEnabled: boolean;
    timezone: string;
    businessHours: BusinessHoursMap;
    holidays: string[];
    manualOverride: { mode: string; until?: string; reason?: string } | null;
    nextTransitionAt: string | null;
    blockers: { isSuspended: boolean; adminForceOffline: boolean; verificationStatus: string };
    drift: boolean;
}

interface ScheduleData {
    vendors: VendorSchedule[];
    summary: { total: number; autoScheduled: number; open: number; paused: number; drifting: number };
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABEL: Record<string, string> = {
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
    friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};
const MAX_SLOTS = 3;

/** Mirrors REASON in scheduleEngine.js. Keep the copy in sync. */
const REASON_META: Record<string, { label: string; color: string; help: string }> = {
    SUSPENDED:          { label: 'Suspended',      color: '#EF4444', help: 'Shop is suspended by admin.' },
    ADMIN_FORCED:       { label: 'Admin Offline',  color: '#EF4444', help: 'Force-offline set by admin. Outranks the schedule.' },
    UNVERIFIED:         { label: 'Unverified',     color: '#F59E0B', help: 'Verification incomplete — cannot auto-open.' },
    VENDOR_PAUSED:      { label: 'Paused',         color: '#F59E0B', help: 'Vendor paused orders temporarily.' },
    VENDOR_FORCED_OPEN: { label: 'Forced Open',    color: '#6366F1', help: 'Open outside scheduled hours.' },
    HOLIDAY:            { label: 'Holiday',        color: '#8B5CF6', help: 'Closed all day (holiday).' },
    MANUAL_MODE:        { label: 'Manual',         color: '#6B7280', help: 'Auto-schedule off — vendor toggles manually.' },
    WITHIN_HOURS:       { label: 'Open',           color: '#10B981', help: 'Within business hours.' },
    OUTSIDE_HOURS:      { label: 'Closed',         color: '#6B7280', help: 'Outside business hours.' },
    EVAL_ERROR:         { label: 'Error',          color: '#EF4444', help: 'Schedule could not be evaluated — check the data.' },
    BLOCKED:            { label: 'Blocked',        color: '#EF4444', help: 'Refused to auto-open a blocked vendor.' },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function slotsOf(day: DayHours | undefined): TimeSlot[] {
    if (!day) return [];
    if (Array.isArray(day.slots) && day.slots.length > 0) return day.slots;
    if (day.isOpen && day.openTime && day.closeTime) return [{ open: day.openTime, close: day.closeTime }];
    return [];
}

function normalise(hours: BusinessHoursMap): BusinessHoursMap {
    const out: BusinessHoursMap = {};
    for (const d of DAYS) {
        const cfg = hours?.[d];
        const slots = slotsOf(cfg);
        out[d] = { isOpen: cfg?.isOpen === true && slots.length > 0, slots };
    }
    return out;
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Client-side mirror of validateBusinessHours() so errors surface before saving. */
function validate(hours: BusinessHoursMap): string[] {
    const errs: string[] = [];
    for (const d of DAYS) {
        const cfg = hours[d];
        if (!cfg?.isOpen) continue;
        const slots = cfg.slots ?? [];
        if (slots.length === 0) { errs.push(`${DAY_LABEL[d]}: open but has no slots`); continue; }
        if (slots.length > MAX_SLOTS) errs.push(`${DAY_LABEL[d]}: max ${MAX_SLOTS} slots`);

        const parsed: { o: number; c: number; wraps: boolean }[] = [];
        for (const s of slots) {
            if (!HHMM.test(s.open)) errs.push(`${DAY_LABEL[d]}: invalid open "${s.open}"`);
            if (!HHMM.test(s.close)) errs.push(`${DAY_LABEL[d]}: invalid close "${s.close}"`);
            if (!HHMM.test(s.open) || !HHMM.test(s.close)) continue;
            const [oh, om] = s.open.split(':').map(Number);
            const [ch, cm] = s.close.split(':').map(Number);
            const o = oh * 60 + om, c = ch * 60 + cm;
            const dur = c > o ? c - o : 1440 - o + c;
            if (dur < 30) errs.push(`${DAY_LABEL[d]}: ${s.open}-${s.close} is under 30 min`);
            parsed.push({ o, c, wraps: c <= o });
        }
        const sameDay = parsed.filter((p) => !p.wraps).sort((a, b) => a.o - b.o);
        for (let i = 1; i < sameDay.length; i++) {
            if (sameDay[i].o < sameDay[i - 1].c) errs.push(`${DAY_LABEL[d]}: slots overlap`);
        }
        if (parsed.filter((p) => p.wraps).length > 1) errs.push(`${DAY_LABEL[d]}: only one past-midnight slot allowed`);
    }
    return errs;
}

function fmtNext(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const mins = Math.round((d.getTime() - now.getTime()) / 60000);
    const t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (mins < 0) return `${t} (overdue)`;
    if (mins < 60) return `${t} (in ${mins}m)`;
    if (d.toDateString() === now.toDateString()) return `Today ${t}`;
    return `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${t}`;
}

/* ------------------------------------------------------------------ */
/* Shared styles                                                       */
/* ------------------------------------------------------------------ */

const fld: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none',
};

function StatCard({ title, value, icon: Icon, color, sub }: {
    title: string; value: string | number; icon: React.ElementType; color: string; sub?: string;
}) {
    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{title}</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)', marginTop: 2 }}>{value}</p>
                    {sub && <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{sub}</p>}
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color="white" />
                </div>
            </div>
        </motion.div>
    );
}

function ReasonChip({ reason }: { reason: string }) {
    const m = REASON_META[reason] ?? { label: reason || '—', color: '#6B7280', help: '' };
    return (
        <span
            title={m.help}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999,
                fontSize: '0.7rem', fontWeight: 600, background: `${m.color}22`, color: m.color,
                border: `1px solid ${m.color}44`, whiteSpace: 'nowrap',
            }}
        >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />
            {m.label}
        </span>
    );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function BusinessHoursPage() {
    const { data, loading, refetch } = useApi<ScheduleData>('/api/vendors/business-hours');
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'auto' | 'manual' | 'drift'>('all');
    const [editing, setEditing] = useState<VendorSchedule | null>(null);

    const vendors = useMemo(() => {
        let list = data?.vendors ?? [];
        const q = search.trim().toLowerCase();
        if (q) list = list.filter((v) => v.shopName.toLowerCase().includes(q) || v.vendorId.toLowerCase().includes(q));
        if (filter === 'auto') list = list.filter((v) => v.autoScheduleEnabled);
        if (filter === 'manual') list = list.filter((v) => !v.autoScheduleEnabled);
        if (filter === 'drift') list = list.filter((v) => v.drift);
        return list;
    }, [data, search, filter]);

    const s = data?.summary;

    return (
        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Clock size={24} /> Business Hours
                    </h1>
                    <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Shops with auto-schedule on are opened and closed automatically every 10 minutes.
                    </p>
                </div>
                <button onClick={refetch} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RefreshCw size={15} /> Refresh
                </button>
            </div>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                <StatCard title="Total Vendors" value={s?.total ?? 0} icon={Store} color="#6366F1" />
                <StatCard title="Auto-Scheduled" value={s?.autoScheduled ?? 0} icon={Zap} color="#10B981" sub={`${(s?.total ?? 0) - (s?.autoScheduled ?? 0)} manual`} />
                <StatCard title="Currently Open" value={s?.open ?? 0} icon={Play} color="#F4511E" />
                <StatCard title="Paused" value={s?.paused ?? 0} icon={Pause} color="#F59E0B" />
                <StatCard
                    title="Drifting"
                    value={s?.drifting ?? 0}
                    icon={AlertTriangle}
                    color={(s?.drifting ?? 0) > 0 ? '#EF4444' : '#6B7280'}
                    sub="state ≠ schedule"
                />
            </div>

            {(s?.drifting ?? 0) > 0 && (
                <div className="glass-card" style={{ padding: 12, marginBottom: 16, borderLeft: '3px solid #EF4444', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <ShieldAlert size={18} color="#EF4444" style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)' }}>
                        <strong style={{ color: 'var(--foreground)' }}>{s?.drifting} shop(s) are not in the state their schedule expects.</strong>{' '}
                        The scheduler should have reconciled this within 10 minutes. If it persists, check that
                        <code style={{ margin: '0 4px' }}>vendorScheduleTick</code> is deployed and running
                        (<code>firebase functions:log --only vendorScheduleTick</code>).
                    </div>
                </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search shop name or vendor ID..."
                        style={{ ...fld, width: '100%', paddingLeft: 32 }}
                    />
                </div>
                {(['all', 'auto', 'manual', 'drift'] as const).map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={filter === f ? 'btn btn-primary' : 'btn btn-outline'}
                        style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}
                    >
                        {f === 'drift' ? 'Drifting' : f}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                        <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                        Loading schedules…
                    </div>
                ) : vendors.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No vendors match.</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {['Shop', 'Status', 'Reason', 'Auto', 'Next Change', 'Timezone', ''].map((h) => (
                                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {vendors.map((v) => (
                                    <tr key={v.vendorId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                        <td style={{ padding: '10px 14px' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{v.shopName || '(unnamed)'}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{v.city || v.vendorId.slice(0, 12)}</div>
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.isOnline ? '#10B981' : '#9CA3AF' }} />
                                                {v.isOnline ? 'Open' : 'Closed'}
                                                {v.drift && <AlertTriangle size={13} color="#EF4444" aria-label="drift" />}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 14px' }}><ReasonChip reason={v.scheduleReason} /></td>
                                        <td style={{ padding: '10px 14px' }}>
                                            {v.autoScheduleEnabled
                                                ? <Check size={16} color="#10B981" />
                                                : <span style={{ color: 'var(--foreground-secondary)', fontSize: '0.75rem' }}>off</span>}
                                        </td>
                                        <td style={{ padding: '10px 14px', color: 'var(--foreground-secondary)', fontSize: '0.78rem' }}>{fmtNext(v.nextTransitionAt)}</td>
                                        <td style={{ padding: '10px 14px', color: 'var(--foreground-secondary)', fontSize: '0.75rem' }}>{v.timezone}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                                            <button onClick={() => setEditing(v)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '4px 12px' }}>Edit</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <AnimatePresence>
                {editing && (
                    <ScheduleEditor
                        vendor={editing}
                        onClose={() => setEditing(null)}
                        onSaved={() => { setEditing(null); refetch(); }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Editor drawer                                                       */
/* ------------------------------------------------------------------ */

function ScheduleEditor({ vendor, onClose, onSaved }: {
    vendor: VendorSchedule; onClose: () => void; onSaved: () => void;
}) {
    const [hours, setHours] = useState<BusinessHoursMap>(() => normalise(vendor.businessHours));
    const [autoEnabled, setAutoEnabled] = useState(vendor.autoScheduleEnabled);
    const [timezone, setTimezone] = useState(vendor.timezone || 'Asia/Kolkata');
    const [holidays, setHolidays] = useState<string[]>(vendor.holidays ?? []);
    const [newHoliday, setNewHoliday] = useState('');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const errors = useMemo(() => validate(hours), [hours]);
    const blocked = vendor.blockers.isSuspended || vendor.blockers.adminForceOffline || vendor.blockers.verificationStatus !== 'verified';

    const setDay = useCallback((day: string, patch: Partial<DayHours>) => {
        setHours((h) => ({ ...h, [day]: { ...h[day], ...patch } }));
    }, []);

    const addSlot = (day: string) => {
        const cur = hours[day]?.slots ?? [];
        if (cur.length >= MAX_SLOTS) return;
        const last = cur[cur.length - 1];
        const next: TimeSlot = last ? { open: '18:00', close: '23:00' } : { open: '11:00', close: '23:00' };
        setDay(day, { isOpen: true, slots: [...cur, next] });
    };

    const removeSlot = (day: string, i: number) => {
        const cur = [...(hours[day]?.slots ?? [])];
        cur.splice(i, 1);
        setDay(day, { slots: cur, isOpen: cur.length > 0 });
    };

    const editSlot = (day: string, i: number, field: 'open' | 'close', val: string) => {
        const cur = [...(hours[day]?.slots ?? [])];
        cur[i] = { ...cur[i], [field]: val };
        setDay(day, { slots: cur });
    };

    /** The single most-used control in any merchant hours editor. */
    const copyMondayToAll = () => {
        const src = hours.monday;
        const next: BusinessHoursMap = {};
        for (const d of DAYS) next[d] = { isOpen: src.isOpen, slots: (src.slots ?? []).map((s) => ({ ...s })) };
        setHours(next);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    const save = async () => {
        if (errors.length > 0) return;
        setSaving(true);
        setErr(null);
        try {
            const res = await authenticatedFetch('/api/vendors/business-hours', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vendorId: vendor.vendorId,
                    businessHours: hours,
                    timezone,
                    holidays,
                    autoScheduleEnabled: autoEnabled,
                }),
            });
            const json = await res.json();
            if (!json.success) { setErr(json.error || 'Save failed'); setSaving(false); return; }
            onSaved();
        } catch {
            setErr('Network error');
            setSaving(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
        >
            <motion.div
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 'min(620px, 100%)', height: '100%', background: 'var(--background)', borderLeft: '1px solid var(--border)', overflowY: 'auto' }}
            >
                {/* Header */}
                <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--background)', borderBottom: '1px solid var(--border)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--foreground)' }}>{vendor.shopName || '(unnamed)'}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <ReasonChip reason={vendor.scheduleReason} />
                            <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>Next: {fmtNext(vendor.nextTransitionAt)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="btn btn-outline" style={{ padding: 6 }}><X size={16} /></button>
                </div>

                <div style={{ padding: 20 }}>
                    {blocked && (
                        <div className="glass-card" style={{ padding: 12, marginBottom: 16, borderLeft: '3px solid #EF4444', display: 'flex', gap: 10 }}>
                            <ShieldAlert size={18} color="#EF4444" style={{ flexShrink: 0 }} />
                            <div style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                This shop cannot auto-open regardless of its hours:
                                {vendor.blockers.isSuspended && ' suspended.'}
                                {vendor.blockers.adminForceOffline && ' admin force-offline.'}
                                {vendor.blockers.verificationStatus !== 'verified' && ` verification is "${vendor.blockers.verificationStatus}".`}
                                {' '}Clear that first — schedule changes here will save but stay inactive.
                            </div>
                        </div>
                    )}

                    {/* Auto-schedule master switch */}
                    <div className="glass-card" style={{ padding: 14, marginBottom: 16 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                            <input type="checkbox" checked={autoEnabled} onChange={(e) => setAutoEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#10B981' }} />
                            <div>
                                <div style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '0.9rem' }}>Auto-schedule</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                    {autoEnabled
                                        ? 'Shop opens and closes automatically from the hours below.'
                                        : 'Off — the vendor controls open/close manually. The scheduler will not touch this shop.'}
                                </div>
                            </div>
                        </label>
                    </div>

                    {/* Weekly grid */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>Weekly Hours</h3>
                        <button onClick={copyMondayToAll} className="btn btn-outline" style={{ fontSize: '0.72rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
                            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy Monday to all</>}
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                        {DAYS.map((day) => {
                            const cfg = hours[day];
                            const slots = cfg?.slots ?? [];
                            return (
                                <div key={day} className="glass-card" style={{ padding: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: slots.length ? 10 : 0 }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={cfg?.isOpen ?? false}
                                                onChange={(e) => {
                                                    const on = e.target.checked;
                                                    setDay(day, { isOpen: on, slots: on && slots.length === 0 ? [{ open: '11:00', close: '23:00' }] : slots });
                                                }}
                                                style={{ width: 15, height: 15, accentColor: '#10B981' }}
                                            />
                                            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)', minWidth: 82 }}>{DAY_LABEL[day]}</span>
                                            {!cfg?.isOpen && <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>Closed</span>}
                                        </label>
                                        {cfg?.isOpen && slots.length < MAX_SLOTS && (
                                            <button onClick={() => addSlot(day)} className="btn btn-outline" style={{ fontSize: '0.7rem', padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Plus size={11} /> Slot
                                            </button>
                                        )}
                                    </div>

                                    {cfg?.isOpen && slots.map((slot, i) => {
                                        const wraps = slot.close <= slot.open;
                                        return (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: i ? 7 : 0 }}>
                                                <input type="time" value={slot.open} step={600} onChange={(e) => editSlot(day, i, 'open', e.target.value)} style={{ ...fld, width: 118 }} />
                                                <span style={{ color: 'var(--foreground-secondary)', fontSize: '0.8rem' }}>→</span>
                                                <input type="time" value={slot.close} step={600} onChange={(e) => editSlot(day, i, 'close', e.target.value)} style={{ ...fld, width: 118 }} />
                                                {wraps && (
                                                    <span title="Closes after midnight, on the following day" style={{ fontSize: '0.68rem', color: '#8B5CF6', background: '#8B5CF622', padding: '2px 7px', borderRadius: 999, border: '1px solid #8B5CF644' }}>
                                                        +1 day
                                                    </span>
                                                )}
                                                {slots.length > 1 && (
                                                    <button onClick={() => removeSlot(day, i)} className="btn btn-outline" style={{ padding: 5, marginLeft: 'auto' }} aria-label="Remove slot">
                                                        <Trash2 size={12} color="#EF4444" />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>

                    {/* Timezone */}
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>Timezone</h3>
                    <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...fld, width: '100%', marginBottom: 18 }}>
                        {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'].map((tz) => (
                            <option key={tz} value={tz}>{tz}</option>
                        ))}
                    </select>

                    {/* Holidays */}
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={14} /> Holidays <span style={{ fontWeight: 400, color: 'var(--foreground-secondary)', fontSize: '0.75rem' }}>(closed all day)</span>
                    </h3>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} style={{ ...fld, flex: 1 }} />
                        <button
                            onClick={() => { if (newHoliday && !holidays.includes(newHoliday)) { setHolidays([...holidays, newHoliday].sort()); setNewHoliday(''); } }}
                            className="btn btn-outline" style={{ fontSize: '0.75rem' }}
                        >
                            Add
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                        {holidays.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>None</span>}
                        {holidays.map((h) => (
                            <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999, background: '#8B5CF622', color: '#8B5CF6', fontSize: '0.72rem', border: '1px solid #8B5CF644' }}>
                                {h}
                                <button onClick={() => setHolidays(holidays.filter((x) => x !== h))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8B5CF6', display: 'flex', padding: 0 }} aria-label={`Remove ${h}`}>
                                    <X size={11} />
                                </button>
                            </span>
                        ))}
                    </div>

                    {/* Validation */}
                    {errors.length > 0 && (
                        <div className="glass-card" style={{ padding: 12, marginBottom: 14, borderLeft: '3px solid #EF4444' }}>
                            {errors.map((e, i) => (
                                <div key={i} style={{ fontSize: '0.78rem', color: '#EF4444', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {e}
                                </div>
                            ))}
                        </div>
                    )}
                    {err && (
                        <div className="glass-card" style={{ padding: 12, marginBottom: 14, borderLeft: '3px solid #EF4444', fontSize: '0.8rem', color: '#EF4444' }}>{err}</div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={onClose} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                        <button
                            onClick={save}
                            disabled={saving || errors.length > 0}
                            className="btn btn-primary"
                            style={{ flex: 2, opacity: saving || errors.length > 0 ? 0.55 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
                        >
                            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Check size={15} /> Save Schedule</>}
                        </button>
                    </div>

                    <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 12, lineHeight: 1.5 }}>
                        Saving applies immediately — it does not wait for the next 10-minute tick. Legacy
                        <code style={{ margin: '0 3px' }}>openTime</code>/<code style={{ margin: '0 3px' }}>closeTime</code>
                        fields are written alongside the slots so vendor app v2.5 keeps displaying hours correctly.
                    </p>
                </div>
            </motion.div>
        </motion.div>
    );
}
