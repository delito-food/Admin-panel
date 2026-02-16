'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    RefreshCw, Search, CheckCircle2, XCircle, Clock,
    Package, CreditCard, IndianRupee, Loader2, Filter
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface Refund {
    refundId: string;
    orderId: string;
    complaintId: string;
    customerId: string;
    customerName: string;
    customerEmail: string;
    amount: number;
    originalAmount: number;
    razorpayPaymentId: string;
    razorpayRefundId: string;
    status: string;
    reason: string;
    refundType: string;
    processedBy: string;
    createdAt: string;
    processedAt: string;
    notes: string;
}

interface RefundData {
    refunds: Refund[];
    summary: {
        totalRefunds: number;
        totalAmount: number;
        pending: number;
        successful: number;
        failed: number;
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

export default function RefundsPage() {
    const { data, loading, refetch } = useApi<RefundData>('/api/refunds');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [filterStatus, setFilterStatus] = useState('');

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const filteredRefunds = data?.refunds
        ?.filter(r => {
            const matchesSearch =
                r.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.orderId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.razorpayRefundId?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = !filterStatus || r.status === filterStatus;
            return matchesSearch && matchesStatus;
        }) || [];

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Refunds</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading refund data...</p>
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
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Refunds</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Track and manage order refunds</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 10,
                        background: 'var(--primary)', color: 'white',
                        border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer',
                        opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem',
                        transition: 'all 0.2s'
                    }}
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <StatCard title="Total Refunds" value={data?.summary.totalRefunds || 0} icon={IndianRupee} color="primary" />
                <StatCard title="Amount Refunded" value={formatCurrency(data?.summary.totalAmount || 0)} icon={CreditCard} color="success" />
                <StatCard title="Pending" value={data?.summary.pending || 0} icon={Clock} color="warning" />
                <StatCard title="Successful" value={data?.summary.successful || 0} icon={CheckCircle2} color="success" />
                <StatCard title="Failed" value={data?.summary.failed || 0} icon={XCircle} color="error" />
            </div>

            {/* Table */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                {/* Search & Filter */}
                <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 400 }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search by name, order ID, or refund ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%', padding: '8px 12px 8px 36px',
                                borderRadius: 10, border: '1px solid var(--border)',
                                background: 'var(--surface)', color: 'var(--foreground)',
                                fontSize: '0.8rem', outline: 'none',
                            }}
                        />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <Filter size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)', pointerEvents: 'none' }} />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            style={{
                                padding: '8px 12px 8px 30px', borderRadius: 10,
                                border: '1px solid var(--border)',
                                background: 'var(--surface)', color: 'var(--foreground)',
                                fontSize: '0.8rem', outline: 'none', cursor: 'pointer',
                            }}
                        >
                            <option value="">All Status</option>
                            <option value="SUCCESS">Success</option>
                            <option value="PENDING">Pending</option>
                            <option value="FAILED">Failed</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>Order ID</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th style={{ textAlign: 'center' }}>Type</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                                <th>Razorpay ID</th>
                                <th>Reason</th>
                                <th>Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRefunds.length === 0 ? (
                                <tr>
                                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <Package size={36} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                        <p>No refunds found</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredRefunds.map((refund) => (
                                    <tr key={refund.refundId}>
                                        <td>
                                            <div>
                                                <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{refund.customerName}</p>
                                                <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{refund.customerEmail}</p>
                                            </div>
                                        </td>
                                        <td>
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', padding: '2px 6px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                                #{refund.orderId.slice(-8).toUpperCase()}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <p style={{ fontWeight: 600, fontSize: '0.85rem', color: '#10B981' }}>{formatCurrency(refund.amount)}</p>
                                            {refund.originalAmount !== refund.amount && (
                                                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>
                                                    of {formatCurrency(refund.originalAmount)}
                                                </p>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{
                                                display: 'inline-block', padding: '3px 8px', borderRadius: 100,
                                                fontSize: '0.7rem', fontWeight: 500,
                                                background: refund.refundType === 'full' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                                                color: refund.refundType === 'full' ? '#10B981' : '#F59E0B',
                                            }}>
                                                {refund.refundType === 'full' ? 'Full' : 'Partial'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span className={`badge ${refund.status === 'SUCCESS' ? 'badge-approved' :
                                                    refund.status === 'PENDING' ? 'badge-pending' :
                                                        'badge-rejected'
                                                }`} style={{ fontSize: '0.7rem' }}>
                                                {refund.status}
                                            </span>
                                        </td>
                                        <td>
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                                {refund.razorpayRefundId || '-'}
                                            </span>
                                        </td>
                                        <td style={{ maxWidth: 150 }}>
                                            <p style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground-secondary)' }}>
                                                {refund.reason || '-'}
                                            </p>
                                        </td>
                                        <td>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                                {formatDate(refund.createdAt)}
                                            </span>
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
