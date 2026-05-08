'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    RefreshCw, Search, AlertTriangle, CheckCircle2, XCircle,
    Clock, IndianRupee, Loader2, Eye, Zap, ShieldAlert,
    CreditCard, TrendingUp, Activity, Filter
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { authenticatedFetch } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface Transaction {
    id: string;
    type: string;
    orderId?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpayRefundId?: string;
    razorpayPayoutId?: string;
    amount?: number;
    status?: string;
    method?: string;
    errorCode?: string;
    errorDescription?: string;
    flagged?: boolean;
    createdAt: string;
}

interface TransactionData {
    transactions: Transaction[];
    summary: {
        total: number;
        captured: number;
        failed: number;
        refunded: number;
        flagged: number;
        verificationFailed: number;
    };
}

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
    payment_captured:     { label: 'Captured',         color: '#10B981', bg: 'rgba(16,185,129,0.12)',  icon: CheckCircle2 },
    payment_authorized:   { label: 'Authorized',       color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  icon: Clock },
    payment_failed:       { label: 'Failed',           color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   icon: XCircle },
    payment_verified:     { label: 'Verified',         color: '#6366F1', bg: 'rgba(99,102,241,0.12)',  icon: ShieldAlert },
    verification_failed:  { label: 'Sig. Mismatch!',   color: '#DC2626', bg: 'rgba(220,38,38,0.15)',   icon: AlertTriangle },
    order_created:        { label: 'Order Created',    color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)',  icon: CreditCard },
    refund_processed:     { label: 'Refund Done',      color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)',  icon: TrendingUp },
    refund_failed:        { label: 'Refund Failed',    color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   icon: XCircle },
    payout_processed:     { label: 'Payout Done',      color: '#10B981', bg: 'rgba(16,185,129,0.12)',  icon: CheckCircle2 },
    payout_reversed:      { label: 'Payout Reversed',  color: '#F97316', bg: 'rgba(249,115,22,0.12)',  icon: AlertTriangle },
};

function StatCard({ title, value, icon: Icon, color = '#F4511E', subtitle }: {
    title: string; value: string | number; icon: React.ElementType; color?: string; subtitle?: string;
}) {
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{title}</p>
                    <p style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                    {subtitle && <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{subtitle}</p>}
                </div>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={color} />
                </div>
            </div>
        </motion.div>
    );
}

export default function PaymentsPage() {
    const [typeFilter, setTypeFilter] = useState('');
    const [flaggedOnly, setFlaggedOnly] = useState(false);
    const [search, setSearch] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [healthStatus, setHealthStatus] = useState<{
        razorpayKeyId: boolean; razorpayKeySecret: boolean; keyPrefix: string;
        apiReachable: boolean; apiMode: string; pendingManualRefunds: number;
        fakeSuccessRefunds: number; message: string;
    } | null>(null);
    const [healthLoading, setHealthLoading] = useState(false);

    const queryParams = new URLSearchParams({ limit: '200' });
    if (typeFilter) queryParams.set('type', typeFilter);
    if (flaggedOnly) queryParams.set('flagged', 'true');

    const { data, loading, refetch } = useApi<TransactionData>(`/api/payments/transactions?${queryParams}`);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const handleHealthCheck = async () => {
        setHealthLoading(true);
        try {
            const res = await authenticatedFetch('/api/refunds', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'health_check' }),
            });
            const result = await res.json();
            if (result.success) setHealthStatus(result.health);
            else alert(result.error || 'Health check failed');
        } catch { alert('Failed to check Razorpay health'); }
        setHealthLoading(false);
    };

    const handleRetryRefund = async (refundId: string) => {
        if (!confirm('This will attempt to process the refund via Razorpay. Continue?')) return;
        setActionLoading(refundId);
        try {
            const res = await authenticatedFetch('/api/refunds', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'retry', refundId }),
            });
            const result = await res.json();
            if (result.success) { alert(result.message); await refetch(); }
            else alert(result.error || 'Retry failed');
        } catch { alert('Retry failed'); }
        setActionLoading(null);
    };

    const handleCapture = async (txn: Transaction) => {
        if (!txn.razorpayPaymentId || !txn.amount) return;
        if (!confirm(`Capture payment ${txn.razorpayPaymentId} for ₹${txn.amount}?`)) return;
        setActionLoading(txn.id);
        try {
            const res = await authenticatedFetch('/api/payments/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'capture', razorpayPaymentId: txn.razorpayPaymentId, amount: txn.amount }),
            });
            const result = await res.json();
            if (result.success) { alert('Payment captured successfully!'); await refetch(); }
            else alert(result.error || 'Capture failed');
        } catch { alert('Failed to capture payment'); }
        setActionLoading(null);
    };

    const handleFetchStatus = async (txn: Transaction) => {
        if (!txn.razorpayPaymentId) return;
        setActionLoading(txn.id);
        try {
            const res = await authenticatedFetch('/api/payments/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'fetch_status', razorpayPaymentId: txn.razorpayPaymentId }),
            });
            const result = await res.json();
            if (result.success) {
                const d = result.data;
                alert(`Payment: ${d.id}\nStatus: ${d.status}\nAmount: ₹${(d.amount / 100).toFixed(2)}\nMethod: ${d.method || 'N/A'}\nEmail: ${d.email || 'N/A'}`);
            } else alert(result.error || 'Fetch failed');
        } catch { alert('Failed to fetch status'); }
        setActionLoading(null);
    };

    const filtered = (data?.transactions || []).filter(t => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (t.razorpayPaymentId || '').toLowerCase().includes(q)
            || (t.orderId || '').toLowerCase().includes(q)
            || (t.razorpayOrderId || '').toLowerCase().includes(q)
            || (t.razorpayRefundId || '').toLowerCase().includes(q)
            || (t.type || '').toLowerCase().includes(q);
    });

    const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
    const fmtDate = (s: string) => s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>

            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Payment Transactions</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Monitor all Razorpay payments, refunds and payouts
                    </p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 10,
                    background: 'var(--primary)', color: 'white',
                    border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer',
                    opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem',
                }}>
                    <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                <button onClick={handleHealthCheck} disabled={healthLoading} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 10,
                    background: 'var(--card)', color: 'var(--foreground)',
                    border: '1px solid var(--border)',
                    cursor: healthLoading ? 'not-allowed' : 'pointer',
                    fontWeight: 500, fontSize: '0.875rem',
                }}>
                    {healthLoading ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />}
                    Razorpay Health
                </button>
            </div>

            {/* Razorpay Health Status Banner */}
            {healthStatus && (
                <div style={{
                    background: healthStatus.apiReachable ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${healthStatus.apiReachable ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    borderRadius: 12, padding: '14px 18px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        {healthStatus.apiReachable ? <CheckCircle2 size={18} color="#10B981" /> : <XCircle size={18} color="#EF4444" />}
                        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)' }}>
                            {healthStatus.message}
                        </p>
                        <button onClick={() => setHealthStatus(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)', fontSize: '1.2rem' }}>×</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                        <span>Key: <strong>{healthStatus.keyPrefix}</strong></span>
                        <span>Mode: <strong>{healthStatus.apiMode}</strong></span>
                        <span>Key ID: {healthStatus.razorpayKeyId ? '✅' : '❌'}</span>
                        <span>Secret: {healthStatus.razorpayKeySecret ? '✅' : '❌'}</span>
                        {healthStatus.pendingManualRefunds > 0 && (
                            <span style={{ color: '#EF4444', fontWeight: 600 }}>⚠ {healthStatus.pendingManualRefunds} pending manual refund(s)</span>
                        )}
                        {healthStatus.fakeSuccessRefunds > 0 && (
                            <span style={{ color: '#DC2626', fontWeight: 700 }}>🚨 {healthStatus.fakeSuccessRefunds} fake "SUCCESS" refund(s) — customer NOT actually refunded!</span>
                        )}
                    </div>
                </div>
            )}

            {/* Stats */}
            {data?.summary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                    <StatCard title="Total Events"       value={data.summary.total}             icon={Activity}     color="#0EA5E9" />
                    <StatCard title="Captured"           value={data.summary.captured}          icon={CheckCircle2} color="#10B981" />
                    <StatCard title="Failed"             value={data.summary.failed}            icon={XCircle}      color="#EF4444" />
                    <StatCard title="Refunded"           value={data.summary.refunded}          icon={IndianRupee}  color="#8B5CF6" />
                    <StatCard title="Flagged / Suspicious" value={data.summary.flagged}         icon={AlertTriangle} color="#DC2626"
                        subtitle={data.summary.flagged > 0 ? '⚠ Review immediately' : 'All clear'} />
                    <StatCard title="Sig. Failures"      value={data.summary.verificationFailed} icon={ShieldAlert} color="#F97316"
                        subtitle={data.summary.verificationFailed > 0 ? '⚠ Possible tampering' : 'All clear'} />
                </div>
            )}

            {/* Flagged Alert Banner */}
            {(data?.summary?.flagged ?? 0) > 0 && (
                <div style={{
                    background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.35)',
                    borderRadius: 12, padding: '12px 16px',
                    display: 'flex', alignItems: 'center', gap: 10,
                }}>
                    <AlertTriangle size={18} color="#DC2626" />
                    <p style={{ margin: 0, fontWeight: 600, color: '#DC2626', fontSize: '0.875rem' }}>
                        {data!.summary.flagged} suspicious transaction(s) detected — possible signature tampering. Review flagged records below.
                    </p>
                    <button onClick={() => setFlaggedOnly(true)} style={{
                        marginLeft: 'auto', padding: '4px 12px', borderRadius: 8,
                        background: '#DC2626', color: 'white', border: 'none',
                        cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                    }}>Show Flagged</button>
                </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 220px' }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                    <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search by payment ID, order ID…"
                        style={{
                            width: '100%', paddingLeft: 32, padding: '8px 12px 8px 32px',
                            borderRadius: 10, border: '1px solid var(--border)',
                            background: 'var(--card)', color: 'var(--foreground)', fontSize: '0.875rem',
                        }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Filter size={14} color="var(--foreground-secondary)" />
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{
                        padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)',
                        background: 'var(--card)', color: 'var(--foreground)', fontSize: '0.875rem', cursor: 'pointer',
                    }}>
                        <option value="">All Types</option>
                        {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                        ))}
                    </select>
                </div>
                <button onClick={() => setFlaggedOnly(f => !f)} style={{
                    padding: '8px 14px', borderRadius: 10,
                    background: flaggedOnly ? 'rgba(220,38,38,0.15)' : 'var(--card)',
                    border: `1px solid ${flaggedOnly ? '#DC2626' : 'var(--border)'}`,
                    color: flaggedOnly ? '#DC2626' : 'var(--foreground-secondary)',
                    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    <AlertTriangle size={13} /> Flagged Only
                </button>
                {(typeFilter || flaggedOnly || search) && (
                    <button onClick={() => { setTypeFilter(''); setFlaggedOnly(false); setSearch(''); }} style={{
                        padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)',
                        background: 'transparent', color: 'var(--foreground-secondary)', cursor: 'pointer', fontSize: '0.8rem',
                    }}>Clear Filters</button>
                )}
            </div>

            {/* Table */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
                    <Loader2 className="animate-spin" size={36} style={{ color: 'var(--primary)' }} />
                </div>
            ) : filtered.length === 0 ? (
                <div className="glass-card" style={{ textAlign: 'center', padding: 48 }}>
                    <Activity size={36} style={{ color: 'var(--foreground-secondary)', marginBottom: 12 }} />
                    <p style={{ color: 'var(--foreground-secondary)', margin: 0 }}>No transactions found</p>
                </div>
            ) : (
                <div className="glass-card" style={{ overflow: 'hidden', padding: 0 }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--card-hover, rgba(0,0,0,0.03))' }}>
                                    {['Type', 'Payment / Refund ID', 'Order ID', 'Amount', 'Status / Method', 'Time', 'Actions'].map(h => (
                                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--foreground-secondary)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((txn, i) => {
                                    const cfg = TYPE_CONFIG[txn.type] || { label: txn.type, color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', icon: Activity };
                                    const Icon = cfg.icon;
                                    const isCaptureable = txn.type === 'payment_authorized' && txn.razorpayPaymentId;
                                    const hasFetchable = txn.razorpayPaymentId;
                                    const isLoading = actionLoading === txn.id;
                                    return (
                                        <tr key={txn.id} style={{
                                            borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                                            background: txn.flagged ? 'rgba(220,38,38,0.05)' : undefined,
                                        }}>
                                            <td style={{ padding: '10px 14px' }}>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                                    padding: '3px 8px', borderRadius: 6,
                                                    background: cfg.bg, color: cfg.color, fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap',
                                                }}>
                                                    <Icon size={12} />
                                                    {cfg.label}
                                                    {txn.flagged && <AlertTriangle size={11} color="#DC2626" />}
                                                </span>
                                            </td>
                                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: 'var(--foreground)', fontSize: '0.78rem' }}>
                                                {txn.razorpayPaymentId || txn.razorpayRefundId || txn.razorpayPayoutId || txn.razorpayOrderId || '—'}
                                            </td>
                                            <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: 'var(--foreground-secondary)', fontSize: '0.78rem' }}>
                                                {txn.orderId || '—'}
                                            </td>
                                            <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--foreground)', whiteSpace: 'nowrap' }}>
                                                {txn.amount ? fmt(txn.amount) : '—'}
                                            </td>
                                            <td style={{ padding: '10px 14px', color: 'var(--foreground-secondary)', fontSize: '0.78rem' }}>
                                                {txn.status || txn.method || txn.errorDescription || '—'}
                                            </td>
                                            <td style={{ padding: '10px 14px', color: 'var(--foreground-secondary)', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                                                {fmtDate(txn.createdAt)}
                                            </td>
                                            <td style={{ padding: '10px 14px' }}>
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    {isCaptureable && (
                                                        <button onClick={() => handleCapture(txn)} disabled={isLoading} style={{
                                                            padding: '4px 10px', borderRadius: 7, border: 'none',
                                                            background: '#F59E0B', color: 'white',
                                                            cursor: isLoading ? 'not-allowed' : 'pointer',
                                                            fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                                                        }}>
                                                            {isLoading ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                                                            Capture
                                                        </button>
                                                    )}
                                                    {hasFetchable && (
                                                        <button onClick={() => handleFetchStatus(txn)} disabled={isLoading} style={{
                                                            padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border)',
                                                            background: 'transparent', color: 'var(--foreground-secondary)',
                                                            cursor: isLoading ? 'not-allowed' : 'pointer',
                                                            fontSize: '0.75rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4,
                                                        }}>
                                                            {isLoading ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
                                                            Status
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', color: 'var(--foreground-secondary)', fontSize: '0.78rem' }}>
                        Showing {filtered.length} of {data?.transactions?.length || 0} transactions
                    </div>
                </div>
            )}
        </motion.div>
    );
}



