'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Bike, Car, Phone, Star, Power,
    Package, Loader2, Users, Filter,
    MoreVertical, Zap, Wallet, Eye,
    RefreshCw, ChevronDown, IndianRupee,
    Ban, CheckCircle, TrendingUp
} from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';

interface DeliveryPartner {
    deliveryPersonId: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    profilePhotoUrl: string;
    address: string;
    city: string;
    pincode: string;
    vehicleType: string;
    vehicleNumber: string;
    driverLicenseNumber: string;
    driverLicenseUrl: string;
    vehicleDocumentUrl: string;
    bankName: string;
    bankAccountNumber: string;
    ifscCode: string;
    upiId: string;
    rating: number;
    totalDeliveries: number;
    totalEarnings: number;
    incentives: number;
    codCollected: number;
    codPending: number;
    isOnline: boolean;
    isOnDelivery: boolean;
    status: 'active' | 'suspended' | 'pending';
    currentLocation: string;
    registeredAt: string;
}

const statusFilters = ['All', 'Active', 'Suspended', 'Pending'];

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

export default function DeliveryPartnersPage() {
    const router = useRouter();
    const { data: partners, loading, refetch } = useApi<DeliveryPartner[]>('/api/delivery');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [actionMenuId, setActionMenuId] = useState<string | null>(null);
    const [processing, setProcessing] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const filteredPartners = (partners || []).filter(partner => {
        const matchesSearch =
            partner.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            partner.phoneNumber.includes(searchQuery) ||
            partner.vehicleNumber?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === 'All' || partner.status === statusFilter.toLowerCase();
        return matchesSearch && matchesStatus;
    });

    const handleStatusChange = async (partnerId: string, newStatus: 'active' | 'suspended') => {
        setProcessing(partnerId);
        try {
            await apiPatch('/api/delivery', {
                deliveryPersonId: partnerId,
                updates: { status: newStatus }
            });
            refetch();
        } catch (err) {
            console.error('Failed to update status:', err);
        } finally {
            setProcessing(null);
            setActionMenuId(null);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(amount || 0);
    };

    const stats = {
        total: partners?.length || 0,
        online: partners?.filter(p => p.isOnline).length || 0,
        onDelivery: partners?.filter(p => p.isOnDelivery).length || 0,
        pendingCOD: partners?.reduce((acc, p) => acc + (p.codPending || 0), 0) || 0,
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Partners</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading delivery partners...</p>
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
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Partners</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Manage your fleet, track performance & handle payouts</p>
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
                    <StatCard title="Total Partners" value={stats.total} icon={Users} color="primary" />
                    <StatCard title="Online Now" value={stats.online} icon={Zap} color="success" />
                    <StatCard title="On Delivery" value={stats.onDelivery} icon={Package} color="warning" />
                    <StatCard title="Pending COD" value={formatCurrency(stats.pendingCOD)} icon={Wallet} color="error" />
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
                            placeholder="Search by name, phone or vehicle..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input"
                            style={{ paddingLeft: 36, width: '100%' }}
                        />
                    </div>

                    {/* Status Filter */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowStatusDropdown(!showStatusDropdown)}
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
                        {filteredPartners.length} partners
                    </span>
                </div>
            </div>

            {/* Delivery Partners Table */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
                style={{ overflow: 'hidden' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #3B82F6, #2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Bike size={16} style={{ color: 'white' }} />
                        </div>
                        <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>Partner List</span>
                    </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium">
                        <thead>
                            <tr>
                                <th>Partner</th>
                                <th>Vehicle</th>
                                <th>Rating</th>
                                <th>Deliveries</th>
                                <th>Earnings</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPartners.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <Users size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                                        <p style={{ fontWeight: 500, color: 'var(--foreground)' }}>No partners found</p>
                                        <p style={{ fontSize: '0.8rem' }}>Try adjusting your search or filters</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredPartners.map((partner) => (
                                    <tr key={partner.deliveryPersonId}>
                                        {/* Partner */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{
                                                    width: 40,
                                                    height: 40,
                                                    borderRadius: 10,
                                                    background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    overflow: 'hidden',
                                                    flexShrink: 0,
                                                }}>
                                                    {partner.profilePhotoUrl ? (
                                                        <img
                                                            src={partner.profilePhotoUrl}
                                                            alt={partner.fullName}
                                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            onError={(e) => {
                                                                (e.target as HTMLImageElement).style.display = 'none';
                                                            }}
                                                        />
                                                    ) : (
                                                        partner.vehicleType?.toLowerCase() === 'car'
                                                            ? <Car size={18} color="white" />
                                                            : <Bike size={18} color="white" />
                                                    )}
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <p style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partner.fullName}</p>
                                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        <Phone size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                                        {partner.phoneNumber}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Vehicle */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {partner.vehicleType?.toLowerCase() === 'car'
                                                        ? <Car size={13} style={{ color: 'var(--foreground-secondary)' }} />
                                                        : <Bike size={13} style={{ color: 'var(--foreground-secondary)' }} />
                                                    }
                                                </div>
                                                <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{partner.vehicleNumber || 'N/A'}</span>
                                            </div>
                                        </td>

                                        {/* Rating */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Star size={14} color="#F59E0B" fill="#F59E0B" />
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{(partner.rating || 0).toFixed(1)}</span>
                                            </div>
                                        </td>

                                        {/* Deliveries */}
                                        <td>
                                            <span style={{ fontWeight: 600 }}>{partner.totalDeliveries || 0}</span>
                                        </td>

                                        {/* Earnings */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <IndianRupee size={13} style={{ color: 'var(--foreground-secondary)' }} />
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{((partner.totalEarnings || 0) / 1000).toFixed(1)}k</span>
                                            </div>
                                            {(partner.codPending || 0) > 0 && (
                                                <p style={{ fontSize: '0.65rem', color: '#EF4444', marginTop: 2 }}>
                                                    COD: ₹{partner.codPending}
                                                </p>
                                            )}
                                        </td>

                                        {/* Status */}
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                <span className={`badge ${partner.status === 'active' ? 'badge-approved' : partner.status === 'suspended' ? 'badge-rejected' : 'badge-pending'}`}>
                                                    {partner.status}
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <span style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: '50%',
                                                        background: partner.isOnline ? (partner.isOnDelivery ? '#F59E0B' : '#10B981') : '#9CA3AF',
                                                        display: 'inline-block'
                                                    }} />
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>
                                                        {partner.isOnline ? (partner.isOnDelivery ? 'On Delivery' : 'Online') : 'Offline'}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Actions */}
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ position: 'relative' }}>
                                                    <button
                                                        onClick={() => setActionMenuId(actionMenuId === partner.deliveryPersonId ? null : partner.deliveryPersonId)}
                                                        className="btn btn-ghost btn-icon-sm"
                                                        style={{ padding: '6px' }}
                                                    >
                                                        <MoreVertical size={15} />
                                                    </button>
                                                    <AnimatePresence>
                                                        {actionMenuId === partner.deliveryPersonId && (
                                                            <motion.div
                                                                initial={{ opacity: 0, scale: 0.95 }}
                                                                animate={{ opacity: 1, scale: 1 }}
                                                                exit={{ opacity: 0, scale: 0.95 }}
                                                                className="dropdown-menu right-0"
                                                                style={{ zIndex: 50 }}
                                                            >
                                                                <button
                                                                    onClick={() => router.push(`/users/delivery/${partner.deliveryPersonId}`)}
                                                                    className="dropdown-item"
                                                                >
                                                                    <Eye size={14} style={{ color: 'var(--primary)' }} />
                                                                    <span>View Details</span>
                                                                </button>
                                                                {partner.status !== 'pending' && (
                                                                    <button
                                                                        onClick={() => handleStatusChange(
                                                                            partner.deliveryPersonId,
                                                                            partner.status === 'active' ? 'suspended' : 'active'
                                                                        )}
                                                                        className="dropdown-item"
                                                                        disabled={processing === partner.deliveryPersonId}
                                                                    >
                                                                        {partner.status === 'active' ? (
                                                                            <>
                                                                                <Ban size={14} className="text-[var(--accent-error)]" />
                                                                                <span>Suspend Partner</span>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <CheckCircle size={14} className="text-[var(--accent-success)]" />
                                                                                <span>Activate Partner</span>
                                                                            </>
                                                                        )}
                                                                    </button>
                                                                )}
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
