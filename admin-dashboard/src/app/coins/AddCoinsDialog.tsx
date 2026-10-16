'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Coins, Search, Loader2, CalendarClock, Bell, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * "Add coins" dialog for the Coins page. Posts to /api/coins/credit.
 * 10 coins = ₹1 (WalletConstants.COINS_PER_RUPEE in the customer app).
 */

export interface CoinCustomer {
    customerId: string;
    name: string;
    phone: string;
    email: string;
    coinBalance: number;
}

const COINS_PER_RUPEE = 10;
const PRESET_COINS = [50, 100, 200, 500, 1000];
const PRESET_DAYS = [7, 15, 30, 90];
const LARGE_GRANT = 5000; // ask for a second click above this

type ExpiryChoice = { mode: 'days'; days: number } | { mode: 'date'; date: string } | { mode: 'never' };

function istDate(offsetDays: number) {
    const d = new Date(Date.now() + offsetDays * 86_400_000);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

function prettyDate(d: Date) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function newRequestId() {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    }
}

const fld: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none',
};
const label: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--foreground-secondary)', textTransform: 'uppercase',
    letterSpacing: '0.04em', marginBottom: 6, display: 'block',
};
const pill = (on: boolean): React.CSSProperties => ({
    padding: '6px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    border: on ? '2px solid #F59E0B' : '1px solid var(--border)',
    background: on ? 'rgba(245,158,11,0.12)' : 'var(--surface)',
    color: on ? '#D97706' : 'var(--foreground-secondary)',
});

export function AddCoinsDialog({
    customers,
    initialCustomer,
    onClose,
    onDone,
}: {
    customers: CoinCustomer[];
    initialCustomer: CoinCustomer | null;
    onClose: () => void;
    onDone: (message: string) => void;
}) {
    const [customer, setCustomer] = useState<CoinCustomer | null>(initialCustomer);
    const [query, setQuery] = useState('');
    const [coinsText, setCoinsText] = useState('100');
    const [reason, setReason] = useState('');
    const [expiry, setExpiry] = useState<ExpiryChoice>({ mode: 'days', days: 30 });
    const [notify, setNotify] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [confirmLarge, setConfirmLarge] = useState(false);
    const requestId = useRef(newRequestId());

    // Close on Escape
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, saving]);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return customers
            .filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q))
            .slice(0, 8);
    }, [customers, query]);

    const coins = Number(coinsText);
    const coinsValid = Number.isInteger(coins) && coins >= 1 && coins <= 100_000;

    const expiresAt: Date | null = useMemo(() => {
        if (expiry.mode === 'never') return null;
        if (expiry.mode === 'days') return new Date(Date.now() + expiry.days * 86_400_000);
        if (!expiry.date) return null;
        const d = new Date(`${expiry.date}T23:59:59+05:30`);
        return isNaN(d.getTime()) ? null : d;
    }, [expiry]);

    const expiryValid = expiry.mode === 'never'
        || (expiry.mode === 'days' && expiry.days >= 1 && expiry.days <= 730)
        || (expiry.mode === 'date' && !!expiresAt && expiresAt.getTime() > Date.now());

    const canSubmit = !!customer && coinsValid && reason.trim().length >= 3 && expiryValid && !saving;

    const submit = async () => {
        if (!canSubmit || !customer) return;
        if (coins >= LARGE_GRANT && !confirmLarge) {
            setConfirmLarge(true);
            return;
        }
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/coins/credit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId: customer.customerId,
                    coins,
                    reason: reason.trim(),
                    expiry,
                    notify,
                    requestId: requestId.current,
                }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok || !body?.success) throw new Error(body?.error || `Request failed (${res.status})`);
            const exp = body.data.expiresAt ? `, expires ${prettyDate(new Date(body.data.expiresAt))}` : ', never expires';
            onDone(`Added ${coins.toLocaleString('en-IN')} coins to ${customer.name || 'customer'} — new balance ${Number(body.data.newBalance).toLocaleString('en-IN')}${exp}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not add coins');
            setSaving(false);
            setConfirmLarge(false);
        }
    };

    return (
        <div
            onClick={() => !saving && onClose()}
            style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
            <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                onClick={e => e.stopPropagation()}
                role="dialog" aria-modal="true" aria-labelledby="add-coins-title"
                className="glass-card"
                style={{ width: '100%', maxWidth: 480, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', padding: 20, background: 'var(--background)', display: 'flex', flexDirection: 'column', gap: 16 }}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,158,11,0.14)', color: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Coins size={18} />
                    </div>
                    <h2 id="add-coins-title" style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, flex: 1 }}>Add coins to wallet</h2>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)', padding: 4 }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Customer */}
                <div>
                    <span style={label}>Customer</span>
                    {customer ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontWeight: 600, fontSize: '0.86rem' }}>{customer.name || 'Customer'}</p>
                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                    {customer.phone}{customer.email ? ` • ${customer.email}` : ''} · Balance 🪙 {customer.coinBalance.toLocaleString('en-IN')}
                                </p>
                            </div>
                            {!initialCustomer && (
                                <button type="button" onClick={() => setCustomer(null)} style={{ ...pill(false), padding: '4px 10px' }}>Change</button>
                            )}
                        </div>
                    ) : (
                        <div style={{ position: 'relative' }}>
                            <Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--foreground-secondary)' }} />
                            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone or email…" style={{ ...fld, paddingLeft: 30 }} />
                            {matches.length > 0 && (
                                <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                                    {matches.map(c => (
                                        <button key={c.customerId} type="button" onClick={() => { setCustomer(c); setQuery(''); }}
                                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--foreground)' }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{c.name || 'Customer'}</span>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginLeft: 8 }}>{c.phone} · 🪙 {c.coinBalance}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {query.trim() && matches.length === 0 && (
                                <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>No customer matches “{query}”.</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Coins */}
                <div>
                    <span style={label}>Coins</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {PRESET_COINS.map(n => (
                            <button key={n} type="button" onClick={() => { setCoinsText(String(n)); setConfirmLarge(false); }} style={pill(coins === n)}>{n}</button>
                        ))}
                    </div>
                    <input type="number" inputMode="numeric" min={1} max={100000} step={1} value={coinsText}
                        onChange={e => { setCoinsText(e.target.value); setConfirmLarge(false); }} style={fld} />
                    <p style={{ fontSize: '0.72rem', marginTop: 5, color: coinsValid || !coinsText ? 'var(--foreground-secondary)' : '#EF4444' }}>
                        {coinsValid
                            ? <>Worth <b>₹{(coins / COINS_PER_RUPEE).toLocaleString('en-IN')}</b> at checkout (10 coins = ₹1){customer ? ` · new balance ${(customer.coinBalance + coins).toLocaleString('en-IN')}` : ''}</>
                            : 'Enter a whole number from 1 to 1,00,000'}
                    </p>
                </div>

                {/* Reason */}
                <div>
                    <span style={label}>Reason <span style={{ textTransform: 'none', fontWeight: 500 }}>(the customer sees this)</span></span>
                    <input value={reason} onChange={e => setReason(e.target.value)} maxLength={120} placeholder="e.g. Sorry for the late delivery on your last order" style={fld} />
                </div>

                {/* Expiry */}
                <div>
                    <span style={label}><CalendarClock size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />Expiry</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {PRESET_DAYS.map(d => (
                            <button key={d} type="button" onClick={() => setExpiry({ mode: 'days', days: d })} style={pill(expiry.mode === 'days' && expiry.days === d)}>{d} days</button>
                        ))}
                        <button type="button" onClick={() => setExpiry({ mode: 'date', date: expiry.mode === 'date' ? expiry.date : istDate(30) })} style={pill(expiry.mode === 'date')}>Pick date</button>
                        <button type="button" onClick={() => setExpiry({ mode: 'never' })} style={pill(expiry.mode === 'never')}>Never</button>
                    </div>
                    {expiry.mode === 'date' && (
                        <input type="date" value={expiry.date} min={istDate(0)} max={istDate(730)}
                            onChange={e => setExpiry({ mode: 'date', date: e.target.value })} style={{ ...fld, marginTop: 8 }} />
                    )}
                    <p style={{ fontSize: '0.72rem', marginTop: 6, color: expiryValid ? 'var(--foreground-secondary)' : '#EF4444' }}>
                        {!expiryValid
                            ? 'Pick a date in the future (up to 2 years).'
                            : expiresAt
                                ? <>Unused coins from this credit are removed after <b>{prettyDate(expiresAt)}</b>. The app shows a reminder 3 days before.</>
                                : 'These coins never expire.'}
                    </p>
                </div>

                {/* Notify */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#F59E0B' }} />
                    <Bell size={14} style={{ color: 'var(--foreground-secondary)' }} /> Send the customer a push notification
                </label>

                {error && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 9, fontSize: '0.8rem', color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }}>
                        <AlertCircle size={15} /> {error}
                    </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                    <button type="button" onClick={onClose} disabled={saving} className="btn btn-outline">Cancel</button>
                    <button type="button" onClick={submit} disabled={!canSubmit}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: '0.85rem', color: '#fff', cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.5, background: confirmLarge ? '#DC2626' : '#F59E0B' }}>
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                        {saving ? 'Adding…' : confirmLarge ? `Confirm ${coins.toLocaleString('en-IN')} coins (₹${(coins / COINS_PER_RUPEE).toLocaleString('en-IN')})` : coinsValid ? `Add ${coins.toLocaleString('en-IN')} coins` : 'Add coins'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
