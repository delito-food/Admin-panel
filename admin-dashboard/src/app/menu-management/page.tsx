'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Filter, Eye, CheckCircle, XCircle, Clock, Package,
    ChevronDown, RefreshCw, UtensilsCrossed, Store, X, AlertTriangle,
    DollarSign, ImageIcon, Edit3, Check, Loader2, MessageSquare,
    CheckCheck, Ban, Leaf, Drumstick,
} from 'lucide-react';

interface MenuItem {
    itemId: string;
    vendorId: string;
    vendorName: string;
    vendorOnline: boolean;
    vendorVerified: boolean;
    name: string;
    description: string;
    price: number;
    originalPrice: number;
    adminApprovedPrice: number | null;
    imageUrl: string;
    categoryName: string;
    categoryId: string;
    isVeg: boolean;
    isAvailable: boolean;
    isBestSeller: boolean;
    discount: number;
    preparationTime: number;
    verificationStatus: string;
    adminNotes: string;
    rejectionReason: string;
    submittedAt: string;
    updatedAt: string;
    tags?: string[];
}

interface Summary {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
}

const statusFilters = ['all', 'pending', 'approved', 'rejected', 'changes_requested'];

export default function MenuManagementPage() {
    const [items, setItems] = useState<MenuItem[]>([]);
    const [summary, setSummary] = useState<Summary>({ total: 0, pending: 0, approved: 0, rejected: 0 });
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'vendor'>('list');
    const [vendorFilter, setVendorFilter] = useState('');

    // Action modal state
    const [actionModal, setActionModal] = useState<{ item: MenuItem; action: 'approve' | 'reject' | 'request_changes' } | null>(null);
    const [adminNotes, setAdminNotes] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [newPrice, setNewPrice] = useState<string>('');
    const [processing, setProcessing] = useState(false);
    const [tagModal, setTagModal] = useState<{ item: MenuItem; tags: string[]; newTag: string } | null>(null);

    // Bulk action state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkProcessing, setBulkProcessing] = useState(false);

    // Migration Tool State
    const [migrationModalOpen, setMigrationModalOpen] = useState(false);
    const [migrationOldId, setMigrationOldId] = useState('');
    const [migrationNewId, setMigrationNewId] = useState('');
    const [migrationStep, setMigrationStep] = useState<'search' | 'copy' | 'verify'>('search');
    const [migrationStats, setMigrationStats] = useState<{itemCount: number, categoryCount: number} | null>(null);
    const [migrationProcessing, setMigrationProcessing] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/menu-management?status=${statusFilter}`);
            const result = await res.json();
            if (result.success) {
                setItems(result.data.items);
                setSummary(result.data.summary);
            }
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchData();
        setRefreshing(false);
    };

    const handleAction = async () => {
        if (!actionModal) return;
        setProcessing(true);

        try {
            const body: Record<string, unknown> = {
                itemId: actionModal.item.itemId,
                action: actionModal.action,
                adminNotes,
            };

            if (actionModal.action === 'approve' && newPrice) {
                body.adminApprovedPrice = parseFloat(newPrice);
            }
            if (actionModal.action === 'reject') {
                body.rejectionReason = rejectionReason || 'Does not meet platform standards';
            }

            const res = await fetch('/api/menu-management', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const result = await res.json();
            if (result.success) {
                setActionModal(null);
                setAdminNotes('');
                setRejectionReason('');
                setNewPrice('');
                fetchData();
            } else {
                alert(result.error || 'Action failed');
            }
        } catch {
            alert('Network error');
        } finally {
            setProcessing(false);
        }
    };

    const handleUpdateTags = async () => {
        if (!tagModal) return;
        setProcessing(true);
        try {
            const res = await fetch('/api/menu-management', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId: tagModal.item.itemId,
                    action: 'update_tags',
                    tags: tagModal.tags,
                }),
            });
            const result = await res.json();
            if (result.success) {
                setTagModal(null);
                fetchData();
            } else {
                alert(result.error || 'Failed to update tags');
            }
        } catch {
            alert('Network error');
        } finally {
            setProcessing(false);
        }
    };

    const handleBulkAction = async (action: 'approve_all' | 'reject_all') => {
        if (selectedIds.size === 0) return;
        setBulkProcessing(true);

        try {
            const res = await fetch('/api/menu-management', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    itemIds: Array.from(selectedIds),
                }),
            });

            const result = await res.json();
            if (result.success) {
                setSelectedIds(new Set());
                fetchData();
            } else {
                alert(result.error || 'Bulk action failed');
            }
        } catch {
            alert('Network error');
        } finally {
            setBulkProcessing(false);
        }
    };

    const handleMigrationSearch = async () => {
        if (!migrationOldId.trim()) return;
        setMigrationProcessing(true);
        try {
            const res = await fetch(`/api/menu-management/migration/search?oldVendorId=${migrationOldId}`);
            const data = await res.json();
            if (data.success) {
                setMigrationStats(data.data);
                if (data.data.itemCount > 0 || data.data.categoryCount > 0) {
                    setMigrationStep('copy');
                } else {
                    alert('No items or categories found for this Vendor ID.');
                }
            } else {
                alert(data.error || 'Failed to search');
            }
        } catch (e) {
            alert('Network error');
        } finally {
            setMigrationProcessing(false);
        }
    };

    const handleMigrationExecute = async (action: 'copy' | 'confirm' | 'revert') => {
        if (action === 'copy' && !migrationNewId.trim()) return;
        setMigrationProcessing(true);
        try {
            const res = await fetch(`/api/menu-management/migration/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldVendorId: migrationOldId, newVendorId: migrationNewId, action })
            });
            const data = await res.json();
            if (data.success) {
                if (action === 'copy') {
                    setMigrationStep('verify');
                    fetchData(); // refresh to show copied data
                } else {
                    alert(data.message);
                    setMigrationModalOpen(false);
                    setMigrationStep('search');
                    setMigrationOldId('');
                    setMigrationNewId('');
                    setMigrationStats(null);
                    fetchData();
                }
            } else {
                alert(data.error || 'Migration failed');
            }
        } catch (e) {
            alert('Network error');
        } finally {
            setMigrationProcessing(false);
        }
    };

    const toggleSelectItem = (itemId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId);
            else next.add(itemId);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredItems.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredItems.map(i => i.itemId)));
        }
    };

    const filteredItems = items.filter(item => {
        const matchesSearch =
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.categoryName.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesVendor = !vendorFilter || item.vendorId === vendorFilter;
        return matchesSearch && matchesVendor;
    });

    // Vendor-wise grouped items
    const vendorGroups = useMemo(() => {
        const groups: Record<string, { vendorId: string; vendorName: string; vendorOnline: boolean; vendorVerified: boolean; items: MenuItem[] }> = {};
        filteredItems.forEach(item => {
            const vid = item.vendorId || 'unknown';
            if (!groups[vid]) groups[vid] = { vendorId: vid, vendorName: item.vendorName || 'Unknown Vendor', vendorOnline: item.vendorOnline, vendorVerified: item.vendorVerified, items: [] };
            groups[vid].items.push(item);
        });
        return Object.values(groups).sort((a, b) => b.items.length - a.items.length);
    }, [filteredItems]);

    // Unique vendors for filter dropdown
    const uniqueVendors = useMemo(() => {
        const map: Record<string, string> = {};
        items.forEach(i => { if (i.vendorId) map[i.vendorId] = i.vendorName; });
        return Object.entries(map).sort((a, b) => a[1].localeCompare(b[1]));
    }, [items]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved': return { bg: 'rgba(16,185,129,0.1)', color: '#10B981', border: 'rgba(16,185,129,0.25)', label: 'Approved', icon: <CheckCircle size={12} /> };
            case 'rejected': return { bg: 'rgba(239,68,68,0.1)', color: '#EF4444', border: 'rgba(239,68,68,0.25)', label: 'Rejected', icon: <XCircle size={12} /> };
            case 'pending': return { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B', border: 'rgba(245,158,11,0.25)', label: 'Pending', icon: <Clock size={12} /> };
            case 'changes_requested': return { bg: 'rgba(99,102,241,0.1)', color: '#6366F1', border: 'rgba(99,102,241,0.25)', label: 'Changes Requested', icon: <Edit3 size={12} /> };
            default: return { bg: 'var(--surface-hover)', color: 'var(--foreground-secondary)', border: 'var(--border)', label: status, icon: <Clock size={12} /> };
        }
    };

    const formatTime = (dateString: string) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const now = new Date();
        const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);
        if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hr ago`;
        return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center animate-pulse">
                        <RefreshCw className="w-8 h-8 animate-spin text-[var(--primary)]" />
                    </div>
                    <p className="text-[var(--foreground-secondary)] font-medium">Loading menu items...</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 40 }}>
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title">Menu Management</h1>
                    <p className="page-description">Review, approve and manage all vendor menu items</p>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={() => setMigrationModalOpen(true)} className="btn btn-primary bg-blue-600 border-none text-white hover:bg-blue-700" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        Data Migration Tool
                    </button>
                    <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1 }}>
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: '1.5rem' }}>
                {[
                    { label: 'Total Items', value: summary.total, icon: UtensilsCrossed, color: '#F4511E', bgColor: 'rgba(244,81,30,0.1)' },
                    { label: 'Pending Review', value: summary.pending, icon: Clock, color: '#F59E0B', bgColor: 'rgba(245,158,11,0.1)' },
                    { label: 'Approved', value: summary.approved, icon: CheckCircle, color: '#10B981', bgColor: 'rgba(16,185,129,0.1)' },
                    { label: 'Rejected', value: summary.rejected, icon: XCircle, color: '#EF4444', bgColor: 'rgba(239,68,68,0.1)' },
                ].map((stat, index) => (
                    <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="glass-card"
                        style={{ padding: '20px 24px' }}
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{stat.label}</p>
                                <p style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--foreground)', marginTop: 4 }}>{stat.value}</p>
                            </div>
                            <div style={{ width: 44, height: 44, borderRadius: 12, background: stat.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <stat.icon size={22} color={stat.color} />
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Search, Filter & Bulk Actions */}
            <div className="glass-card p-6">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="input-group flex-1">
                        <Search size={18} className="input-icon" />
                        <input
                            type="text"
                            placeholder="Search by item name, vendor, or category..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input"
                        />
                    </div>

                    {/* Vendor Filter */}
                    <select
                        value={vendorFilter}
                        onChange={e => setVendorFilter(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none', minWidth: 160 }}
                    >
                        <option value="">All Vendors</option>
                        {uniqueVendors.map(([vid, vname]) => (
                            <option key={vid} value={vid}>{vname}</option>
                        ))}
                    </select>

                    {/* View Toggle */}
                    <div style={{ display: 'flex', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
                        <button onClick={() => setViewMode('list')} style={{ padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, background: viewMode === 'list' ? 'var(--primary)' : 'var(--surface)', color: viewMode === 'list' ? 'white' : 'var(--foreground-secondary)' }}>
                            List View
                        </button>
                        <button onClick={() => setViewMode('vendor')} style={{ padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, background: viewMode === 'vendor' ? 'var(--primary)' : 'var(--surface)', color: viewMode === 'vendor' ? 'white' : 'var(--foreground-secondary)' }}>
                            Vendor Wise
                        </button>
                    </div>

                    <div className="relative">
                        <button
                            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                            className="btn btn-outline w-full sm:w-auto"
                        >
                            <Filter size={16} />
                            {statusFilter === 'all' ? 'All Status' : getStatusBadge(statusFilter).label}
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
                                            onClick={() => { setStatusFilter(filter); setShowFilterDropdown(false); }}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${statusFilter === filter ? 'bg-[var(--primary)] text-white' : 'hover:bg-[var(--surface-hover)]'}`}
                                        >
                                            {filter === 'all' ? 'All Status' : getStatusBadge(filter).label}
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Bulk Actions */}
                {selectedIds.size > 0 && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, padding: '12px 16px', borderRadius: 12, background: 'rgba(244,81,30,0.08)', border: '1px solid rgba(244,81,30,0.2)' }}
                    >
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)' }}>
                            {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
                        </span>
                        <div style={{ flex: 1 }} />
                        <button
                            onClick={() => handleBulkAction('approve_all')}
                            disabled={bulkProcessing}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#10B981', color: 'white', fontWeight: 600, fontSize: '0.82rem' }}
                        >
                            <CheckCheck size={14} /> Approve All
                        </button>
                        <button
                            onClick={() => handleBulkAction('reject_all')}
                            disabled={bulkProcessing}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#EF4444', color: 'white', fontWeight: 600, fontSize: '0.82rem' }}
                        >
                            <Ban size={14} /> Reject All
                        </button>
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--foreground-secondary)', fontSize: '0.82rem' }}
                        >
                            Clear
                        </button>
                    </motion.div>
                )}
            </div>

            {/* Items List */}
            <div>
                {/* Vendor-Wise View */}
                {viewMode === 'vendor' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {vendorGroups.length === 0 ? (
                            <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                                <Store size={40} style={{ color: 'var(--foreground-secondary)', opacity: 0.3, margin: '0 auto 12px' }} />
                                <p style={{ fontWeight: 600, color: 'var(--foreground-secondary)' }}>No items found</p>
                            </div>
                        ) : vendorGroups.map(group => (
                            <div key={group.vendorId} className="glass-card" style={{ overflow: 'hidden' }}>
                                {/* Vendor Header */}
                                <div style={{ padding: '14px 20px', background: 'var(--surface-hover)', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(244,81,30,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Store size={18} style={{ color: 'var(--primary)' }} />
                                        </div>
                                        <div>
                                            <p style={{ fontWeight: 700, fontSize: '0.95rem' }}>{group.vendorName}</p>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: group.vendorOnline ? '#10B981' : '#9CA3AF' }} />
                                                <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>{group.vendorOnline ? 'Online' : 'Offline'}</span>
                                                {group.vendorVerified && <span style={{ fontSize: '0.62rem', background: 'rgba(16,185,129,0.1)', color: '#10B981', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>✓ Verified</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ padding: '4px 12px', borderRadius: 20, background: 'rgba(244,81,30,0.08)', color: 'var(--primary)', fontSize: '0.78rem', fontWeight: 700 }}>{group.items.length} items</span>
                                        <a href={`/menu-management/vendor/${group.vendorId}`} style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--primary)', color: 'white', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>
                                            Manage Menu &rarr;
                                        </a>
                                    </div>
                                </div>
                                {/* Items Grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16, padding: 16 }}>
                                    {group.items.map(item => {
                                        const badge = getStatusBadge(item.verificationStatus);
                                        return (
                                            <div key={item.itemId} style={{ padding: '12px', borderRadius: 12, border: '1px solid var(--glass-border)', background: 'var(--surface)', display: 'flex', gap: 10, cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => setSelectedItem(item)}>
                                                <div style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', background: 'var(--surface-hover)', flexShrink: 0 }}>
                                                    {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ImageIcon size={18} color="var(--foreground-secondary)" /></div>}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <div style={{ width: 10, height: 10, borderRadius: 2, border: `1.5px solid ${item.isVeg ? '#10B981' : '#EF4444'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 4, height: 4, borderRadius: '50%', background: item.isVeg ? '#10B981' : '#EF4444' }} /></div>
                                                        <p style={{ fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</p>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary)' }}>₹{item.price}</span>
                                                        {item.discount > 0 && <span style={{ fontSize: '0.6rem', background: 'rgba(16,185,129,0.1)', color: '#10B981', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>-{item.discount}%</span>}
                                                        {item.categoryName && <span style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', background: 'var(--surface-hover)', padding: '1px 5px', borderRadius: 4 }}>{item.categoryName}</span>}
                                                    </div>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.62rem', fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: badge.bg, color: badge.color, marginTop: 4 }}>{badge.icon} {badge.label}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                /* Original List View */
                <>
                {/* Select All Header */}
                {filteredItems.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '0 8px' }}>
                        <input
                            type="checkbox"
                            checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                            onChange={toggleSelectAll}
                            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary)' }}
                        />
                        <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>
                            Select All ({filteredItems.length} items)
                        </span>
                    </div>
                )}

                <div className="grid gap-3">
                    <AnimatePresence mode="popLayout">
                        {filteredItems.length === 0 ? (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="empty-state glass-card">
                                <div className="empty-state-icon"><UtensilsCrossed size={32} /></div>
                                <h3 className="empty-state-title">No menu items found</h3>
                                <p className="empty-state-description">Try adjusting your search or filter criteria.</p>
                            </motion.div>
                        ) : (
                            filteredItems.map((item, index) => {
                                const badge = getStatusBadge(item.verificationStatus);
                                return (
                                    <motion.div
                                        key={item.itemId}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={{ delay: index * 0.015 }}
                                        className="glass-card"
                                        style={{ padding: '16px 20px' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                            {/* Checkbox */}
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(item.itemId)}
                                                onChange={() => toggleSelectItem(item.itemId)}
                                                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary)', flexShrink: 0 }}
                                            />

                                            {/* Image */}
                                            <div style={{ width: 56, height: 56, borderRadius: 12, overflow: 'hidden', background: 'var(--surface-hover)', flexShrink: 0 }}>
                                                {item.imageUrl ? (
                                                    <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <ImageIcon size={20} color="var(--foreground-secondary)" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    {/* Veg/Non-veg indicator */}
                                                    <div style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${item.isVeg ? '#10B981' : '#EF4444'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: item.isVeg ? '#10B981' : '#EF4444' }} />
                                                    </div>
                                                    <p style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--foreground)' }}>{item.name}</p>
                                                    {item.isBestSeller && (
                                                        <span style={{ fontSize: '0.62rem', fontWeight: 700, background: 'rgba(245,158,11,0.12)', color: '#F59E0B', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(245,158,11,0.25)' }}>
                                                            ⭐ Best Seller
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                                        <Store size={12} />
                                                        <span>{item.vendorName || 'Unknown Vendor'}</span>
                                                    </div>
                                                    {item.categoryName && (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', background: 'var(--surface-hover)', padding: '2px 8px', borderRadius: 6 }}>
                                                            {item.categoryName}
                                                        </span>
                                                    )}
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                                        {formatTime(item.submittedAt)}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Price */}
                                            <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 12 }}>
                                                <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--foreground)' }}>₹{item.price}</p>
                                                {item.adminApprovedPrice && item.adminApprovedPrice !== item.originalPrice && (
                                                    <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', textDecoration: 'line-through' }}>₹{item.originalPrice}</p>
                                                )}
                                                {item.discount > 0 && (
                                                    <span style={{ fontSize: '0.62rem', fontWeight: 700, background: 'rgba(16,185,129,0.12)', color: '#10B981', padding: '1px 5px', borderRadius: 4 }}>
                                                        -{item.discount}%
                                                    </span>
                                                )}
                                            </div>

                                            {/* Status Badge */}
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                fontSize: '0.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                                                background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                                                flexShrink: 0,
                                            }}>
                                                {badge.icon} {badge.label}
                                            </span>

                                            {/* Action Buttons */}
                                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                                {(item.verificationStatus === 'pending' || item.verificationStatus === 'changes_requested') && (
                                                    <>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setActionModal({ item, action: 'approve' }); setNewPrice(String(item.price)); }}
                                                            style={{ width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(16,185,129,0.1)', color: '#10B981', transition: 'all 0.2s' }}
                                                            title="Approve"
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setActionModal({ item, action: 'reject' }); }}
                                                            style={{ width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', color: '#EF4444', transition: 'all 0.2s' }}
                                                            title="Reject"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    onClick={() => setSelectedItem(item)}
                                                    style={{ width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-hover)', color: 'var(--foreground-secondary)', transition: 'all 0.2s' }}
                                                    title="View Details"
                                                >
                                                    <Eye size={16} />
                                                </button>
                                                <a
                                                    href={`/menu-management/vendor/${item.vendorId}`}
                                                    style={{ width: 34, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary)', color: 'white', transition: 'all 0.2s', textDecoration: 'none' }}
                                                    title="Manage Vendor Menu"
                                                >
                                                    <Edit3 size={16} />
                                                </a>
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })
                        )}
                    </AnimatePresence>
                </div>
                </>
                )}
            </div>

            {/* ─── Item Detail Modal ─── */}
            <AnimatePresence>
                {selectedItem && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setSelectedItem(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="modal-content w-full max-w-lg" style={{ maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">Item Details</h2>
                                <button onClick={() => setSelectedItem(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body space-y-5">
                                {/* Image */}
                                {selectedItem.imageUrl && (
                                    <div style={{ width: '100%', height: 200, borderRadius: 14, overflow: 'hidden', background: 'var(--surface-hover)' }}>
                                        <img src={selectedItem.imageUrl} alt={selectedItem.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    </div>
                                )}

                                {/* Name & Status */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${selectedItem.isVeg ? '#10B981' : '#EF4444'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedItem.isVeg ? '#10B981' : '#EF4444' }} />
                                        </div>
                                        <h3 style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedItem.name}</h3>
                                    </div>
                                    {(() => { const b = getStatusBadge(selectedItem.verificationStatus); return (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600, padding: '4px 12px', borderRadius: 20, background: b.bg, color: b.color, border: `1px solid ${b.border}` }}>
                                            {b.icon} {b.label}
                                        </span>
                                    ); })()}
                                </div>

                                {selectedItem.description && (
                                    <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', lineHeight: 1.5 }}>{selectedItem.description}</p>
                                )}

                                {/* Price & Vendor Info */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Price</p>
                                        <p style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>₹{selectedItem.price}</p>
                                        {selectedItem.adminApprovedPrice && selectedItem.adminApprovedPrice !== selectedItem.originalPrice && (
                                            <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                                Original: <span style={{ textDecoration: 'line-through' }}>₹{selectedItem.originalPrice}</span>
                                            </p>
                                        )}
                                    </div>
                                    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Vendor</p>
                                        <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground)' }}>{selectedItem.vendorName}</p>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: selectedItem.vendorOnline ? '#10B981' : '#9CA3AF' }} />
                                            <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>{selectedItem.vendorOnline ? 'Online' : 'Offline'}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Category & Prep Time */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Category</p>
                                        <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selectedItem.categoryName || 'Uncategorized'}</p>
                                    </div>
                                    {selectedItem.preparationTime > 0 && (
                                        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Prep Time</p>
                                            <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selectedItem.preparationTime} min</p>
                                        </div>
                                    )}
                                </div>

                                {/* Tags */}
                                <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Search Tags</p>
                                        <button 
                                            onClick={() => setTagModal({ item: selectedItem, tags: selectedItem.tags || [], newTag: '' })}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                                        >
                                            Edit Tags
                                        </button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {selectedItem.tags && selectedItem.tags.length > 0 ? (
                                            selectedItem.tags.map((tag, idx) => (
                                                <span key={idx} style={{ padding: '4px 10px', background: 'rgba(244,81,30,0.1)', color: 'var(--primary)', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                                                    #{tag}
                                                </span>
                                            ))
                                        ) : (
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>No tags added.</span>
                                        )}
                                    </div>
                                </div>

                                {/* Admin Notes / Rejection Reason */}
                                {selectedItem.rejectionReason && (
                                    <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                        <p style={{ fontSize: '0.65rem', color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Rejection Reason</p>
                                        <p style={{ fontSize: '0.85rem', color: '#EF4444' }}>{selectedItem.rejectionReason}</p>
                                    </div>
                                )}
                                {selectedItem.adminNotes && (
                                    <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)' }}>
                                        <p style={{ fontSize: '0.65rem', color: '#6366F1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Admin Notes</p>
                                        <p style={{ fontSize: '0.85rem', color: '#6366F1' }}>{selectedItem.adminNotes}</p>
                                    </div>
                                )}

                                {/* Quick Actions */}
                                <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
                                    {selectedItem.verificationStatus !== 'approved' && (
                                        <button
                                            onClick={() => { setSelectedItem(null); setActionModal({ item: selectedItem, action: 'approve' }); setNewPrice(String(selectedItem.price)); }}
                                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#10B981', color: 'white', fontWeight: 600, fontSize: '0.85rem' }}
                                        >
                                            <CheckCircle size={16} /> Approve
                                        </button>
                                    )}
                                    {selectedItem.verificationStatus !== 'rejected' && (
                                        <button
                                            onClick={() => { setSelectedItem(null); setActionModal({ item: selectedItem, action: 'reject' }); }}
                                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#EF4444', color: 'white', fontWeight: 600, fontSize: '0.85rem' }}
                                        >
                                            <XCircle size={16} /> Reject
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setSelectedItem(null); setActionModal({ item: selectedItem, action: 'request_changes' }); }}
                                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent', color: 'var(--foreground)', fontWeight: 600, fontSize: '0.85rem' }}
                                    >
                                        <Edit3 size={16} /> Request Changes
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ─── Action Modal (Approve/Reject/Request Changes) ─── */}
            <AnimatePresence>
                {actionModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => { setActionModal(null); setAdminNotes(''); setRejectionReason(''); setNewPrice(''); }}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="modal-content w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">
                                    {actionModal.action === 'approve' && '✅ Approve Item'}
                                    {actionModal.action === 'reject' && '❌ Reject Item'}
                                    {actionModal.action === 'request_changes' && '✏️ Request Changes'}
                                </h2>
                                <button onClick={() => { setActionModal(null); setAdminNotes(''); setRejectionReason(''); setNewPrice(''); }} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body space-y-4">
                                {/* Item Preview */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                    {actionModal.item.imageUrl && (
                                        <img src={actionModal.item.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />
                                    )}
                                    <div>
                                        <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{actionModal.item.name}</p>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>{actionModal.item.vendorName} · ₹{actionModal.item.price}</p>
                                    </div>
                                </div>

                                {/* Price Change (Approve only) */}
                                {actionModal.action === 'approve' && (
                                    <div>
                                        <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                                            <DollarSign size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                            Approved Price (₹) <span style={{ fontWeight: 400, color: 'var(--foreground-secondary)', fontSize: '0.72rem' }}>— leave as-is or change</span>
                                        </label>
                                        <input
                                            type="number"
                                            value={newPrice}
                                            onChange={(e) => setNewPrice(e.target.value)}
                                            placeholder={`Current: ₹${actionModal.item.price}`}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' }}
                                        />
                                    </div>
                                )}

                                {/* Rejection Reason */}
                                {actionModal.action === 'reject' && (
                                    <div>
                                        <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                                            Rejection Reason <span style={{ color: '#EF4444' }}>*</span>
                                        </label>
                                        <select
                                            value={rejectionReason}
                                            onChange={(e) => setRejectionReason(e.target.value)}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' }}
                                        >
                                            <option value="">Select reason...</option>
                                            <option value="Price too high">Price too high</option>
                                            <option value="Image does not match item">Image does not match item</option>
                                            <option value="Inappropriate content">Inappropriate content</option>
                                            <option value="Duplicate item">Duplicate item</option>
                                            <option value="Poor image quality">Poor image quality</option>
                                            <option value="Misleading description">Misleading description</option>
                                            <option value="Does not meet food safety standards">Does not meet food safety standards</option>
                                            <option value="Other">Other</option>
                                        </select>
                                    </div>
                                )}

                                {/* Admin Notes */}
                                <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                                        <MessageSquare size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                        Admin Notes <span style={{ fontWeight: 400, color: 'var(--foreground-secondary)', fontSize: '0.72rem' }}>— visible to vendor</span>
                                    </label>
                                    <textarea
                                        value={adminNotes}
                                        onChange={(e) => setAdminNotes(e.target.value)}
                                        placeholder={actionModal.action === 'request_changes' ? 'Describe what needs to change...' : 'Optional notes for the vendor...'}
                                        rows={3}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none', resize: 'vertical' }}
                                    />
                                </div>

                                {/* Action Buttons */}
                                <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
                                    <button
                                        onClick={() => { setActionModal(null); setAdminNotes(''); setRejectionReason(''); setNewPrice(''); }}
                                        style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--foreground)', fontWeight: 600, fontSize: '0.85rem' }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleAction}
                                        disabled={processing || (actionModal.action === 'reject' && !rejectionReason)}
                                        style={{
                                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                            padding: '10px 16px', borderRadius: 10, border: 'none', cursor: processing ? 'not-allowed' : 'pointer',
                                            fontWeight: 600, fontSize: '0.85rem', opacity: processing ? 0.6 : 1,
                                            background: actionModal.action === 'approve' ? '#10B981' : actionModal.action === 'reject' ? '#EF4444' : 'var(--primary)',
                                            color: 'white',
                                        }}
                                    >
                                        {processing ? <Loader2 size={16} className="animate-spin" /> : null}
                                        {actionModal.action === 'approve' ? 'Approve Item' : actionModal.action === 'reject' ? 'Reject Item' : 'Send Request'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {/* Data Migration Modal */}
                {migrationModalOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                        <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg overflow-hidden flex flex-col shadow-xl">
                            <div className="p-5 border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface-hover)]">
                                <h2 className="text-lg font-bold">Menu Data Migration</h2>
                                <button onClick={() => { setMigrationModalOpen(false); setMigrationStep('search'); setMigrationOldId(''); setMigrationNewId(''); }} className="p-1 hover:bg-[var(--surface)] rounded-md"><X size={20} /></button>
                            </div>
                            
                            <div className="p-6 space-y-6">
                                {migrationStep === 'search' && (
                                    <div className="space-y-4">
                                        <p className="text-sm text-[var(--foreground-secondary)]">
                                            Find an orphaned vendor account to rescue its menu data. This usually happens when a vendor logs in with OTP and gets a new ID.
                                        </p>
                                        <div>
                                            <label className="block text-xs font-semibold mb-1 text-[var(--foreground-secondary)]">Old Vendor ID (Orphaned)</label>
                                            <input type="text" className="input w-full" value={migrationOldId} onChange={e => setMigrationOldId(e.target.value)} placeholder="e.g. jB9asdf2..." />
                                        </div>
                                        <button onClick={handleMigrationSearch} disabled={!migrationOldId || migrationProcessing} className="btn btn-primary w-full">
                                            {migrationProcessing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Search for Orphaned Data'}
                                        </button>
                                    </div>
                                )}

                                {migrationStep === 'copy' && migrationStats && (
                                    <div className="space-y-4">
                                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-blue-800 text-sm">
                                            <strong>Data Found!</strong> {migrationStats.itemCount} menu items and {migrationStats.categoryCount} categories are ready to be migrated.
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold mb-1 text-[var(--foreground-secondary)]">New Vendor ID (Target)</label>
                                            <input type="text" className="input w-full" value={migrationNewId} onChange={e => setMigrationNewId(e.target.value)} placeholder="Enter the new vendor's ID" />
                                        </div>
                                        <p className="text-xs text-[var(--foreground-secondary)]">
                                            Clicking "Temporary Copy" will safely clone the data to the new ID so you can verify it in the vendor app before deleting the original.
                                        </p>
                                        <button onClick={() => handleMigrationExecute('copy')} disabled={!migrationNewId || migrationProcessing} className="btn btn-primary w-full bg-blue-600 hover:bg-blue-700 border-none text-white">
                                            {migrationProcessing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create Temporary Copy'}
                                        </button>
                                    </div>
                                )}

                                {migrationStep === 'verify' && (
                                    <div className="space-y-4 text-center">
                                        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-2">
                                            <AlertTriangle size={32} />
                                        </div>
                                        <h3 className="font-bold text-lg">Verify in Vendor App</h3>
                                        <p className="text-sm text-[var(--foreground-secondary)] pb-4">
                                            The data has been copied. Please ask the vendor to check their app. Are the menu items showing correctly?
                                        </p>
                                        <div className="flex gap-3">
                                            <button onClick={() => handleMigrationExecute('revert')} disabled={migrationProcessing} className="btn btn-outline flex-1 border-red-200 text-red-500 hover:bg-red-50">
                                                Revert Copy
                                            </button>
                                            <button onClick={() => handleMigrationExecute('confirm')} disabled={migrationProcessing} className="btn btn-primary flex-1 bg-green-600 hover:bg-green-700 border-none text-white">
                                                Confirm & Erase Old
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
                {/* Tag Edit Modal */}
                {tagModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setTagModal(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="modal-content w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">Edit Tags</h2>
                                <button onClick={() => setTagModal(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body space-y-4">
                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Add tags to improve search discoverability for <strong>{tagModal.item.name}</strong>.</p>
                                
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 40, padding: '10px 12px', background: 'var(--surface-hover)', borderRadius: 10, border: '1px solid var(--border)' }}>
                                    {tagModal.tags.map((tag, idx) => (
                                        <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--primary)', color: 'white', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                                            {tag}
                                            <button 
                                                onClick={() => setTagModal({ ...tagModal, tags: tagModal.tags.filter((_, i) => i !== idx) })}
                                                style={{ background: 'transparent', border: 'none', color: 'white', padding: 0, display: 'flex', cursor: 'pointer' }}
                                            >
                                                <X size={12} />
                                            </button>
                                        </span>
                                    ))}
                                    <input
                                        type="text"
                                        value={tagModal.newTag}
                                        onChange={(e) => setTagModal({ ...tagModal, newTag: e.target.value })}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && tagModal.newTag.trim()) {
                                                e.preventDefault();
                                                const newT = tagModal.newTag.trim().toLowerCase();
                                                if (!tagModal.tags.includes(newT)) {
                                                    setTagModal({ ...tagModal, tags: [...tagModal.tags, newT], newTag: '' });
                                                }
                                            }
                                        }}
                                        placeholder="Add tag and press Enter"
                                        style={{ flex: 1, minWidth: 120, background: 'transparent', border: 'none', outline: 'none', fontSize: '0.8rem', color: 'var(--foreground)' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: 10, paddingTop: 10 }}>
                                    <button onClick={() => setTagModal(null)} style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--foreground)', fontWeight: 600, fontSize: '0.85rem' }}>Cancel</button>
                                    <button 
                                        onClick={handleUpdateTags} 
                                        disabled={processing}
                                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: processing ? 'not-allowed' : 'pointer', background: 'var(--primary)', color: 'white', fontWeight: 600, fontSize: '0.85rem', opacity: processing ? 0.6 : 1 }}
                                    >
                                        {processing ? <Loader2 size={16} className="animate-spin" /> : 'Save Tags'}
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

