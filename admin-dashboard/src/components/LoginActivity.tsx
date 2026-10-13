'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Monitor, Smartphone, Tablet, HelpCircle, MapPin, Clock, LogOut, RefreshCw,
    Loader2, ShieldAlert, History, CheckCircle2, AlertCircle, Globe,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

/**
 * Settings → Security: where this admin account is signed in, the login
 * history, and sign-out for any single device / all other devices / everywhere.
 * Data: /api/admin-sessions (see lib/admin-sessions.ts).
 */

type Status = 'active' | 'signed_out' | 'revoked';

interface SessionRow {
    id: string;
    status: Status;
    current: boolean;
    device: { browser: string; os: string; type: 'desktop' | 'mobile' | 'tablet' | 'unknown'; model?: string; label: string };
    ip: string | null;
    location: { city?: string; region?: string; country?: string };
    timezone: string | null;
    createdAt: number | null;
    lastActiveAt: number | null;
    endedAt: number | null;
    endedBy: { sessionId?: string; label?: string } | null;
}

const ACTIVE_NOW_MS = 5 * 60_000;

function countryName(code?: string) {
    if (!code) return undefined;
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
    } catch {
        return code;
    }
}

function placeOf(s: SessionRow) {
    const { city, region, country } = s.location || {};
    const parts = [city, region && region !== city ? region : undefined, countryName(country)].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
}

function fmtDate(ms: number | null) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

function timeAgo(ms: number | null) {
    if (!ms) return 'unknown';
    const diff = Date.now() - ms;
    if (diff < ACTIVE_NOW_MS) return 'Active now';
    const min = Math.round(diff / 60_000);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const d = Math.round(hr / 24);
    if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
    return fmtDate(ms);
}

function DeviceIcon({ type, size = 20 }: { type: SessionRow['device']['type']; size?: number }) {
    const Icon = type === 'mobile' ? Smartphone : type === 'tablet' ? Tablet : type === 'desktop' ? Monitor : HelpCircle;
    return <Icon size={size} />;
}

const chip = (bg: string, fg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 100,
    fontSize: '0.68rem', fontWeight: 700, background: bg, color: fg, whiteSpace: 'nowrap',
});

const btn = (variant: 'ghost' | 'danger' | 'dangerSolid'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9,
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    border: variant === 'ghost' ? '1px solid var(--border)' : '1px solid rgba(239,68,68,0.45)',
    background: variant === 'dangerSolid' ? '#EF4444' : variant === 'danger' ? 'rgba(239,68,68,0.08)' : 'var(--surface)',
    color: variant === 'dangerSolid' ? '#fff' : variant === 'danger' ? '#EF4444' : 'var(--foreground)',
});

const sectionTitle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', fontWeight: 700, color: 'var(--foreground)', margin: 0,
};

export function LoginActivity() {
    const { logout } = useAuth();
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState<string | null>(null);      // session id | 'others' | 'everywhere'
    const [confirming, setConfirming] = useState<string | null>(null);

    const load = useCallback(async (quiet = false) => {
        if (!quiet) setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/admin-sessions', { cache: 'no-store' });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body?.success) throw new Error(body?.error || `Request failed (${res.status})`);
            setSessions(body.data.sessions as SessionRow[]);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load login activity');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const iv = window.setInterval(() => load(true), 60_000);
        return () => window.clearInterval(iv);
    }, [load]);

    useEffect(() => {
        if (!notice) return;
        const t = window.setTimeout(() => setNotice(''), 4000);
        return () => window.clearTimeout(t);
    }, [notice]);

    const active = useMemo(
        () => sessions
            .filter((s) => s.status === 'active')
            .sort((a, b) => Number(b.current) - Number(a.current) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)),
        [sessions]
    );
    const others = active.filter((s) => !s.current);

    const revoke = async (payload: { sessionId: string } | { scope: 'others' | 'everywhere' }, key: string) => {
        setBusy(key);
        setConfirming(null);
        setError('');
        try {
            const res = await fetch('/api/admin-sessions/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body?.success) throw new Error(body?.error || `Request failed (${res.status})`);

            if ('scope' in payload && payload.scope === 'everywhere') {
                await logout();
                return;
            }
            const n = body.data?.revoked ?? 0;
            setNotice(n === 1 ? 'Device signed out.' : `${n} devices signed out.`);
            await load(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not sign out the device');
        } finally {
            setBusy(null);
        }
    };

    if (loading && sessions.length === 0) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>
                <Loader2 size={18} className="animate-spin" /> Loading login activity…
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Messages */}
            <AnimatePresence>
                {(error || notice) && (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, fontSize: '0.82rem',
                            border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'}`,
                            background: error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                            color: error ? '#EF4444' : '#10B981',
                        }}
                    >
                        {error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                        {error || notice}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Where you're signed in ── */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                        <h3 style={sectionTitle}><Globe size={16} /> Where you&apos;re signed in</h3>
                        <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 3 }}>
                            {active.length === 1 ? 'Only this device.' : `${active.length} devices are signed in to your account.`}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => load()} style={btn('ghost')} disabled={loading}>
                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                        {others.length > 0 && (
                            confirming === 'others' ? (
                                <>
                                    <button type="button" onClick={() => revoke({ scope: 'others' }, 'others')} style={btn('dangerSolid')}>
                                        Sign out {others.length} other{others.length === 1 ? '' : 's'}?
                                    </button>
                                    <button type="button" onClick={() => setConfirming(null)} style={btn('ghost')}>Cancel</button>
                                </>
                            ) : (
                                <button type="button" onClick={() => setConfirming('others')} style={btn('danger')} disabled={busy !== null}>
                                    {busy === 'others' ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                                    Sign out all other devices
                                </button>
                            )
                        )}
                    </div>
                </div>

                {active.length === 0 && !error && (
                    <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)', padding: '12px 0' }}>
                        No device sessions recorded yet. This device will appear after its next check-in (within about two minutes).
                    </p>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {active.map((s) => {
                        const place = placeOf(s);
                        const isNow = s.lastActiveAt !== null && Date.now() - s.lastActiveAt < ACTIVE_NOW_MS;
                        return (
                            <motion.div
                                key={s.id} layout
                                style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 14,
                                    background: 'var(--surface)',
                                    border: s.current ? '1px solid rgba(16,185,129,0.55)' : '1px solid var(--border)',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <div style={{
                                    width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: s.current ? 'rgba(16,185,129,0.12)' : 'var(--surface-hover, rgba(127,127,127,0.1))',
                                    color: s.current ? '#10B981' : 'var(--foreground-secondary)',
                                }}>
                                    <DeviceIcon type={s.device.type} />
                                </div>

                                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--foreground)' }}>{s.device.label}</span>
                                        {s.current && <span style={chip('rgba(16,185,129,0.14)', '#10B981')}>This device</span>}
                                        {!s.current && isNow && <span style={chip('rgba(59,130,246,0.14)', '#3B82F6')}>Active now</span>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, fontSize: '0.74rem', color: 'var(--foreground-secondary)' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <MapPin size={12} /> {place || 'Location unavailable'}{s.ip ? ` · IP ${s.ip}` : ''}
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <Clock size={12} /> Signed in {fmtDate(s.createdAt)} · Last active {s.current ? 'now' : timeAgo(s.lastActiveAt).replace('Active now', 'just now')}
                                        </span>
                                    </div>
                                </div>

                                {!s.current && (
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                                        {confirming === s.id ? (
                                            <>
                                                <button type="button" onClick={() => revoke({ sessionId: s.id }, s.id)} style={btn('dangerSolid')}>
                                                    Confirm sign out
                                                </button>
                                                <button type="button" onClick={() => setConfirming(null)} style={btn('ghost')}>Cancel</button>
                                            </>
                                        ) : (
                                            <button type="button" onClick={() => setConfirming(s.id)} style={btn('danger')} disabled={busy !== null}>
                                                {busy === s.id ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                                                Sign out
                                            </button>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            </section>

            {/* ── Login history ── */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                    <h3 style={sectionTitle}><History size={16} /> Login history</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 3 }}>
                        Your last {sessions.length} sign-ins. If you don&apos;t recognise one, sign it out and change your password.
                    </p>
                </div>

                <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                    {sessions.length === 0 && (
                        <p style={{ padding: 14, fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>No sign-ins recorded yet.</p>
                    )}
                    {sessions.map((s, i) => {
                        const place = placeOf(s);
                        let statusChip: React.ReactNode;
                        let ended = '';
                        if (s.status === 'active') {
                            statusChip = <span style={chip('rgba(16,185,129,0.14)', '#10B981')}>{s.current ? 'This device' : 'Signed in'}</span>;
                        } else if (s.status === 'revoked') {
                            statusChip = <span style={chip('rgba(239,68,68,0.12)', '#EF4444')}>Signed out remotely</span>;
                            ended = `Ended ${fmtDate(s.endedAt)}${s.endedBy?.label ? ` from ${s.endedBy.label}` : ''}`;
                        } else {
                            statusChip = <span style={chip('rgba(127,127,127,0.14)', 'var(--foreground-secondary)')}>Signed out</span>;
                            ended = `Ended ${fmtDate(s.endedAt)}`;
                        }
                        return (
                            <div
                                key={s.id}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', flexWrap: 'wrap',
                                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                                }}
                            >
                                <span style={{ color: 'var(--foreground-secondary)', display: 'flex' }}><DeviceIcon type={s.device.type} size={17} /></span>
                                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)' }}>{s.device.label}</div>
                                    <div style={{ fontSize: '0.71rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                        {place || 'Location unavailable'}{s.ip ? ` · ${s.ip}` : ''}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '0.71rem', color: 'var(--foreground-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, marginLeft: 'auto' }}>
                                    {statusChip}
                                    <span>Signed in {fmtDate(s.createdAt)}</span>
                                    {ended && <span>{ended}</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* ── Sign out everywhere ── */}
            <section style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                padding: 14, borderRadius: 14, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.04)',
            }}>
                <div style={{ flex: '1 1 240px' }}>
                    <h3 style={{ ...sectionTitle, color: '#EF4444' }}><ShieldAlert size={16} /> Sign out everywhere</h3>
                    <p style={{ fontSize: '0.74rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Ends every session including this one and invalidates all saved logins. Use this if you think your password was exposed.
                    </p>
                </div>
                {confirming === 'everywhere' ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={() => revoke({ scope: 'everywhere' }, 'everywhere')} style={btn('dangerSolid')}>
                            Yes, sign out everywhere
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} style={btn('ghost')}>Cancel</button>
                    </div>
                ) : (
                    <button type="button" onClick={() => setConfirming('everywhere')} style={btn('danger')} disabled={busy !== null}>
                        {busy === 'everywhere' ? <Loader2 size={14} className="animate-spin" /> : <ShieldAlert size={14} />}
                        Sign out everywhere
                    </button>
                )}
            </section>
        </div>
    );
}
