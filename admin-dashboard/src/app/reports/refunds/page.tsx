'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    RotateCcw, RefreshCw, Download, IndianRupee,
    Filter, ChevronDown, User, AlertTriangle,
    CheckCircle, Clock, XCircle, Store, TrendingDown, Loader2
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import { useApi } from '@/hooks/useApi';

interface RefundEntry {
    orderId: string;
    vendorId: string;
    vendorName: string;
    customerId: string;
    customerName: string;
    orderDate: string;
    refundDate: string | null;
    orderTotal: number;
    refundAmount: number;
    refundReason: string;
    refundStatus: string;
    paymentMode: string;
    cancellationReason: string;
    cancelledBy: string;
}

interface MonthlyRefund {
    month: string;
    monthKey: string;
    count: number;
    totalRefundAmount: number;
    cancelledByCustomer: number;
    cancelledByVendor: number;
    cancelledBySystem: number;
}

interface RefundReportData {
    entries: RefundEntry[];
    monthlyData: MonthlyRefund[];
    summary: {
        totalRefunds: number;
        totalRefundAmount: number;
        pendingRefunds: number;
        completedRefunds: number;
        cancelledByCustomer: number;
        cancelledByVendor: number;
        cancelledBySystem: number;
        onlineRefunds: number;
        codCancellations: number;
    };
}

function StatCard({ title, value, subtitle, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; subtitle?: string;
    icon: React.ElementType; color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const colorMap = {
        primary: { bg: 'rgba(244, 81, 30, 0.15)', text: '#F4511E' },
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
                    {subtitle && <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{subtitle}</p>}
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: colorMap[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={colorMap[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

const COLORS = ['#F4511E', '#FF9904', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'];

const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: 'var(--shadow-md)',
    fontSize: '0.8125rem',
    padding: '10px 14px',
};

export default function RefundReportPage() {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [appliedStart, setAppliedStart] = useState('');
    const [appliedEnd, setAppliedEnd] = useState('');
    const [showDateFilter, setShowDateFilter] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'refunded' | 'cancelled'>('all');

    const buildEndpoint = (s: string, e: string, status: string) => {
        const params = new URLSearchParams();
        if (s) params.set('startDate', s);
        if (e) params.set('endDate', e);
        if (status && status !== 'all') params.set('status', status);
        const q = params.toString();
        return `/api/reports/refunds${q ? '?' + q : ''}`;
    };

    const [endpoint, setEndpoint] = useState(() => buildEndpoint('', '', 'all'));
    const { data, loading, refetch } = useApi<RefundReportData>(endpoint);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<'summary' | 'monthly' | 'transactions'>('summary');

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const applyFilter = () => {
        setAppliedStart(startDate);
        setAppliedEnd(endDate);
        setEndpoint(buildEndpoint(startDate, endDate, statusFilter));
        setShowDateFilter(false);
    };

    const clearFilter = () => {
        setStartDate(''); setEndDate('');
        setAppliedStart(''); setAppliedEnd('');
        setStatusFilter('all');
        setEndpoint(buildEndpoint('', '', 'all'));
        setShowDateFilter(false);
    };

    const isFiltered = !!(appliedStart || appliedEnd || statusFilter !== 'all');

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 1 }).format(amount);

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const chartData = useMemo(() => {
        if (!data?.monthlyData) return [];
        return data.monthlyData.slice(0, 12).reverse().map(m => ({
            name: m.month.split(' ')[0].slice(0, 3),
            count: m.count,
            amount: Math.round(m.totalRefundAmount),
        }));
    }, [data]);

    const pieData = useMemo(() => {
        if (!data?.summary) return [];
        return [
            { name: 'By Customer', value: data.summary.cancelledByCustomer },
            { name: 'By Vendor', value: data.summary.cancelledByVendor },
            { name: 'By System', value: data.summary.cancelledBySystem },
        ].filter(d => d.value > 0);
    }, [data]);

    const downloadCSV = () => {
        if (!data?.entries) return;
        const headers = ['Order ID', 'Customer', 'Vendor', 'Order Date', 'Refund Date', 'Order Total', 'Refund Amount', 'Payment Mode', 'Cancelled By', 'Cancellation Reason', 'Refund Status'];
        const rows = data.entries.map(e => [
            e.orderId, e.customerName, e.vendorName,
            formatDate(e.orderDate), formatDate(e.refundDate),
            e.orderTotal.toFixed(2), e.refundAmount.toFixed(2),
            e.paymentMode, e.cancelledBy,
            `"${(e.cancellationReason || '').replace(/"/g, "'")}"`,
            e.refundStatus,
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `refund-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getStatusBadge = (status: string) => {
        const s = status.toLowerCase();
        if (s === 'refunded') return { bg: 'rgba(16,185,129,0.15)', color: '#10B981', icon: CheckCircle, label: 'Refunded' };
        if (s === 'pending') return { bg: 'rgba(245,158,11,0.15)', color: '#F59E0B', icon: Clock, label: 'Pending' };
        return { bg: 'rgba(239,68,68,0.15)', color: '#EF4444', icon: XCircle, label: status };
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Refund Report</h1>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>

            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
                        <RotateCcw size={26} style={{ marginRight: 10, verticalAlign: 'middle', color: 'var(--primary)' }} />
                        Refund Report
                    </h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Track cancelled orders and refund transactions
                    </p>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Filter Dropdown */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowDateFilter(v => !v)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10,
                                background: isFiltered ? 'rgba(244,81,30,0.12)' : 'var(--surface)',
                                color: isFiltered ? 'var(--primary)' : 'var(--foreground)',
                                border: `1px solid ${isFiltered ? 'var(--primary)' : 'var(--border)'}`,
                                cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem'
                            }}
                        >
                            <Filter size={16} />
                            {isFiltered
                                ? `${appliedStart || 'Start'} → ${appliedEnd || 'End'}${statusFilter !== 'all' ? ` · ${statusFilter}` : ''}`
                                : 'Filter'}
                            <ChevronDown size={14} />
                        </button>

                        {showDateFilter && (
                            <div style={{
                                position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50,
                                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                                padding: 16, boxShadow: 'var(--shadow-md)', minWidth: 290,
                                display: 'flex', flexDirection: 'column', gap: 12
                            }}>
                                <p style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>Filter Options</p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>Status</label>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {(['all', 'cancelled', 'refunded'] as const).map(s => (
                                            <button key={s} onClick={() => setStatusFilter(s)} style={{
                                                flex: 1, padding: '6px 8px', borderRadius: 8, fontSize: '0.78rem',
                                                background: statusFilter === s ? 'var(--primary)' : 'var(--background)',
                                                color: statusFilter === s ? 'white' : 'var(--foreground)',
                                                border: `1px solid ${statusFilter === s ? 'var(--primary)' : 'var(--border)'}`,
                                                cursor: 'pointer', fontWeight: 500, textTransform: 'capitalize'
                                            }}>{s}</button>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>Start Date</label>
                                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                        style={{ padding: '7px 10px', borderRadius: 8, fontSize: '0.85rem', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', outline: 'none' }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>End Date</label>
                                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                                        style={{ padding: '7px 10px', borderRadius: 8, fontSize: '0.85rem', border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)', outline: 'none' }} />
                                </div>

                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {[
                                        { label: 'This Month', fn: () => { const n = new Date(); setStartDate(new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0]); setEndDate(n.toISOString().split('T')[0]); } },
                                        { label: 'Last Month', fn: () => { const n = new Date(); setStartDate(new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString().split('T')[0]); setEndDate(new Date(n.getFullYear(), n.getMonth(), 0).toISOString().split('T')[0]); } },
                                        { label: 'Last 3M', fn: () => { const n = new Date(); const s = new Date(n); s.setMonth(s.getMonth() - 3); setStartDate(s.toISOString().split('T')[0]); setEndDate(n.toISOString().split('T')[0]); } },
                                        { label: 'This Year', fn: () => { const n = new Date(); setStartDate(`${n.getFullYear()}-01-01`); setEndDate(n.toISOString().split('T')[0]); } },
                                    ].map(p => (
                                        <button key={p.label} onClick={p.fn} style={{
                                            padding: '4px 10px', borderRadius: 6, fontSize: '0.75rem',
                                            background: 'rgba(244,81,30,0.08)', color: 'var(--primary)',
                                            border: '1px solid rgba(244,81,30,0.2)', cursor: 'pointer', fontWeight: 500
                                        }}>{p.label}</button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={clearFilter} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: '0.85rem', background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500 }}>Clear</button>
                                    <button onClick={applyFilter} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: '0.85rem', background: 'var(--primary)', border: 'none', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Apply</button>
                                </div>
                            </div>
                        )}
                    </div>

                    <button onClick={downloadCSV} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--surface)', color: 'var(--foreground)', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' }}>
                        <Download size={16} /> Export CSV
                    </button>
                    <button onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem' }}>
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* Summary Cards Row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <StatCard title="Total Cancellations" value={data?.summary.totalRefunds || 0} subtitle="Cancelled orders" icon={XCircle} color="error" />
                <StatCard title="Total Refund Amount" value={formatCurrency(data?.summary.totalRefundAmount || 0)} subtitle="Across all refunds" icon={IndianRupee} color="primary" />
                <StatCard title="Completed Refunds" value={data?.summary.completedRefunds || 0} subtitle="Successfully refunded" icon={CheckCircle} color="success" />
                <StatCard title="Pending Refunds" value={data?.summary.pendingRefunds || 0} subtitle="Awaiting refund" icon={Clock} color="warning" />
            </div>

            {/* Summary Cards Row 2 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <StatCard title="By Customer" value={data?.summary.cancelledByCustomer || 0} subtitle="Customer-initiated" icon={User} color="warning" />
                <StatCard title="By Vendor" value={data?.summary.cancelledByVendor || 0} subtitle="Vendor-initiated" icon={Store} color="error" />
                <StatCard title="Online Refunds" value={data?.summary.onlineRefunds || 0} subtitle="Online payment orders" icon={TrendingDown} color="primary" />
                <StatCard title="COD Cancellations" value={data?.summary.codCancellations || 0} subtitle="Cash on delivery" icon={AlertTriangle} color="success" />
            </div>

            {/* Tabs */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {(['summary', 'monthly', 'transactions'] as const).map(t => (
                        <button key={t} onClick={() => setActiveTab(t)} style={{
                            flex: 1, padding: '14px 16px', fontSize: '0.85rem', fontWeight: 500,
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            borderBottom: `2px solid ${activeTab === t ? 'var(--primary)' : 'transparent'}`,
                            color: activeTab === t ? 'var(--primary)' : 'var(--foreground-secondary)',
                            transition: 'all 0.2s'
                        }}>
                            {t === 'summary' ? 'Overview' : t === 'monthly' ? 'Monthly Breakdown' : 'All Refunds'}
                        </button>
                    ))}
                </div>

                <div style={{ padding: 20 }}>

                    {/* Overview Tab */}
                    {activeTab === 'summary' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                            <div>
                                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Monthly Cancellations & Refunds</h3>
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={v => `₹${v}`} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Legend />
                                        <Bar yAxisId="left" dataKey="count" name="Cancellations" fill="#EF4444" radius={[4, 4, 0, 0]} />
                                        <Bar yAxisId="right" dataKey="amount" name="Refund (₹)" fill="#F4511E" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <div>
                                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Cancellations by Source</h3>
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                                            label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                                            {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Orders']} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Monthly Tab */}
                    {activeTab === 'monthly' && (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Month</th>
                                        <th style={{ textAlign: 'right' }}>Cancellations</th>
                                        <th style={{ textAlign: 'right' }}>Refund Amount</th>
                                        <th style={{ textAlign: 'right' }}>By Customer</th>
                                        <th style={{ textAlign: 'right' }}>By Vendor</th>
                                        <th style={{ textAlign: 'right' }}>By System</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.monthlyData.map(m => (
                                        <tr key={m.monthKey}>
                                            <td style={{ fontWeight: 500 }}>{m.month}</td>
                                            <td style={{ textAlign: 'right' }}>{m.count}</td>
                                            <td style={{ textAlign: 'right', color: '#EF4444', fontWeight: 600 }}>{formatCurrency(m.totalRefundAmount)}</td>
                                            <td style={{ textAlign: 'right' }}>{m.cancelledByCustomer}</td>
                                            <td style={{ textAlign: 'right' }}>{m.cancelledByVendor}</td>
                                            <td style={{ textAlign: 'right' }}>{m.cancelledBySystem}</td>
                                        </tr>
                                    ))}
                                    {(!data?.monthlyData || data.monthlyData.length === 0) && (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>No data available</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Transactions Tab */}
                    {activeTab === 'transactions' && (
                        <div style={{ overflowX: 'auto' }}>
                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginBottom: 12 }}>
                                Showing {data?.entries.length || 0} records
                            </p>
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Customer</th>
                                        <th>Vendor</th>
                                        <th>Order Date</th>
                                        <th style={{ textAlign: 'right' }}>Order Total</th>
                                        <th style={{ textAlign: 'right' }}>Refund Amount</th>
                                        <th>Payment</th>
                                        <th>Cancelled By</th>
                                        <th>Status</th>
                                        <th>Reason</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.entries.map(e => {
                                        const badge = getStatusBadge(e.refundStatus);
                                        const BadgeIcon = badge.icon;
                                        return (
                                            <tr key={e.orderId}>
                                                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{e.orderId.slice(0, 8)}…</td>
                                                <td style={{ fontWeight: 500 }}>{e.customerName}</td>
                                                <td style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)' }}>{e.vendorName}</td>
                                                <td style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>{formatDate(e.orderDate)}</td>
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(e.orderTotal)}</td>
                                                <td style={{ textAlign: 'right', color: '#EF4444', fontWeight: 600 }}>{formatCurrency(e.refundAmount)}</td>
                                                <td>
                                                    <span style={{
                                                        padding: '3px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 500,
                                                        background: e.paymentMode === 'COD' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                                                        color: e.paymentMode === 'COD' ? '#F59E0B' : '#10B981'
                                                    }}>{e.paymentMode}</span>
                                                </td>
                                                <td style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>{e.cancelledBy || '—'}</td>
                                                <td>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 500, background: badge.bg, color: badge.color }}>
                                                        <BadgeIcon size={11} />
                                                        {badge.label}
                                                    </span>
                                                </td>
                                                <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                    {e.cancellationReason || '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {(!data?.entries || data.entries.length === 0) && (
                                        <tr><td colSpan={10} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>No refund records found</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}

