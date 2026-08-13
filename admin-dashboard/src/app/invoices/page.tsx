'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    FileText,
    Download,
    Eye,
    X,
    RefreshCw,
    Calendar,
    Store,
    User,
    ShoppingBag,
    Filter,
    ChevronDown,
    Loader2,
    CheckCircle,
    Clock,
    AlertTriangle,
    Receipt,
    IndianRupee,
    TrendingUp,
} from 'lucide-react';
import { useApi, Order } from '@/hooks/useApi';
import { authenticatedFetch } from '@/lib/api-client';

export default function InvoicesPage() {
    const { data: orders, loading, refetch } = useApi<Order[]>('/api/orders');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('Delivered');
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
    const [previewData, setPreviewData] = useState<any>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const statusFilters = ['All', 'Delivered', 'Pending', 'Accepted', 'Preparing', 'Picked Up', 'Cancelled'];

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setTimeout(() => setRefreshing(false), 500);
    };

    // Filter orders
    const filteredOrders = useMemo(() => {
        if (!orders) return [];
        let filtered = [...orders];

        // Status filter
        if (statusFilter !== 'All') {
            filtered = filtered.filter(o => o.status === statusFilter);
        }

        // Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(o =>
                o.orderId?.toLowerCase().includes(q) ||
                o.customerName?.toLowerCase().includes(q) ||
                o.vendorName?.toLowerCase().includes(q) ||
                o.customerPhone?.includes(q)
            );
        }

        // Date range
        if (dateFrom) {
            const from = new Date(dateFrom);
            filtered = filtered.filter(o => new Date(o.createdAt) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo);
            to.setHours(23, 59, 59, 999);
            filtered = filtered.filter(o => new Date(o.createdAt) <= to);
        }

        return filtered;
    }, [orders, statusFilter, searchQuery, dateFrom, dateTo]);

    // Stats
    const stats = useMemo(() => {
        if (!orders) return { total: 0, delivered: 0, revenue: 0, avgValue: 0 };
        const delivered = orders.filter(o => o.status === 'Delivered');
        const revenue = delivered.reduce((sum, o) => sum + (o.total || 0), 0);
        return {
            total: orders.length,
            delivered: delivered.length,
            revenue,
            avgValue: delivered.length > 0 ? revenue / delivered.length : 0,
        };
    }, [orders]);

    // Download PDF — supports typed invoices
    const handleDownloadPDF = async (orderId: string, type?: 'food' | 'delivery' | 'platform') => {
        const dlKey = type ? `${orderId}-${type}` : orderId;
        setDownloadingId(dlKey);
        try {
            const typeParam = type ? `&type=${type}` : '';
            const res = await authenticatedFetch(`/api/invoices/${orderId}?format=pdf${typeParam}`);
            if (!res.ok) {
                const err = await res.json();
                alert(err.error || 'Failed to generate invoice');
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const label = type ? `-${type.charAt(0).toUpperCase() + type.slice(1)}` : '';
            a.download = `Invoice-${orderId.slice(-8).toUpperCase()}${label}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch {
            alert('Failed to download invoice. Please try again.');
        } finally {
            setDownloadingId(null);
        }
    };

    // Export the filtered invoice list (opens directly in Excel)
    const handleExport = () => {
        const headers = [
            'Invoice No.', 'Food Invoice No.', 'Delivery Invoice No.', 'Platform Invoice No.',
            'Order ID', 'Date', 'Time', 'Customer', 'Phone', 'Vendor', 'Status',
            'Payment Mode', 'Payment Status',
            'Gross Item Total', 'Item Discount', 'Item Total',
            'Promo Discount', 'Coin Discount', 'HungerGame Discount', 'Delivery Discount',
            'Total Discount', 'Delivery Fee', 'Platform Fee', 'Taxes (GST)', 'Grand Total',
        ];
        const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = filteredOrders.map(o => {
            const d = new Date(o.createdAt);
            const inv = o.invoiceNumber && o.invoiceNumber !== 'Not issued' ? o.invoiceNumber : '';
            const itemDiscount = o.itemDiscount || 0;
            return [
                esc(o.invoiceNumber || ''),
                esc(inv ? `${inv}-F` : ''),
                esc(inv && (o.deliveryFee || 0) > 0 ? `${inv}-D` : ''),
                esc(inv && (o.smallOrderSupportFee || 0) > 0 ? `${inv}-P` : ''),
                esc(o.orderId),
                esc(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })),
                esc(d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })),
                esc(o.customerName || ''),
                esc(o.customerPhone || ''),
                esc(o.vendorName || ''),
                esc(o.status),
                esc(o.paymentMode),
                esc(o.paymentStatus),
                ((o.itemTotal || 0) + itemDiscount).toFixed(2),
                itemDiscount.toFixed(2),
                (o.itemTotal || 0).toFixed(2),
                (o.promoDiscount || 0).toFixed(2),
                (o.coinDiscount || 0).toFixed(2),
                (o.hungerGameDiscount || 0).toFixed(2),
                (o.deliveryDiscount || 0).toFixed(2),
                (o.totalDiscount || 0).toFixed(2),
                (o.deliveryFee || 0).toFixed(2),
                (o.smallOrderSupportFee || 0).toFixed(2),
                (o.taxes || 0).toFixed(2),
                (o.total || 0).toFixed(2),
            ].join(',');
        });
        const csv = '﻿' + [headers.map(esc).join(','), ...rows].join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `Invoices_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Preview invoice
    const handlePreview = async (order: Order) => {
        setPreviewOrder(order);
        setPreviewLoading(true);
        try {
            const res = await authenticatedFetch(`/api/invoices/${order.orderId}`);
            const result = await res.json();
            if (result.success) {
                setPreviewData(result.data);
            }
        } catch {
            // Silent fail
        } finally {
            setPreviewLoading(false);
        }
    };

    const formatDateTime = (dateStr: string) => {
        if (!dateStr) return 'N/A';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
            ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Delivered': return { bg: 'rgba(16,185,129,0.1)', color: '#10B981', border: 'rgba(16,185,129,0.25)' };
            case 'Pending': return { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B', border: 'rgba(245,158,11,0.25)' };
            case 'Cancelled': return { bg: 'rgba(239,68,68,0.1)', color: '#EF4444', border: 'rgba(239,68,68,0.25)' };
            case 'Preparing': return { bg: 'rgba(59,130,246,0.1)', color: '#3B82F6', border: 'rgba(59,130,246,0.25)' };
            default: return { bg: 'var(--surface-hover)', color: 'var(--foreground-secondary)', border: 'var(--glass-border)' };
        }
    };

    return (
        <div className="page-container">
            {/* ─── Header ─── */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <Receipt size={28} style={{ color: 'var(--primary)' }} />
                        Invoices
                    </h1>
                    <p className="page-subtitle">Generate and download tax invoices for all orders</p>
                </div>
                <div className="page-header-actions">
                    <button onClick={handleExport} className="btn btn-outline" disabled={filteredOrders.length === 0}>
                        <Download size={16} />
                        Export Excel
                    </button>
                    <button
                        onClick={handleRefresh}
                        className="btn btn-outline"
                        disabled={refreshing}
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ─── Stats Cards ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                {[
                    { label: 'Total Orders', value: stats.total, icon: <ShoppingBag size={20} />, color: '#F4511E' },
                    { label: 'Delivered Orders', value: stats.delivered, icon: <CheckCircle size={20} />, color: '#10B981' },
                    { label: 'Total Revenue', value: `₹${stats.revenue.toLocaleString('en-IN')}`, icon: <IndianRupee size={20} />, color: '#F59E0B' },
                    { label: 'Avg Order Value', value: `₹${Math.round(stats.avgValue).toLocaleString('en-IN')}`, icon: <TrendingUp size={20} />, color: '#8B5CF6' },
                ].map((stat, i) => (
                    <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="glass-card"
                        style={{ padding: '16px 20px' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{stat.label}</p>
                                <p style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--foreground)' }}>{stat.value}</p>
                            </div>
                            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${stat.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: stat.color }}>
                                {stat.icon}
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* ─── Filters ─── */}
            <div className="glass-card" style={{ padding: '16px 20px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                {/* Search */}
                <div style={{ flex: '1 1 250px', position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search by Order ID, customer, vendor..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%', padding: '10px 12px 10px 36px', borderRadius: 10,
                            border: '1px solid var(--border)', background: 'var(--surface)',
                            color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none',
                        }}
                    />
                </div>

                {/* Status filter */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '10px 16px', borderRadius: 10,
                            border: '1px solid var(--border)', background: 'var(--surface)',
                            color: 'var(--foreground)', fontSize: '0.85rem', cursor: 'pointer',
                        }}
                    >
                        <Filter size={14} />
                        {statusFilter}
                        <ChevronDown size={14} />
                    </button>
                    {showFilterDropdown && (
                        <div style={{
                            position: 'absolute', top: '100%', left: 0, zIndex: 30,
                            marginTop: 4, borderRadius: 10, overflow: 'hidden',
                            background: 'var(--surface)', border: '1px solid var(--border)',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.15)', minWidth: 160,
                        }}>
                            {statusFilters.map(sf => (
                                <button
                                    key={sf}
                                    onClick={() => { setStatusFilter(sf); setShowFilterDropdown(false); }}
                                    style={{
                                        display: 'block', width: '100%', textAlign: 'left',
                                        padding: '10px 16px', border: 'none', cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        background: sf === statusFilter ? 'var(--surface-hover)' : 'transparent',
                                        color: sf === statusFilter ? 'var(--primary)' : 'var(--foreground)',
                                        fontWeight: sf === statusFilter ? 600 : 400,
                                    }}
                                >
                                    {sf}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Date filters */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} className="filter-date-group">
                    <Calendar size={14} style={{ color: 'var(--foreground-secondary)' }} />
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        style={{
                            padding: '8px 12px', borderRadius: 8,
                            border: '1px solid var(--border)', background: 'var(--surface)',
                            color: 'var(--foreground)', fontSize: '0.82rem',
                        }}
                    />
                    <span style={{ color: 'var(--foreground-secondary)', fontSize: '0.82rem' }}>to</span>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        style={{
                            padding: '8px 12px', borderRadius: 8,
                            border: '1px solid var(--border)', background: 'var(--surface)',
                            color: 'var(--foreground)', fontSize: '0.82rem',
                        }}
                    />
                </div>

                {/* Clear filters */}
                {(searchQuery || statusFilter !== 'Delivered' || dateFrom || dateTo) && (
                    <button
                        onClick={() => { setSearchQuery(''); setStatusFilter('Delivered'); setDateFrom(''); setDateTo(''); }}
                        style={{
                            padding: '8px 14px', borderRadius: 8, border: 'none',
                            background: 'rgba(239,68,68,0.1)', color: '#EF4444',
                            fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        Clear Filters
                    </button>
                )}
            </div>

            {/* ─── Results Count ─── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '0 4px' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)' }}>
                    Showing <strong>{filteredOrders.length}</strong> orders
                    {statusFilter !== 'All' && <> with status <strong>{statusFilter}</strong></>}
                </p>
            </div>

            {/* ─── Orders Table ─── */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                    <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                    <FileText size={48} style={{ color: 'var(--foreground-secondary)', opacity: 0.3, margin: '0 auto 12px' }} />
                    <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground-secondary)' }}>No orders found</p>
                    <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Try changing the filters or search query</p>
                </div>
            ) : (
                <div className="glass-card" style={{ overflow: 'hidden' }}>
                    {/* Table header */}
                    <div className="invoice-table-header">
                        <span>Order / Invoice No.</span>
                        <span>Customer</span>
                        <span className="invoice-col-vendor">Vendor</span>
                        <span>Date</span>
                        <span>Amount</span>
                        <span className="invoice-col-status">Status</span>
                        <span style={{ textAlign: 'right' }}>Actions</span>
                    </div>

                    {/* Table rows */}
                    {filteredOrders.map((order, index) => {
                        const sc = getStatusColor(order.status);
                        return (
                            <motion.div
                                key={order.orderId}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: index * 0.02 }}
                                className="invoice-table-row"
                                style={{
                                    borderBottom: '1px solid var(--glass-border)',
                                    transition: 'background 0.15s',
                                    cursor: 'default',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                                {/* Order ID + issued invoice number */}
                                <div>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.82rem' }}>
                                        #{order.orderId?.slice(-8).toUpperCase()}
                                    </span>
                                    {order.invoiceNumber && order.invoiceNumber !== 'Not issued' && (
                                        <p style={{ fontFamily: 'monospace', fontSize: '0.66rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                            {order.invoiceNumber}
                                        </p>
                                    )}
                                </div>

                                {/* Customer */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(244,81,30,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <User size={14} style={{ color: '#F4511E' }} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <p style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{order.customerName || 'Unknown'}</p>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{order.customerPhone || ''}</p>
                                    </div>
                                </div>

                                {/* Vendor */}
                                <div className="invoice-col-vendor" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(245,158,11,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <Store size={14} style={{ color: '#F59E0B' }} />
                                    </div>
                                    <p style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{order.vendorName || 'Unknown'}</p>
                                </div>

                                {/* Date */}
                                <div>
                                    <p style={{ fontSize: '0.78rem' }}>{new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</p>
                                    <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>{new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                                </div>

                                {/* Amount */}
                                <div>
                                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>₹{(order.total || 0).toLocaleString('en-IN')}</span>
                                </div>

                                {/* Status */}
                                <div className="invoice-col-status">
                                    <span style={{
                                        display: 'inline-block', padding: '3px 10px',
                                        borderRadius: 20, fontSize: '0.68rem', fontWeight: 600,
                                        background: sc.bg, color: sc.color,
                                        border: `1px solid ${sc.border}`,
                                    }}>
                                        {order.status}
                                    </span>
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                    <button
                                        onClick={() => handlePreview(order)}
                                        title="Preview Invoice"
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 4,
                                            padding: '5px 8px', borderRadius: 6,
                                            border: '1px solid var(--border)', background: 'var(--surface)',
                                            color: 'var(--foreground)', fontSize: '0.68rem',
                                            fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                                        }}
                                    >
                                        <Eye size={12} /> Preview
                                    </button>
                                    {[
                                        { type: 'food' as const, label: '🍽️ Food', color: '#D84315', disabled: false },
                                        { type: 'delivery' as const, label: '🚴 Delivery', color: '#2196F3', disabled: (order.deliveryFee || 0) === 0 },
                                        { type: 'platform' as const, label: '📋 Platform', color: '#4CAF50', disabled: (order.smallOrderSupportFee || 0) === 0 },
                                    ].map(inv => (
                                        <button
                                            key={inv.type}
                                            onClick={() => handleDownloadPDF(order.orderId, inv.type)}
                                            disabled={inv.disabled || downloadingId === `${order.orderId}-${inv.type}`}
                                            title={inv.disabled ? `No ${inv.type} fee for this order` : `Download ${inv.label} Invoice`}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 3,
                                                padding: '5px 8px', borderRadius: 6, border: 'none',
                                                background: inv.color, color: 'white',
                                                fontSize: '0.65rem', fontWeight: 600,
                                                cursor: inv.disabled ? 'not-allowed' : (downloadingId === `${order.orderId}-${inv.type}` ? 'wait' : 'pointer'),
                                                opacity: inv.disabled ? 0.35 : (downloadingId === `${order.orderId}-${inv.type}` ? 0.6 : 1),
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            {downloadingId === `${order.orderId}-${inv.type}` ? (
                                                <Loader2 size={11} className="animate-spin" />
                                            ) : (
                                                <Download size={11} />
                                            )}
                                            {inv.label}
                                        </button>
                                    ))}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {/* ─── Invoice Preview Modal ─── */}
            <AnimatePresence>
                {previewOrder && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                        onClick={() => { setPreviewOrder(null); setPreviewData(null); }}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="modal-content w-full"
                            style={{ maxWidth: 680, maxHeight: '90vh', overflow: 'auto' }}
                            onClick={e => e.stopPropagation()}
                        >
                            {/* Modal header */}
                            <div className="modal-header" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)', borderBottom: '1px solid var(--glass-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <Receipt size={20} style={{ color: 'var(--primary)' }} />
                                    <div>
                                        <h2 className="modal-title" style={{ marginBottom: 0 }}>Invoice Preview</h2>
                                        <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                            Order #{previewOrder.orderId?.slice(-8).toUpperCase()}
                                        </p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                    {[
                                        { type: 'food' as const, label: '🍽️ Food', color: '#D84315' },
                                        { type: 'delivery' as const, label: '🚴 Delivery', color: '#2196F3' },
                                        { type: 'platform' as const, label: '📋 Platform', color: '#4CAF50' },
                                    ].map(inv => (
                                        <button
                                            key={inv.type}
                                            onClick={() => handleDownloadPDF(previewOrder.orderId, inv.type)}
                                            disabled={downloadingId === `${previewOrder.orderId}-${inv.type}`}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 5,
                                                padding: '7px 12px', borderRadius: 8, border: 'none',
                                                background: inv.color, color: 'white',
                                                fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                                                opacity: downloadingId === `${previewOrder.orderId}-${inv.type}` ? 0.6 : 1,
                                            }}
                                        >
                                            {downloadingId === `${previewOrder.orderId}-${inv.type}` ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                                            {inv.label}
                                        </button>
                                    ))}
                                    <button onClick={() => { setPreviewOrder(null); setPreviewData(null); }} className="btn btn-ghost btn-icon-sm">
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* Modal body */}
                            <div className="modal-body" style={{ padding: 20 }}>
                                {previewLoading ? (
                                    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                                        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} />
                                    </div>
                                ) : previewData ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                        {/* Invoice header */}
                                        <div style={{
                                            padding: '16px 20px', borderRadius: 12,
                                            background: 'linear-gradient(135deg, #1C1B1F, #37474F)',
                                            color: 'white',
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div>
                                                    <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{previewData.platform.name}</h3>
                                                    <p style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 2 }}>{previewData.platform.legalName}</p>
                                                    {previewData.platform.gstin && (
                                                        <p style={{ fontSize: '0.72rem', opacity: 0.7, marginTop: 2 }}>GSTIN: {previewData.platform.gstin}</p>
                                                    )}
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <p style={{ fontSize: '1rem', fontWeight: 700 }}>{previewData.invoiceType}</p>
                                                    <p style={{ fontSize: '0.78rem', opacity: 0.8, marginTop: 2 }}>{previewData.invoiceNumber}</p>
                                                    <p style={{ fontSize: '0.72rem', opacity: 0.7, marginTop: 2 }}>{previewData.invoiceDate}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Order info bar */}
                                        <div className="invoice-order-info-grid" style={{
                                            padding: '12px 16px', borderRadius: 10,
                                            background: 'var(--surface-hover)', border: '1px solid var(--glass-border)',
                                        }}>
                                            <div>
                                                <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Order ID</p>
                                                <p style={{ fontSize: '0.82rem', fontWeight: 600, fontFamily: 'monospace' }}>{previewData.orderId}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Date & Time</p>
                                                <p style={{ fontSize: '0.82rem', fontWeight: 500 }}>{previewData.orderDate} {previewData.orderTime}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Payment</p>
                                                <p style={{ fontSize: '0.82rem', fontWeight: 500 }}>{previewData.paymentMode}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Status</p>
                                                <p style={{ fontSize: '0.82rem', fontWeight: 600, color: previewData.orderStatus === 'Delivered' ? '#10B981' : '#F59E0B' }}>{previewData.orderStatus}</p>
                                            </div>
                                        </div>

                                        {/* Customer & Vendor side by side */}
                                        <div className="invoice-parties-grid">
                                            <div style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Bill To (Customer)</p>
                                                <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{previewData.customer.name}</p>
                                                {previewData.customer.phone && <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 3 }}>📱 {previewData.customer.phone}</p>}
                                                {previewData.customer.deliveryAddress && <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 3 }}>📍 {previewData.customer.deliveryAddress}</p>}
                                            </div>
                                            <div style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Supplied By (Restaurant)</p>
                                                <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{previewData.vendor.name}</p>
                                                {previewData.vendor.address && <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 3 }}>📍 {previewData.vendor.address}{previewData.vendor.city ? `, ${previewData.vendor.city}` : ''}</p>}
                                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 3 }}>GSTIN: {previewData.vendor.gstin || 'Unregistered'}</p>
                                                {previewData.vendor.fssaiLicense && <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>FSSAI: {previewData.vendor.fssaiLicense}</p>}
                                            </div>
                                        </div>

                                        {/* Items table */}
                                        <div>
                                            <p style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Item Details</p>
                                            <div className="invoice-items-scroll">
                                            <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                                                {/* Header */}
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: '30px 2fr 50px 70px 60px 70px 60px 60px 70px',
                                                    padding: '8px 12px',
                                                    background: 'var(--primary)',
                                                    color: 'white',
                                                    fontSize: '0.65rem',
                                                    fontWeight: 700,
                                                }}>
                                                    <span>#</span>
                                                    <span>Item</span>
                                                    <span style={{ textAlign: 'center' }}>Qty</span>
                                                    <span style={{ textAlign: 'right' }}>Rate</span>
                                                    <span style={{ textAlign: 'right' }}>Disc.</span>
                                                    <span style={{ textAlign: 'right' }}>Taxable</span>
                                                    <span style={{ textAlign: 'right' }}>CGST</span>
                                                    <span style={{ textAlign: 'right' }}>SGST</span>
                                                    <span style={{ textAlign: 'right' }}>Total</span>
                                                </div>
                                                {/* Rows */}
                                                {previewData.items.map((item: any, i: number) => (
                                                    <div key={i} style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '30px 2fr 50px 70px 60px 70px 60px 60px 70px',
                                                        padding: '8px 12px',
                                                        fontSize: '0.78rem',
                                                        borderBottom: i < previewData.items.length - 1 ? '1px solid var(--glass-border)' : 'none',
                                                        background: i % 2 === 0 ? 'transparent' : 'var(--surface-hover)',
                                                    }}>
                                                        <span style={{ color: 'var(--foreground-secondary)' }}>{item.slNo}</span>
                                                        <span style={{ fontWeight: 500 }}>{item.name}</span>
                                                        <span style={{ textAlign: 'center' }}>{item.quantity}</span>
                                                        <span style={{ textAlign: 'right' }}>₹{item.unitPrice.toFixed(2)}</span>
                                                        <span style={{ textAlign: 'right', color: (item.discount || 0) > 0 ? '#10B981' : 'var(--foreground-secondary)' }}>{(item.discount || 0) > 0 ? `-₹${item.discount.toFixed(2)}` : '—'}</span>
                                                        <span style={{ textAlign: 'right' }}>₹{item.taxableValue.toFixed(2)}</span>
                                                        <span style={{ textAlign: 'right', fontSize: '0.72rem' }}>₹{item.cgstAmount.toFixed(2)}<br /><span style={{ color: 'var(--foreground-secondary)', fontSize: '0.62rem' }}>({item.cgstRate}%)</span></span>
                                                        <span style={{ textAlign: 'right', fontSize: '0.72rem' }}>₹{item.sgstAmount.toFixed(2)}<br /><span style={{ color: 'var(--foreground-secondary)', fontSize: '0.62rem' }}>({item.sgstRate}%)</span></span>
                                                        <span style={{ textAlign: 'right', fontWeight: 600 }}>₹{item.totalAmount.toFixed(2)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            </div>
                                        </div>

                                        {/* Tax summary */}
                                        {previewData.taxSummary.length > 0 && (
                                            <div>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Tax Summary</p>
                                                <div className="invoice-tax-scroll">
                                                <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                                                    <div style={{
                                                        display: 'grid', gridTemplateColumns: '2fr 1fr 0.6fr 0.8fr 0.6fr 0.8fr 1fr',
                                                        padding: '8px 12px', background: '#505050', color: 'white',
                                                        fontSize: '0.65rem', fontWeight: 700,
                                                    }}>
                                                        <span>Description</span>
                                                        <span style={{ textAlign: 'right' }}>Taxable</span>
                                                        <span style={{ textAlign: 'center' }}>CGST%</span>
                                                        <span style={{ textAlign: 'right' }}>CGST</span>
                                                        <span style={{ textAlign: 'center' }}>SGST%</span>
                                                        <span style={{ textAlign: 'right' }}>SGST</span>
                                                        <span style={{ textAlign: 'right' }}>Total Tax</span>
                                                    </div>
                                                    {previewData.taxSummary.map((row: any, i: number) => (
                                                        <div key={i} style={{
                                                            display: 'grid', gridTemplateColumns: '2fr 1fr 0.6fr 0.8fr 0.6fr 0.8fr 1fr',
                                                            padding: '8px 12px', fontSize: '0.78rem',
                                                            borderBottom: i < previewData.taxSummary.length - 1 ? '1px solid var(--glass-border)' : 'none',
                                                        }}>
                                                            <span>{row.description}</span>
                                                            <span style={{ textAlign: 'right' }}>₹{row.taxableAmount.toFixed(2)}</span>
                                                            <span style={{ textAlign: 'center' }}>{row.cgstRate}%</span>
                                                            <span style={{ textAlign: 'right' }}>₹{row.cgstAmount.toFixed(2)}</span>
                                                            <span style={{ textAlign: 'center' }}>{row.sgstRate}%</span>
                                                            <span style={{ textAlign: 'right' }}>₹{row.sgstAmount.toFixed(2)}</span>
                                                            <span style={{ textAlign: 'right', fontWeight: 600 }}>₹{row.totalTax.toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Bill summary */}
                                        <div style={{
                                            padding: '16px 20px', borderRadius: 10,
                                            background: 'var(--surface-hover)', border: '1px solid var(--glass-border)',
                                        }}>
                                            <p style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>Bill Summary</p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {(previewData.billSummary.itemDiscount || 0) > 0 ? (
                                                    <>
                                                        <BillRow label="Item Total (Gross)" amount={previewData.billSummary.itemTotal + previewData.billSummary.itemDiscount} />
                                                        <BillRow label="Item Discount" amount={previewData.billSummary.itemDiscount} isNeg />
                                                    </>
                                                ) : (
                                                    previewData.billSummary.itemTotal > 0 && <BillRow label="Item Total" amount={previewData.billSummary.itemTotal} />
                                                )}
                                                {previewData.billSummary.discount > 0 && <BillRow label="Discount" amount={previewData.billSummary.discount} isNeg />}
                                                {(previewData.billSummary.hungerGameDiscount || 0) > 0 && <BillRow label="🎮 HungerGame Discount" amount={previewData.billSummary.hungerGameDiscount} isNeg />}
                                                {previewData.billSummary.coinDiscount > 0 && <BillRow label="🪙 Coin Discount" amount={previewData.billSummary.coinDiscount} isNeg />}
                                                {previewData.billSummary.promoDiscount > 0 && <BillRow label="🎟️ Promo Discount" amount={previewData.billSummary.promoDiscount} isNeg />}
                                                {(previewData.billSummary.deliveryDiscount || 0) > 0 && <BillRow label="🚴 Delivery Discount" amount={previewData.billSummary.deliveryDiscount} isNeg />}
                                                {previewData.billSummary.deliveryFee > 0 && <BillRow label="Delivery Fee" amount={previewData.billSummary.deliveryFee} />}
                                                {previewData.billSummary.packagingFee > 0 && <BillRow label="Platform Fee" amount={previewData.billSummary.packagingFee} />}
                                                {previewData.billSummary.tip > 0 && <BillRow label="Delivery Tip" amount={previewData.billSummary.tip} />}
                                                {(previewData.billSummary.cgst > 0 || previewData.billSummary.sgst > 0) && (
                                                    <>
                                                        <BillRow label="CGST" amount={previewData.billSummary.cgst} />
                                                        <BillRow label="SGST" amount={previewData.billSummary.sgst} />
                                                    </>
                                                )}
                                                {(previewData.billSummary.roundOff != null && previewData.billSummary.roundOff !== 0) && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                                        <span style={{ color: 'var(--foreground-secondary)' }}>Round Off</span>
                                                        <span style={{ color: 'var(--foreground-secondary)', fontWeight: 500 }}>
                                                            {previewData.billSummary.roundOff > 0 ? '+' : '−'}₹{Math.abs(previewData.billSummary.roundOff).toFixed(2)}
                                                        </span>
                                                    </div>
                                                )}

                                                <div style={{ height: 1, background: 'var(--primary)', margin: '6px 0' }} />

                                                {previewData.billSummary.totalTax > 0 && (
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                                        <span style={{ color: 'var(--foreground-secondary)', fontWeight: 500 }}>Total Tax (GST)</span>
                                                        <span style={{ fontWeight: 500 }}>₹{previewData.billSummary.totalTax.toFixed(2)}</span>
                                                    </div>
                                                )}

                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>GRAND TOTAL</span>
                                                    <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)' }}>₹{previewData.billSummary.grandTotal.toFixed(2)}</span>
                                                </div>

                                                {/* Computed total verification */}
                                                {(() => {
                                                    const computed = (previewData.billSummary.itemTotal || 0)
                                                        - (previewData.billSummary.discount || 0)
                                                        - (previewData.billSummary.hungerGameDiscount || 0)
                                                        - (previewData.billSummary.coinDiscount || 0)
                                                        - (previewData.billSummary.promoDiscount || 0)
                                                        - (previewData.billSummary.deliveryDiscount || 0)
                                                        + (previewData.billSummary.deliveryFee || 0)
                                                        + (previewData.billSummary.packagingFee || 0)
                                                        + (previewData.billSummary.tip || 0)
                                                        + (previewData.billSummary.cgst || 0)
                                                        + (previewData.billSummary.sgst || 0)
                                                        + (previewData.billSummary.roundOff || 0);
                                                    const diff = Math.abs(computed - previewData.billSummary.grandTotal);
                                                    if (diff > 1 && previewData.billSummary.grandTotal > 0) {
                                                        return (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', marginTop: 4 }}>
                                                                <AlertTriangle size={13} style={{ color: '#F59E0B' }} />
                                                                <span style={{ fontSize: '0.7rem', color: '#F59E0B' }}>
                                                                    Note: Grand total (₹{previewData.billSummary.grandTotal.toFixed(2)}) differs from computed sum (₹{computed.toFixed(2)}) — this may be due to rounding in the app.
                                                                </span>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                        </div>

                                        {/* Footer note */}
                                        <div style={{
                                            padding: '12px 16px', borderRadius: 8,
                                            background: 'rgba(28,27,31,0.04)',
                                            border: '1px solid rgba(28,27,31,0.12)',
                                        }}>
                                            <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', fontStyle: 'italic', lineHeight: 1.6 }}>
                                                This is a computer-generated invoice and does not require a physical signature.
                                                {previewData.onBehalfOf || `This invoice is generated by ${previewData.platform.name}.`}{' '}
                                                For queries, contact {previewData.platform.email}
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: 30 }}>
                                        <AlertTriangle size={32} style={{ color: '#F59E0B', margin: '0 auto 10px' }} />
                                        <p style={{ fontSize: '0.88rem', color: 'var(--foreground-secondary)' }}>Failed to load invoice preview</p>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// Helper component for bill summary rows
function BillRow({ label, amount, isNeg = false }: { label: string; amount: number; isNeg?: boolean }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ color: isNeg ? '#10B981' : 'var(--foreground-secondary)' }}>{label}</span>
            <span style={{ color: isNeg ? '#10B981' : 'var(--foreground)', fontWeight: 500 }}>
                {isNeg ? '-' : ''}₹{amount.toFixed(2)}
            </span>
        </div>
    );
}







