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
    Star,
    Power,
    Ban,
    CheckCircle,
    ChevronDown,
    ShoppingBag,
    RefreshCw,
    Loader2,
    TrendingUp,
    IndianRupee
} from 'lucide-react';
import { useApi, apiPatch, Vendor } from '@/hooks/useApi';

const statusFilters = ['All', 'Active', 'Suspended'];
const onlineFilters = ['All', 'Online', 'Offline'];

// Compact Stat Card (matches dashboard style)
function StatCard({
    title,
    value,
    subValue,
    icon: Icon,
    color = 'primary'
}: {
    title: string;
    value: string | number;
    subValue?: string;
    icon: React.ElementType;
    color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const colorMap = {
        primary: { bg: 'rgba(40, 137, 144, 0.15)', text: '#288990' },
        success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
        warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
        error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card"
            style={{ padding: 16 }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginBottom: 4 }}>{title}</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                    {subValue && (
                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{subValue}</p>
                    )}
                </div>
                <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: colorMap[color].bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <Icon size={20} color={colorMap[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

export default function VendorsPage() {
    const { data: vendorsData, loading, refetch } = useApi<Vendor[]>('/api/vendors');
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [onlineFilter, setOnlineFilter] = useState('All');
    const router = useRouter();
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [showOnlineDropdown, setShowOnlineDropdown] = useState(false);
    const [actionMenuId, setActionMenuId] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

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

    const toggleVendorStatus = async (vendorId: string) => {
        const vendor = vendors.find(v => v.vendorId === vendorId);
        if (!vendor) return;

        const newStatus = vendor.status === 'active' ? 'suspended' : 'active';
        setUpdating(vendorId);

        const result = await apiPatch('/api/vendors', {
            vendorId,
            updates: { status: newStatus }
        });

        if (result.success) {
            setVendors(prev => prev.map(v =>
                v.vendorId === vendorId ? { ...v, status: newStatus } : v
            ));
        }
        setUpdating(null);
        setActionMenuId(null);
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
        }
        setUpdating(null);
        setActionMenuId(null);
    };

    const stats = {
        total: vendors.length,
        active: vendors.filter(v => v.status === 'active').length,
        online: vendors.filter(v => v.isOnline).length,
        totalOrders: vendors.reduce((sum, v) => sum + (v.totalOrders || 0), 0),
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendors</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading vendors...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 80 }}>
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
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendors</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Manage registered vendors and their shops</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 16px',
                        borderRadius: 10,
                        background: 'var(--primary)',
                        color: 'white',
                        border: 'none',
                        cursor: refreshing ? 'not-allowed' : 'pointer',
                        opacity: refreshing ? 0.6 : 1,
                        fontWeight: 500,
                        fontSize: '0.875rem',
                        transition: 'all 0.2s'
                    }}
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TrendingUp size={18} /> Overview
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                    <StatCard title="Total Vendors" value={stats.total} icon={Store} color="primary" />
                    <StatCard title="Active" value={stats.active} subValue={`${stats.total > 0 ? ((stats.active / stats.total) * 100).toFixed(0) : 0}%`} icon={CheckCircle} color="success" />
                    <StatCard title="Online Now" value={stats.online} icon={Power} color="warning" />
                    <StatCard title="Total Orders" value={stats.totalOrders.toLocaleString()} icon={ShoppingBag} color="error" />
                </div>
            </div>

            {/* Search & Filters */}
            <div className="glass-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    {/* Search */}
                    <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search by shop, owner, or phone..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input"
                            style={{ paddingLeft: 36, width: '100%' }}
                        />
                    </div>

                    {/* Status Filter */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => { setShowStatusDropdown(!showStatusDropdown); setShowOnlineDropdown(false); }}
                            className="btn btn-outline"
                            style={{ padding: '8px 14px', fontSize: '0.8rem', gap: 6 }}
                        >
                            <Filter size={14} />
                            {statusFilter}
                            <ChevronDown size={14} />
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
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => { setShowOnlineDropdown(!showOnlineDropdown); setShowStatusDropdown(false); }}
                            className="btn btn-outline"
                            style={{ padding: '8px 14px', fontSize: '0.8rem', gap: 6 }}
                        >
                            <Power size={14} />
                            {onlineFilter}
                            <ChevronDown size={14} />
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

                    {/* Count badge */}
                    <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '4px 12px',
                        borderRadius: 100,
                        background: 'var(--primary)',
                        color: 'white',
                        marginLeft: 'auto'
                    }}>
                        {filteredVendors.length} vendors
                    </span>
                </div>
            </div>

            {/* Vendor Table */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
                style={{ overflow: 'hidden' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #F59E0B, #D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Store size={16} style={{ color: 'white' }} />
                        </div>
                        <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>Vendor List</span>
                    </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium">
                        <thead>
                            <tr>
                                <th>Vendor</th>
                                <th>Rating</th>
                                <th>Orders</th>
                                <th>Earnings</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredVendors.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <Store size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                                        <p style={{ fontWeight: 500, color: 'var(--foreground)' }}>No vendors found</p>
                                        <p style={{ fontSize: '0.8rem' }}>Try adjusting your search or filters</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredVendors.map((vendor) => (
                                    <tr
                                        key={vendor.vendorId}
                                        onClick={() => router.push(`/users/vendors/${vendor.vendorId}`)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {/* Vendor */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{
                                                    width: 40,
                                                    height: 40,
                                                    borderRadius: 10,
                                                    background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    overflow: 'hidden',
                                                    flexShrink: 0,
                                                }}>
                                                    {vendor.shopImageUrl || vendor.profileImageUrl ? (
                                                        <img
                                                            src={vendor.shopImageUrl || vendor.profileImageUrl}
                                                            alt={vendor.shopName}
                                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            onError={(e) => {
                                                                (e.target as HTMLImageElement).style.display = 'none';
                                                            }}
                                                        />
                                                    ) : (
                                                        <Store size={18} color="white" />
                                                    )}
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <p style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vendor.shopName}</p>
                                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vendor.fullName}</p>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Rating */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Star size={14} color="#F59E0B" fill="#F59E0B" />
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{(vendor.rating || 0).toFixed(1)}</span>
                                            </div>
                                        </td>

                                        {/* Orders */}
                                        <td>
                                            <span style={{ fontWeight: 600 }}>{vendor.totalOrders || 0}</span>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{vendor.menuItemsCount || 0} items</p>
                                        </td>

                                        {/* Earnings */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <IndianRupee size={13} style={{ color: 'var(--foreground-secondary)' }} />
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{((vendor.totalEarnings || 0) / 1000).toFixed(1)}k</span>
                                            </div>
                                        </td>

                                        {/* Status */}
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                <span className={`badge ${vendor.status === 'active' ? 'badge-approved' : 'badge-rejected'}`}>
                                                    {vendor.status}
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <span style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: '50%',
                                                        background: vendor.isOnline ? '#10B981' : '#9CA3AF',
                                                        display: 'inline-block'
                                                    }} />
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>
                                                        {vendor.isOnline ? 'Online' : 'Offline'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Actions */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => router.push(`/users/vendors/${vendor.vendorId}`)}
                                                    className="btn btn-outline btn-icon-sm"
                                                    title="View Details"
                                                    style={{ padding: '6px' }}
                                                >
                                                    <Eye size={15} />
                                                </button>
                                                <div style={{ position: 'relative' }}>
                                                    <button
                                                        onClick={() => setActionMenuId(actionMenuId === vendor.vendorId ? null : vendor.vendorId)}
                                                        className="btn btn-ghost btn-icon-sm"
                                                        style={{ padding: '6px' }}
                                                    >
                                                        <MoreVertical size={15} />
                                                    </button>
                                                    <AnimatePresence>
                                                        {actionMenuId === vendor.vendorId && (
                                                            <motion.div
                                                                initial={{ opacity: 0, scale: 0.95 }}
                                                                animate={{ opacity: 1, scale: 1 }}
                                                                exit={{ opacity: 0, scale: 0.95 }}
                                                                className="dropdown-menu right-0"
                                                                style={{ zIndex: 50 }}
                                                            >
                                                                <button
                                                                    onClick={() => toggleVendorOnline(vendor.vendorId)}
                                                                    className="dropdown-item"
                                                                    disabled={updating === vendor.vendorId}
                                                                >
                                                                    <Power size={14} className={vendor.isOnline ? 'text-[var(--accent-error)]' : 'text-[var(--accent-success)]'} />
                                                                    <span>{vendor.isOnline ? 'Set Offline' : 'Set Online'}</span>
                                                                </button>
                                                                <button
                                                                    onClick={() => toggleVendorStatus(vendor.vendorId)}
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
