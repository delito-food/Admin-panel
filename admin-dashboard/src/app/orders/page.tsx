'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
    User,
    Store,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    RefreshCw,
    ShoppingBag,
    BarChart3,
    AlertTriangle,
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
import {
    opsStageOf, opsStageLabel, OPS_STAGE_META, OPS_GROUPS,
    type OpsStage, type OpsGroup,
} from '@/lib/order-stage';

const CHART_COLORS = ['#F4511E', '#FF9904', '#F6D59F', '#10B981', '#E9190C'];

// Filters are by real stage, not raw status. The vendor app only writes
// Pending → Accepted → Prepared, and "Sent for delivery" means the rider search
// started — so filtering on raw strings left "Preparing" permanently empty and
// put orders still in the kitchen under "on the way". See src/lib/order-stage.ts.
const statusFilters: ('All' | OpsGroup)[] = ['All', ...OPS_GROUPS.map(g => g.key)];

const filterLabel = (f: string) =>
    f === 'All' ? 'All' : (OPS_GROUPS.find(g => g.key === f)?.label ?? f);

/** The order's merged stage — from the API, or derived here for older payloads. */
const stageOfOrder = (o: Order): OpsStage =>
    o.opsStage ?? opsStageOf(o.status, o.deliveryTaskStatus, o.pickupPinVerified);

/** Marked "count as fulfilled" by an admin while its own status says otherwise. */
const isMarkedFulfilled = (o: Order): boolean => !!o.fulfilledMark && stageOfOrder(o) !== 'DELIVERED';

/** Delivered, or marked fulfilled — what every count on this page treats as done. */
const isFulfilled = (o: Order): boolean => stageOfOrder(o) === 'DELIVERED' || isMarkedFulfilled(o);

/** Filter bucket: a marked order is counted under Delivered, not under issues. */
const groupOf = (o: Order): OpsGroup => isMarkedFulfilled(o) ? 'delivered' : OPS_STAGE_META[stageOfOrder(o)].group;

/** Live order more than 5 minutes past the promise made at acceptance. */
const isLate = (o: Order): boolean => {
    const g = OPS_STAGE_META[stageOfOrder(o)].group;
    if (g === 'delivered' || g === 'issues' || !o.promisedDeliveryAt) return false;
    return Date.now() - Date.parse(o.promisedDeliveryAt) > 5 * 60_000;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const ORDERS_ENDPOINT = '/api/orders?limit=all';

// ── Keeping the register current ──
//
// This page used to re-download every order it had every 90 seconds. On a
// thousand-order platform that is a thousand document reads plus the vendor,
// partner, delivery-task and invoice collections joined onto them — several
// megabytes of JSON — to discover that, typically, one order had moved from
// Preparing to Delivered. It also got steadily worse as the register grew.
//
// Instead: load the full register once, then ask only for orders created in
// the last day and merge them in. That covers everything that realistically
// changes — new orders, and status transitions on recent ones — at a cost
// that stays flat no matter how long the platform has been running.
//
// The slow full refresh is the safety net. If anything ever falls outside the
// delta window — an old order cancelled by hand, an order whose timestamp
// isn't a Firestore timestamp and so escapes the range query — it is picked up
// within fifteen minutes rather than never. The Refresh button is immediate.
const DELTA_POLL_MS = 90_000;
const FULL_REFRESH_MS = 15 * 60_000;
const DELTA_WINDOW_MS = 24 * 60 * 60_000;

export default function OrdersPage() {
    // The full order register is fetched once so that search, filters and
    // pagination below operate on every order, not just the newest page.
    const { data: orders, loading, refetch, mutate } = useApi<Order[]>(ORDERS_ENDPOINT);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const router = useRouter();

    /** Full order page — Ctrl/⌘-click or middle-click opens it in a new tab. */
    const openOrder = (orderId: string, newTab = false) => {
        const href = `/orders/${encodeURIComponent(orderId)}`;
        if (newTab) window.open(href, '_blank');
        else router.push(href);
    };

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    // Latest orders, readable from inside the polling effect without making
    // the effect depend on them (which would tear down every timer on every
    // merge).
    const ordersRef = useRef<Order[] | null>(orders);
    ordersRef.current = orders;

    const pullDelta = useCallback(async () => {
        const current = ordersRef.current;
        // Nothing to merge into yet — the initial load will cover it.
        if (!current || current.length === 0) return;

        const since = new Date(Date.now() - DELTA_WINDOW_MS).toISOString();

        try {
            const res = await authenticatedFetch(
                `/api/orders?since=${encodeURIComponent(since)}`
            );
            if (!res.ok) return;

            const json = await res.json();
            if (!json?.success || !Array.isArray(json.data) || json.data.length === 0) return;

            const byId = new Map(current.map(o => [o.orderId, o]));
            for (const order of json.data as Order[]) {
                byId.set(order.orderId, order);
            }

            const merged = Array.from(byId.values()).sort((a, b) =>
                (b.createdAt || '').localeCompare(a.createdAt || '')
            );
            mutate(merged);
        } catch {
            // A failed refresh leaves the list exactly as it was, which is the
            // right outcome — the register on screen is still valid, just a
            // little older.
        }
    }, [mutate]);

    // Auto-refresh: a delta every 90 seconds, a full reload every 15 minutes,
    // both suspended while the tab is in the background.
    useEffect(() => {
        let deltaTimer: ReturnType<typeof setInterval> | undefined;
        let fullTimer: ReturnType<typeof setInterval> | undefined;

        const start = () => {
            if (deltaTimer) return;
            deltaTimer = setInterval(pullDelta, DELTA_POLL_MS);
            fullTimer = setInterval(() => { refetch(); }, FULL_REFRESH_MS);
        };

        const stop = () => {
            if (deltaTimer) clearInterval(deltaTimer);
            if (fullTimer) clearInterval(fullTimer);
            deltaTimer = undefined;
            fullTimer = undefined;
        };

        const onVisibility = () => {
            if (document.hidden) {
                stop();
            } else {
                pullDelta();
                start();
            }
        };

        if (!document.hidden) start();
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pullDelta, refetch]);

    const filteredOrders = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return (orders || []).filter(order => {
            const matchesSearch = !q ||
                (order.orderId || '').toLowerCase().includes(q) ||
                (order.customerName || '').toLowerCase().includes(q) ||
                (order.customerPhone || '').toLowerCase().includes(q) ||
                (order.vendorName || '').toLowerCase().includes(q) ||
                (order.invoiceNumber || '').toLowerCase().includes(q);

            const matchesStatus = statusFilter === 'All' || groupOf(order) === statusFilter;

            return matchesSearch && matchesStatus;
        });
    }, [orders, searchQuery, statusFilter]);

    // ── Pagination derived values ──
    const totalOrders = filteredOrders.length;
    const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * pageSize;
    const pagedOrders = useMemo(
        () => filteredOrders.slice(startIndex, startIndex + pageSize),
        [filteredOrders, startIndex, pageSize]
    );
    const rangeStart = totalOrders === 0 ? 0 : startIndex + 1;
    const rangeEnd = Math.min(startIndex + pageSize, totalOrders);

    // Compact page-number strip: 1 … 4 5 [6] 7 8 … 20
    const pageNumbers = useMemo<(number | 'gap')[]>(() => {
        if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
        const pages: (number | 'gap')[] = [1];
        const from = Math.max(2, safePage - 1);
        const to = Math.min(totalPages - 1, safePage + 1);
        if (from > 2) pages.push('gap');
        for (let p = from; p <= to; p++) pages.push(p);
        if (to < totalPages - 1) pages.push('gap');
        pages.push(totalPages);
        return pages;
    }, [safePage, totalPages]);

    const getStatusBadge = (order: Order) => {
        switch (OPS_STAGE_META[stageOfOrder(order)].group) {
            case 'delivered': return 'badge-approved';
            case 'awaiting':
            case 'kitchen': return 'badge-pending';
            case 'issues': return 'badge-rejected';
            default: return 'badge-active';
        }
    };

    const getStatusIcon = (order: Order) => {
        switch (OPS_STAGE_META[stageOfOrder(order)].group) {
            case 'delivered': return <CheckCircle size={14} />;
            case 'issues': return <XCircle size={14} />;
            case 'onTheWay': return <Truck size={14} />;
            case 'kitchen': return <Package size={14} />;
            case 'pickup': return <Store size={14} />;
            default: return <Clock size={14} />;
        }
    };

    const getDisplayStatus = (order: Order) => opsStageLabel(stageOfOrder(order), order.foodReady);

    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);

        if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hr ago`;
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    // Stats
    const stats = {
        total: (orders || []).length,
        pending: (orders || []).filter(o => OPS_STAGE_META[stageOfOrder(o)].group === 'awaiting').length,
        preparing: (orders || []).filter(o => OPS_STAGE_META[stageOfOrder(o)].group === 'kitchen').length,
        awaitingPickup: (orders || []).filter(o => OPS_STAGE_META[stageOfOrder(o)].group === 'pickup').length,
        onTheWay: (orders || []).filter(o => OPS_STAGE_META[stageOfOrder(o)].group === 'onTheWay').length,
        // Fulfilled = delivered + orders an admin marked "count as fulfilled".
        delivered: (orders || []).filter(isFulfilled).length,
        markedFulfilled: (orders || []).filter(isMarkedFulfilled).length,
        late: (orders || []).filter(isLate).length,
        notResponded: (orders || []).filter(o => stageOfOrder(o) === 'NOT_RESPONDED' && !isMarkedFulfilled(o)).length,
        // 'Expired' = vendor accepted but no delivery partner was ever found.
        // Written by functions/deliveryPush.js expireDeliveryRequests.
        noRider: (orders || []).filter(o => stageOfOrder(o) === 'NO_RIDER' && !isMarkedFulfilled(o)).length,
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
        { name: 'Awaiting vendor', value: stats.pending, color: '#F6D59F' },
        { name: 'Preparing', value: stats.preparing, color: '#FF9904' },
        { name: 'Awaiting pickup', value: stats.awaitingPickup, color: '#0EA5E9' },
        { name: 'On the Way', value: stats.onTheWay, color: '#F4511E' },
        { name: 'Fulfilled', value: stats.delivered, color: '#10B981' },
        { name: 'Not Responded', value: stats.notResponded, color: '#E9190C' },
        { name: 'No Rider', value: stats.noRider, color: '#9333EA' },
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
                                    '/api/orders?format=xlsx&limit=all',
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
                <div className="grid grid-cols-2 lg:grid-cols-6" style={{ gap: '1.5rem' }}>
                    {[
                        { label: 'Total Orders', value: stats.total, icon: ShoppingBag, color: 'primary' },
                        { label: 'Awaiting Vendor', value: stats.pending, icon: Clock, color: 'warning' },
                        { label: 'Preparing', value: stats.preparing, icon: Package, color: 'warning' },
                        { label: stats.late ? `Awaiting Pickup · ${stats.late} late` : 'Awaiting Pickup', value: stats.awaitingPickup, icon: Store, color: 'primary' },
                        { label: 'On the Way', value: stats.onTheWay, icon: Truck, color: 'primary' },
                        { label: stats.markedFulfilled ? `Fulfilled · ${stats.markedFulfilled} marked` : 'Fulfilled', value: stats.delivered, icon: CheckCircle, color: 'success' },
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
                        <span className="section-badge">{totalOrders.toLocaleString('en-IN')}</span>
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
                                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="input"
                            />
                        </div>

                        <div className="relative">
                            <button
                                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                                className="btn btn-outline w-full sm:w-auto"
                            >
                                <Filter size={16} />
                                {filterLabel(statusFilter)}
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
                                                    setCurrentPage(1);
                                                }}
                                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${statusFilter === filter
                                                    ? 'bg-[var(--primary)] text-white'
                                                    : 'hover:bg-[var(--surface-hover)]'
                                                    }`}
                                            >
                                                {filterLabel(filter)}
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
                            pagedOrders.map((order, index) => (
                                <motion.div
                                    key={order.orderId}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    transition={{ delay: Math.min(index, 12) * 0.02 }}
                                    className="glass-card p-6 cursor-pointer"
                                    role="link"
                                    tabIndex={0}
                                    onClick={(e) => openOrder(order.orderId, e.ctrlKey || e.metaKey)}
                                    onAuxClick={(e) => { if (e.button === 1) openOrder(order.orderId, true); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') openOrder(order.orderId, e.ctrlKey || e.metaKey); }}
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
                                            {isLate(order) && (
                                                <span className="badge badge-rejected" title="More than 5 minutes past the delivery time promised at acceptance">
                                                    <AlertTriangle size={12} /> Late
                                                </span>
                                            )}
                                            <span className={`badge ${getStatusBadge(order)}`} title={`Raw status: ${order.status}${order.deliveryTaskStatus ? ` · rider task: ${order.deliveryTaskStatus}` : ''}`}>
                                                {getStatusIcon(order)}
                                                {getDisplayStatus(order)}
                                            </span>
                                            {isMarkedFulfilled(order) && (
                                                <span className="badge badge-approved" title={`Counted as fulfilled by admin${order.fulfilledMark?.note ? ` — ${order.fulfilledMark.note}` : ''}`}>
                                                    <CheckCircle size={12} /> Counted fulfilled
                                                </span>
                                            )}
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

                {/* Pagination */}
                {totalOrders > 0 && (
                    <div
                        className="glass-card"
                        style={{
                            marginTop: 20, padding: '14px 18px',
                            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                            justifyContent: 'space-between', gap: 16,
                        }}
                    >
                        {/* Range summary */}
                        <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)', margin: 0 }}>
                            Showing <strong style={{ color: 'var(--foreground)' }}>{rangeStart.toLocaleString('en-IN')}</strong>
                            {' – '}
                            <strong style={{ color: 'var(--foreground)' }}>{rangeEnd.toLocaleString('en-IN')}</strong>
                            {' of '}
                            <strong style={{ color: 'var(--foreground)' }}>{totalOrders.toLocaleString('en-IN')}</strong>
                            {' orders'}
                            {statusFilter !== 'All' || searchQuery ? ' (filtered)' : ''}
                        </p>

                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                            {/* Rows per page */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                Rows
                                <select
                                    value={pageSize}
                                    onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                                    style={{
                                        padding: '5px 8px', borderRadius: 8,
                                        border: '1px solid var(--border)', background: 'var(--surface)',
                                        color: 'var(--foreground)', fontSize: '0.8rem', cursor: 'pointer', outline: 'none',
                                    }}
                                >
                                    {PAGE_SIZE_OPTIONS.map(size => (
                                        <option key={size} value={size}>{size}</option>
                                    ))}
                                </select>
                            </label>

                            {/* Page controls */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <button
                                    onClick={() => setCurrentPage(1)}
                                    disabled={safePage === 1}
                                    aria-label="First page"
                                    className="btn btn-ghost btn-icon-sm"
                                    style={{ opacity: safePage === 1 ? 0.4 : 1, cursor: safePage === 1 ? 'not-allowed' : 'pointer' }}
                                >
                                    <ChevronsLeft size={16} />
                                </button>
                                <button
                                    onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                                    disabled={safePage === 1}
                                    aria-label="Previous page"
                                    className="btn btn-ghost btn-icon-sm"
                                    style={{ opacity: safePage === 1 ? 0.4 : 1, cursor: safePage === 1 ? 'not-allowed' : 'pointer' }}
                                >
                                    <ChevronLeft size={16} />
                                </button>

                                {pageNumbers.map((p, i) =>
                                    p === 'gap' ? (
                                        <span key={`gap-${i}`} style={{ padding: '0 4px', color: 'var(--foreground-secondary)', fontSize: '0.8rem' }}>…</span>
                                    ) : (
                                        <button
                                            key={p}
                                            onClick={() => setCurrentPage(p)}
                                            aria-current={p === safePage ? 'page' : undefined}
                                            style={{
                                                minWidth: 32, height: 32, borderRadius: 8, cursor: 'pointer',
                                                fontSize: '0.8rem', fontWeight: p === safePage ? 700 : 500,
                                                border: `1px solid ${p === safePage ? 'var(--primary)' : 'var(--border)'}`,
                                                background: p === safePage ? 'var(--primary)' : 'transparent',
                                                color: p === safePage ? '#fff' : 'var(--foreground-secondary)',
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            {p}
                                        </button>
                                    )
                                )}

                                <button
                                    onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                                    disabled={safePage === totalPages}
                                    aria-label="Next page"
                                    className="btn btn-ghost btn-icon-sm"
                                    style={{ opacity: safePage === totalPages ? 0.4 : 1, cursor: safePage === totalPages ? 'not-allowed' : 'pointer' }}
                                >
                                    <ChevronRight size={16} />
                                </button>
                                <button
                                    onClick={() => setCurrentPage(totalPages)}
                                    disabled={safePage === totalPages}
                                    aria-label="Last page"
                                    className="btn btn-ghost btn-icon-sm"
                                    style={{ opacity: safePage === totalPages ? 0.4 : 1, cursor: safePage === totalPages ? 'not-allowed' : 'pointer' }}
                                >
                                    <ChevronsRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>

        </div>
    );
}

