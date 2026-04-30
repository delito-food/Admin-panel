'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    Filter,
    Eye,
    MoreVertical,
    Store,
    Phone,
    Mail,
    MapPin,
    Star,
    Power,
    Ban,
    CheckCircle,
    X,
    ChevronDown,
    IndianRupee,
    UtensilsCrossed,
    Clock,
    FileText,
    Loader2,
    Tag,
    ExternalLink,
    Users,
    TrendingUp,
    ShoppingBag,
    RefreshCw
} from 'lucide-react';
import { useApi, apiPatch, Vendor } from '@/hooks/useApi';

const statusFilters = ['All', 'Active', 'Suspended'];
const onlineFilters = ['All', 'Online', 'Offline'];

export default function VendorsPage() {
    const { data: vendorsData, loading, refetch } = useApi<Vendor[]>('/api/vendors');
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [onlineFilter, setOnlineFilter] = useState('All');
    const router = useRouter();
    const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [showOnlineDropdown, setShowOnlineDropdown] = useState(false);
    const [actionMenuId, setActionMenuId] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    // Suspend modal
    const [suspendTarget, setSuspendTarget] = useState<Vendor | null>(null);
    const [suspensionReason, setSuspensionReason] = useState('');
    const [suspensionNotes, setSuspensionNotes] = useState('');
    const [suspending, setSuspending] = useState(false);
    const [suspendError, setSuspendError] = useState('');

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    useEffect(() => {
        if (vendorsData) {
            setVendors(vendorsData);
        }
    }, [vendorsData]);

    const filteredVendors = vendors.filter(vendor => {
        const matchesSearch =
            vendor.shopName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            vendor.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            vendor.phoneNumber.includes(searchQuery);

        const matchesStatus = statusFilter === 'All' ||
            vendor.status.toLowerCase() === statusFilter.toLowerCase();

        const matchesOnline = onlineFilter === 'All' ||
            (onlineFilter === 'Online' && vendor.isOnline) ||
            (onlineFilter === 'Offline' && !vendor.isOnline);

        return matchesSearch && matchesStatus && matchesOnline;
    });

    const handleSuspend = async () => {
        if (!suspendTarget || !suspensionReason) return;
        setSuspending(true);
        setSuspendError('');
        try {
            const res = await fetch('/api/vendors/suspend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vendorId: suspendTarget.vendorId, reason: suspensionReason, notes: suspensionNotes }),
            });
            const result = await res.json();
            if (result.success) {
                setVendors(prev => prev.map(v => v.vendorId === suspendTarget.vendorId ? { ...v, status: 'suspended', isSuspended: true } : v));
                setSuspendTarget(null);
                setSuspensionReason('');
                setSuspensionNotes('');
            } else {
                setSuspendError(result.error || 'Failed to suspend vendor');
            }
        } catch {
            setSuspendError('Network error. Please try again.');
        } finally {
            setSuspending(false);
        }
    };

    const handleReinstate = async (vendorId: string) => {
        if (!confirm('Reinstate this vendor?')) return;
        setUpdating(vendorId);
        try {
            const res = await fetch(`/api/vendors/suspend?vendorId=${vendorId}&adminId=admin`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                setVendors(prev => prev.map(v => v.vendorId === vendorId ? { ...v, status: 'active', isSuspended: false } : v));
            }
        } catch { /* ignore */ } finally {
            setUpdating(null);
            setActionMenuId(null);
        }
    };

    const toggleVendorOnline = async (vendorId: string) => {
        const vendor = vendors.find(v => v.vendorId === vendorId);
        if (!vendor) return;

        setUpdating(vendorId);

        const result = await apiPatch('/api/vendors', {
            vendorId,
            updates: { isOnline: !vendor.isOnline }
        });

        if (result.success) {
            setVendors(prev => prev.map(v =>
                v.vendorId === vendorId ? { ...v, isOnline: !v.isOnline } : v
            ));
            if (selectedVendor?.vendorId === vendorId) {
                setSelectedVendor({ ...selectedVendor, isOnline: !selectedVendor.isOnline });
            }
        }
        setUpdating(null);
        setActionMenuId(null);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const stats = {
        total: vendors.length,
        active: vendors.filter(v => v.status === 'active').length,
        online: vendors.filter(v => v.isOnline).length,
        totalOrders: vendors.reduce((sum, v) => sum + (v.totalOrders || 0), 0),
    };

    if (loading) {
        return (
            <div className="space-y-8">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Vendors</h1>
                    <p className="text-[var(--foreground-secondary)] mt-1">Loading vendors...</p>
                </div>
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-10 h-10 animate-spin text-[var(--primary)]" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--foreground)]">Vendors</h1>
                    <p className="text-[var(--foreground-secondary)] mt-1">Manage registered vendors and their shops</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="btn btn-primary flex items-center gap-2"
                    style={{ opacity: refreshing ? 0.6 : 1 }}
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Premium Stats Section */}
            <section>
                <div className="section-header">
                    <div className="section-title">
                        <div className="icon"><TrendingUp size={18} /></div>
                        Overview
                    </div>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                        { label: 'Total Vendors', value: stats.total, icon: Store, gradient: 'var(--gradient-primary)' },
                        { label: 'Active', value: stats.active, icon: CheckCircle, gradient: 'var(--gradient-success)' },
                        { label: 'Online Now', value: stats.online, icon: Power, gradient: 'var(--gradient-warning)' },
                        { label: 'Total Orders', value: stats.totalOrders.toLocaleString(), icon: ShoppingBag, gradient: 'var(--gradient-error)' },
                    ].map((stat, index) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="stat-card-premium"
                        >
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="stat-label">{stat.label}</p>
                                    <p className="stat-value">{stat.value}</p>
                                </div>
                                <div className="icon-box" style={{ background: stat.gradient }}>
                                    <stat.icon size={24} className="text-white" />
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* Search and Filters */}
            <section>
                <div className="section-header">
                    <div className="section-title">
                        <div className="icon"><Users size={18} /></div>
                        Vendor List
                        <span className="section-badge">{filteredVendors.length}</span>
                    </div>
                </div>

                <div className="glass-card p-4 mb-6">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--foreground-secondary)]" />
                            <input
                                type="text"
                                placeholder="Search by shop name, owner, or phone..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="input pl-10"
                            />
                        </div>

                        {/* Status Filter */}
                        <div className="relative">
                            <button
                                onClick={() => { setShowStatusDropdown(!showStatusDropdown); setShowOnlineDropdown(false); }}
                                className="btn btn-outline w-full sm:w-auto"
                            >
                                <Filter size={16} />
                                {statusFilter}
                                <ChevronDown size={16} />
                            </button>

                            <AnimatePresence>
                                {showStatusDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="dropdown-menu right-0"
                                    >
                                        {statusFilters.map(status => (
                                            <button
                                                key={status}
                                                onClick={() => {
                                                    setStatusFilter(status);
                                                    setShowStatusDropdown(false);
                                                }}
                                                className={`dropdown-item ${statusFilter === status ? 'active' : ''}`}
                                            >
                                                {status}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Online Filter */}
                        <div className="relative">
                            <button
                                onClick={() => { setShowOnlineDropdown(!showOnlineDropdown); setShowStatusDropdown(false); }}
                                className="btn btn-outline w-full sm:w-auto"
                            >
                                <Power size={16} />
                                {onlineFilter}
                                <ChevronDown size={16} />
                            </button>

                            <AnimatePresence>
                                {showOnlineDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="dropdown-menu right-0"
                                    >
                                        {onlineFilters.map(filter => (
                                            <button
                                                key={filter}
                                                onClick={() => {
                                                    setOnlineFilter(filter);
                                                    setShowOnlineDropdown(false);
                                                }}
                                                className={`dropdown-item ${onlineFilter === filter ? 'active' : ''}`}
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

                {/* Vendors List */}
                <div className="glass-card overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-[var(--surface-hover)] border-b border-[var(--border)] text-xs font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">
                        <div className="col-span-4">Vendor</div>
                        <div className="col-span-2 text-center">Rating</div>
                        <div className="col-span-2 text-center">Orders</div>
                        <div className="col-span-2 text-center">Status</div>
                        <div className="col-span-2 text-right">Actions</div>
                    </div>

                    {/* List Body */}
                    <div className="divide-y divide-[var(--border)]">
                        <AnimatePresence mode="popLayout">
                            {filteredVendors.map((vendor, index) => (
                                <motion.div
                                    key={vendor.vendorId}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 10 }}
                                    transition={{ delay: index * 0.02 }}
                                    className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                                    onClick={() => router.push(`/users/vendors/${vendor.vendorId}`)}
                                >
                                    {/* Vendor Info */}
                                    <div className="col-span-4 flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] flex items-center justify-center overflow-hidden flex-shrink-0">
                                            {vendor.shopImageUrl || vendor.profileImageUrl ? (
                                                <img
                                                    src={vendor.shopImageUrl || vendor.profileImageUrl}
                                                    alt={vendor.shopName}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                    }}
                                                />
                                            ) : (
                                                <Store size={22} className="text-white" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-semibold text-[var(--foreground)] truncate">{vendor.shopName}</h3>
                                            <p className="text-sm text-[var(--foreground-secondary)] truncate">{vendor.fullName}</p>
                                            <p className="text-xs text-[var(--foreground-secondary)] truncate mt-0.5">
                                                ₹{(vendor.totalEarnings || 0).toLocaleString()} earnings
                                            </p>
                                        </div>
                                    </div>

                                    {/* Rating */}
                                    <div className="col-span-2 flex items-center justify-center gap-1.5">
                                        <Star size={16} className="text-[var(--accent-warning)] fill-[var(--accent-warning)]" />
                                        <span className="font-semibold text-[var(--foreground)]">{(vendor.rating || 0).toFixed(1)}</span>
                                    </div>

                                    {/* Orders */}
                                    <div className="col-span-2 text-center">
                                        <span className="font-semibold text-[var(--foreground)]">{vendor.totalOrders || 0}</span>
                                        <p className="text-xs text-[var(--foreground-secondary)]">{vendor.menuItemsCount || 0} items</p>
                                    </div>

                                    {/* Status */}
                                    <div className="col-span-2 flex flex-col items-center gap-1.5">
                                        <span className={`badge ${vendor.status === 'active' ? 'badge-approved' : 'badge-rejected'}`}>
                                            {vendor.status}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <span className={`w-2 h-2 rounded-full ${vendor.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                                            <span className="text-xs text-[var(--foreground-secondary)]">
                                                {vendor.isOnline ? 'Online' : 'Offline'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="col-span-2 flex items-center justify-end gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                router.push(`/users/vendors/${vendor.vendorId}`);
                                            }}
                                            className="btn btn-outline btn-icon-sm"
                                            title="View Details"
                                        >
                                            <Eye size={16} />
                                        </button>
                                        <div className="relative">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActionMenuId(actionMenuId === vendor.vendorId ? null : vendor.vendorId);
                                                }}
                                                className="btn btn-ghost btn-icon-sm"
                                            >
                                                <MoreVertical size={16} />
                                            </button>

                                            <AnimatePresence>
                                                {actionMenuId === vendor.vendorId && (
                                                    <motion.div
                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                        animate={{ opacity: 1, scale: 1 }}
                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                        className="dropdown-menu right-0"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <button
                                                            onClick={() => toggleVendorOnline(vendor.vendorId)}
                                                            className="dropdown-item"
                                                        >
                                                            <Power size={14} className={vendor.isOnline ? 'text-[var(--accent-error)]' : 'text-[var(--accent-success)]'} />
                                                            <span>{vendor.isOnline ? 'Set Offline' : 'Set Online'}</span>
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setActionMenuId(null);
                                                                if (vendor.status === 'active') {
                                                                    setSuspendTarget(vendor);
                                                                } else {
                                                                    handleReinstate(vendor.vendorId);
                                                                }
                                                            }}
                                                            className="dropdown-item"
                                                            disabled={updating === vendor.vendorId}
                                                        >
                                                            {vendor.status === 'active' ? (
                                                                <>
                                                                    <Ban size={14} className="text-[var(--accent-error)]" />
                                                                    <span>Suspend Vendor</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <CheckCircle size={14} className="text-[var(--accent-success)]" />
                                                                    <span>Activate Vendor</span>
                                                                </>
                                                            )}
                                                        </button>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>

                {filteredVendors.length === 0 && (
                    <div className="empty-state">
                        <Store size={56} className="text-[var(--foreground-secondary)] mx-auto mb-4" />
                        <p className="text-lg font-medium text-[var(--foreground)]">No vendors found</p>
                        <p className="text-[var(--foreground-secondary)]">Try adjusting your search or filters</p>
                    </div>
                )}
            </section>

            {/* Vendor Detail Modal */}
            <AnimatePresence>
                {selectedVendor && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                        onClick={() => setSelectedVendor(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="modal-content w-full max-w-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] flex items-center justify-center">
                                        <Store size={28} className="text-white" />
                                    </div>
                                    <div>
                                        <h2 className="modal-title">{selectedVendor.shopName}</h2>
                                        <p className="text-sm text-[var(--foreground-secondary)]">{selectedVendor.fullName}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`badge ${selectedVendor.status === 'active' ? 'badge-approved' : 'badge-rejected'}`}>
                                                {selectedVendor.status}
                                            </span>
                                            <span className={`w-2 h-2 rounded-full ${selectedVendor.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                                            <span className="text-xs text-[var(--foreground-secondary)]">
                                                {selectedVendor.isOnline ? 'Online' : 'Offline'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedVendor(null)}
                                    className="btn btn-ghost btn-icon-sm"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="modal-body space-y-5">
                                {/* Contact Info */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="glass-card p-4">
                                        <div className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)] mb-1">
                                            <Phone size={14} />
                                            Phone
                                        </div>
                                        <p className="font-medium text-[var(--foreground)]">{selectedVendor.phoneNumber}</p>
                                    </div>
                                    <div className="glass-card p-4">
                                        <div className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)] mb-1">
                                            <Mail size={14} />
                                            Email
                                        </div>
                                        <p className="font-medium text-[var(--foreground)] text-sm">{selectedVendor.email}</p>
                                    </div>
                                </div>

                                <div className="glass-card p-4">
                                    <div className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)] mb-1">
                                        <MapPin size={14} />
                                        Address
                                    </div>
                                    <p className="font-medium text-[var(--foreground)]">{selectedVendor.address}</p>
                                    <p className="text-sm text-[var(--foreground-secondary)]">{selectedVendor.city} - {selectedVendor.pincode}</p>
                                </div>

                                {/* Stats Grid */}
                                <div className="grid grid-cols-4 gap-4">
                                    <div className="glass-card p-4 text-center">
                                        <Star size={22} className="text-[var(--accent-warning)] mx-auto mb-2 fill-[var(--accent-warning)]" />
                                        <p className="text-xl font-bold text-[var(--foreground)]">{selectedVendor.rating}</p>
                                        <p className="text-xs text-[var(--foreground-secondary)]">Rating</p>
                                    </div>
                                    <div className="glass-card p-4 text-center">
                                        <ShoppingBag size={22} className="text-[var(--primary)] mx-auto mb-2" />
                                        <p className="text-xl font-bold text-[var(--foreground)]">{selectedVendor.totalOrders}</p>
                                        <p className="text-xs text-[var(--foreground-secondary)]">Orders</p>
                                    </div>
                                    <div className="glass-card p-4 text-center">
                                        <UtensilsCrossed size={22} className="text-[var(--accent-active)] mx-auto mb-2" />
                                        <p className="text-xl font-bold text-[var(--foreground)]">{selectedVendor.menuItemsCount || 0}</p>
                                        <p className="text-xs text-[var(--foreground-secondary)]">Menu Items</p>
                                    </div>
                                    <div className="glass-card p-4 text-center">
                                        <IndianRupee size={22} className="text-[var(--accent-success)] mx-auto mb-2" />
                                        <p className="text-xl font-bold text-[var(--foreground)]">₹{((selectedVendor.totalEarnings || 0) / 1000).toFixed(0)}K</p>
                                        <p className="text-xs text-[var(--foreground-secondary)]">Earnings</p>
                                    </div>
                                </div>

                                <div className="text-xs text-[var(--foreground-secondary)]">
                                    Registered: {formatDate(selectedVendor.registeredAt || selectedVendor.createdAt)}
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    onClick={() => {
                                        toggleVendorOnline(selectedVendor.vendorId);
                                        setSelectedVendor({ ...selectedVendor, isOnline: !selectedVendor.isOnline });
                                    }}
                                    className={`btn flex-1 ${selectedVendor.isOnline ? 'btn-outline' : 'btn-primary'}`}
                                >
                                    <Power size={16} />
                                    {selectedVendor.isOnline ? 'Set Offline' : 'Set Online'}
                                </button>
                                <button
                                    onClick={() => {
                                        if (selectedVendor.status === 'active') {
                                            setSuspendTarget(selectedVendor);
                                            setSelectedVendor(null);
                                        } else {
                                            handleReinstate(selectedVendor.vendorId);
                                            setSelectedVendor(null);
                                        }
                                    }}
                                    className={`btn flex-1 ${selectedVendor.status === 'active' ? 'btn-danger' : 'btn-success'}`}
                                >
                                    {selectedVendor.status === 'active' ? (
                                        <>
                                            <Ban size={16} />
                                            Suspend Vendor
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle size={16} />
                                            Activate Vendor
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Suspend Reason Modal ── */}
            {suspendTarget && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
                    <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440, margin: '0 16px', border: '1px solid var(--glass-border)' }}>
                        <h2 style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--foreground)', marginBottom: 4 }}>🚫 Suspend Vendor</h2>
                        <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', marginBottom: 18 }}>
                            Suspending <strong style={{ color: 'var(--foreground)' }}>{suspendTarget.shopName}</strong> will immediately take them offline.
                        </p>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-secondary)', display: 'block', marginBottom: 6 }}>Reason *</label>
                            <select
                                value={suspensionReason}
                                onChange={e => { setSuspensionReason(e.target.value); setSuspendError(''); }}
                                className="input"
                                style={{ width: '100%' }}
                            >
                                <option value="">Select a reason…</option>
                                {['Policy Violation', 'Multiple Customer Complaints', 'Food Quality Issues', 'Hygiene Standards Not Met', 'Documents Expired', 'Fraudulent Activity', 'Non-compliance with Platform Rules', 'Payment/Settlement Issues', 'Extended Inactivity', 'Other (See Notes)'].map(r => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ marginBottom: 18 }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-secondary)', display: 'block', marginBottom: 6 }}>Notes (optional)</label>
                            <textarea
                                value={suspensionNotes}
                                onChange={e => setSuspensionNotes(e.target.value)}
                                placeholder="Additional details…"
                                rows={3}
                                className="input"
                                style={{ width: '100%', resize: 'vertical' }}
                            />
                        </div>
                        {suspendError && <p style={{ color: '#EF4444', fontSize: '0.8rem', marginBottom: 12 }}>{suspendError}</p>}
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button
                                onClick={() => { setSuspendTarget(null); setSuspensionReason(''); setSuspensionNotes(''); setSuspendError(''); }}
                                className="btn btn-outline"
                                style={{ flex: 1 }}
                            >Cancel</button>
                            <button
                                onClick={handleSuspend}
                                disabled={suspending || !suspensionReason}
                                className="btn btn-danger"
                                style={{ flex: 1 }}
                            >{suspending ? 'Suspending…' : 'Confirm Suspension'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
