'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, RefreshCw, Store, Wifi, WifiOff, Eye, X,
    MapPin, Phone, Star, ShoppingBag, Loader2, ToggleLeft,
    ToggleRight, AlertTriangle, CheckCircle, XCircle,
} from 'lucide-react';

interface Vendor {
    vendorId: string;
    fullName: string;
    shopName: string;
    phoneNumber: string;
    address: string;
    city: string;
    isOnline: boolean;
    isVerified: boolean;
    isSuspended?: boolean;
    rating: number;
    totalOrders: number;
    totalEarnings: number;
    menuItemsCount: number;
    profileImageUrl: string;
    shopImageUrl: string;
    cuisineTypes: string[];
}

export default function VendorStatusPage() {
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
    const [toggling, setToggling] = useState<string | null>(null);
    const [confirmModal, setConfirmModal] = useState<{ vendor: Vendor; targetStatus: boolean } | null>(null);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/vendors');
            const result = await res.json();
            if (result.success) {
                setVendors(result.data.filter((v: Vendor) => v.isVerified));
            }
        } catch {
            console.error('Fetch error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchData();
        setRefreshing(false);
    };

    const handleToggleStatus = async () => {
        if (!confirmModal) return;
        setToggling(confirmModal.vendor.vendorId);

        try {
            const res = await fetch('/api/vendors/toggle-status', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vendorId: confirmModal.vendor.vendorId,
                    isOnline: confirmModal.targetStatus,
                    reason: reason || undefined,
                }),
            });

            const result = await res.json();
            if (result.success) {
                setMessage({ type: 'success', text: result.message });
                setConfirmModal(null);
                setReason('');
                fetchData();
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to update status' });
            }
        } catch {
            setMessage({ type: 'error', text: 'Network error' });
        } finally {
            setToggling(null);
        }
    };

    const filteredVendors = vendors.filter(vendor => {
        const matchesSearch =
            vendor.shopName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            vendor.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            vendor.phoneNumber.includes(searchQuery);
        const matchesStatus =
            statusFilter === 'all' ||
            (statusFilter === 'online' && vendor.isOnline) ||
            (statusFilter === 'offline' && !vendor.isOnline);
        return matchesSearch && matchesStatus;
    });

    // Auto-clear message
    useEffect(() => {
        if (message) {
            const timer = setTimeout(() => setMessage(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center animate-pulse">
                        <RefreshCw className="w-8 h-8 animate-spin text-[var(--primary)]" />
                    </div>
                    <p className="text-[var(--foreground-secondary)] font-medium">Loading vendors...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8" style={{ padding: 20 }}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title">Vendor Status Control</h1>
                    <p className="page-description">Toggle vendors online/offline status</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Toast Message */}
            <AnimatePresence>
                {message && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        style={{
                            padding: '12px 20px', borderRadius: 12,
                            background: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                            border: `1px solid ${message.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                            color: message.type === 'success' ? '#10B981' : '#EF4444',
                            fontWeight: 600, fontSize: '0.85rem',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}
                    >
                        {message.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                        {message.text}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Stats */}
            <div className="grid grid-cols-3" style={{ gap: '1.5rem' }}>
                {[
                    { label: 'Total Vendors', value: vendors.length, icon: Store, color: '#F4511E', bg: 'rgba(244,81,30,0.1)' },
                    { label: 'Online', value: vendors.filter(v => v.isOnline).length, icon: Wifi, color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
                    { label: 'Offline', value: vendors.filter(v => !v.isOnline).length, icon: WifiOff, color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
                ].map((stat, i) => (
                    <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass-card" style={{ padding: '20px 24px' }}>
                        <div className="flex items-start justify-between">
                            <div>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{stat.label}</p>
                                <p style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4 }}>{stat.value}</p>
                            </div>
                            <div style={{ width: 44, height: 44, borderRadius: 12, background: stat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <stat.icon size={22} color={stat.color} />
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Search & Filter */}
            <div className="glass-card p-6">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="input-group flex-1">
                        <Search size={18} className="input-icon" />
                        <input type="text" placeholder="Search vendors..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input" />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {(['all', 'online', 'offline'] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setStatusFilter(f)}
                                style={{
                                    padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
                                    background: statusFilter === f ? 'var(--primary)' : 'transparent',
                                    color: statusFilter === f ? 'white' : 'var(--foreground)',
                                    fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.2s', textTransform: 'capitalize',
                                }}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Vendor List */}
            <div className="grid gap-3">
                <AnimatePresence mode="popLayout">
                    {filteredVendors.length === 0 ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="empty-state glass-card">
                            <div className="empty-state-icon"><Store size={32} /></div>
                            <h3 className="empty-state-title">No vendors found</h3>
                            <p className="empty-state-description">Try adjusting your search or filter.</p>
                        </motion.div>
                    ) : (
                        filteredVendors.map((vendor, index) => (
                            <motion.div
                                key={vendor.vendorId}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.02 }}
                                className="glass-card"
                                style={{ padding: '16px 20px' }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    {/* Avatar */}
                                    <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', background: 'var(--surface-hover)', flexShrink: 0 }}>
                                        {(vendor.shopImageUrl || vendor.profileImageUrl) ? (
                                            <img src={vendor.shopImageUrl || vendor.profileImageUrl} alt={vendor.shopName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Store size={20} color="var(--foreground-secondary)" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>{vendor.shopName || vendor.fullName}</p>
                                            {/* Online indicator */}
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: vendor.isOnline ? '#10B981' : '#9CA3AF', flexShrink: 0 }} />
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                                            {vendor.phoneNumber && (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                                    <Phone size={11} /> {vendor.phoneNumber}
                                                </span>
                                            )}
                                            {vendor.city && (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                                    <MapPin size={11} /> {vendor.city}
                                                </span>
                                            )}
                                            {vendor.rating > 0 && (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#F59E0B' }}>
                                                    <Star size={11} /> {vendor.rating.toFixed(1)}
                                                </span>
                                            )}
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                                <ShoppingBag size={11} /> {vendor.totalOrders} orders
                                            </span>
                                        </div>
                                    </div>

                                    {/* Status Badge */}
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        fontSize: '0.78rem', fontWeight: 600, padding: '6px 14px', borderRadius: 20, flexShrink: 0,
                                        background: vendor.isOnline ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                        color: vendor.isOnline ? '#10B981' : '#EF4444',
                                        border: `1px solid ${vendor.isOnline ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                                    }}>
                                        {vendor.isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                                        {vendor.isOnline ? 'Online' : 'Offline'}
                                    </span>

                                    {/* Toggle Button */}
                                    <button
                                        onClick={() => setConfirmModal({ vendor, targetStatus: !vendor.isOnline })}
                                        disabled={toggling === vendor.vendorId}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', flexShrink: 0,
                                            background: vendor.isOnline ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                                            color: vendor.isOnline ? '#EF4444' : '#10B981',
                                            fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.2s',
                                            opacity: toggling === vendor.vendorId ? 0.5 : 1,
                                        }}
                                    >
                                        {toggling === vendor.vendorId ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : vendor.isOnline ? (
                                            <ToggleLeft size={14} />
                                        ) : (
                                            <ToggleRight size={14} />
                                        )}
                                        {vendor.isOnline ? 'Set Offline' : 'Set Online'}
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>

            {/* ─── Confirm Modal ─── */}
            <AnimatePresence>
                {confirmModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => { setConfirmModal(null); setReason(''); }}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="modal-content w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">
                                    {confirmModal.targetStatus ? '🟢 Set Vendor Online' : '🔴 Set Vendor Offline'}
                                </h2>
                                <button onClick={() => { setConfirmModal(null); setReason(''); }} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body space-y-4">
                                {/* Vendor info */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                    <Store size={18} color="var(--primary)" />
                                    <div>
                                        <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{confirmModal.vendor.shopName || confirmModal.vendor.fullName}</p>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                            Currently {confirmModal.vendor.isOnline ? 'Online' : 'Offline'}  →  Will be {confirmModal.targetStatus ? 'Online' : 'Offline'}
                                        </p>
                                    </div>
                                </div>

                                {!confirmModal.targetStatus && (
                                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F59E0B', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                                            <AlertTriangle size={14} /> Warning
                                        </div>
                                        <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                            Setting a vendor offline will prevent customers from placing new orders. The vendor will see that they were set offline by admin.
                                        </p>
                                    </div>
                                )}

                                {/* Reason */}
                                <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                        Reason (optional)
                                    </label>
                                    <textarea
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        placeholder="Reason for status change..."
                                        rows={2}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none', resize: 'vertical' }}
                                    />
                                </div>

                                {/* Buttons */}
                                <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
                                    <button onClick={() => { setConfirmModal(null); setReason(''); }} style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleToggleStatus}
                                        disabled={toggling !== null}
                                        style={{
                                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                            padding: '10px 16px', borderRadius: 10, border: 'none', cursor: toggling ? 'not-allowed' : 'pointer',
                                            fontWeight: 600, fontSize: '0.85rem', opacity: toggling ? 0.6 : 1,
                                            background: confirmModal.targetStatus ? '#10B981' : '#EF4444', color: 'white',
                                        }}
                                    >
                                        {toggling ? <Loader2 size={16} className="animate-spin" /> : null}
                                        {confirmModal.targetStatus ? 'Set Online' : 'Set Offline'}
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

