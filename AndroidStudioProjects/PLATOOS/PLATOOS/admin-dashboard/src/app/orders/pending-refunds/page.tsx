'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    RefreshCw, IndianRupee, AlertTriangle, Clock,
    CheckCircle2, XCircle, User, Phone, Loader2, Package
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface PendingRefund {
    orderId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    total: number;
    status: string;
    razorpayPaymentId: string;
    refundStatus: string;
    cancelledAt: string | null;
    cancellationReason: string;
    cancelledBy: string;
}

interface PendingRefundsData {
    pendingRefunds: PendingRefund[];
    summary: {
        totalPendingRefunds: number;
        totalAmount: number;
        cancelled: number;
        notResponded: number;
    };
}

function StatCard({ title, value, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; icon: React.ElementType;
    color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const colorMap = {
        primary: { bg: 'rgba(40, 137, 144, 0.15)', text: '#288990' },
        success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
        warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
        error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
    };
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{title}</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: colorMap[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={colorMap[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

export default function PendingRefundsPage() {
    const { data, loading, refetch } = useApi<PendingRefundsData>('/api/payouts');
    const [refreshing, setRefreshing] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const processRefund = async (refund: PendingRefund) => {
        if (!refund.razorpayPaymentId) {
            alert('No Razorpay Payment ID found. This order may not have been paid online.');
            return;
        }

        setProcessingId(refund.orderId);
        try {
            const response = await fetch('/api/refunds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: refund.orderId,
                    amount: refund.total,
                    reason: refund.cancellationReason || `Order ${refund.status.toLowerCase()} - automatic refund`,
                    refundType: 'full',
                }),
            });
            const result = await response.json();
            if (result.success) {
                await refetch();
                alert(`Refund of ${formatCurrency(refund.total)} processed successfully!`);
            } else {
                alert(result.error || 'Failed to process refund');
            }
        } catch {
            alert('Failed to process refund');
        }
        setProcessingId(null);
    };

    const processAllRefunds = async () => {
        if (!data?.pendingRefunds.length) return;
        const refundsWithPaymentId = data.pendingRefunds.filter(r => r.razorpayPaymentId);
        if (refundsWithPaymentId.length === 0) {
            alert('No refunds with valid payment IDs to process');
            return;
        }
        if (!confirm(`Process ${refundsWithPaymentId.length} refunds totaling ${formatCurrency(refundsWithPaymentId.reduce((sum, r) => sum + r.total, 0))}?`)) {
            return;
        }
        let successCount = 0;
        let failCount = 0;
        for (const refund of refundsWithPaymentId) {
            try {
                const response = await fetch('/api/refunds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderId: refund.orderId,
                        amount: refund.total,
                        reason: refund.cancellationReason || `Order ${refund.status.toLowerCase()} - automatic refund`,
                        refundType: 'full',
                    }),
                });
                const result = await response.json();
                if (result.success) successCount++;
                else failCount++;
            } catch {
                failCount++;
            }
        }
        await refetch();
        alert(`Processed ${successCount} refunds successfully. ${failCount} failed.`);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Pending Refunds</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading pending refunds...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}
        >
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Pending Refunds</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Process refunds for cancelled and unresponded orders</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 10,
                            background: 'var(--surface)', color: 'var(--foreground)',
                            border: '1px solid var(--border)', cursor: refreshing ? 'not-allowed' : 'pointer',
                            opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.85rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                    {(data?.pendingRefunds.length ?? 0) > 0 && (
                        <button
                            onClick={processAllRefunds}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '8px 16px', borderRadius: 10,
                                background: 'var(--primary)', color: 'white',
                                border: 'none', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.85rem',
                                transition: 'all 0.2s'
                            }}
                        >
                            <IndianRupee size={16} />
                            Process All Refunds
                        </button>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <StatCard title="Pending Refunds" value={data?.summary.totalPendingRefunds || 0} icon={Clock} color="warning" />
                <StatCard title="Total Amount" value={formatCurrency(data?.summary.totalAmount || 0)} icon={IndianRupee} color="primary" />
                <StatCard title="Cancelled" value={data?.summary.cancelled || 0} icon={XCircle} color="error" />
                <StatCard title="Not Responded" value={data?.summary.notResponded || 0} icon={AlertTriangle} color="warning" />
            </div>

            {/* Table */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium">
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Customer</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                                <th>Reason</th>
                                <th>Cancelled At</th>
                                <th style={{ textAlign: 'center' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!data?.pendingRefunds.length ? (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <CheckCircle2 size={36} style={{ margin: '0 auto 8px', color: '#10B981' }} />
                                        <p style={{ fontWeight: 500 }}>No pending refunds!</p>
                                        <p style={{ fontSize: '0.8rem', marginTop: 4 }}>All cancelled orders have been refunded.</p>
                                    </td>
                                </tr>
                            ) : (
                                data.pendingRefunds.map((refund) => (
                                    <tr key={refund.orderId}>
                                        <td>
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '2px 6px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                                #{refund.orderId.slice(-8).toUpperCase()}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{
                                                    width: 32, height: 32, borderRadius: 8,
                                                    background: 'rgba(40,137,144,0.1)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                                }}>
                                                    <User size={14} color="#288990" />
                                                </div>
                                                <div>
                                                    <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{refund.customerName}</p>
                                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                        <Phone size={10} /> {refund.customerPhone || 'N/A'}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#EF4444' }}>{formatCurrency(refund.total)}</span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span className={`badge ${refund.status.toLowerCase() === 'cancelled' ? 'badge-rejected' :
                                                    refund.status.toLowerCase() === 'not_responded' ? 'badge-pending' : ''
                                                }`} style={{ fontSize: '0.7rem' }}>
                                                {refund.status.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td style={{ maxWidth: 200 }}>
                                            <p style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground-secondary)' }}>
                                                {refund.cancellationReason || 'No reason provided'}
                                            </p>
                                            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>By: {refund.cancelledBy || 'N/A'}</p>
                                        </td>
                                        <td>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                                {formatDate(refund.cancelledAt)}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                onClick={() => processRefund(refund)}
                                                disabled={processingId === refund.orderId || !refund.razorpayPaymentId}
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    padding: '5px 12px', borderRadius: 8,
                                                    background: refund.razorpayPaymentId ? '#10B981' : 'var(--surface)',
                                                    color: refund.razorpayPaymentId ? 'white' : 'var(--foreground-secondary)',
                                                    border: refund.razorpayPaymentId ? 'none' : '1px solid var(--border)',
                                                    cursor: refund.razorpayPaymentId ? (processingId === refund.orderId ? 'not-allowed' : 'pointer') : 'not-allowed',
                                                    fontSize: '0.75rem', fontWeight: 600,
                                                    opacity: processingId === refund.orderId ? 0.6 : 1,
                                                    transition: 'all 0.2s',
                                                }}
                                            >
                                                {processingId === refund.orderId ? (
                                                    <><Loader2 size={13} className="animate-spin" /> Processing...</>
                                                ) : refund.razorpayPaymentId ? (
                                                    <><IndianRupee size={13} /> Refund</>
                                                ) : (
                                                    'No Payment ID'
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </motion.div>
        </motion.div>
    );
}
