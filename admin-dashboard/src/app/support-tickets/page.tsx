'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
    LifeBuoy, RefreshCw, Search, Phone, PhoneCall, Send, CheckCircle2, Clock,
    AlertTriangle, Loader2, Package, Wallet, Bike, X, MessageSquare, ExternalLink,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

/* ── Types (mirror /api/support-tickets) ───────────────────────────── */

interface Ticket {
    ticketId: string;
    ticketNumber: string;
    riderId: string;
    riderName: string;
    riderPhone: string;
    riderPincode: string;
    category: string;
    categoryLabel: string;
    orderId: string;
    orderLabel: string;
    message: string;
    attachments: string[];
    status: string;
    priority: string;
    callbackRequested: boolean;
    callbackRequestedAt: string;
    callbackDoneAt: string;
    lastMessageAt: string;
    lastMessageFrom: string;
    adminNotes: string;
    appVersion: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string;
}

interface ListData {
    tickets: Ticket[];
    summary: { total: number; open: number; inReview: number; resolved: number; callbacks: number; awaitingReply: number };
}

interface Detail {
    ticket: Ticket;
    messages: { id: string; from: 'rider' | 'support'; text: string; authorName: string; at: string }[];
    rider: null | {
        name: string; phone: string; pincode: string; isOnline: boolean; isVerified: boolean;
        totalDeliveries: number; todayDeliveries: number; codCollected: number; totalEarnings: number;
        paidAmount: number; pendingPayout: number; totalIncentiveEarned: number; pendingIncentive: number;
        gigPaidToday: number; hasBankDetails: boolean; bankName: string; bankAccountLast4: string; upiId: string;
    };
    order: null | {
        orderId: string; status: string; vendorName: string; customerName: string; deliveryAddress: string;
        total: number; paymentMode: string; riderPay: number; distanceKm: number; createdAt: string; deliveredAt: string;
    };
    payouts: { payoutId: string; amount: number; method: string; status: string; transactionId: string; createdAt: string; confirmedAt: string }[];
}

/* ── Styling helpers (same tokens as the Complaints page) ──────────── */

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
    OPEN: { label: 'Open', bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
    IN_REVIEW: { label: 'In review', bg: 'rgba(245,158,11,0.12)', color: '#D97706' },
    RESOLVED: { label: 'Resolved', bg: 'rgba(16,185,129,0.1)', color: '#059669' },
};
const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
    LOW: { bg: 'rgba(107,114,128,0.1)', color: '#6B7280' },
    MEDIUM: { bg: 'rgba(59,130,246,0.1)', color: '#3B82F6' },
    HIGH: { bg: 'rgba(249,115,22,0.1)', color: '#F97316' },
    URGENT: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
};

const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none',
};

const inr = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 1 }).format(n || 0);

const when = (s: string) => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function Pill({ label, bg, color }: { label: string; bg: string; color: string }) {
    return (
        <span style={{ padding: '3px 9px', borderRadius: 999, background: bg, color, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {label}
        </span>
    );
}

function Stat({ title, value, icon: Icon, color }: { title: string; value: number; icon: React.ElementType; color: string }) {
    return (
        <div className="glass-card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
                <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>{title}</p>
                <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
            </div>
            <Icon size={18} color={color} />
        </div>
    );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.82rem', padding: '4px 0' }}>
            <span style={{ color: 'var(--foreground-secondary)' }}>{k}</span>
            <span style={{ color: 'var(--foreground)', fontWeight: 600, textAlign: 'right' }}>{v}</span>
        </div>
    );
}

/* ── Page ──────────────────────────────────────────────────────────── */

export default function SupportTicketsPage() {
    const { data, loading, refetch } = useApi<ListData>('/api/support-tickets', { pollMs: 60_000 });
    const [tab, setTab] = useState<'OPEN_ALL' | 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CALLBACK'>('OPEN_ALL');
    const [q, setQ] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const tickets = useMemo(() => {
        const all = data?.tickets || [];
        const term = q.trim().toLowerCase();
        return all.filter(t => {
            if (tab === 'OPEN_ALL' && t.status === 'RESOLVED') return false;
            if ((tab === 'OPEN' || tab === 'IN_REVIEW' || tab === 'RESOLVED') && t.status !== tab) return false;
            if (tab === 'CALLBACK' && !(t.callbackRequested && t.status !== 'RESOLVED')) return false;
            if (!term) return true;
            return [t.ticketNumber, t.riderName, t.riderPhone, t.categoryLabel, t.orderId, t.message]
                .some(s => (s || '').toLowerCase().includes(term));
        });
    }, [data, tab, q]);

    if (loading && !data) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
            </div>
        );
    }

    const s = data?.summary;
    const tabs: { id: typeof tab; label: string }[] = [
        { id: 'OPEN_ALL', label: 'Not resolved' },
        { id: 'OPEN', label: 'Open' },
        { id: 'IN_REVIEW', label: 'In review' },
        { id: 'CALLBACK', label: `Call back (${s?.callbacks || 0})` },
        { id: 'RESOLVED', label: 'Resolved' },
    ];

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Rider Support</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Tickets and call-back requests raised from the delivery app
                    </p>
                </div>
                <button onClick={() => refetch()}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' }}>
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <Stat title="Open" value={s?.open || 0} icon={AlertTriangle} color="#EF4444" />
                <Stat title="In review" value={s?.inReview || 0} icon={Clock} color="#D97706" />
                <Stat title="Awaiting our reply" value={s?.awaitingReply || 0} icon={MessageSquare} color="#3B82F6" />
                <Stat title="Call-back requests" value={s?.callbacks || 0} icon={PhoneCall} color="#F97316" />
                <Stat title="Resolved" value={s?.resolved || 0} icon={CheckCircle2} color="#059669" />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
                {/* List */}
                <div className="glass-card" style={{ flex: '1 1 380px', minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input aria-label="Search tickets" placeholder="Search ticket, rider, phone, order…" value={q} onChange={e => setQ(e.target.value)}
                                style={{ ...fieldStyle, paddingLeft: 36 }} />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {tabs.map(t => (
                                <button key={t.id} onClick={() => setTab(t.id)}
                                    style={{
                                        padding: '6px 12px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                                        border: '1px solid var(--border)',
                                        background: tab === t.id ? 'var(--foreground)' : 'var(--surface)',
                                        color: tab === t.id ? 'var(--background)' : 'var(--foreground)',
                                    }}>
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                        {tickets.length === 0 && (
                            <p style={{ padding: 24, textAlign: 'center', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>No tickets here.</p>
                        )}
                        {tickets.map(t => {
                            const st = STATUS_STYLE[t.status] || STATUS_STYLE.OPEN;
                            const active = t.ticketId === selectedId;
                            return (
                                <button key={t.ticketId} onClick={() => setSelectedId(t.ticketId)}
                                    style={{
                                        display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', cursor: 'pointer',
                                        border: 'none', borderBottom: '1px solid var(--border)',
                                        background: active ? 'var(--surface-hover, rgba(0,0,0,0.04))' : 'transparent',
                                        color: 'var(--foreground)',
                                    }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>{t.ticketNumber} · {when(t.createdAt)}</span>
                                        <span style={{ display: 'flex', gap: 6 }}>
                                            {t.callbackRequested && t.status !== 'RESOLVED' && <Pill label="Call back" bg="rgba(249,115,22,0.12)" color="#EA580C" />}
                                            <Pill {...st} />
                                        </span>
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: '0.92rem', marginTop: 4 }}>{t.categoryLabel}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                        {t.riderName}{t.riderPhone ? ` · ${t.riderPhone}` : ''}{t.orderLabel ? ` · ${t.orderLabel}` : ''}
                                    </div>
                                    {t.status !== 'RESOLVED' && t.lastMessageFrom === 'rider' && (
                                        <div style={{ fontSize: '0.72rem', color: '#3B82F6', fontWeight: 600, marginTop: 4 }}>Waiting for our reply</div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Detail */}
                <div style={{ flex: '999 1 520px', minWidth: 0 }}>
                    {selectedId
                        ? <TicketDetail key={selectedId} ticketId={selectedId} onClose={() => setSelectedId(null)} onChanged={() => refetch()} />
                        : (
                            <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                                <LifeBuoy size={28} style={{ margin: '0 auto 10px' }} />
                                Select a ticket to see the rider, the related order and the conversation.
                            </div>
                        )}
                </div>
            </div>
        </motion.div>
    );
}

/* ── Detail panel ──────────────────────────────────────────────────── */

function TicketDetail({ ticketId, onClose, onChanged }: { ticketId: string; onClose: () => void; onChanged: () => void }) {
    const { data, loading, refetch } = useApi<Detail>(`/api/support-tickets/${ticketId}`, { pollMs: 30_000 });
    const [reply, setReply] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => { if (data) setNotes(data.ticket.adminNotes || ''); }, [data?.ticket.ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (loading && !data) {
        return <div className="glass-card" style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Loader2 className="animate-spin" /></div>;
    }
    if (!data) return null;
    const { ticket: t, messages, rider, order, payouts } = data;

    async function call(method: 'POST' | 'PATCH', body: Record<string, unknown>, tag: string) {
        setBusy(tag);
        try {
            const res = await fetch(`/api/support-tickets/${ticketId}`, {
                method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!json.success) { alert(json.error || 'Failed'); return false; }
            await refetch();
            onChanged();
            return true;
        } catch {
            alert('Network error');
            return false;
        } finally {
            setBusy(null);
        }
    }

    const phone = rider?.phone || t.riderPhone;
    const st = STATUS_STYLE[t.status] || STATUS_STYLE.OPEN;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Header */}
            <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>{t.ticketNumber} · raised {when(t.createdAt)}{t.appVersion ? ` · app ${t.appVersion}` : ''}</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--foreground)', marginTop: 2 }}>{t.categoryLabel}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <Pill {...st} />
                            <Pill label={t.priority} {...(PRIORITY_STYLE[t.priority] || PRIORITY_STYLE.MEDIUM)} />
                        </div>
                    </div>
                    <button aria-label="Close ticket" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={18} /></button>
                </div>

                {t.callbackRequested && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(249,115,22,0.1)', color: '#C2410C', fontSize: '0.85rem' }}>
                        <span><PhoneCall size={14} style={{ display: 'inline', marginRight: 6 }} />Rider asked for a call back {t.callbackRequestedAt ? `at ${when(t.callbackRequestedAt)}` : ''}</span>
                        <button disabled={busy !== null} onClick={() => call('PATCH', { callbackDone: true }, 'cb')}
                            style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#EA580C', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}>
                            {busy === 'cb' ? 'Saving…' : 'Mark called'}
                        </button>
                    </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {phone && (
                        <a href={`tel:${phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, background: 'var(--primary)', color: 'white', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
                            <Phone size={15} /> Call {phone}
                        </a>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                        Status
                        <select value={t.status} disabled={busy !== null} onChange={e => call('PATCH', { status: e.target.value }, 'status')} style={{ ...fieldStyle, width: 'auto', padding: '6px 10px' }}>
                            <option value="OPEN">Open</option>
                            <option value="IN_REVIEW">In review</option>
                            <option value="RESOLVED">Resolved</option>
                        </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                        Priority
                        <select value={t.priority} disabled={busy !== null} onChange={e => call('PATCH', { priority: e.target.value }, 'priority')} style={{ ...fieldStyle, width: 'auto', padding: '6px 10px' }}>
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                            <option value="URGENT">Urgent</option>
                        </select>
                    </label>
                </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
                {/* Conversation */}
                <div className="glass-card" style={{ flex: '999 1 320px', minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Conversation</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                        {messages.length === 0 && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--foreground)' }}>{t.message || '—'}</div>
                        )}
                        {messages.map(m => (
                            <div key={m.id} style={{
                                alignSelf: m.from === 'support' ? 'flex-end' : 'flex-start', maxWidth: '85%',
                                background: m.from === 'support' ? 'rgba(37,103,30,0.1)' : 'var(--surface)',
                                border: '1px solid var(--border)', borderRadius: 12, padding: '8px 12px',
                            }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginBottom: 2 }}>
                                    {m.from === 'support' ? (m.authorName || 'Support') : t.riderName} · {when(m.at)}
                                </div>
                                <div style={{ fontSize: '0.86rem', color: 'var(--foreground)', whiteSpace: 'pre-wrap' }}>{m.text}</div>
                            </div>
                        ))}
                    </div>
                    {t.attachments.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {t.attachments.map(u => (
                                <a key={u} href={u} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--primary)' }}>
                                    <ExternalLink size={13} /> Screenshot
                                </a>
                            ))}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <textarea aria-label="Reply to rider" value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="Reply to the rider (they get a notification)…"
                            style={{ ...fieldStyle, resize: 'vertical' }} />
                        <button aria-label="Send reply" disabled={!reply.trim() || busy !== null}
                            onClick={async () => { if (await call('POST', { text: reply }, 'reply')) setReply(''); }}
                            style={{ padding: '0 14px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', opacity: !reply.trim() ? 0.5 : 1 }}>
                            {busy === 'reply' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--foreground-secondary)', margin: '6px 0' }}>Internal notes (not shown to rider)</div>
                        <textarea aria-label="Internal notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...fieldStyle, resize: 'vertical' }} />
                        <button disabled={busy !== null || notes === (t.adminNotes || '')} onClick={() => call('PATCH', { adminNotes: notes }, 'notes')}
                            style={{ marginTop: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer', fontSize: '0.8rem' }}>
                            {busy === 'notes' ? 'Saving…' : 'Save notes'}
                        </button>
                    </div>
                </div>

                {/* Context */}
                <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="glass-card" style={{ padding: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6, color: 'var(--foreground)' }}><Bike size={15} /> Rider</div>
                        {rider ? (<>
                            <Row k="Name" v={rider.name} />
                            <Row k="Phone" v={rider.phone || '—'} />
                            <Row k="Pincode" v={rider.pincode || '—'} />
                            <Row k="Status" v={`${rider.isOnline ? 'Online' : 'Offline'}${rider.isVerified ? ' · verified' : ' · not verified'}`} />
                            <Row k="Deliveries today / total" v={`${rider.todayDeliveries} / ${rider.totalDeliveries}`} />
                            <Row k="Gig bonus paid today" v={inr(rider.gigPaidToday)} />
                            <Row k="Bonus held (no bank)" v={inr(rider.pendingIncentive)} />
                            <Row k="Cash in hand (COD)" v={inr(rider.codCollected)} />
                            <Row k="Pending payout" v={inr(rider.pendingPayout)} />
                            <Row k="Paid so far" v={inr(rider.paidAmount)} />
                            <Row k="Bank" v={rider.hasBankDetails ? `${rider.bankName || 'Bank'} ••${rider.bankAccountLast4}${rider.upiId ? ` · ${rider.upiId}` : ''}` : 'Not added'} />
                        </>) : <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)' }}>Rider record not found.</p>}
                    </div>

                    {order && (
                        <div className="glass-card" style={{ padding: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6, color: 'var(--foreground)' }}><Package size={15} /> Related order</div>
                            <Row k="Order" v={order.orderId.slice(-8).toUpperCase()} />
                            <Row k="Status" v={order.status} />
                            <Row k="Restaurant" v={order.vendorName} />
                            <Row k="Customer" v={order.customerName} />
                            <Row k="Total" v={`${inr(order.total)} · ${order.paymentMode}`} />
                            <Row k="Rider pay" v={inr(order.riderPay)} />
                            <Row k="Distance" v={order.distanceKm ? `${order.distanceKm} km` : '—'} />
                            <Row k="Placed / delivered" v={`${when(order.createdAt)} / ${when(order.deliveredAt)}`} />
                        </div>
                    )}

                    <div className="glass-card" style={{ padding: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6, color: 'var(--foreground)' }}><Wallet size={15} /> Recent payouts</div>
                        {payouts.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)' }}>No payouts yet.</p>}
                        {payouts.map(p => (
                            <Row key={p.payoutId}
                                k={`${when(p.confirmedAt || p.createdAt)} · ${p.method}`}
                                v={<span>{inr(p.amount)} <span style={{ color: p.status === 'completed' ? '#059669' : '#D97706', fontWeight: 600 }}>{p.status}</span></span>} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
