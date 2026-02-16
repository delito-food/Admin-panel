'use client';

import { useState } from 'react';
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
    BarChart3
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

const CHART_COLORS = ['#288990', '#FF9904', '#F6D59F', '#10B981', '#E9190C'];

const statusFilters = ['All', 'Pending', 'Preparing', 'Sent for delivery', 'Delivered', 'Cancelled'];

export default function OrdersPage() {
    const { data: orders, loading, refetch } = useApi<Order[]>('/api/orders');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

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
                return <XCircle size={14} />;
            case 'sent for delivery':
                return <Truck size={14} />;
            case 'preparing':
                return <Package size={14} />;
            default:
                return <Clock size={14} />;
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
        { name: 'On the Way', value: stats.onTheWay, color: '#288990' },
        { name: 'Delivered', value: stats.delivered, color: '#10B981' },
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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title">Orders</h1>
                    <p className="page-description">Manage and track all orders in real-time</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
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
                                {statusFilter}
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
                                                {filter}
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
                                                {order.status}
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
                            className="modal-content w-full max-w-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <h2 className="modal-title">
                                    Order #{selectedOrder.orderId?.slice(-8).toUpperCase()}
                                </h2>
                                <button
                                    onClick={() => setSelectedOrder(null)}
                                    className="btn btn-ghost btn-icon-sm"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="modal-body space-y-6">
                                {/* Status Badge */}
                                <div className="flex items-center justify-between">
                                    <span className={`badge ${getStatusBadge(selectedOrder.status)}`}>
                                        {getStatusIcon(selectedOrder.status)}
                                        {selectedOrder.status}
                                    </span>
                                    <span className="text-sm text-[var(--foreground-secondary)]">
                                        {formatDateTime(selectedOrder.createdAt)}
                                    </span>
                                </div>

                                {/* Customer & Vendor Info */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="glass-card p-4">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center">
                                                <User size={18} className="text-[var(--primary)]" />
                                            </div>
                                            <div>
                                                <p className="text-sm text-[var(--foreground-secondary)]">Customer</p>
                                                <p className="font-medium">{selectedOrder.customerName || 'Unknown'}</p>
                                            </div>
                                        </div>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex items-center gap-2 text-[var(--foreground-secondary)]">
                                                <Phone size={14} />
                                                <span>{selectedOrder.customerPhone || 'N/A'}</span>
                                            </div>
                                            <div className="flex items-start gap-2 text-[var(--foreground-secondary)]">
                                                <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                                                <span>{selectedOrder.deliveryAddress || 'N/A'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="glass-card p-4">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 rounded-lg bg-[var(--accent-active)]/10 flex items-center justify-center">
                                                <Store size={18} className="text-[var(--accent-active)]" />
                                            </div>
                                            <div>
                                                <p className="text-sm text-[var(--foreground-secondary)]">Vendor</p>
                                                <p className="font-medium">{selectedOrder.vendorName || 'Unknown'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Order Items */}
                                <div>
                                    <h4 className="text-sm font-semibold text-[var(--foreground-secondary)] uppercase tracking-wide mb-3">
                                        Order Items
                                    </h4>
                                    <div className="glass-card divide-y divide-[var(--border)]">
                                        {selectedOrder.items?.map((item, index) => (
                                            <div key={index} className="p-4 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="w-8 h-8 rounded-lg bg-[var(--surface-hover)] flex items-center justify-center text-sm font-medium">
                                                        {item.quantity}x
                                                    </span>
                                                    <span className="font-medium">{item.name}</span>
                                                </div>
                                                <span className="font-semibold">₹{item.price * item.quantity}</span>
                                            </div>
                                        )) || (
                                                <div className="p-4 text-center text-[var(--foreground-secondary)]">
                                                    No items available
                                                </div>
                                            )}
                                    </div>
                                </div>

                                {/* Total */}
                                <div className="flex items-center justify-between p-4 bg-[var(--primary)]/5 rounded-xl">
                                    <span className="font-semibold text-lg">Total Amount</span>
                                    <span className="font-bold text-xl text-[var(--primary)]">
                                        ₹{selectedOrder.total?.toLocaleString() || 0}
                                    </span>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
