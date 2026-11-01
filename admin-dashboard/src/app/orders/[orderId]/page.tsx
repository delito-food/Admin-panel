'use client';

/**
 * Order detail — one order on a full page.
 *
 * Replaces the popup on the Orders list, which had outgrown it. Everything the
 * popup showed is here, laid out so it can be read at a glance:
 *
 *   header      who/what/when, status, ids, the four numbers that matter
 *   people      customer · restaurant · delivery partner (with PINs)
 *   left        items, customer bill, where the money went
 *   right       timeline, payment & refunds, admin actions
 *
 * Data comes from GET /api/orders?id=<orderId> — the same enrichment as a row
 * of the register. When arriving from the list, the row already in memory is
 * painted immediately while the fresh copy loads.
 */

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft,
    RefreshCw,
    FileText,
    Ban,
    Copy,
    Check,
    User,
    Store,
    Truck,
    Phone,
    MapPin,
    ExternalLink,
    Clock,
    CheckCircle,
    XCircle,
    Package,
    ShoppingBag,
    AlertTriangle,
    Loader2,
    X,
    CreditCard,
    Navigation,
    Timer,
    MessageSquare,
    ShieldAlert,
} from 'lucide-react';
import { useApi, Order, peekApiCache, updateApiCache } from '@/hooks/useApi';
import { OrderBill } from '../OrderBill';
import { authenticatedFetch } from '@/lib/api-client';
import { opsStageOf, opsStageLabel, OPS_STAGE_META, minutesBetween, type OpsStage } from '@/lib/order-stage';

/** The register the Orders list keeps in memory — used for instant paint and kept in sync. */
const LIST_ENDPOINT = '/api/orders?limit=all';

const LABEL = 'text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]';
const MUTED = 'text-[var(--foreground-secondary)]';

// ── order helpers (same rules as the Orders list) ──────────────────────────

const stageOfOrder = (o: Order): OpsStage =>
    o.opsStage ?? opsStageOf(o.status, o.deliveryTaskStatus, o.pickupPinVerified);

const isMarkedFulfilled = (o: Order): boolean => !!o.fulfilledMark && stageOfOrder(o) !== 'DELIVERED';

const isLate = (o: Order): boolean => {
    const g = OPS_STAGE_META[stageOfOrder(o)].group;
    if (g === 'delivered' || g === 'issues' || !o.promisedDeliveryAt) return false;
    return Date.now() - Date.parse(o.promisedDeliveryAt) > 5 * 60_000;
};

const isCash = (o: Order) => /cod|cash/i.test(o.paymentMode || '');

const isCancellable = (o: Order) =>
    o.status !== 'Delivered' && o.status !== 'Cancelled' && o.status !== 'Cancelled by Admin';

function statusBadgeClass(o: Order) {
    switch (OPS_STAGE_META[stageOfOrder(o)].group) {
        case 'delivered': return 'badge-approved';
        case 'awaiting':
        case 'kitchen': return 'badge-pending';
        case 'issues': return 'badge-rejected';
        default: return 'badge-active';
    }
}

function statusIcon(o: Order) {
    switch (OPS_STAGE_META[stageOfOrder(o)].group) {
        case 'delivered': return <CheckCircle size={14} />;
        case 'issues': return <XCircle size={14} />;
        case 'onTheWay': return <Truck size={14} />;
        case 'kitchen': return <Package size={14} />;
        case 'pickup': return <Store size={14} />;
        default: return <Clock size={14} />;
    }
}

// ── formatting ─────────────────────────────────────────────────────────────

const fmtDateTime = (iso?: string | null) => iso
    ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

const fmtClock = (iso?: string | null) => iso
    ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : '';

function fmtAgo(iso?: string | null) {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)} hr ago`;
    const days = Math.floor(mins / 1440);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

const inr = (v: number) => '₹' + (Math.round((v || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

// ── small building blocks ──────────────────────────────────────────────────

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    if (!value) return null;
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                } catch { /* clipboard blocked — nothing to do */ }
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--foreground-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
        >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        </button>
    );
}

function Card({ title, icon, note, children, className = '' }: { title: string; icon?: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={`glass-card ${className}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    {icon && <span className="text-[var(--foreground-secondary)]">{icon}</span>}
                    <h2 className={LABEL}>{title}</h2>
                </div>
                {note && <span className={`text-[0.7rem] ${MUTED}`}>{note}</span>}
            </div>
            {children}
        </section>
    );
}

/** One label/value line inside a card. */
function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-[var(--glass-border)] py-2 last:border-b-0">
            <span className={`shrink-0 text-[0.78rem] ${MUTED}`}>{label}</span>
            <span className="min-w-0 text-right text-[0.84rem] font-medium text-[var(--foreground)]">{children}</span>
        </div>
    );
}

/** One of the four headline numbers under the order title. */
function Fact({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'amber' | 'red' }) {
    const color = tone === 'green' ? '#10B981' : tone === 'amber' ? '#F59E0B' : tone === 'red' ? '#EF4444' : 'var(--foreground)';
    return (
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-hover)] px-4 py-3">
            <p className={LABEL}>{label}</p>
            <p className="mt-1 text-lg font-bold leading-tight tabular-nums" style={{ color }}>{value}</p>
            {sub && <p className={`mt-0.5 text-[0.72rem] ${MUTED}`}>{sub}</p>}
        </div>
    );
}

function ContactLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
    return (
        <div className={`flex items-start gap-2 text-[0.82rem] ${MUTED}`}>
            <span className="mt-0.5 shrink-0">{icon}</span>
            <div className="min-w-0 break-words">{children}</div>
        </div>
    );
}

function IdChip({ label, id, href }: { label: string; id?: string | null; href?: string }) {
    if (!id) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-[0.72rem]">
            <span className={MUTED}>{label}</span>
            <code className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[0.7rem] text-[var(--foreground)]">{id}</code>
            <CopyButton value={id} label={`Copy ${label.toLowerCase()}`} />
            {href && (
                <Link href={href} className="inline-flex items-center gap-1 font-medium text-[var(--primary)] hover:underline">
                    Open profile <ExternalLink size={11} />
                </Link>
            )}
        </div>
    );
}

function PersonHeader({ role, name, icon, gradient, extra }: { role: string; name: string; icon: ReactNode; gradient: string; extra?: ReactNode }) {
    return (
        <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: gradient }}>
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <p className={LABEL}>{role}</p>
                <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[1rem] font-semibold text-[var(--foreground)]">{name}</p>
                    {extra}
                </div>
            </div>
        </div>
    );
}

function PinBox({ label, pin, verified, verifiedAt }: { label: string; pin: string; verified: boolean; verifiedAt: string | null }) {
    return (
        <div
            className="rounded-xl px-3 py-2.5"
            style={{
                background: verified ? 'rgba(16,185,129,0.08)' : 'var(--surface-hover)',
                border: `1.5px solid ${verified ? '#10B981' : 'var(--glass-border)'}`,
            }}
        >
            <div className="mb-1 flex items-center justify-between">
                <span className={LABEL}>{label}</span>
                {verified ? <CheckCircle size={13} color="#10B981" /> : <Clock size={13} className={MUTED} />}
            </div>
            <p className="font-mono text-xl font-extrabold tracking-[0.25em]" style={{ color: verified ? '#10B981' : 'var(--foreground)' }}>
                {pin || '---'}
            </p>
            <p className="mt-0.5 text-[0.65rem]" style={{ color: verified ? '#10B981' : 'var(--foreground-secondary)' }}>
                {verified ? `✓ Verified${verifiedAt ? ` ${fmtDateTime(verifiedAt)}` : ''}` : 'Awaiting verification'}
            </p>
        </div>
    );
}

const TASK_STATUS: Record<string, { label: string; color: string }> = {
    ASSIGNED: { label: 'Assigned', color: '#6366F1' },
    ACCEPTED: { label: 'Accepted', color: '#3B82F6' },
    EN_ROUTE_TO_PICKUP: { label: 'En route to pickup', color: '#F59E0B' },
    ARRIVED_AT_PICKUP: { label: 'At pickup', color: '#F97316' },
    PICKED_UP: { label: 'Picked up', color: '#0EA5E9' },
    EN_ROUTE_TO_CUSTOMER: { label: 'Out for delivery', color: '#10B981' },
    ARRIVED_AT_CUSTOMER: { label: 'Arrived', color: '#059669' },
    DELIVERED: { label: 'Delivered', color: '#10B981' },
    COMPLETED: { label: 'Completed', color: '#10B981' },
    CANCELLED: { label: 'Cancelled', color: '#EF4444' },
};

function TaskChip({ status }: { status: string }) {
    if (!status) return null;
    const s = TASK_STATUS[status] || { label: status.replace(/_/g, ' ').toLowerCase(), color: 'var(--foreground-secondary)' };
    return (
        <span
            className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold"
            style={{ color: s.color, border: `1px solid ${s.color}`, background: 'var(--surface-hover)' }}
        >
            {s.label}
        </span>
    );
}

// ── timeline ───────────────────────────────────────────────────────────────

function Timeline({ order: o }: { order: Order }) {
    // Built only from timestamps that mean what they say. The vendor app
    // records Accepted and Ready — there is no separate "started preparing"
    // event — and orders.pickedUpAt is stamped when a rider ACCEPTS, so pickup
    // comes from the PIN / the rider's own task.
    const stage = stageOfOrder(o);
    const delivered = stage === 'DELIVERED';
    const pickedUp = !!o.pickedUpAt || o.pickupPinVerified || ['OUT_FOR_DELIVERY', 'AT_CUSTOMER', 'DELIVERED'].includes(stage);
    const readyDelta = minutesBetween(o.expectedReadyAt, o.preparedAt);
    const riderWait = minutesBetween(o.riderAtRestaurantAt, o.pickedUpAt);
    const deliveredDelta = minutesBetween(o.promisedDeliveryAt, o.deliveredAt);

    const steps: { label: string; time: string | null | undefined; done: boolean; note?: string; warn?: boolean }[] = [
        { label: 'Order placed', time: o.createdAt, done: true },
        {
            label: o.preparationTimeMinutes ? `Accepted · committed ${o.preparationTimeMinutes} min prep` : 'Accepted by restaurant',
            time: o.acceptedAt, done: !!o.acceptedAt,
            note: o.acceptedAt
                ? [
                    `took ${minutesBetween(o.createdAt, o.acceptedAt) ?? '?'} min to accept`,
                    o.promisedDeliveryAt ? `promised by ${fmtClock(o.promisedDeliveryAt)}` : '',
                ].filter(Boolean).join(' · ')
                : undefined,
        },
        {
            label: 'Marked ready by restaurant', time: o.preparedAt, done: !!o.preparedAt || !!o.foodReady,
            note: readyDelta === null
                ? (o.expectedReadyAt && !o.preparedAt ? `due by ${fmtClock(o.expectedReadyAt)}` : undefined)
                : readyDelta > 0 ? `${readyDelta} min later than committed` : 'on time',
            warn: readyDelta !== null && readyDelta > 5,
        },
        { label: 'Rider search started', time: o.riderSearchStartedAt, done: !!o.riderSearchStartedAt || !!o.riderAssignedAt || pickedUp },
        { label: o.deliveryPersonName ? `Rider accepted · ${o.deliveryPersonName}` : 'Rider accepted', time: o.riderAssignedAt, done: !!o.riderAssignedAt || pickedUp },
        {
            label: 'Rider at restaurant', time: o.riderAtRestaurantAt, done: !!o.riderAtRestaurantAt || pickedUp,
            note: riderWait !== null ? `waited ${riderWait} min for the food` : undefined, warn: riderWait !== null && riderWait > 8,
        },
        { label: 'Picked up (PIN verified)', time: o.pickupPinVerifiedAt || o.pickedUpAt, done: pickedUp },
        { label: 'Rider at customer', time: o.atCustomerAt, done: !!o.atCustomerAt || delivered },
        {
            label: 'Delivered', time: o.deliveryPinVerifiedAt || o.deliveredAt, done: delivered || o.deliveryPinVerified,
            note: deliveredDelta === null ? undefined
                : deliveredDelta > 0 ? `${deliveredDelta} min after the promised time` : `${-deliveredDelta} min before the promised time`,
            warn: deliveredDelta !== null && deliveredDelta > 5,
        },
    ];

    const totalMins = minutesBetween(o.createdAt, o.deliveredAt);

    return (
        <Card title="Order timeline" icon={<Timer size={14} />} note={delivered && totalMins !== null ? `${totalMins} min door to door` : undefined}>
            <ol>
                {steps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                            <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold"
                                style={{
                                    background: s.done ? 'rgba(16,185,129,0.12)' : 'var(--surface-hover)',
                                    border: `2px solid ${s.done ? '#10B981' : 'var(--glass-border)'}`,
                                    color: s.done ? '#10B981' : 'var(--foreground-secondary)',
                                }}
                            >
                                {s.done ? '✓' : ''}
                            </span>
                            {i < steps.length - 1 && (
                                <span className="my-1 w-0.5 flex-1" style={{ minHeight: 14, background: s.done ? '#10B981' : 'var(--glass-border)' }} />
                            )}
                        </div>
                        <div className={`min-w-0 ${i < steps.length - 1 ? 'pb-3' : ''}`}>
                            <p className={`text-[0.82rem] ${s.done ? 'font-semibold text-[var(--foreground)]' : MUTED}`}>{s.label}</p>
                            {s.time
                                ? <p className="text-[0.7rem] text-emerald-500">{fmtDateTime(s.time)}</p>
                                : s.done && <p className={`text-[0.7rem] ${MUTED}`}>Completed</p>}
                            {s.note && <p className="text-[0.7rem]" style={{ color: s.warn ? '#EF4444' : 'var(--foreground-secondary)' }}>{s.note}</p>}
                        </div>
                    </li>
                ))}
            </ol>
        </Card>
    );
}

// ── page ───────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
    const params = useParams<{ orderId: string }>();
    const orderId = decodeURIComponent(String(params?.orderId ?? ''));
    const router = useRouter();

    const endpoint = `/api/orders?id=${encodeURIComponent(orderId)}`;
    const { data, error, refetch, mutate } = useApi<Order>(endpoint, { pollMs: 60_000 });

    // Arriving from the list: paint the row it already has while the fresh copy loads.
    const [seed] = useState<Order | null>(() =>
        peekApiCache<Order[]>(LIST_ENDPOINT)?.find(o => o.orderId === orderId) ?? null
    );
    const order = data ?? seed;

    const [refreshing, setRefreshing] = useState(false);
    const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // "Count as fulfilled" marker
    const [markNote, setMarkNote] = useState('');
    const [marking, setMarking] = useState(false);
    const [markResult, setMarkResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Admin cancel
    const [showCancel, setShowCancel] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelling, setCancelling] = useState(false);

    // Keep the list's in-memory register in step with what this page shows.
    useEffect(() => {
        if (!data) return;
        updateApiCache<Order[]>(LIST_ENDPOINT, list => list.map(o => o.orderId === data.orderId ? data : o));
    }, [data]);

    useEffect(() => {
        if (!banner) return;
        const t = setTimeout(() => setBanner(null), 6000);
        return () => clearTimeout(t);
    }, [banner]);

    const goBack = () => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push('/orders');
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const downloadInvoice = async () => {
        if (!order) return;
        try {
            const res = await authenticatedFetch(`/api/invoices/${order.orderId}?format=pdf`);
            if (!res.ok) {
                setBanner({ type: 'error', text: 'Could not generate the invoice' });
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Invoice-${order.orderId.slice(-8).toUpperCase()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch {
            setBanner({ type: 'error', text: 'Network error while downloading the invoice' });
        }
    };

    /**
     * Adds or removes the marker. Writes only adminFulfilledMarks/{orderId} —
     * the order's status, refund and payouts are left exactly as they are.
     */
    const handleFulfilledMark = async (mark: boolean) => {
        if (!order) return;
        setMarking(true);
        setMarkResult(null);
        const id = order.orderId;
        try {
            const res = mark
                ? await authenticatedFetch('/api/orders/fulfilled-mark', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: id, note: markNote }),
                })
                : await authenticatedFetch(`/api/orders/fulfilled-mark?orderId=${encodeURIComponent(id)}`, { method: 'DELETE' });
            const result = await res.json();
            if (!result.success) {
                setMarkResult({ type: 'error', text: result.error || 'Failed' });
                return;
            }
            const fulfilledMark = mark
                ? { markedAt: new Date().toISOString(), markedBy: 'you', note: markNote.trim(), statusWhenMarked: order.status }
                : null;
            mutate({ ...order, fulfilledMark });
            setMarkNote('');
            setMarkResult({ type: 'success', text: result.message });
        } catch {
            setMarkResult({ type: 'error', text: 'Network error' });
        } finally {
            setMarking(false);
        }
    };

    const handleAdminCancel = async () => {
        if (!order) return;
        setCancelling(true);
        try {
            const res = await authenticatedFetch('/api/orders/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: order.orderId, reason: cancelReason || 'Cancelled by admin' }),
            });
            const result = await res.json();
            if (result.success) {
                setBanner({ type: 'success', text: result.message + (result.data?.refundInitiated ? ' — Refund initiated automatically.' : '') });
                setShowCancel(false);
                setCancelReason('');
                refetch();
            } else {
                setBanner({ type: 'error', text: result.error || 'Failed to cancel order' });
            }
        } catch {
            setBanner({ type: 'error', text: 'Network error' });
        } finally {
            setCancelling(false);
        }
    };

    // ── loading / not found ──
    if (!order) {
        return (
            <div className="space-y-6">
                <button onClick={goBack} className="btn btn-outline"><ArrowLeft size={16} /> Orders</button>
                {error ? (
                    <div className="glass-card flex flex-col items-center gap-3 py-12 text-center">
                        <AlertTriangle size={28} className="text-amber-500" />
                        <p className="font-semibold">{/not found/i.test(error) ? 'Order not found' : 'Could not load this order'}</p>
                        <p className={`text-sm ${MUTED}`}>{/not found/i.test(error) ? <>No order with id <code className="font-mono">{orderId}</code>.</> : error}</p>
                        {!/not found/i.test(error) && <button onClick={handleRefresh} className="btn btn-outline"><RefreshCw size={16} /> Try again</button>}
                    </div>
                ) : (
                    <div className="flex min-h-[50vh] items-center justify-center">
                        <div className="flex flex-col items-center gap-4">
                            <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-[var(--primary)]/10">
                                <RefreshCw className="h-8 w-8 animate-spin text-[var(--primary)]" />
                            </div>
                            <p className={`font-medium ${MUTED}`}>Loading order…</p>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    const o = order;
    const shortId = o.orderId.slice(-8).toUpperCase();
    const stage = stageOfOrder(o);
    const delivered = stage === 'DELIVERED';
    const paid = (o.paymentStatus || '').toLowerCase() === 'paid';
    const itemCount = (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 1), 0);
    const deliveredIn = minutesBetween(o.createdAt, o.deliveredAt);
    const hasRider = !!(o.deliveryPersonName || o.deliveryPersonPhone || o.deliveryPersonId || o.pickupPin || o.deliveryPin);
    const cancellable = isCancellable(o);
    const mark = o.fulfilledMark;
    const refundOpen = !!o.refundStatus || (o.refundAmount || 0) > 0 || /refund/i.test(o.paymentStatus || '');

    return (
        <div className="space-y-6">
            {/* ── Top bar ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <button onClick={goBack} className="btn btn-outline">
                    <ArrowLeft size={16} /> Orders
                </button>
                <div className="flex flex-wrap gap-2">
                    <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1 }}>
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                    {o.status === 'Delivered' && (
                        <button onClick={downloadInvoice} className="btn btn-primary">
                            <FileText size={16} /> Invoice PDF
                        </button>
                    )}
                    {cancellable && (
                        <button
                            onClick={() => setShowCancel(true)}
                            className="btn"
                            style={{ background: '#EF4444', color: 'white' }}
                        >
                            <Ban size={16} /> Cancel order
                        </button>
                    )}
                </div>
            </div>

            {banner && (
                <div
                    className="rounded-xl px-4 py-3 text-sm font-medium"
                    style={{
                        background: banner.type === 'success' ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
                        color: banner.type === 'success' ? '#10B981' : '#EF4444',
                        border: `1px solid ${banner.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    }}
                >
                    {banner.text}
                </div>
            )}

            {/* ── Header ── */}
            <section className="glass-card">
                <div className="flex items-start gap-4">
                    <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/10 sm:flex">
                        <ShoppingBag size={24} className="text-[var(--primary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-2xl font-bold text-[var(--foreground)]">Order #{shortId}</h1>
                            <span className={`badge ${statusBadgeClass(o)}`}>
                                {statusIcon(o)}
                                {opsStageLabel(stage, o.foodReady)}
                            </span>
                            {isLate(o) && (
                                <span className="badge badge-rejected" title="More than 5 minutes past the delivery time promised at acceptance">
                                    <AlertTriangle size={12} /> Late
                                </span>
                            )}
                            {isMarkedFulfilled(o) && (
                                <span className="badge badge-approved"><CheckCircle size={12} /> Counted fulfilled</span>
                            )}
                        </div>
                        <p className={`mt-1 text-sm ${MUTED}`}>
                            Placed {fmtDateTime(o.createdAt)} · {fmtAgo(o.createdAt)}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                            <IdChip label="Order ID" id={o.orderId} />
                            <div className="flex items-center gap-1.5 text-[0.72rem]">
                                <span className={MUTED}>Invoice</span>
                                {o.invoiceNumber
                                    ? <><code className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[0.7rem]">{o.invoiceNumber}</code><CopyButton value={o.invoiceNumber} label="Copy invoice number" /></>
                                    : <span className={MUTED}>not issued</span>}
                            </div>
                            <span className={`text-[0.68rem] ${MUTED} opacity-80`} title="What the apps actually wrote — for debugging">
                                raw: {o.status}{o.deliveryTaskStatus ? ` · task: ${o.deliveryTaskStatus}` : ''}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Fact label="Customer paid" value={inr(o.total)} sub={`${itemCount} item${itemCount === 1 ? '' : 's'}${o.tip > 0 ? ` · + ${inr(o.tip)} tip` : ''}`} />
                    <Fact
                        label="Payment"
                        value={o.paymentMode || 'Cash on Delivery'}
                        sub={o.paymentStatus || 'Pending'}
                        tone={paid ? 'green' : undefined}
                    />
                    {delivered ? (
                        <Fact
                            label="Delivered"
                            value={fmtClock(o.deliveryPinVerifiedAt || o.deliveredAt) || '—'}
                            sub={deliveredIn !== null ? `${deliveredIn} min after ordering` : undefined}
                            tone="green"
                        />
                    ) : (
                        <Fact
                            label="Promised by"
                            value={o.promisedDeliveryAt ? fmtClock(o.promisedDeliveryAt) : '—'}
                            sub={o.promisedDeliveryAt ? (isLate(o) ? 'running late' : 'on track') : 'set when the restaurant accepts'}
                            tone={isLate(o) ? 'red' : undefined}
                        />
                    )}
                    <Fact
                        label="Distance"
                        value={o.distanceKm > 0 ? `${o.distanceKm} km` : '—'}
                        sub={o.preparationTimeMinutes ? `${o.preparationTimeMinutes} min prep committed` : undefined}
                    />
                </div>
            </section>

            {/* ── Delivery instruction — first thing ops should see ── */}
            {o.deliveryInstruction && (
                <div className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <MessageSquare size={16} className="mt-0.5 shrink-0 text-blue-500" />
                    <div>
                        <p className={LABEL}>Delivery instruction from customer</p>
                        <p className="mt-0.5 text-[0.9rem] italic text-[var(--foreground)]">&ldquo;{o.deliveryInstruction}&rdquo;</p>
                    </div>
                </div>
            )}

            {/* ── People ── */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {/* Customer */}
                <section className="glass-card">
                    <PersonHeader role="Customer" name={o.customerName || 'Unknown'} icon={<User size={20} />} gradient="linear-gradient(135deg, var(--primary), #0ea5e9)" />
                    <div className="space-y-2.5">
                        <ContactLine icon={<Phone size={14} />}>
                            {o.customerPhone
                                ? <span className="inline-flex items-center gap-1"><a href={`tel:${o.customerPhone}`} className="font-medium text-[var(--foreground)] hover:underline">{o.customerPhone}</a><CopyButton value={o.customerPhone} label="Copy phone" /></span>
                                : 'No phone'}
                        </ContactLine>
                        <ContactLine icon={<MapPin size={14} />}>
                            {o.deliveryAddress ? (
                                <>
                                    <span className="text-[var(--foreground)]">{o.deliveryAddress}</span>
                                    <a href={mapsUrl(o.deliveryAddress)} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 whitespace-nowrap text-[0.72rem] font-medium text-[var(--primary)] hover:underline">
                                        Map <ExternalLink size={10} />
                                    </a>
                                </>
                            ) : 'No address'}
                        </ContactLine>
                        {o.distanceKm > 0 && (
                            <ContactLine icon={<Navigation size={14} />}>{o.distanceKm} km from the restaurant</ContactLine>
                        )}
                        <div className="pt-1"><IdChip label="Customer ID" id={o.customerId} /></div>
                    </div>
                </section>

                {/* Restaurant */}
                <section className="glass-card">
                    <PersonHeader role="Restaurant" name={o.vendorName || 'Unknown'} icon={<Store size={20} />} gradient="linear-gradient(135deg, #F59E0B, #d97706)" />
                    <div className="space-y-2.5">
                        <ContactLine icon={<Phone size={14} />}>
                            {o.vendorPhone
                                ? <span className="inline-flex items-center gap-1"><a href={`tel:${o.vendorPhone}`} className="font-medium text-[var(--foreground)] hover:underline">{o.vendorPhone}</a><CopyButton value={o.vendorPhone} label="Copy phone" /></span>
                                : 'No phone'}
                        </ContactLine>
                        <ContactLine icon={<MapPin size={14} />}>
                            {o.vendorAddress ? (
                                <>
                                    <span className="text-[var(--foreground)]">{o.vendorAddress}{o.vendorCity ? `, ${o.vendorCity}` : ''}</span>
                                    <a href={mapsUrl(`${o.vendorName ? o.vendorName + ', ' : ''}${o.vendorAddress}${o.vendorCity ? ', ' + o.vendorCity : ''}`)} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 whitespace-nowrap text-[0.72rem] font-medium text-[var(--primary)] hover:underline">
                                        Map <ExternalLink size={10} />
                                    </a>
                                </>
                            ) : 'No address'}
                        </ContactLine>
                        <div className="pt-1"><IdChip label="Restaurant ID" id={o.vendorId} href={o.vendorId ? `/users/vendors/${o.vendorId}` : undefined} /></div>
                    </div>
                </section>

                {/* Delivery partner */}
                <section className="glass-card md:col-span-2 xl:col-span-1">
                    {hasRider ? (
                        <>
                            <PersonHeader
                                role="Delivery partner"
                                name={o.deliveryPersonName || 'Delivery partner'}
                                icon={<Truck size={20} />}
                                gradient="linear-gradient(135deg, #10B981, #059669)"
                                extra={<>
                                    {o.deliveryPersonRating > 0 && (
                                        <span className="rounded-full px-2 py-0.5 text-[0.68rem] font-semibold text-amber-500" style={{ background: 'rgba(245,158,11,0.12)' }}>
                                            ⭐ {o.deliveryPersonRating.toFixed(1)}
                                        </span>
                                    )}
                                    <TaskChip status={o.deliveryTaskStatus} />
                                </>}
                            />
                            <div className="space-y-2.5">
                                {o.deliveryPersonPhone && (
                                    <ContactLine icon={<Phone size={14} />}>
                                        <span className="inline-flex items-center gap-1"><a href={`tel:${o.deliveryPersonPhone}`} className="font-medium text-[var(--foreground)] hover:underline">{o.deliveryPersonPhone}</a><CopyButton value={o.deliveryPersonPhone} label="Copy phone" /></span>
                                    </ContactLine>
                                )}
                                {(o.deliveryPersonVehicleType || o.deliveryPersonVehicleNumber) && (
                                    <ContactLine icon={<Truck size={14} />}>
                                        <span className="text-[var(--foreground)]">{o.deliveryPersonVehicleType}</span>
                                        {o.deliveryPersonVehicleNumber && (
                                            <code className="ml-2 rounded border border-[var(--glass-border)] px-2 py-0.5 font-mono text-[0.75rem] font-bold tracking-wider text-[var(--foreground)]">
                                                {o.deliveryPersonVehicleNumber}
                                            </code>
                                        )}
                                    </ContactLine>
                                )}
                                <IdChip label="Partner ID" id={o.deliveryPersonId} href={o.deliveryPersonId ? `/users/delivery/${o.deliveryPersonId}` : undefined} />
                                {(o.pickupPin || o.deliveryPin) && (
                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                        <PinBox label="Pickup PIN" pin={o.pickupPin} verified={o.pickupPinVerified} verifiedAt={o.pickupPinVerifiedAt} />
                                        <PinBox label="Delivery PIN" pin={o.deliveryPin} verified={o.deliveryPinVerified} verifiedAt={o.deliveryPinVerifiedAt} />
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <PersonHeader role="Delivery partner" name="Not assigned yet" icon={<Truck size={20} />} gradient="linear-gradient(135deg, #9CA3AF, #6B7280)" />
                            <p className={`rounded-xl border border-dashed border-[var(--glass-border)] px-3 py-3 text-[0.8rem] ${MUTED}`}>
                                {stage === 'AWAITING_VENDOR' ? 'Order is waiting for the restaurant to accept.'
                                    : stage === 'PREPARING' ? 'Rider search starts about 5 minutes before the food is ready.'
                                        : stage === 'FOOD_READY' ? 'Food is ready — rider search should start within a minute.'
                                            : stage === 'SEARCHING_RIDER' ? 'Searching for a rider now.'
                                                : OPS_STAGE_META[stage].group === 'issues' ? 'No partner was assigned to this order.'
                                                    : 'A partner will be assigned shortly.'}
                            </p>
                        </>
                    )}
                </section>
            </div>

            {/* ── Main: money on the left, operations on the right ── */}
            <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="min-w-0 space-y-6">
                    <OrderBill order={o} part="items" />
                    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
                        <OrderBill order={o} part="bill" />
                        <OrderBill order={o} part="money" />
                    </div>
                </div>

                <div className="space-y-6">
                    <Timeline order={o} />

                    {/* Payment & settlement */}
                    <Card title="Payment & settlement" icon={<CreditCard size={14} />}>
                        <Field label="Mode">{o.paymentMode || 'Cash on Delivery'}</Field>
                        <Field label="Status">
                            <span style={{ color: paid ? '#10B981' : undefined }}>{o.paymentStatus || 'Pending'}</span>
                        </Field>
                        <Field label="Amount">{inr(o.total)}</Field>
                        {o.tip > 0 && <Field label="Tip (to rider)">{inr(o.tip)}</Field>}
                        {o.promoCode && <Field label="Promo code"><code className="font-mono">{o.promoCode}</code>{o.promoDiscount > 0 ? ` · −${inr(o.promoDiscount)}` : ''}</Field>}
                        {o.coinsUsed > 0 && <Field label="Coins used">{o.coinsUsed} coins{o.coinDiscount > 0 ? ` · −${inr(o.coinDiscount)}` : ''}</Field>}
                        {(o.totalDiscount || 0) > 0 && <Field label="All discounts">−{inr(o.totalDiscount || 0)}</Field>}
                        {o.refundStatus && (
                            <Field label="Refund">
                                <span style={{ color: o.refundStatus === 'full_refund' ? '#10B981' : o.refundStatus === 'partial_refund' ? '#F59E0B' : '#EF4444' }}>
                                    {o.refundStatus === 'full_refund' ? 'Full refund'
                                        : o.refundStatus === 'partial_refund' ? 'Partial refund'
                                            : o.refundStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </span>
                                {o.refundAmount > 0 ? ` · ${inr(o.refundAmount)}` : ''}
                            </Field>
                        )}
                        {isCash(o) && o.status === 'Delivered' && (
                            <Field label="COD settlement">
                                <span style={{ color: o.codSettled ? '#10B981' : '#F59E0B' }}>{o.codSettled ? '✅ Settled' : '⏳ Pending'}</span>
                            </Field>
                        )}
                    </Card>

                    {/* Admin actions */}
                    <Card title="Admin actions" icon={<ShieldAlert size={14} />}>
                        <div className="space-y-4">
                            {stage !== 'DELIVERED' && (
                                <div
                                    className="rounded-xl p-3"
                                    style={{ border: `1px solid ${mark ? '#10B981' : 'var(--glass-border)'}`, background: mark ? 'rgba(16,185,129,0.06)' : 'var(--surface-hover)' }}
                                >
                                    <p className="text-[0.85rem] font-semibold text-[var(--foreground)]">Count as fulfilled</p>
                                    {mark ? (
                                        <p className="mt-1 text-[0.78rem] text-[var(--foreground)]">
                                            ✅ Counted in fulfilled orders and Delito earnings
                                            {mark.markedAt ? ` · marked ${fmtDateTime(mark.markedAt)}` : ''}
                                            {mark.markedBy ? ` by ${mark.markedBy}` : ''}
                                            {mark.note ? <><br /><span className={`italic ${MUTED}`}>&ldquo;{mark.note}&rdquo;</span></> : null}
                                        </p>
                                    ) : (
                                        <p className={`mt-1 text-[0.76rem] leading-relaxed ${MUTED}`}>
                                            Use this when the food really reached the customer but the order shows &ldquo;{o.status}&rdquo;.
                                            Only the counts change — the order&apos;s status, refund and payouts stay exactly as they are.
                                        </p>
                                    )}
                                    {refundOpen && (
                                        <p className="mt-2 text-[0.72rem] text-amber-500">
                                            ⚠ This order has a refund on it ({o.refundStatus || o.paymentStatus}{o.refundAmount ? ` · ₹${o.refundAmount}` : ''}). Marking it does not stop or reverse that refund.
                                        </p>
                                    )}
                                    {!mark && (
                                        <input
                                            type="text"
                                            value={markNote}
                                            onChange={(e) => setMarkNote(e.target.value)}
                                            placeholder="Note (optional) — e.g. customer confirmed delivery"
                                            maxLength={300}
                                            className="input"
                                            style={{ marginTop: 10, fontSize: '0.8rem', padding: '0.6rem 0.8rem' }}
                                        />
                                    )}
                                    {markResult && (
                                        <p className="mt-2 text-[0.72rem]" style={{ color: markResult.type === 'success' ? '#10B981' : '#EF4444' }}>{markResult.text}</p>
                                    )}
                                    <button
                                        onClick={() => handleFulfilledMark(!mark)}
                                        disabled={marking}
                                        className="btn mt-3 w-full"
                                        style={{
                                            padding: '0.6rem 1rem',
                                            border: mark ? '1px solid var(--glass-border)' : 'none',
                                            background: mark ? 'transparent' : '#10B981',
                                            color: mark ? 'var(--foreground)' : 'white',
                                            opacity: marking ? 0.6 : 1,
                                            cursor: marking ? 'wait' : 'pointer',
                                        }}
                                    >
                                        {marking ? <Loader2 size={16} className="animate-spin" /> : mark ? <XCircle size={16} /> : <CheckCircle size={16} />}
                                        {mark ? 'Remove marker' : 'Mark as fulfilled'}
                                    </button>
                                </div>
                            )}

                            {cancellable && (
                                <div className="rounded-xl p-3" style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
                                    <p className="text-[0.85rem] font-semibold text-red-500">Cancel this order</p>
                                    <p className={`mt-1 text-[0.76rem] ${MUTED}`}>
                                        Marks it &ldquo;Cancelled by Admin&rdquo;, frees the rider{isCash(o) ? '' : ' and refunds online payments automatically'}. Cannot be undone.
                                    </p>
                                    <button onClick={() => setShowCancel(true)} className="btn mt-3 w-full" style={{ padding: '0.6rem 1rem', background: '#EF4444', color: 'white' }}>
                                        <Ban size={16} /> Cancel order
                                    </button>
                                </div>
                            )}

                            {stage === 'DELIVERED' && !cancellable && (
                                <p className={`text-[0.78rem] ${MUTED}`}>Delivered orders have no admin actions. Use the invoice button above for the PDF.</p>
                            )}
                            {stage !== 'DELIVERED' && !cancellable && !mark && OPS_STAGE_META[stage].group !== 'issues' && (
                                <p className={`text-[0.78rem] ${MUTED}`}>This order can no longer be cancelled.</p>
                            )}
                        </div>
                    </Card>
                </div>
            </div>

            {/* ── Cancel confirmation ── */}
            <AnimatePresence>
                {showCancel && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="modal-overlay" style={{ zIndex: 60 }}
                        onClick={() => { setShowCancel(false); setCancelReason(''); }}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content w-full max-w-md"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <h2 className="modal-title">⚠️ Cancel order</h2>
                                <button onClick={() => { setShowCancel(false); setCancelReason(''); }} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body space-y-4">
                                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] px-3.5 py-3">
                                    <div className="mb-1 flex justify-between">
                                        <span className="text-[0.82rem] font-semibold">#{shortId}</span>
                                        <span className="text-[0.82rem] font-bold text-[var(--primary)]">{inr(o.total)}</span>
                                    </div>
                                    <p className={`text-[0.75rem] ${MUTED}`}>{o.customerName} · {o.vendorName} · {o.status}</p>
                                </div>

                                <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                    <div className="mb-1.5 flex items-center gap-1.5 text-[0.82rem] font-semibold text-red-500">
                                        <AlertTriangle size={14} /> This action cannot be undone
                                    </div>
                                    <ul className={`m-0 list-disc pl-4 text-[0.78rem] leading-relaxed ${MUTED}`}>
                                        <li>Order will be marked as &quot;Cancelled by Admin&quot;</li>
                                        <li>Delivery task will be cancelled and partner freed</li>
                                        <li>Vendor will see &quot;Cancelled by Admin&quot;</li>
                                        <li>Customer will see &quot;Cancelled due to technical reason&quot;</li>
                                        {(o.paymentMode?.toLowerCase() === 'online' || o.paymentMode?.toLowerCase() === 'razorpay') && (
                                            <li className="font-semibold text-emerald-500">✓ Full refund will be processed automatically</li>
                                        )}
                                    </ul>
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-[0.82rem] font-semibold">Cancellation reason</label>
                                    <select
                                        value={cancelReason}
                                        onChange={(e) => setCancelReason(e.target.value)}
                                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[0.85rem] text-[var(--foreground)] outline-none"
                                    >
                                        <option value="">Select reason...</option>
                                        <option value="Technical issue with the order">Technical issue with the order</option>
                                        <option value="Vendor unable to fulfill the order">Vendor unable to fulfill</option>
                                        <option value="Customer requested cancellation via support">Customer support request</option>
                                        <option value="Delivery partner unavailable">Delivery partner unavailable</option>
                                        <option value="Payment issue">Payment issue</option>
                                        <option value="Fraudulent order detected">Fraudulent order detected</option>
                                        <option value="Quality or safety concern">Quality/safety concern</option>
                                        <option value="System error">System error</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>

                                <div className="flex gap-2.5 pt-2">
                                    <button
                                        onClick={() => { setShowCancel(false); setCancelReason(''); }}
                                        className="btn btn-outline flex-1"
                                    >
                                        Go back
                                    </button>
                                    <button
                                        onClick={handleAdminCancel}
                                        disabled={cancelling || !cancelReason}
                                        className="btn flex-1"
                                        style={{
                                            background: '#EF4444', color: 'white',
                                            opacity: (cancelling || !cancelReason) ? 0.5 : 1,
                                            cursor: (cancelling || !cancelReason) ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {cancelling ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                                        {cancelling ? 'Cancelling…' : 'Cancel order'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
