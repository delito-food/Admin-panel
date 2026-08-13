'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    Filter,
    Eye,
    Clock,
    CheckCircle,
    XCircle,
    Package,
    Truck,
    MapPin,
    Phone,
    User,
    Store,
    X,
    ChevronDown,
    RefreshCw,
    ShoppingBag,
    TrendingUp,
    BarChart3,
    AlertTriangle,
    Loader2,
    Ban,
    FileText,
    Download,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend
} from 'recharts';
import { useApi, Order } from '@/hooks/useApi';
import { authenticatedFetch, downloadAuthenticatedFile } from '@/lib/api-client';

const CHART_COLORS = ['#F4511E', '#FF9904', '#F6D59F', '#10B981', '#E9190C'];

const statusFilters = ['All', 'Pending', 'Accepted', 'Preparing', 'Prepared', 'Sent for delivery', 'Delivered', 'Not Responded', 'Cancelled', 'Cancelled by Admin'];

export default function OrdersPage() {
    const { data: orders, loading, refetch } = useApi<Order[]>('/api/orders');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // Admin cancel state
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const [cancelResult, setCancelResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleAdminCancel = async () => {
        if (!selectedOrder) return;
        setCancelling(true);
        setCancelResult(null);

        try {
            const res = await authenticatedFetch('/api/orders/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: selectedOrder.orderId,
                    reason: cancelReason || 'Cancelled by admin',
                }),
            });

            const result = await res.json();
            if (result.success) {
                setCancelResult({ type: 'success', text: result.message + (result.data?.refundInitiated ? ' — Refund initiated automatically.' : '') });
                setShowCancelModal(false);
                setCancelReason('');
                setSelectedOrder(null);
                refetch();
            } else {
                setCancelResult({ type: 'error', text: result.error || 'Failed to cancel order' });
            }
        } catch {
            setCancelResult({ type: 'error', text: 'Network error' });
        } finally {
            setCancelling(false);
        }
    };

    // Auto-clear cancel result
    useEffect(() => {
        if (cancelResult) {
            const timer = setTimeout(() => setCancelResult(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [cancelResult]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    // Auto-refresh every 90 seconds
    useEffect(() => {
        const interval = setInterval(() => { refetch(); }, 90_000);
        return () => clearInterval(interval);
    }, [refetch]);

    const filteredOrders = (orders || []).filter(order => {
        const matchesSearch =
            (order.orderId || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (order.customerName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (order.vendorName || '').toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus = statusFilter === 'All' || order.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    const getStatusBadge = (status: string) => {
        switch (status.toLowerCase()) {
            case 'delivered':
                return 'badge-approved';
            case 'pending':
            case 'preparing':
                return 'badge-pending';
            case 'cancelled':
            case 'not responded':
                return 'badge-rejected';
            default:
                return 'badge-active';
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status.toLowerCase()) {
            case 'delivered':
                return <CheckCircle size={14} />;
            case 'cancelled':
            case 'not responded':
                return <XCircle size={14} />;
            case 'sent for delivery':
                return <Truck size={14} />;
            case 'preparing':
                return <Package size={14} />;
            default:
                return <Clock size={14} />;
        }
    };

    const getDisplayStatus = (status: string) => {
        switch (status) {
            case 'Preparing': return 'Accepted & Preparing';
            case 'Sent for delivery': return 'Delivery partner assigned';
            default: return status;
        }
    };

    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);

        if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hr ago`;
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Stats
    const stats = {
        total: (orders || []).length,
        pending: (orders || []).filter(o => o.status === 'Pending').length,
        preparing: (orders || []).filter(o => o.status === 'Preparing').length,
        onTheWay: (orders || []).filter(o => o.status === 'Sent for delivery').length,
        delivered: (orders || []).filter(o => o.status === 'Delivered').length,
        notResponded: (orders || []).filter(o => o.status === 'Not Responded').length,
    };

    const orderTrendData = (orders || []).reduce((acc: { date: string; orders: number }[], order) => {
        const date = new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const existing = acc.find(item => item.date === date);
        if (existing) {
            existing.orders += 1;
        } else {
            acc.push({ date, orders: 1 });
        }
        return acc;
    }, []).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-7);

    const statusDistribution = [
        { name: 'Pending', value: stats.pending, color: '#F6D59F' },
        { name: 'Preparing', value: stats.preparing, color: '#FF9904' },
        { name: 'On the Way', value: stats.onTheWay, color: '#F4511E' },
        { name: 'Delivered', value: stats.delivered, color: '#10B981' },
        { name: 'Not Responded', value: stats.notResponded, color: '#E9190C' },
    ].filter(item => item.value > 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center animate-pulse">
                        <RefreshCw className="w-8 h-8 animate-spin text-[var(--primary)]" />
                    </div>
                    <p className="text-[var(--foreground-secondary)] font-medium">Loading orders...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-10">
            {/* Page Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="page-title">Orders</h1>
                    <p className="page-description">Manage and track all orders in real-time</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={async () => {
                            try {
                                await downloadAuthenticatedFile(
                                    '/api/orders?format=xlsx&limit=5000',
                                    `Orders_${new Date().toISOString().slice(0, 10)}.xlsx`
                                );
                            } catch (err) {
                                alert(err instanceof Error ? err.message : 'Export failed');
                            }
                        }}
                        className="btn btn-outline"
                    >
                        <Download size={16} />
                        Export Excel
                    </button>
                    <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1 }}>
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* Stats Section */}
            <section>
                <div className="section-header">
                    <div className="section-title">
                        <div className="icon"><ShoppingBag size={18} /></div>
                        Order Statistics
                    </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-5" style={{ gap: '1.5rem' }}>
                    {[
                        { label: 'Total Orders', value: stats.total, icon: ShoppingBag, color: 'primary' },
                        { label: 'Pending', value: stats.pending, icon: Clock, color: 'warning' },
                        { label: 'Preparing', value: stats.preparing, icon: Package, color: 'warning' },
                        { label: 'On the Way', value: stats.onTheWay, icon: Truck, color: 'primary' },
                        { label: 'Delivered', value: stats.delivered, icon: CheckCircle, color: 'success' },
                    ].map((stat, index) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className={`stat-card-premium ${stat.color === 'success' ? 'accent-success' : stat.color === 'warning' ? 'accent-warning' : ''}`}
                        >
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="stat-label">{stat.label}</p>
                                    <p className="stat-value">{stat.value}</p>
                                </div>
                                <div className={`icon-box ${stat.color}`}>
                                    <stat.icon size={24} className="text-white" />
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* Analytics Section */}
            <section>
                <div className="section-header">
                    <div className="section-title">
                        <div className="icon"><BarChart3 size={18} /></div>
                        Analytics
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Order Trend Chart */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="chart-card lg:col-span-2"
                    >
                        <div className="chart-header">
                            <h3 className="chart-title">Order Trend (Last 7 Days)</h3>
                            <div className="chart-legend">
                                <div className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: 'var(--primary)' }} />
                                    <span>Orders</span>
                                </div>
                            </div>
                        </div>
                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={orderTrendData}>
                                    <defs>
                                        <linearGradient id="orderGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                                            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: 'var(--foreground-secondary)', fontSize: 12 }}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: 'var(--foreground-secondary)', fontSize: 12 }}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '8px',
                                            boxShadow: 'var(--shadow-md)'
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="orders"
                                        stroke="var(--primary)"
                                        strokeWidth={2}
                                        fill="url(#orderGradient)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </motion.div>

                    {/* Status Distribution */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="chart-card"
                    >
                        <div className="chart-header">
                            <h3 className="chart-title">Status Distribution</h3>
                        </div>
                        <div className="h-[200px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={statusDistribution}
                                        innerRadius={50}
                                        outerRadius={70}
                                        paddingAngle={4}
                                        dataKey="value"
                                    >
                                        {statusDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '8px'
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex flex-wrap justify-center gap-3 mt-4">
                            {statusDistribution.map((item) => (
                                <div key={item.name} className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: item.color }} />
                                    <span>{item.name}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* Order List Section */}
            <section>
                <div className="section-header">
                    <div className="section-title">
                        <div className="icon"><Package size={18} /></div>
                        Order List
                        <span className="section-badge">{filteredOrders.length}</span>
                    </div>
                </div>

                {/* Search and Filter */}
                <div className="glass-card p-6" style={{ marginBottom: 32 }}>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="input-group flex-1">
                            <Search size={18} className="input-icon" />
                            <input
                                type="text"
                                placeholder="Search by order ID, customer, or vendor..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="input"
                            />
                        </div>

                        <div className="relative">
                            <button
                                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                                className="btn btn-outline w-full sm:w-auto"
                            >
                                <Filter size={16} />
                                {getDisplayStatus(statusFilter)}
                                <ChevronDown size={16} className={`transition-transform ${showFilterDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {showFilterDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 8 }}
                                        className="absolute right-0 mt-2 w-48 glass-card p-2 z-10"
                                    >
                                        {statusFilters.map((filter) => (
                                            <button
                                                key={filter}
                                                onClick={() => {
                                                    setStatusFilter(filter);
                                                    setShowFilterDropdown(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${statusFilter === filter
                                                    ? 'bg-[var(--primary)] text-white'
                                                    : 'hover:bg-[var(--surface-hover)]'
                                                    }`}
                                            >
                                                {getDisplayStatus(filter)}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Orders Grid */}
                <div className="grid gap-4">
                    <AnimatePresence mode="popLayout">
                        {filteredOrders.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="empty-state glass-card"
                            >
                                <div className="empty-state-icon">
                                    <Package size={32} />
                                </div>
                                <h3 className="empty-state-title">No orders found</h3>
                                <p className="empty-state-description">
                                    Try adjusting your search or filter criteria to find what you're looking for.
                                </p>
                            </motion.div>
                        ) : (
                            filteredOrders.slice(0, 20).map((order, index) => (
                                <motion.div
                                    key={order.orderId}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    transition={{ delay: index * 0.02 }}
                                    className="glass-card p-6 cursor-pointer"
                                    onClick={() => setSelectedOrder(order)}
                                >
                                    <div className="flex items-center justify-between flex-wrap gap-4">
                                        {/* Order Info */}
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
                                                <ShoppingBag size={20} className="text-[var(--primary)]" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-[var(--foreground)]">
                                                    #{order.orderId?.slice(-8).toUpperCase() || 'N/A'}
                                                </p>
                                                <p className="text-sm text-[var(--foreground-secondary)]">
                                                    {formatTime(order.createdAt)}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Customer & Vendor */}
                                        <div className="flex items-center gap-6">
                                            <div className="flex items-center gap-2">
                                                <User size={16} className="text-[var(--foreground-secondary)]" />
                                                <span className="text-sm">{order.customerName || 'Unknown'}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Store size={16} className="text-[var(--foreground-secondary)]" />
                                                <span className="text-sm">{order.vendorName || 'Unknown'}</span>
                                            </div>
                                        </div>

                                        {/* Amount & Status */}
                                        <div className="flex items-center gap-4">
                                            <span className="font-semibold text-[var(--foreground)]">
                                                ₹{order.total?.toLocaleString() || 0}
                                            </span>
                                            <span className={`badge ${getStatusBadge(order.status)}`}>
                                                {getStatusIcon(order.status)}
                                                {getDisplayStatus(order.status)}
                                            </span>
                                            <button className="btn btn-ghost btn-icon-sm">
                                                <Eye size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>
            </section>

            {/* Order Detail Modal */}
            <AnimatePresence>
                {selectedOrder && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                        onClick={() => setSelectedOrder(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content w-full max-w-3xl"
                            style={{ maxHeight: '90vh', overflowY: 'auto' }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">
                                        Order #{selectedOrder.orderId?.slice(-8).toUpperCase()}
                                    </h2>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                        {formatDateTime(selectedOrder.createdAt)}
                                    </p>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span className={`badge ${getStatusBadge(selectedOrder.status)}`}>
                                        {getStatusIcon(selectedOrder.status)}
                                        {getDisplayStatus(selectedOrder.status)}
                                    </span>
                                    {selectedOrder.status === 'Delivered' && (
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const res = await authenticatedFetch(`/api/invoices/${selectedOrder.orderId}?format=pdf`);
                                                    if (res.ok) {
                                                        const blob = await res.blob();
                                                        const url = URL.createObjectURL(blob);
                                                        const a = document.createElement('a');
                                                        a.href = url;
                                                        a.download = `Invoice-${selectedOrder.orderId.slice(-8).toUpperCase()}.pdf`;
                                                        document.body.appendChild(a);
                                                        a.click();
                                                        document.body.removeChild(a);
                                                        URL.revokeObjectURL(url);
                                                    }
                                                } catch { /* silent */ }
                                            }}
                                            title="Download Invoice PDF"
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 5,
                                                padding: '6px 14px', borderRadius: 8, border: 'none',
                                                background: '#F4511E', color: 'white',
                                                fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                                            }}
                                        >
                                            <FileText size={14} />
                                            Invoice
                                        </button>
                                    )}
                                    <button onClick={() => setSelectedOrder(null)} className="btn btn-ghost btn-icon-sm">
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            <div className="modal-body space-y-5">

                                {/* ── SECTION 1: Customer & Vendor ── */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                                    {/* Customer Card */}
                                    <div className="glass-card p-4">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--primary), #0ea5e9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <User size={18} color="white" />
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</p>
                                                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{selectedOrder.customerName || 'Unknown'}</p>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                <Phone size={13} />
                                                <span>{selectedOrder.customerPhone || 'N/A'}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                <MapPin size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                                                <span>{selectedOrder.deliveryAddress || 'N/A'}</span>
                                            </div>
                                            {selectedOrder.distanceKm > 0 && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                    <TrendingUp size={13} />
                                                    <span>{selectedOrder.distanceKm} km away</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Vendor Card */}
                                    <div className="glass-card p-4">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #F59E0B, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Store size={18} color="white" />
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vendor / Restaurant</p>
                                                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{selectedOrder.vendorName || 'Unknown'}</p>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {selectedOrder.vendorPhone && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                    <Phone size={13} />
                                                    <span>{selectedOrder.vendorPhone}</span>
                                                </div>
                                            )}
                                            {selectedOrder.vendorAddress && (
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                    <MapPin size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                                                    <span>{selectedOrder.vendorAddress}{selectedOrder.vendorCity ? `, ${selectedOrder.vendorCity}` : ''}</span>
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                <Package size={13} />
                                                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', background: 'var(--surface-hover)', padding: '2px 6px', borderRadius: 4 }}>
                                                    ID: {selectedOrder.vendorId?.slice(-8).toUpperCase() || 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ── SECTION 2: Delivery Partner ── */}
                                <div className="glass-card p-4">
                                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                                        Delivery Partner
                                    </p>

                                    {(selectedOrder.deliveryPersonName || selectedOrder.deliveryPersonPhone || selectedOrder.deliveryPersonId || selectedOrder.pickupPin || selectedOrder.deliveryPin) ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                                            {/* ─ Partner header: avatar · name · rating · task status ─ */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(16,185,129,0.07), rgba(5,150,105,0.04))', border: '1px solid rgba(16,185,129,0.18)' }}>
                                                {/* Avatar */}
                                                <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #10B981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(16,185,129,0.25)' }}>
                                                    <Truck size={22} color="white" />
                                                </div>

                                                {/* Name + meta */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                        <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--foreground)' }}>
                                                            {selectedOrder.deliveryPersonName || 'Delivery Partner'}
                                                        </p>
                                                        {selectedOrder.deliveryPersonRating > 0 && (
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', fontWeight: 600, background: 'rgba(245,158,11,0.12)', color: '#F59E0B', padding: '2px 8px', borderRadius: 20, border: '1px solid rgba(245,158,11,0.25)' }}>
                                                                ⭐ {selectedOrder.deliveryPersonRating.toFixed(1)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Phone + ID row */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 5, flexWrap: 'wrap' }}>
                                                        {selectedOrder.deliveryPersonPhone && (
                                                            <a href={`tel:${selectedOrder.deliveryPersonPhone}`}
                                                               style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: '#10B981', fontWeight: 500, textDecoration: 'none' }}>
                                                                <Phone size={13} />
                                                                {selectedOrder.deliveryPersonPhone}
                                                            </a>
                                                        )}
                                                        {selectedOrder.deliveryPersonId && (
                                                            <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', background: 'rgba(16,185,129,0.08)', padding: '2px 8px', borderRadius: 6, color: 'var(--foreground-secondary)', border: '1px solid rgba(16,185,129,0.12)' }}>
                                                                ID: {selectedOrder.deliveryPersonId.slice(-8).toUpperCase()}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Task status badge — right side */}
                                                {(() => {
                                                    const ts = selectedOrder.deliveryTaskStatus || '';
                                                    if (!ts) return null;
                                                    const statusMap: Record<string, { label: string; bg: string; color: string; border: string }> = {
                                                        ASSIGNED:              { label: 'Assigned',            bg: 'rgba(99,102,241,0.10)',  color: '#6366F1', border: 'rgba(99,102,241,0.25)' },
                                                        ACCEPTED:              { label: 'Accepted',            bg: 'rgba(59,130,246,0.10)',  color: '#3B82F6', border: 'rgba(59,130,246,0.25)' },
                                                        EN_ROUTE_TO_PICKUP:    { label: 'En Route to Pickup',  bg: 'rgba(245,158,11,0.10)', color: '#F59E0B', border: 'rgba(245,158,11,0.25)' },
                                                        ARRIVED_AT_PICKUP:     { label: 'At Pickup',           bg: 'rgba(249,115,22,0.10)', color: '#F97316', border: 'rgba(249,115,22,0.25)' },
                                                        PICKED_UP:             { label: 'Picked Up',           bg: 'rgba(14,165,233,0.10)', color: '#0EA5E9', border: 'rgba(14,165,233,0.25)' },
                                                        EN_ROUTE_TO_CUSTOMER:  { label: 'Out for Delivery',    bg: 'rgba(16,185,129,0.10)', color: '#10B981', border: 'rgba(16,185,129,0.25)' },
                                                        ARRIVED_AT_CUSTOMER:   { label: 'Arrived',             bg: 'rgba(16,185,129,0.14)', color: '#059669', border: 'rgba(5,150,105,0.30)' },
                                                        DELIVERED:             { label: 'Delivered',           bg: 'rgba(16,185,129,0.12)', color: '#10B981', border: 'rgba(16,185,129,0.30)' },
                                                        COMPLETED:             { label: 'Completed',           bg: 'rgba(16,185,129,0.12)', color: '#10B981', border: 'rgba(16,185,129,0.30)' },
                                                        CANCELLED:             { label: 'Cancelled',           bg: 'rgba(239,68,68,0.10)',  color: '#EF4444', border: 'rgba(239,68,68,0.25)' },
                                                    };
                                                    const s = statusMap[ts] || { label: ts.replace(/_/g, ' '), bg: 'var(--surface-hover)', color: 'var(--foreground-secondary)', border: 'var(--glass-border)' };
                                                    return (
                                                        <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                            {s.label}
                                                        </span>
                                                    );
                                                })()}
                                            </div>

                                            {/* ─ Vehicle info row ─ */}
                                            {(selectedOrder.deliveryPersonVehicleType || selectedOrder.deliveryPersonVehicleNumber) && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)' }}>
                                                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                        <Truck size={15} color="#6366F1" />
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                                                        {selectedOrder.deliveryPersonVehicleType && (
                                                            <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--foreground)' }}>{selectedOrder.deliveryPersonVehicleType}</span>
                                                        )}
                                                        {selectedOrder.deliveryPersonVehicleNumber && (
                                                            <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, background: 'var(--glass-bg)', padding: '3px 10px', borderRadius: 6, border: '1px solid var(--glass-border)', letterSpacing: '0.08em', color: 'var(--foreground)' }}>
                                                                {selectedOrder.deliveryPersonVehicleNumber}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* ─ PINs grid ─ */}
                                            {(selectedOrder.pickupPin || selectedOrder.deliveryPin) && (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                    {/* Pickup PIN */}
                                                    <div style={{
                                                        padding: '12px 14px', borderRadius: 12,
                                                        background: selectedOrder.pickupPinVerified ? 'rgba(16,185,129,0.08)' : 'var(--surface-hover)',
                                                        border: `1.5px solid ${selectedOrder.pickupPinVerified ? '#10B981' : 'var(--glass-border)'}`
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                                            <span style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Pickup PIN</span>
                                                            {selectedOrder.pickupPinVerified
                                                                ? <CheckCircle size={14} color="#10B981" />
                                                                : <Clock size={14} color="var(--foreground-secondary)" />}
                                                        </div>
                                                        <p style={{ fontFamily: 'monospace', fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.25em', color: selectedOrder.pickupPinVerified ? '#10B981' : 'var(--foreground)' }}>
                                                            {selectedOrder.pickupPin || '---'}
                                                        </p>
                                                        {selectedOrder.pickupPinVerified && selectedOrder.pickupPinVerifiedAt && (
                                                            <p style={{ fontSize: '0.62rem', color: '#10B981', marginTop: 4, fontWeight: 500 }}>✓ Verified at {formatDateTime(selectedOrder.pickupPinVerifiedAt)}</p>
                                                        )}
                                                        {!selectedOrder.pickupPinVerified && (
                                                            <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Awaiting verification</p>
                                                        )}
                                                    </div>

                                                    {/* Delivery PIN */}
                                                    <div style={{
                                                        padding: '12px 14px', borderRadius: 12,
                                                        background: selectedOrder.deliveryPinVerified ? 'rgba(16,185,129,0.08)' : 'var(--surface-hover)',
                                                        border: `1.5px solid ${selectedOrder.deliveryPinVerified ? '#10B981' : 'var(--glass-border)'}`
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                                            <span style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Delivery PIN</span>
                                                            {selectedOrder.deliveryPinVerified
                                                                ? <CheckCircle size={14} color="#10B981" />
                                                                : <Clock size={14} color="var(--foreground-secondary)" />}
                                                        </div>
                                                        <p style={{ fontFamily: 'monospace', fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.25em', color: selectedOrder.deliveryPinVerified ? '#10B981' : 'var(--foreground)' }}>
                                                            {selectedOrder.deliveryPin || '---'}
                                                        </p>
                                                        {selectedOrder.deliveryPinVerified && selectedOrder.deliveryPinVerifiedAt && (
                                                            <p style={{ fontSize: '0.62rem', color: '#10B981', marginTop: 4, fontWeight: 500 }}>✓ Verified at {formatDateTime(selectedOrder.deliveryPinVerifiedAt)}</p>
                                                        )}
                                                        {!selectedOrder.deliveryPinVerified && (
                                                            <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Awaiting verification</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        /* No delivery partner assigned */
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px dashed var(--glass-border)' }}>
                                            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(156,163,175,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Truck size={18} style={{ opacity: 0.35, color: 'var(--foreground-secondary)' }} />
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--foreground-secondary)' }}>No delivery partner assigned</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', opacity: 0.7, marginTop: 2 }}>
                                                    {selectedOrder.status === 'Pending' ? 'Order awaiting vendor acceptance' :
                                                     selectedOrder.status === 'Preparing' || selectedOrder.status === 'Accepted' ? 'Will be assigned when food is ready' :
                                                     'Partner will be assigned shortly'}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* ── SECTION 3: Order Items ── */}
                                <div>
                                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                                        Ordered Items
                                    </p>
                                    <div className="glass-card" style={{ overflow: 'hidden' }}>
                                        {(selectedOrder.items?.length > 0 ? selectedOrder.items : []).map((item, index) => (
                                            <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: index < selectedOrder.items.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600 }}>
                                                        {item.quantity}×
                                                    </span>
                                                    <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{item.name}</span>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    {/* Determine effective unit price */}
                                                    {(() => {
                                                        const originalPrice: number = item.originalPrice ?? item.price ?? 0;
                                                        const effectivePrice: number = (item.discountedPrice != null && item.discountedPrice < originalPrice)
                                                            ? item.discountedPrice
                                                            : item.price ?? 0;
                                                        const isDiscounted = effectivePrice < originalPrice;
                                                        const lineTotal = effectivePrice * item.quantity;
                                                        return (
                                                            <>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                                                                    {isDiscounted && (
                                                                        <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', textDecoration: 'line-through' }}>
                                                                            ₹{(originalPrice * item.quantity).toLocaleString('en-IN')}
                                                                        </span>
                                                                    )}
                                                                    <span style={{ fontSize: '0.88rem', fontWeight: 600, color: isDiscounted ? '#10B981' : 'var(--foreground)' }}>
                                                                        ₹{lineTotal.toLocaleString('en-IN')}
                                                                    </span>
                                                                    {isDiscounted && (
                                                                        <span style={{ fontSize: '0.62rem', fontWeight: 700, background: 'rgba(16,185,129,0.12)', color: '#10B981', padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(16,185,129,0.25)' }}>
                                                                            -{Math.round((1 - effectivePrice / originalPrice) * 100)}%
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {item.quantity > 1 && (
                                                                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                                                        {isDiscounted
                                                                            ? <><span style={{ textDecoration: 'line-through' }}>₹{originalPrice.toLocaleString('en-IN')}</span> ₹{effectivePrice.toLocaleString('en-IN')} each</>
                                                                            : <>₹{item.price.toLocaleString('en-IN')} each</>
                                                                        }
                                                                    </p>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                        ))}
                                        {(!selectedOrder.items || selectedOrder.items.length === 0) && (
                                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>
                                                No items available
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* ── SECTION 4: Bill Breakdown ── */}
                                <div className="glass-card p-4">
                                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                                        Bill Breakdown
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {/* Customer-facing charges */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                            <span style={{ color: 'var(--foreground-secondary)' }}>Item Total</span>
                                            <span>₹{(selectedOrder.subtotal || selectedOrder.itemTotal || 0).toLocaleString('en-IN')}</span>
                                        </div>
                                        {selectedOrder.discount > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                                <span style={{ color: '#10B981' }}>Discount</span>
                                                <span style={{ color: '#10B981' }}>−₹{selectedOrder.discount.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                            <span style={{ color: 'var(--foreground-secondary)' }}>Delivery Fee</span>
                                            <span>₹{(selectedOrder.deliveryFee || 0).toLocaleString('en-IN')}</span>
                                        </div>
                                        {selectedOrder.taxes > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--foreground-secondary)' }}>Taxes & Fees</span>
                                                <span>₹{selectedOrder.taxes.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {selectedOrder.smallOrderSupportFee > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--foreground-secondary)' }}>Small Order Fee</span>
                                                <span>₹{selectedOrder.smallOrderSupportFee.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {selectedOrder.tip > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                                <span style={{ color: 'var(--foreground-secondary)' }}>Tip 🙏</span>
                                                <span>₹{selectedOrder.tip.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {selectedOrder.coinDiscount > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                                <span style={{ color: '#F59E0B' }}>🪙 Coin Discount ({selectedOrder.coinsUsed} coins)</span>
                                                <span style={{ color: '#F59E0B' }}>−₹{selectedOrder.coinDiscount.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        {selectedOrder.promoDiscount > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                                <span style={{ color: '#8B5CF6' }}>🎟️ Promo{selectedOrder.promoCode ? ` (${selectedOrder.promoCode})` : ''}</span>
                                                <span style={{ color: '#8B5CF6' }}>−₹{selectedOrder.promoDiscount.toLocaleString('en-IN')}</span>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700, paddingTop: 10, borderTop: '1px solid var(--glass-border)', marginTop: 4 }}>
                                            <span>Total Paid</span>
                                            <span style={{ color: 'var(--primary)' }}>₹{(selectedOrder.total || 0).toLocaleString('en-IN')}</span>
                                        </div>

                                        {/* Platform earnings breakdown — only for delivered orders */}
                                        {(() => {
                                            const cancelledStatuses = ['Cancelled', 'Declined', 'Not Responded'];
                                            const isCancelled = cancelledStatuses.includes(selectedOrder.status);
                                            if (isCancelled) {
                                                return (
                                                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--glass-border)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)' }}>
                                                            <span style={{ fontSize: '0.8rem', color: '#EF4444', fontWeight: 600 }}>No platform earnings — order {selectedOrder.status.toLowerCase()}</span>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            const sub = selectedOrder.subtotal || selectedOrder.itemTotal || 0;
                                            // Use stored commission values from order (respects custom vendor commission rate)
                                            // Fall back to 15% calculation only for old orders that don't have these fields
                                            const commission = selectedOrder.vendorPlatformCut > 0
                                                ? selectedOrder.vendorPlatformCut
                                                : Math.round(sub * 0.15 * 10) / 10;
                                            const gst = selectedOrder.vendorGstOnPlatformCut > 0
                                                ? selectedOrder.vendorGstOnPlatformCut
                                                : Math.round(commission * 0.18 * 10) / 10;
                                            const vendorPayout = selectedOrder.vendorEarning > 0
                                                ? selectedOrder.vendorEarning
                                                : Math.round((sub - commission - gst) * 10) / 10;
                                            const commissionPercent = sub > 0 ? Math.round((commission / sub) * 100) : 15;
                                            const partnerPayout = selectedOrder.distanceKm > 0 ? Math.max(15, Math.round((10 + selectedOrder.distanceKm * 6.5) * 10) / 10) : (selectedOrder.deliveryFee || 15);
                                            const deliverySubsidy = (selectedOrder.deliveryFee || 0) - partnerPayout;
                                            const platformNet = commission + gst + deliverySubsidy;
                                            return sub > 0 ? (
                                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--glass-border)' }}>
                                                    <p style={{ fontSize: '0.6rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Platform Earnings Breakdown</p>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                                            <span style={{ color: 'var(--foreground-secondary)' }}>Vendor Payout (after {commissionPercent}%+GST)</span>
                                                            <span style={{ color: '#F59E0B' }}>₹{vendorPayout.toLocaleString('en-IN')}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                                            <span style={{ color: 'var(--foreground-secondary)' }}>Commission ({commissionPercent}%)</span>
                                                            <span>₹{commission.toLocaleString('en-IN')}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                                            <span style={{ color: 'var(--foreground-secondary)' }}>GST on Commission (18%)</span>
                                                            <span style={{ color: '#ef4444' }}>−₹{gst.toLocaleString('en-IN')}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                                            <span style={{ color: 'var(--foreground-secondary)' }}>Delivery Partner Payout (₹10 + ₹6.5/km)</span>
                                                            <span style={{ color: '#ef4444' }}>−₹{partnerPayout.toLocaleString('en-IN')}</span>
                                                        </div>
                                                        {deliverySubsidy < 0 && (
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                                                <span style={{ color: '#ef4444' }}>Delivery Subsidy</span>
                                                                <span style={{ color: '#ef4444' }}>₹{deliverySubsidy.toLocaleString('en-IN')}</span>
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 700, paddingTop: 6, borderTop: '1px dashed var(--glass-border)', marginTop: 2 }}>
                                                            <span style={{ color: '#10B981' }}>Platform Net Earning</span>
                                                            <span style={{ color: '#10B981' }}>₹{platformNet.toLocaleString('en-IN')}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : null;
                                        })()}
                                    </div>
                                </div>

                                {/* ── SECTION 5: Order Timeline ── */}
                                {(() => {
                                    const steps = [
                                        { label: 'Order Placed', time: selectedOrder.createdAt, done: true, icon: '📋' },
                                        { label: 'Accepted by Vendor', time: selectedOrder.acceptedAt, done: !!selectedOrder.acceptedAt, icon: '✅' },
                                        { label: 'Preparing', time: selectedOrder.preparingAt, done: !!selectedOrder.preparingAt, icon: '🍳' },
                                        { label: 'Food Ready', time: selectedOrder.preparedAt, done: !!selectedOrder.preparedAt, icon: '✨' },
                                        { label: 'Dispatched / Out for Delivery', time: selectedOrder.dispatchedAt || selectedOrder.pickedUpAt, done: !!(selectedOrder.dispatchedAt || selectedOrder.pickedUpAt || selectedOrder.deliveryPersonId), icon: '🚴' },
                                        { label: 'Picked Up (PIN Verified)', time: selectedOrder.pickupPinVerifiedAt || selectedOrder.pickedUpAt, done: selectedOrder.pickupPinVerified || !!selectedOrder.pickedUpAt, icon: '📦' },
                                        { label: 'Delivered (PIN Verified)', time: selectedOrder.deliveryPinVerifiedAt || selectedOrder.deliveredAt, done: selectedOrder.deliveryPinVerified || selectedOrder.status === 'Delivered', icon: '🏠' },
                                    ];
                                    const hasAnyTimestamp = steps.some(s => s.time);
                                    if (!hasAnyTimestamp) return null;
                                    return (
                                        <div className="glass-card p-4">
                                            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>Order Timeline</p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                                {steps.map((step, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, position: 'relative' }}>
                                                        {/* Vertical line connector */}
                                                        {i < steps.length - 1 && (
                                                            <div style={{ position: 'absolute', left: 13, top: 24, width: 2, height: 28, background: step.done ? '#10B981' : 'var(--glass-border)' }} />
                                                        )}
                                                        {/* Dot */}
                                                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: step.done ? 'rgba(16,185,129,0.12)' : 'var(--surface-hover)', border: `2px solid ${step.done ? '#10B981' : 'var(--glass-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0, zIndex: 1 }}>
                                                            {step.done ? '✓' : '○'}
                                                        </div>
                                                        {/* Content */}
                                                        <div style={{ paddingBottom: i < steps.length - 1 ? 18 : 0 }}>
                                                            <p style={{ fontSize: '0.8rem', fontWeight: step.done ? 600 : 400, color: step.done ? 'var(--foreground)' : 'var(--foreground-secondary)' }}>
                                                                {step.icon} {step.label}
                                                            </p>
                                                            {step.time && (
                                                                <p style={{ fontSize: '0.68rem', color: '#10B981', marginTop: 1 }}>{formatDateTime(step.time)}</p>
                                                            )}
                                                            {!step.time && step.done && (
                                                                <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginTop: 1 }}>Completed</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ── SECTION 5: Payment Info ── */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)' }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Payment Mode</p>
                                        <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{selectedOrder.paymentMode || 'Cash on Delivery'}</p>
                                    </div>
                                    <div style={{ padding: '12px 16px', borderRadius: 12, background: selectedOrder.paymentStatus?.toLowerCase() === 'paid' ? 'rgba(16,185,129,0.08)' : 'var(--surface-hover)', border: `1px solid ${selectedOrder.paymentStatus?.toLowerCase() === 'paid' ? '#10B981' : 'var(--glass-border)'}` }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Payment Status</p>
                                        <p style={{ fontSize: '0.9rem', fontWeight: 600, color: selectedOrder.paymentStatus?.toLowerCase() === 'paid' ? '#10B981' : 'var(--foreground)' }}>
                                            {selectedOrder.paymentStatus || 'Pending'}
                                        </p>
                                    </div>
                                </div>

                                {/* ── Admin Cancel Button ── */}
                                {selectedOrder.status !== 'Delivered' && selectedOrder.status !== 'Cancelled' && selectedOrder.status !== 'Cancelled by Admin' && (
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setShowCancelModal(true); }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 6,
                                                padding: '10px 20px', borderRadius: 10, border: 'none',
                                                background: '#EF4444', color: 'white',
                                                fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                                            }}
                                        >
                                            <Ban size={16} />
                                            Cancel Order
                                        </button>
                                    </div>
                                )}

                                {/* ── SECTION 6: Delivery Instruction ── */}
                                {selectedOrder.deliveryInstruction && (
                                    <div className="glass-card p-4" style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.15)' }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                                            📝 Delivery Instruction
                                        </p>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--foreground)', fontStyle: 'italic', lineHeight: 1.5 }}>
                                            &ldquo;{selectedOrder.deliveryInstruction}&rdquo;
                                        </p>
                                    </div>
                                )}

                                {/* ── SECTION 7: Refund & COD Status ── */}
                                {(selectedOrder.refundStatus || (selectedOrder.paymentMode?.toLowerCase().includes('cod') || selectedOrder.paymentMode?.toLowerCase().includes('cash'))) && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                        {selectedOrder.refundStatus && (
                                            <div style={{
                                                padding: '12px 16px', borderRadius: 12,
                                                background: selectedOrder.refundStatus === 'full_refund' ? 'rgba(16,185,129,0.08)' :
                                                    selectedOrder.refundStatus === 'partial_refund' ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
                                                border: `1px solid ${selectedOrder.refundStatus === 'full_refund' ? '#10B981' :
                                                    selectedOrder.refundStatus === 'partial_refund' ? '#F59E0B' : '#EF4444'}`
                                            }}>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Refund Status</p>
                                                <p style={{
                                                    fontSize: '0.85rem', fontWeight: 600,
                                                    color: selectedOrder.refundStatus === 'full_refund' ? '#10B981' :
                                                        selectedOrder.refundStatus === 'partial_refund' ? '#F59E0B' : '#EF4444'
                                                }}>
                                                    {selectedOrder.refundStatus === 'full_refund' ? '✅ Full Refund' :
                                                        selectedOrder.refundStatus === 'partial_refund' ? '⚠️ Partial Refund' :
                                                            selectedOrder.refundStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                                </p>
                                                {selectedOrder.refundAmount > 0 && (
                                                    <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                                        Amount: ₹{selectedOrder.refundAmount.toLocaleString('en-IN')}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        {(selectedOrder.paymentMode?.toLowerCase().includes('cod') || selectedOrder.paymentMode?.toLowerCase().includes('cash')) && selectedOrder.status === 'Delivered' && (
                                            <div style={{
                                                padding: '12px 16px', borderRadius: 12,
                                                background: selectedOrder.codSettled ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
                                                border: `1px solid ${selectedOrder.codSettled ? '#10B981' : '#F59E0B'}`
                                            }}>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>COD Settlement</p>
                                                <p style={{ fontSize: '0.85rem', fontWeight: 600, color: selectedOrder.codSettled ? '#10B981' : '#F59E0B' }}>
                                                    {selectedOrder.codSettled ? '✅ Settled' : '⏳ Pending'}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ─── Admin Cancel Order Confirmation Modal ─── */}
            <AnimatePresence>
                {showCancelModal && selectedOrder && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" style={{ zIndex: 60 }} onClick={() => { setShowCancelModal(false); setCancelReason(''); }}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="modal-content w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">⚠️ Cancel Order</h2>
                                <button onClick={() => { setShowCancelModal(false); setCancelReason(''); }} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body space-y-4">
                                {/* Order summary */}
                                <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>#{selectedOrder.orderId?.slice(-8).toUpperCase()}</span>
                                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary)' }}>₹{selectedOrder.total}</span>
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                        {selectedOrder.customerName} · {selectedOrder.vendorName} · {selectedOrder.status}
                                    </p>
                                </div>

                                {/* Warning */}
                                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#EF4444', fontWeight: 600, fontSize: '0.82rem', marginBottom: 6 }}>
                                        <AlertTriangle size={14} /> This action cannot be undone
                                    </div>
                                    <ul style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', paddingLeft: 16, margin: 0, lineHeight: 1.6 }}>
                                        <li>Order will be marked as &quot;Cancelled by Admin&quot;</li>
                                        <li>Delivery task will be cancelled and partner freed</li>
                                        <li>Vendor will see &quot;Cancelled by Admin&quot;</li>
                                        <li>Customer will see &quot;Cancelled due to technical reason&quot;</li>
                                        {(selectedOrder.paymentMode?.toLowerCase() === 'online' || selectedOrder.paymentMode?.toLowerCase() === 'razorpay') && (
                                            <li style={{ color: '#10B981', fontWeight: 600 }}>✓ Full refund will be processed automatically</li>
                                        )}
                                    </ul>
                                </div>

                                {/* Reason */}
                                <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>Cancellation Reason</label>
                                    <select
                                        value={cancelReason}
                                        onChange={(e) => setCancelReason(e.target.value)}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' }}
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

                                {/* Buttons */}
                                <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
                                    <button onClick={() => { setShowCancelModal(false); setCancelReason(''); }} style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>
                                        Go Back
                                    </button>
                                    <button
                                        onClick={handleAdminCancel}
                                        disabled={cancelling || !cancelReason}
                                        style={{
                                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                            padding: '10px 16px', borderRadius: 10, border: 'none',
                                            cursor: (cancelling || !cancelReason) ? 'not-allowed' : 'pointer',
                                            background: '#EF4444', color: 'white', fontWeight: 600, fontSize: '0.85rem',
                                            opacity: (cancelling || !cancelReason) ? 0.5 : 1,
                                        }}
                                    >
                                        {cancelling ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                                        {cancelling ? 'Cancelling...' : 'Cancel Order'}
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

