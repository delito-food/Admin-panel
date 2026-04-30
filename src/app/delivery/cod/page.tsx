'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bike, IndianRupee, RefreshCw, Search, CheckCircle2, Clock, X, Banknote,
    AlertTriangle, Loader2, FileText, ArrowDownRight, ArrowUpRight, XCircle,
    CreditCard, Smartphone, Building2, Wallet, History, Shield
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

/* ── Types ── */
interface QrReviewOrder {
    orderId: string; total: number; customerName: string; createdAt: string; qrReviewStatus: string;
}
interface DeliveryCOD {
    deliveryPersonId: string; fullName: string; profilePhotoUrl: string;
    phoneNumber: string; city: string; isOnline: boolean; isVerified: boolean;
    codCollected: number; codSettled: number; codPending: number;
    pendingOrders: number; pendingOrderIds?: string[]; totalCodOrders: number;
    qrPendingReview: number; qrReviewOrders: QrReviewOrder[];
}
interface Settlement {
    settlementId: string; deliveryPersonId: string; deliveryPersonName: string;
    amount: number; ordersCount: number; method: string; status: string;
    createdAt: string; processedAt: string | null; notes: string | null;
    receiptId: string | null; processedBy: string; orderIds: string[];
}
interface CODData {
    deliveryPartners: DeliveryCOD[];
    recentSettlements: Settlement[];
    summary: {
        totalCodCollected: number; totalCodSettled: number;
        totalCodPending: number; totalQrPendingReview: number;
        partnersWithPending: number;
        totalSettlementRecords: number;
    };
}

/* ── Stat Card ── */
function StatCard({ title, value, subtitle, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; subtitle?: string;
    icon: React.ElementType; color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const cm = {
        primary: { bg: 'rgba(244,81,30,0.12)', text: '#F4511E', grad: 'linear-gradient(135deg, rgba(244,81,30,0.08), rgba(244,81,30,0.02))' },
        success: { bg: 'rgba(16,185,129,0.12)', text: '#10B981', grad: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))' },
        warning: { bg: 'rgba(245,158,11,0.12)', text: '#F59E0B', grad: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))' },
        error: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444', grad: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))' },
    };
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card"
            style={{ padding: 18, background: cm[color].grad }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{title}</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.1 }}>{value}</p>
                    {subtitle && <p style={{ fontSize: '0.7rem', color: cm[color].text, marginTop: 4, fontWeight: 500 }}>{subtitle}</p>}
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: cm[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color={cm[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

const fld: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 12,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none',
    transition: 'border-color 0.2s',
};

const methodIcons: Record<string, React.ReactNode> = {
    'Cash': <Banknote size={14} />,
    'Bank Transfer': <Building2 size={14} />,
    'UPI': <Smartphone size={14} />,
    'Razorpay': <CreditCard size={14} />,
    'Admin Override': <Shield size={14} />,
};

function useIsMobile(breakpoint = 640) {
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < breakpoint);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, [breakpoint]);
    return isMobile;
}

export default function CODTrackingPage() {
    const { data, loading, refetch } = useApi<CODData>('/api/delivery/cod');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [showSettleModal, setShowSettleModal] = useState<DeliveryCOD | null>(null);
    const [settleAmount, setSettleAmount] = useState(0);
    const [settleMethod, setSettleMethod] = useState('Cash');
    const [notes, setNotes] = useState('');
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'pending' | 'history' | 'qr_review'>('pending');
    const [showDetailModal, setShowDetailModal] = useState<DeliveryCOD | null>(null);
    const [voidingId, setVoidingId] = useState<string | null>(null);
    const isMobile = useIsMobile();

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
    const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 1 }).format(n);
    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const fmtTime = (d: string) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

    const handleSettle = async () => {
        if (!showSettleModal || settleAmount <= 0) { alert('Please enter a valid amount'); return; }
        if (settleAmount > showSettleModal.codPending + 1) { alert('Settlement amount cannot exceed pending COD'); return; }
        const confirmed = window.confirm(
            `⚠️ Confirm COD settlement:\n\nPartner: ${showSettleModal.fullName}\nAmount: ₹${settleAmount.toLocaleString('en-IN')}\nMethod: ${settleMethod}\n\nThis will mark the orders as settled.`
        );
        if (!confirmed) return;
        setProcessing(true);
        try {
            const r = await fetch('/api/delivery/cod', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deliveryPersonId: showSettleModal.deliveryPersonId,
                    deliveryPersonName: showSettleModal.fullName,
                    amount: settleAmount,
                    method: settleMethod,
                    notes: notes || null,
                    orderIds: showSettleModal.pendingOrderIds || [],
                    processedBy: 'admin',
                })
            });
            const res = await r.json();
            if (res.success) {
                await refetch();
                setShowSettleModal(null); setSettleAmount(0); setNotes('');
                alert(`✅ ${res.message}\n\nReceipt: ${res.receiptId}\nOrders settled: ${res.ordersSettled}`);
            } else {
                alert(`❌ ${res.error || 'Failed'}`);
            }
        } catch { alert('Network error. Please try again.'); }
        setProcessing(false);
    };

    const handleVoid = async (settlementId: string) => {
        const confirmed = window.confirm('⚠️ Are you sure you want to void this settlement?\n\nThis will unmark all associated orders and reverse the settlement.');
        if (!confirmed) return;
        setVoidingId(settlementId);
        try {
            const r = await fetch('/api/delivery/cod', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settlementId, action: 'void', notes: 'Voided by admin' }),
            });
            const res = await r.json();
            if (res.success) { await refetch(); alert('✅ ' + res.message); }
            else alert('❌ ' + (res.error || 'Failed'));
        } catch { alert('Network error'); }
        setVoidingId(null);
    };

    const openSettle = (p: DeliveryCOD) => {
        setShowSettleModal(p);
        setSettleAmount(Math.round(p.codPending));
        setSettleMethod('Cash'); setNotes('');
    };

    const fp = data?.deliveryPartners.filter(d =>
        d.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.phoneNumber.includes(searchTerm)
    ) || [];

    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>COD Settlement</h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
            </div>
        </div>
    );

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20, padding: isMobile ? 12 : 20 }}>

            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: isMobile ? '1.25rem' : '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Wallet size={isMobile ? 22 : 28} style={{ color: 'var(--primary)' }} /> COD Settlement
                    </h1>
                    <p style={{ fontSize: isMobile ? '0.75rem' : '0.85rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        {isMobile ? 'Track & settle COD amounts' : 'Track & settle cash-on-delivery amounts • Tamper-proof — computed from orders'}
                    </p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1, fontSize: isMobile ? '0.75rem' : undefined, padding: isMobile ? '6px 12px' : undefined }}>
                    <RefreshCw size={isMobile ? 14 : 16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Summary Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: isMobile ? 10 : 14 }}>
                <StatCard title="Total COD Collected" value={fmt(data?.summary.totalCodCollected || 0)}
                    subtitle={`${data?.summary.totalSettlementRecords || 0} settlement records`}
                    icon={IndianRupee} color="primary" />
                <StatCard title="Total Settled" value={fmt(data?.summary.totalCodSettled || 0)}
                    subtitle="All-time settled amount"
                    icon={CheckCircle2} color="success" />
                <StatCard title="Pending Collection" value={fmt(data?.summary.totalCodPending || 0)}
                    subtitle={`${data?.summary.partnersWithPending || 0} partners with pending`}
                    icon={Clock} color="warning" />
                <StatCard title="Settlement Rate" value={
                    data?.summary.totalCodCollected
                        ? `${Math.round((data.summary.totalCodSettled / data.summary.totalCodCollected) * 100)}%`
                        : '0%'
                }
                    subtitle="Collected → Settled"
                    icon={ArrowUpRight} color={
                        (data?.summary.totalCodCollected && (data.summary.totalCodSettled / data.summary.totalCodCollected) > 0.8)
                            ? 'success' : 'warning'
                    } />
                {(data?.summary.totalQrPendingReview || 0) > 0 && (
                    <StatCard title="QR Pending Review" value={fmt(data?.summary.totalQrPendingReview || 0)}
                        subtitle="Paid via QR — awaiting verification"
                        icon={Smartphone} color="warning" />
                )}
            </div>

            {/* Main Content — Tabs */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {(['pending', 'qr_review', 'history'] as const).map(t => (
                        <button key={t} onClick={() => setActiveTab(t)} style={{
                            flex: 1, padding: '14px 16px', fontSize: '0.85rem', fontWeight: 600,
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            borderBottom: `2.5px solid ${activeTab === t ? 'var(--primary)' : 'transparent'}`,
                            color: activeTab === t ? 'var(--primary)' : 'var(--foreground-secondary)',
                            transition: 'all 0.2s',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        }}>
                            {t === 'pending' ? <><Clock size={16} /> Pending COD ({fp.filter(p => p.codPending > 0).length})</> :
                             t === 'qr_review' ? <><Smartphone size={16} /> QR Review ({data?.deliveryPartners?.reduce((s: number, p: DeliveryCOD) => s + (p.qrReviewOrders?.length || 0), 0) || 0})</> :
                                <><History size={16} /> Settlement History ({data?.recentSettlements?.length || 0})</>}
                        </button>
                    ))}
                </div>

                {/* ── Pending Tab ── */}
                {activeTab === 'pending' && (<>
                    <div style={{ padding: isMobile ? 12 : 16, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ position: 'relative', maxWidth: 400 }}>
                            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input type="text" placeholder="Search by name or phone..." value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ ...fld, paddingLeft: 36, fontSize: '0.8rem' }} />
                        </div>
                    </div>

                    {/* Mobile: Card Layout */}
                    {isMobile ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {fp.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>
                                    No delivery partners with COD found
                                </div>
                            ) : fp.map(p => (
                                <div key={p.deliveryPersonId} style={{ padding: '14px 14px', borderBottom: '1px solid var(--border)' }}>
                                    {/* Partner Row */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}
                                        onClick={() => setShowDetailModal(p)}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(244,81,30,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                            {p.profilePhotoUrl
                                                ? <img src={p.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <Bike size={16} color="#F4511E" />}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {p.fullName}
                                                {p.isOnline && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: '#10B981', marginLeft: 6, verticalAlign: 'middle' }} />}
                                            </p>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{p.phoneNumber}</p>
                                        </div>
                                        <span style={{ padding: '3px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 600, background: p.pendingOrders > 0 ? 'rgba(245,158,11,0.12)' : 'var(--surface)', color: p.pendingOrders > 0 ? '#F59E0B' : 'var(--foreground-secondary)', whiteSpace: 'nowrap' }}>
                                            {p.pendingOrders}/{p.totalCodOrders}
                                        </span>
                                    </div>
                                    {/* Amount Row */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: p.codPending > 0 ? 10 : 0 }}>
                                        <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>Collected: <b style={{ color: 'var(--foreground)' }}>{fmt(p.codCollected)}</b></span>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>Settled: <b style={{ color: '#10B981' }}>{fmt(p.codSettled)}</b></span>
                                        </div>
                                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: p.codPending > 0 ? '#F59E0B' : 'var(--foreground-secondary)', whiteSpace: 'nowrap' }}>
                                            {fmt(p.codPending)}
                                            {p.codPending > 5000 && <AlertTriangle size={12} style={{ marginLeft: 4, color: '#EF4444', verticalAlign: 'middle' }} />}
                                        </span>
                                    </div>
                                    {/* Settle Button */}
                                    {p.codPending > 0 && (
                                        <button onClick={() => openSettle(p)} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                            width: '100%', padding: '9px 14px', borderRadius: 10,
                                            background: 'linear-gradient(135deg, #10B981, #059669)',
                                            color: 'white', border: 'none', cursor: 'pointer',
                                            fontSize: '0.78rem', fontWeight: 600,
                                            boxShadow: '0 2px 8px rgba(16,185,129,0.3)',
                                        }}>
                                            <Banknote size={14} /> Settle {fmt(p.codPending)}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* Desktop: Table Layout */
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table-premium">
                                <thead><tr>
                                    <th>Delivery Partner</th>
                                    <th style={{ textAlign: 'right' }}>COD Collected</th>
                                    <th style={{ textAlign: 'right' }}>Settled</th>
                                    <th style={{ textAlign: 'right' }}>Pending</th>
                                    <th style={{ textAlign: 'center' }}>Orders</th>
                                    <th style={{ textAlign: 'center' }}>Actions</th>
                                </tr></thead>
                                <tbody>
                                    {fp.length === 0 ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                            No delivery partners with COD found
                                        </td></tr>
                                    ) : fp.map(p => (
                                        <tr key={p.deliveryPersonId}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                                                    onClick={() => setShowDetailModal(p)}>
                                                    <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(244,81,30,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                                        {p.profilePhotoUrl
                                                            ? <img src={p.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                            : <Bike size={16} color="#F4511E" />}
                                                    </div>
                                                    <div>
                                                        <p style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                                                            {p.fullName}
                                                            {p.isOnline && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: '#10B981', marginLeft: 6, verticalAlign: 'middle' }} />}
                                                        </p>
                                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{p.phoneNumber}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'right', fontSize: '0.85rem' }}>{fmt(p.codCollected)}</td>
                                            <td style={{ textAlign: 'right', fontSize: '0.85rem', color: '#10B981', fontWeight: 500 }}>{fmt(p.codSettled)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: p.codPending > 0 ? '#F59E0B' : 'var(--foreground-secondary)' }}>
                                                    {fmt(p.codPending)}
                                                </span>
                                                {p.codPending > 5000 && <AlertTriangle size={13} style={{ marginLeft: 6, color: '#EF4444', verticalAlign: 'middle' }} />}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: 100, fontSize: '0.72rem', fontWeight: 600,
                                                    background: p.pendingOrders > 0 ? 'rgba(245,158,11,0.12)' : 'var(--surface)',
                                                    color: p.pendingOrders > 0 ? '#F59E0B' : 'var(--foreground-secondary)',
                                                }}>
                                                    {p.pendingOrders} pending / {p.totalCodOrders} total
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {p.codPending > 0 && (
                                                    <button onClick={() => openSettle(p)} style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                                        padding: '6px 14px', borderRadius: 10,
                                                        background: 'linear-gradient(135deg, #10B981, #059669)',
                                                        color: 'white', border: 'none', cursor: 'pointer',
                                                        fontSize: '0.78rem', fontWeight: 600,
                                                        boxShadow: '0 2px 8px rgba(16,185,129,0.3)',
                                                        transition: 'transform 0.15s',
                                                    }}
                                                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}>
                                                        <Banknote size={14} /> Settle
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>)}

                {/* ── QR Review Tab ── */}
                {activeTab === 'qr_review' && (
                    <div style={{ padding: isMobile ? 12 : 16 }}>
                        {(() => {
                            const allQrOrders = (data?.deliveryPartners || []).flatMap((p: DeliveryCOD) =>
                                (p.qrReviewOrders || []).map(o => ({ ...o, deliveryPersonName: p.fullName, deliveryPersonId: p.deliveryPersonId }))
                            );
                            if (allQrOrders.length === 0) {
                                return (
                                    <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>
                                        <Smartphone size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                        <p>No QR payments pending review</p>
                                    </div>
                                );
                            }
                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', padding: '0 4px', fontWeight: 500 }}>
                                        {allQrOrders.length} QR payment{allQrOrders.length > 1 ? 's' : ''} awaiting verification — confirm if the amount was received in your bank/UPI
                                    </div>
                                    {allQrOrders.map((o: any) => (
                                        <div key={o.orderId} style={{
                                            display: 'flex', alignItems: 'center', gap: 14, padding: 16,
                                            background: 'var(--surface)', borderRadius: 14,
                                            border: '1px solid rgba(124,58,237,0.15)',
                                        }}>
                                            <div style={{
                                                width: 44, height: 44, borderRadius: 12,
                                                background: 'linear-gradient(135deg, #7C3AED, #9333EA)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                            }}>
                                                <Smartphone size={20} color="white" />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>
                                                    ₹{o.total.toLocaleString('en-IN')}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                                    {o.customerName} · Order #{o.orderId.slice(-6).toUpperCase()}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 1 }}>
                                                    Delivery: {o.deliveryPersonName} · {o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                                <button onClick={async () => {
                                                    if (!window.confirm(`Confirm: ₹${o.total} received via QR for order #${o.orderId.slice(-6)}?`)) return;
                                                    try {
                                                        await fetch('/api/delivery/cod', {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ orderId: o.orderId, status: 'reviewed' }),
                                                        });
                                                        handleRefresh();
                                                    } catch (e) { alert('Failed to update'); }
                                                }} style={{
                                                    padding: '6px 14px', borderRadius: 8,
                                                    background: 'var(--accent-success)', color: 'white',
                                                    border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                }}>
                                                    <CheckCircle2 size={14} /> Verified
                                                </button>
                                                <button onClick={async () => {
                                                    if (!window.confirm(`Reject QR payment of ₹${o.total}? This will add it back to delivery person's pending COD.`)) return;
                                                    try {
                                                        await fetch('/api/delivery/cod', {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ orderId: o.orderId, status: 'rejected' }),
                                                        });
                                                        handleRefresh();
                                                    } catch (e) { alert('Failed to update'); }
                                                }} style={{
                                                    padding: '6px 14px', borderRadius: 8,
                                                    background: 'var(--accent-error)', color: 'white',
                                                    border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                }}>
                                                    <XCircle size={14} /> Reject
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* ── History Tab ── */}
                {activeTab === 'history' && (
                    isMobile ? (
                        /* Mobile: Card layout for settlement history */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {(!data?.recentSettlements?.length) ? (
                                <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>
                                    No settlement history yet
                                </div>
                            ) : data.recentSettlements.map(s => (
                                <div key={s.settlementId} style={{ padding: '14px', borderBottom: '1px solid var(--border)', opacity: s.status === 'voided' ? 0.5 : 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', padding: '2px 6px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                <FileText size={10} />
                                                {s.receiptId || `#${s.settlementId.slice(-8).toUpperCase()}`}
                                            </span>
                                            <span style={{ padding: '2px 6px', borderRadius: 100, fontSize: '0.62rem', fontWeight: 600, background: s.status === 'completed' ? 'rgba(16,185,129,0.08)' : s.status === 'voided' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)', color: s.status === 'completed' ? '#10B981' : s.status === 'voided' ? '#EF4444' : '#F59E0B' }}>
                                                {s.status === 'completed' ? '✅' : s.status === 'voided' ? '❌' : '⏳'} {s.status}
                                            </span>
                                        </div>
                                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: s.status === 'voided' ? '#EF4444' : '#10B981' }}>
                                            {s.status === 'voided' ? <span style={{ textDecoration: 'line-through' }}>{fmt(s.amount)}</span> : fmt(s.amount)}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                            <span style={{ fontWeight: 500, color: 'var(--foreground)' }}>{s.deliveryPersonName}</span>
                                            {' • '}{s.ordersCount} orders{' • '}
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{methodIcons[s.method] || <Banknote size={10} />} {s.method}</span>
                                            {' • '}{fmtDate(s.createdAt)}
                                        </div>
                                        {s.status === 'completed' && (
                                            <button onClick={() => handleVoid(s.settlementId)} disabled={voidingId === s.settlementId}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)', cursor: voidingId === s.settlementId ? 'not-allowed' : 'pointer', fontSize: '0.65rem', fontWeight: 600, opacity: voidingId === s.settlementId ? 0.5 : 1 }}>
                                                <XCircle size={10} /> {voidingId === s.settlementId ? '...' : 'Void'}
                                            </button>
                                        )}
                                    </div>
                                    {s.notes && <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 4, fontStyle: 'italic' }}>{s.notes}</p>}
                                </div>
                            ))}
                        </div>
                    ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium">
                            <thead><tr>
                                <th>Receipt</th><th>Partner</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th style={{ textAlign: 'center' }}>Orders</th>
                                <th style={{ textAlign: 'center' }}>Method</th>
                                <th style={{ textAlign: 'center' }}>Processed By</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                                <th>Notes</th><th>Date</th>
                                <th style={{ textAlign: 'center' }}>Actions</th>
                            </tr></thead>
                            <tbody>
                                {(!data?.recentSettlements?.length) ? (
                                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        No settlement history yet
                                    </td></tr>
                                ) : data.recentSettlements.map(s => (
                                    <tr key={s.settlementId} style={{ opacity: s.status === 'voided' ? 0.5 : 1 }}>
                                        <td>
                                            <span style={{
                                                fontFamily: 'monospace', fontSize: '0.75rem', padding: '3px 8px',
                                                borderRadius: 8, background: 'var(--surface)',
                                                border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 4,
                                            }}>
                                                <FileText size={11} />
                                                {s.receiptId || `#${s.settlementId.slice(-8).toUpperCase()}`}
                                            </span>
                                        </td>
                                        <td style={{ fontWeight: 500, fontSize: '0.85rem' }}>{s.deliveryPersonName}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: s.status === 'voided' ? '#EF4444' : '#10B981', fontSize: '0.88rem' }}>
                                            {s.status === 'voided' && <span style={{ textDecoration: 'line-through' }}>{fmt(s.amount)}</span>}
                                            {s.status !== 'voided' && fmt(s.amount)}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ padding: '2px 8px', borderRadius: 100, fontSize: '0.68rem', fontWeight: 600, background: 'rgba(59,130,246,0.08)', color: '#3B82F6' }}>
                                                {s.ordersCount}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 500,
                                                background: s.method === 'Razorpay' ? 'rgba(99,102,241,0.08)' : 'rgba(59,130,246,0.08)',
                                                color: s.method === 'Razorpay' ? '#6366F1' : '#3B82F6',
                                            }}>
                                                {methodIcons[s.method] || <Banknote size={12} />}
                                                {s.method}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: 100, fontSize: '0.68rem', fontWeight: 500,
                                                background: s.processedBy === 'delivery_app' ? 'rgba(99,102,241,0.08)' : 'rgba(244,81,30,0.08)',
                                                color: s.processedBy === 'delivery_app' ? '#6366F1' : '#F4511E',
                                            }}>
                                                {s.processedBy === 'delivery_app' ? '📱 App' : '🖥️ Admin'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: 100, fontSize: '0.68rem', fontWeight: 600,
                                                background: s.status === 'completed' ? 'rgba(16,185,129,0.08)' : s.status === 'voided' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                                                color: s.status === 'completed' ? '#10B981' : s.status === 'voided' ? '#EF4444' : '#F59E0B',
                                            }}>
                                                {s.status === 'completed' ? '✅' : s.status === 'voided' ? '❌' : '⏳'} {s.status}
                                            </span>
                                        </td>
                                        <td style={{ maxWidth: 150, fontSize: '0.78rem', color: 'var(--foreground-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {s.notes || '—'}
                                        </td>
                                        <td>
                                            {s.createdAt ? (
                                                <div style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                    <div>{fmtDate(s.createdAt)}</div>
                                                    <div style={{ fontSize: '0.68rem', opacity: 0.7 }}>{fmtTime(s.createdAt)}</div>
                                                </div>
                                            ) : '—'}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {s.status === 'completed' && (
                                                <button onClick={() => handleVoid(s.settlementId)} disabled={voidingId === s.settlementId}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        padding: '4px 10px', borderRadius: 8,
                                                        background: 'rgba(239,68,68,0.08)', color: '#EF4444',
                                                        border: '1px solid rgba(239,68,68,0.2)',
                                                        cursor: voidingId === s.settlementId ? 'not-allowed' : 'pointer',
                                                        fontSize: '0.7rem', fontWeight: 600,
                                                        opacity: voidingId === s.settlementId ? 0.5 : 1,
                                                    }}>
                                                    <XCircle size={12} /> {voidingId === s.settlementId ? 'Voiding...' : 'Void'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    )
                )}
            </motion.div>

            {/* ── Settlement Modal ── */}
            <AnimatePresence>{showSettleModal && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={() => setShowSettleModal(null)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                        onClick={e => e.stopPropagation()} className="glass-card" style={{ padding: isMobile ? 18 : 28, maxWidth: 460, width: '100%', maxHeight: isMobile ? '90vh' : undefined, overflowY: isMobile ? 'auto' : undefined }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Banknote size={20} style={{ color: 'var(--primary)' }} /> Record Settlement
                            </h3>
                            <button onClick={() => setShowSettleModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)', padding: 4 }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Partner info */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, background: 'linear-gradient(135deg, rgba(244,81,30,0.06), rgba(244,81,30,0.02))', border: '1px solid rgba(244,81,30,0.15)', marginBottom: 24 }}>
                            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(244,81,30,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                {showSettleModal.profilePhotoUrl
                                    ? <img src={showSettleModal.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : <Bike size={22} color="#F4511E" />}
                            </div>
                            <div>
                                <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>{showSettleModal.fullName}</p>
                                <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>{showSettleModal.phoneNumber}</span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#F59E0B' }}>
                                        Pending: {fmt(showSettleModal.codPending)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Tamper-proof notice */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)', marginBottom: 20, fontSize: '0.72rem', color: '#3B82F6' }}>
                            <Shield size={14} />
                            <span>Amount verified against order records. Cannot exceed actual pending.</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, display: 'block' }}>Settlement Amount</label>
                                <div style={{ position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)', fontWeight: 600 }}>₹</span>
                                    <input type="number" value={settleAmount}
                                        onChange={e => setSettleAmount(Number(e.target.value))}
                                        max={showSettleModal.codPending}
                                        style={{ ...fld, paddingLeft: 30, fontWeight: 600, fontSize: '1rem' }} />
                                </div>
                            </div>

                            <div>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, display: 'block' }}>Method</label>
                                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 8 }}>
                                    {['Cash', 'Bank Transfer', 'UPI', 'Admin Override'].map(m => (
                                        <button key={m} onClick={() => setSettleMethod(m)} style={{
                                            padding: isMobile ? '10px 8px' : '8px 6px', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600,
                                            background: settleMethod === m ? 'var(--primary)' : 'var(--surface)',
                                            color: settleMethod === m ? 'white' : 'var(--foreground)',
                                            border: `1px solid ${settleMethod === m ? 'var(--primary)' : 'var(--border)'}`,
                                            cursor: 'pointer', transition: 'all 0.2s',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        }}>
                                            {methodIcons[m]} {m === 'Bank Transfer' ? 'Bank' : m === 'Admin Override' ? 'Override' : m}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, display: 'block' }}>Notes (Optional)</label>
                                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                                    placeholder="Add settlement notes..." rows={2}
                                    style={{ ...fld, resize: 'vertical' }} />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                            <button onClick={() => setShowSettleModal(null)} style={{
                                flex: 1, padding: 12, borderRadius: 12,
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
                            }}>Cancel</button>
                            <button onClick={handleSettle} disabled={processing || settleAmount <= 0} style={{
                                flex: 1, padding: 12, borderRadius: 12,
                                background: 'linear-gradient(135deg, #10B981, #059669)',
                                border: 'none', color: 'white', cursor: processing ? 'not-allowed' : 'pointer',
                                fontWeight: 700, fontSize: '0.88rem',
                                opacity: processing || settleAmount <= 0 ? 0.6 : 1,
                                boxShadow: '0 2px 10px rgba(16,185,129,0.3)',
                            }}>
                                {processing ? 'Processing...' : `Settle ${fmt(settleAmount)}`}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}</AnimatePresence>

            {/* ── Partner Detail Modal ── */}
            <AnimatePresence>{showDetailModal && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={() => setShowDetailModal(null)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                        onClick={e => e.stopPropagation()} className="glass-card" style={{ padding: isMobile ? 18 : 28, maxWidth: 520, width: '100%', maxHeight: isMobile ? '90vh' : '80vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>COD Details — {showDetailModal.fullName}</h3>
                            <button onClick={() => setShowDetailModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)', padding: 4 }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Summary */}
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                            {[
                                { label: 'Collected', value: fmt(showDetailModal.codCollected), color: 'var(--foreground)' },
                                { label: 'Settled', value: fmt(showDetailModal.codSettled), color: '#10B981' },
                                { label: 'Pending', value: fmt(showDetailModal.codPending), color: '#F59E0B' },
                            ].map(s => (
                                <div key={s.label} style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{s.label}</p>
                                    <p style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.value}</p>
                                </div>
                            ))}
                        </div>

                        {/* Partner settlements from history */}
                        <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, fontWeight: 600 }}>
                            Settlement History for this Partner
                        </p>
                        {data?.recentSettlements?.filter(s => s.deliveryPersonId === showDetailModal.deliveryPersonId).length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', padding: '16px 0', textAlign: 'center' }}>No settlements yet</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {data?.recentSettlements?.filter(s => s.deliveryPersonId === showDetailModal.deliveryPersonId).map(s => (
                                    <div key={s.settlementId} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '10px 14px', borderRadius: 10,
                                        background: s.status === 'voided' ? 'rgba(239,68,68,0.04)' : 'var(--surface)',
                                        border: `1px solid ${s.status === 'voided' ? 'rgba(239,68,68,0.15)' : 'var(--border)'}`,
                                        opacity: s.status === 'voided' ? 0.6 : 1,
                                    }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ fontWeight: 600, fontSize: '0.88rem', color: s.status === 'voided' ? '#EF4444' : '#10B981' }}>
                                                    {fmt(s.amount)}
                                                </span>
                                                <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 100, background: s.processedBy === 'delivery_app' ? 'rgba(99,102,241,0.08)' : 'rgba(244,81,30,0.08)', color: s.processedBy === 'delivery_app' ? '#6366F1' : '#F4511E', fontWeight: 500 }}>
                                                    {s.processedBy === 'delivery_app' ? '📱 Razorpay' : `🖥️ ${s.method}`}
                                                </span>
                                                {s.status === 'voided' && <span style={{ fontSize: '0.65rem', color: '#EF4444', fontWeight: 600 }}>VOIDED</span>}
                                            </div>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                                {s.receiptId} • {s.ordersCount} orders • {fmtDate(s.createdAt)}
                                            </p>
                                        </div>
                                        <div style={{
                                            width: 24, height: 24, borderRadius: 6,
                                            background: s.status === 'completed' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            {s.status === 'completed' ? <CheckCircle2 size={14} color="#10B981" /> : <XCircle size={14} color="#EF4444" />}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {showDetailModal.codPending > 0 && (
                            <button onClick={() => { setShowDetailModal(null); openSettle(showDetailModal); }}
                                style={{
                                    width: '100%', padding: 12, marginTop: 20, borderRadius: 12,
                                    background: 'linear-gradient(135deg, #10B981, #059669)',
                                    color: 'white', border: 'none', cursor: 'pointer',
                                    fontWeight: 700, fontSize: '0.88rem',
                                    boxShadow: '0 2px 10px rgba(16,185,129,0.3)',
                                }}>
                                Settle {fmt(showDetailModal.codPending)} Now
                            </button>
                        )}
                    </motion.div>
                </motion.div>
            )}</AnimatePresence>
        </motion.div>
    );
}

