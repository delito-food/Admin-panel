'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
    ArrowLeft, Store, Phone, Mail, MapPin, Star, Power, Ban, CheckCircle,
    IndianRupee, UtensilsCrossed, Clock, FileText, Tag, ShoppingBag, Loader2,
    Calendar, Award, AlertTriangle, Shield, Edit2, X, Check,
    ChevronLeft, ChevronRight, Receipt, TrendingUp, XCircle
} from 'lucide-react';
import { apiPatch } from '@/hooks/useApi';

interface MenuItem {
    itemId: string;
    name: string;
    price: number;
    imageUrl: string;
    discount: number;
    isAvailable: boolean;
    isBestSeller: boolean;
    isVeg: boolean;
    categoryName: string;
}

interface SpecialOffer {
    itemId: string;
    name: string;
    price: number;
    discount: number;
    imageUrl: string;
}

interface VendorOrder {
    orderId: string;
    invoiceNumber: string;
    createdAt: string;
    deliveredAt: string | null;
    customerName: string;
    customerPhone: string;
    status: string;
    paymentMode: string;
    paymentStatus: string;
    itemCount: number;
    itemNames: string[];
    itemTotal: number;
    deliveryFee: number;
    taxes: number;
    total: number;
    commission: number;
    gstOnCommission: number;
    totalDeduction: number;
    vendorEarning: number;
    refundStatus: string;
    refundAmount: number;
}

interface VendorOrderStats {
    totalOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    activeOrders: number;
    grossSales: number;
    netEarnings: number;
    commissionPaid: number;
    gstPaid: number;
    averageOrderValue: number;
    fulfilmentRate: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    truncated: boolean;
}

interface VendorDetail {
    vendorId: string;
    fullName: string;
    shopName: string;
    email: string;
    phoneNumber: string;
    profileImageUrl: string;
    shopImageUrl: string;
    address: string;
    city: string;
    pincode: string;
    gstNumber: string;
    fssaiLicense: string;
    rating: number;
    totalOrders: number;
    totalEarnings: number;
    menuItemsCount: number;
    menuItems: MenuItem[];
    specialOffers: SpecialOffer[];
    isOnline: boolean;
    isVerified: boolean;
    cuisineTypes: string[];
    minimumOrderAmount: number;
    averageDeliveryTime: number;
    createdAt: string;
    registeredAt: string;
    status: string;
    isHidden?: boolean;
    adminForceOffline?: boolean;
}

const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
};

// Reusable stat card matching dashboard style
function StatCard({ title, value, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; icon: React.ElementType;
    color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
}) {
    const colorMap = {
        primary: { bg: 'rgba(244, 81, 30, 0.15)', text: '#F4511E' },
        success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
        warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
        error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
        info: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1' },
    };
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{title}</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: colorMap[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={colorMap[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

export default function VendorDetailPage() {
    const params = useParams();
    const router = useRouter();
    const vendorId = params.vendorId as string;

    const [vendor, setVendor] = useState<VendorDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState(false);
    const [activeTab, setActiveTab] = useState<'menu' | 'offers'>('menu');

    const [editingFssai, setEditingFssai] = useState(false);
    const [newFssai, setNewFssai] = useState('');
    const [savingFssai, setSavingFssai] = useState(false);

    // ── Vendor order history ──
    const [orders, setOrders] = useState<VendorOrder[]>([]);
    const [orderStats, setOrderStats] = useState<VendorOrderStats | null>(null);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [ordersError, setOrdersError] = useState<string | null>(null);
    const [orderStatusFilter, setOrderStatusFilter] = useState('All');
    const [ordersPage, setOrdersPage] = useState(1);
    const ORDERS_PER_PAGE = 10;

    useEffect(() => {
        const fetchVendor = async () => {
            try {
                const response = await fetch('/api/vendors');
                const result = await response.json();
                if (result.success) {
                    const foundVendor = result.data.find((v: VendorDetail) => v.vendorId === vendorId);
                    if (foundVendor) setVendor(foundVendor);
                    else setError('Vendor not found');
                } else {
                    setError('Failed to fetch vendor');
                }
            } catch {
                setError('Network error');
            } finally {
                setLoading(false);
            }
        };
        fetchVendor();
    }, [vendorId]);

    useEffect(() => {
        const fetchOrders = async () => {
            setOrdersLoading(true);
            setOrdersError(null);
            try {
                const response = await fetch(`/api/vendors/orders?vendorId=${encodeURIComponent(vendorId)}`);
                const result = await response.json();
                if (result.success) {
                    setOrders(result.data.orders || []);
                    setOrderStats(result.data.stats || null);
                } else {
                    setOrdersError(result.error || 'Failed to load order history');
                }
            } catch {
                setOrdersError('Network error while loading order history');
            } finally {
                setOrdersLoading(false);
            }
        };
        fetchOrders();
    }, [vendorId]);

    const orderStatuses = useMemo(
        () => ['All', ...Array.from(new Set(orders.map(o => o.status))).sort()],
        [orders]
    );

    const filteredOrders = useMemo(
        () => orderStatusFilter === 'All' ? orders : orders.filter(o => o.status === orderStatusFilter),
        [orders, orderStatusFilter]
    );

    const orderTotalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
    const safeOrdersPage = Math.min(ordersPage, orderTotalPages);
    const pagedOrders = filteredOrders.slice(
        (safeOrdersPage - 1) * ORDERS_PER_PAGE,
        safeOrdersPage * ORDERS_PER_PAGE
    );

    const toggleOnline = async () => {
        if (!vendor || updating) return;
        setUpdating(true);
        await apiPatch('/api/vendors', { vendorId: vendor.vendorId, updates: { isOnline: !vendor.isOnline } });
        setVendor({ ...vendor, isOnline: !vendor.isOnline });
        setUpdating(false);
    };

    const toggleStatus = async () => {
        if (!vendor || updating) return;
        setUpdating(true);
        const newStatus = vendor.status === 'active' ? 'suspended' : 'active';
        await apiPatch('/api/vendors', { vendorId: vendor.vendorId, updates: { status: newStatus, isVerified: newStatus === 'active' } });
        setVendor({ ...vendor, status: newStatus, isVerified: newStatus === 'active' });
        setUpdating(false);
    };

    const toggleHidden = async () => {
        if (!vendor || updating) return;
        setUpdating(true);
        const isCurrentlyHidden = vendor.adminForceOffline;
        const updates = isCurrentlyHidden 
            ? { adminForceOffline: false } 
            : { adminForceOffline: true, isOnline: false };
            
        await apiPatch('/api/vendors', { vendorId: vendor.vendorId, updates });
        setVendor({ 
            ...vendor, 
            adminForceOffline: !isCurrentlyHidden, 
            isOnline: isCurrentlyHidden ? vendor.isOnline : false 
        });
        setUpdating(false);
    };

    const handleSaveFssai = async () => {
        if (!vendor) return;
        setSavingFssai(true);
        const result = await apiPatch('/api/vendors', { vendorId: vendor.vendorId, updates: { fssaiLicense: newFssai } });
        if (result.success) {
            setVendor({ ...vendor, fssaiLicense: newFssai });
            setEditingFssai(false);
        } else {
            alert('Failed to update FSSAI License');
        }
        setSavingFssai(false);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendor Details</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading vendor information...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    if (error || !vendor) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20 }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={32} color="#EF4444" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>{error || 'Vendor not found'}</h2>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)' }}>We couldn&apos;t find the vendor you&apos;re looking for</p>
                </div>
                <button onClick={() => router.back()} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Go Back
                </button>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 0.2s'
                    }}
                >
                    <ArrowLeft size={18} style={{ color: 'var(--foreground)' }} />
                </button>
                <div style={{ flex: 1 }}>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>{vendor.shopName}</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Vendor Profile & Management</p>
                </div>
                <button 
                    onClick={() => router.push(`/menu-management/vendor/${vendor.vendorId}`)}
                    className="btn btn-primary px-4 py-2 font-bold text-sm shadow-sm transition-transform hover:-translate-y-0.5 rounded-xl"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                    <UtensilsCrossed size={16} /> Manage Menu
                </button>
            </div>

            {/* Profile Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
                style={{ overflow: 'hidden' }}
            >
                {/* Cover Image */}
                <div style={{
                    position: 'relative', height: 160,
                    background: 'linear-gradient(135deg, #F59E0B, #EF4444)',
                }}>
                    {(vendor.shopImageUrl || vendor.profileImageUrl) && (
                        <img
                            src={vendor.shopImageUrl || vendor.profileImageUrl}
                            alt={vendor.shopName}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                        />
                    )}
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)' }} />

                    {/* Status badges */}
                    <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6 }}>
                        <span style={{
                            padding: '4px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                            backdropFilter: 'blur(8px)',
                            background: vendor.isOnline ? 'rgba(16,185,129,0.2)' : 'rgba(156,163,175,0.2)',
                            color: vendor.isOnline ? '#6EE7B7' : '#D1D5DB',
                            border: `1px solid ${vendor.isOnline ? 'rgba(16,185,129,0.3)' : 'rgba(156,163,175,0.3)'}`,
                        }}>
                            {vendor.isOnline ? '● Online' : '● Offline'}
                        </span>
                        <span className={`badge ${vendor.status === 'active' ? 'badge-approved' : 'badge-rejected'}`} style={{ fontSize: '0.7rem' }}>
                            {vendor.status}
                        </span>
                    </div>

                    {vendor.isVerified && (
                        <div style={{ position: 'absolute', top: 12, left: 12 }}>
                            <span style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                                backdropFilter: 'blur(8px)',
                                background: 'rgba(59,130,246,0.2)', color: '#93C5FD',
                                border: '1px solid rgba(59,130,246,0.3)',
                            }}>
                                <Shield size={12} /> Verified
                            </span>
                        </div>
                    )}
                </div>

                {/* Profile info */}
                <div style={{ position: 'relative', padding: '0 20px 20px' }}>
                    {/* Avatar */}
                    <div style={{
                        position: 'absolute', top: -36, left: 20,
                        width: 72, height: 72, borderRadius: 16,
                        background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden',
                        border: '4px solid var(--glass-bg)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    }}>
                        {vendor.profileImageUrl ? (
                            <img src={vendor.profileImageUrl} alt={vendor.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                        ) : (
                            <Store size={28} color="white" />
                        )}
                    </div>

                    <div style={{ paddingTop: 44, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16 }}>
                        {/* Left: info */}
                        <div style={{ flex: '1 1 300px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>{vendor.fullName}</h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 8, background: 'rgba(245,158,11,0.1)' }}>
                                    <Star size={13} color="#F59E0B" fill="#F59E0B" />
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#D97706' }}>{(vendor.rating || 0).toFixed(1)}</span>
                                </div>
                            </div>

                            {/* Cuisines */}
                            {vendor.cuisineTypes && vendor.cuisineTypes.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                                    {vendor.cuisineTypes.map((c, i) => (
                                        <span key={i} style={{
                                            padding: '2px 10px', borderRadius: 100, fontSize: '0.7rem',
                                            background: 'rgba(244,81,30,0.1)', color: 'var(--primary)', fontWeight: 500
                                        }}>{c}</span>
                                    ))}
                                </div>
                            )}

                            {/* Contact */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                <a href={`tel:${vendor.phoneNumber}`} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'inherit', textDecoration: 'none' }}>
                                    <Phone size={14} /> {vendor.phoneNumber}
                                </a>
                                <a href={`mailto:${vendor.email}`} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <Mail size={14} /> {vendor.email}
                                </a>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, gridColumn: '1 / -1' }}>
                                    <MapPin size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                                    <span>{vendor.address}, {vendor.city} - {vendor.pincode}</span>
                                </div>
                            </div>
                        </div>

                        {/* Right: action buttons */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <button
                                onClick={toggleOnline}
                                disabled={updating}
                                className={`btn ${vendor.isOnline ? 'btn-outline' : 'btn-primary'}`}
                                style={{ fontSize: '0.8rem', padding: '6px 14px', gap: 6 }}
                            >
                                {updating ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                                {vendor.isOnline ? 'Set Offline' : 'Set Online'}
                            </button>
                            <button
                                onClick={toggleHidden}
                                disabled={updating}
                                className={`btn ${vendor.adminForceOffline ? 'btn-primary' : 'btn-outline'}`}
                                style={{ fontSize: '0.8rem', padding: '6px 14px', gap: 6 }}
                            >
                                {updating ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                                {vendor.adminForceOffline ? 'Unhide Vendor' : 'Hide Vendor'}
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                <StatCard title="Total Orders" value={orderStats?.totalOrders ?? vendor.totalOrders ?? 0} icon={ShoppingBag} color="primary" />
                <StatCard title="Net Earnings" value={formatCurrency(orderStats?.netEarnings ?? vendor.totalEarnings ?? 0)} icon={IndianRupee} color="success" />
                <StatCard title="Menu Items" value={vendor.menuItemsCount || vendor.menuItems?.length || 0} icon={UtensilsCrossed} color="warning" />
                <StatCard title="Avg. Delivery" value={`${vendor.averageDeliveryTime || 30}m`} icon={Clock} color="info" />
                <StatCard title="Min. Order" value={formatCurrency(vendor.minimumOrderAmount || 0)} icon={Tag} color="error" />
            </div>

            {/* ── Order History ── */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{
                    padding: '18px 20px', borderBottom: '1px solid var(--border)',
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Receipt size={16} style={{ color: 'var(--primary)' }} /> Order History
                        {!ordersLoading && (
                            <span style={{
                                padding: '2px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 700,
                                background: 'rgba(244,81,30,0.12)', color: 'var(--primary)',
                            }}>
                                {filteredOrders.length}
                            </span>
                        )}
                    </h3>

                    {orders.length > 0 && (
                        <select
                            value={orderStatusFilter}
                            onChange={(e) => { setOrderStatusFilter(e.target.value); setOrdersPage(1); }}
                            style={{
                                padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
                                background: 'var(--surface)', color: 'var(--foreground)',
                                fontSize: '0.78rem', cursor: 'pointer', outline: 'none',
                            }}
                        >
                            {orderStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    )}
                </div>

                {/* Order performance summary */}
                {orderStats && orderStats.totalOrders > 0 && (
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: 1, background: 'var(--border)', borderBottom: '1px solid var(--border)',
                    }}>
                        {[
                            { label: 'Delivered', value: String(orderStats.deliveredOrders), icon: CheckCircle, color: '#10B981' },
                            { label: 'Cancelled', value: String(orderStats.cancelledOrders), icon: XCircle, color: '#EF4444' },
                            { label: 'In Progress', value: String(orderStats.activeOrders), icon: Clock, color: '#F59E0B' },
                            { label: 'Gross Sales', value: formatCurrency(orderStats.grossSales), icon: IndianRupee, color: '#6366F1' },
                            { label: 'Commission + GST', value: formatCurrency(orderStats.commissionPaid + orderStats.gstPaid), icon: Award, color: '#EC4899' },
                            { label: 'Avg. Order', value: formatCurrency(orderStats.averageOrderValue), icon: TrendingUp, color: '#0EA5E9' },
                            { label: 'Fulfilment', value: `${orderStats.fulfilmentRate}%`, icon: Shield, color: '#10B981' },
                        ].map(stat => (
                            <div key={stat.label} style={{ background: 'var(--glass-bg)', padding: '12px 14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                    <stat.icon size={12} color={stat.color} />
                                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        {stat.label}
                                    </span>
                                </div>
                                <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>{stat.value}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Table */}
                <div style={{ padding: ordersLoading || filteredOrders.length === 0 ? 20 : 0 }}>
                    {ordersLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
                            <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--primary)' }} />
                        </div>
                    ) : ordersError ? (
                        <div style={{ textAlign: 'center', padding: '32px 0', color: '#EF4444', fontSize: '0.85rem' }}>
                            <AlertTriangle size={32} style={{ margin: '0 auto 10px', opacity: 0.7 }} />
                            <p>{ordersError}</p>
                        </div>
                    ) : filteredOrders.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                            <ShoppingBag size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                            <p>{orders.length === 0 ? 'This vendor has no orders yet' : 'No orders match this status'}</p>
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--surface)' }}>
                                        {['Order', 'Date', 'Customer', 'Items', 'Item Total', 'Commission + GST', 'Vendor Earning', 'Payment', 'Status'].map((h, i) => (
                                            <th
                                                key={h}
                                                style={{
                                                    padding: '10px 14px', textAlign: i >= 4 && i <= 6 ? 'right' : 'left',
                                                    fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em',
                                                    textTransform: 'uppercase', color: 'var(--foreground-secondary)',
                                                    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedOrders.map(order => {
                                        const statusLower = order.status.toLowerCase();
                                        const statusColor =
                                            statusLower === 'delivered' || statusLower === 'completed' ? '#10B981'
                                                : statusLower.includes('cancel') || statusLower === 'expired' || statusLower === 'not responded' ? '#EF4444'
                                                    : '#F59E0B';
                                        return (
                                            <tr
                                                key={order.orderId}
                                                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                                                onClick={() => router.push(`/orders?orderId=${order.orderId}`)}
                                            >
                                                <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                                                        #{order.orderId.slice(-8).toUpperCase()}
                                                    </span>
                                                    <br />
                                                    <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', fontFamily: 'monospace' }}>
                                                        {order.invoiceNumber}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '11px 14px', color: 'var(--foreground-secondary)', whiteSpace: 'nowrap' }}>
                                                    {order.createdAt
                                                        ? new Date(order.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                                                        : '—'}
                                                </td>
                                                <td style={{ padding: '11px 14px', color: 'var(--foreground)' }}>
                                                    {order.customerName || 'Unknown'}
                                                    {order.customerPhone && (
                                                        <>
                                                            <br />
                                                            <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>{order.customerPhone}</span>
                                                        </>
                                                    )}
                                                </td>
                                                <td style={{ padding: '11px 14px', color: 'var(--foreground-secondary)', maxWidth: 220 }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{order.itemCount}</span>
                                                    {order.itemNames.length > 0 && (
                                                        <span
                                                            title={order.itemNames.join(', ')}
                                                            style={{ display: 'block', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                        >
                                                            {order.itemNames.join(', ')}
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '11px 14px', textAlign: 'right', color: 'var(--foreground)', whiteSpace: 'nowrap' }}>
                                                    {formatCurrency(order.itemTotal)}
                                                </td>
                                                <td style={{ padding: '11px 14px', textAlign: 'right', color: '#EF4444', whiteSpace: 'nowrap' }}>
                                                    −{formatCurrency(order.totalDeduction)}
                                                </td>
                                                <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: '#10B981', whiteSpace: 'nowrap' }}>
                                                    {formatCurrency(order.vendorEarning)}
                                                </td>
                                                <td style={{ padding: '11px 14px', color: 'var(--foreground-secondary)', whiteSpace: 'nowrap' }}>
                                                    {order.paymentMode || '—'}
                                                    {order.paymentStatus && (
                                                        <>
                                                            <br />
                                                            <span style={{ fontSize: '0.68rem' }}>{order.paymentStatus}</span>
                                                        </>
                                                    )}
                                                </td>
                                                <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                                                    <span style={{
                                                        padding: '3px 10px', borderRadius: 100, fontSize: '0.68rem', fontWeight: 700,
                                                        background: `${statusColor}1A`, color: statusColor,
                                                    }}>
                                                        {order.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {!ordersLoading && filteredOrders.length > ORDERS_PER_PAGE && (
                    <div style={{
                        padding: '12px 20px', borderTop: '1px solid var(--border)',
                        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                            Showing {(safeOrdersPage - 1) * ORDERS_PER_PAGE + 1}–
                            {Math.min(safeOrdersPage * ORDERS_PER_PAGE, filteredOrders.length)} of {filteredOrders.length}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                                onClick={() => setOrdersPage(Math.max(1, safeOrdersPage - 1))}
                                disabled={safeOrdersPage === 1}
                                className="btn btn-outline"
                                style={{ padding: '5px 10px', fontSize: '0.78rem', gap: 4, opacity: safeOrdersPage === 1 ? 0.45 : 1 }}
                            >
                                <ChevronLeft size={14} /> Prev
                            </button>
                            <span style={{ fontSize: '0.78rem', color: 'var(--foreground)', fontWeight: 600 }}>
                                {safeOrdersPage} / {orderTotalPages}
                            </span>
                            <button
                                onClick={() => setOrdersPage(Math.min(orderTotalPages, safeOrdersPage + 1))}
                                disabled={safeOrdersPage === orderTotalPages}
                                className="btn btn-outline"
                                style={{ padding: '5px 10px', fontSize: '0.78rem', gap: 4, opacity: safeOrdersPage === orderTotalPages ? 0.45 : 1 }}
                            >
                                Next <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {orderStats?.truncated && (
                    <p style={{ padding: '0 20px 14px', fontSize: '0.72rem', color: 'var(--foreground-secondary)', margin: 0 }}>
                        Showing the most recent orders only — totals above cover the orders listed here.
                    </p>
                )}
            </motion.div>

            {/* Documents & Menu/Offers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {/* Documents */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={16} style={{ color: '#6366F1' }} /> Documents
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {[
                            { label: 'GST Number', value: vendor.gstNumber, verified: !!vendor.gstNumber, editable: false },
                            { label: 'FSSAI License', value: vendor.fssaiLicense, verified: !!vendor.fssaiLicense, editable: true },
                        ].map(doc => (
                            <div key={doc.label} style={{
                                padding: 14, borderRadius: 12,
                                background: 'var(--surface)', border: '1px solid var(--border)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>{doc.label}</span>
                                    {doc.editable ? (
                                        editingFssai ? (
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                <button onClick={handleSaveFssai} disabled={savingFssai} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#10B981', padding: 2 }}>
                                                    {savingFssai ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                </button>
                                                <button onClick={() => setEditingFssai(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 2 }}>
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => { setEditingFssai(true); setNewFssai(vendor.fssaiLicense || ''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366F1', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 500 }}>
                                                <Edit2 size={12} /> Edit
                                            </button>
                                        )
                                    ) : (
                                        doc.verified && <CheckCircle size={14} color="#10B981" />
                                    )}
                                </div>
                                {doc.editable && editingFssai ? (
                                    <input
                                        type="text"
                                        value={newFssai}
                                        onChange={(e) => setNewFssai(e.target.value)}
                                        placeholder="Enter FSSAI License"
                                        style={{
                                            width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
                                            background: 'var(--bg)', color: 'var(--foreground)', fontSize: '0.8rem', outline: 'none'
                                        }}
                                    />
                                ) : (
                                    <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', fontFamily: 'monospace' }}>{doc.value || 'Not provided'}</p>
                                )}
                            </div>
                        ))}
                        <div style={{
                            padding: 14, borderRadius: 12,
                            background: 'var(--surface)', border: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', gap: 8,
                            fontSize: '0.8rem', color: 'var(--foreground-secondary)',
                        }}>
                            <Calendar size={14} />
                            <span>Registered on {formatDate(vendor.registeredAt || vendor.createdAt)}</span>
                        </div>
                    </div>
                </motion.div>

                {/* Menu & Offers */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                        {[
                            { id: 'menu' as const, label: `Menu Items (${vendor.menuItems?.length || 0})`, icon: UtensilsCrossed },
                            { id: 'offers' as const, label: `Offers (${vendor.specialOffers?.length || 0})`, icon: Tag },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                    padding: '14px 16px', fontSize: '0.8rem', fontWeight: 500,
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    borderBottom: `2px solid ${activeTab === tab.id ? 'var(--primary)' : 'transparent'}`,
                                    color: activeTab === tab.id ? 'var(--primary)' : 'var(--foreground-secondary)',
                                    transition: 'all 0.2s',
                                }}
                            >
                                <tab.icon size={16} /> {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Tab content */}
                    <div style={{ padding: 20, maxHeight: 480, overflowY: 'auto' }}>
                        {activeTab === 'menu' && (
                            <>
                                {vendor.menuItems && vendor.menuItems.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                                        {vendor.menuItems.map((item) => (
                                            <div key={item.itemId} style={{
                                                borderRadius: 14, overflow: 'hidden',
                                                background: 'var(--surface)', border: '1px solid var(--border)',
                                                transition: 'box-shadow 0.2s',
                                            }}>
                                                <div style={{ position: 'relative', height: 100 }}>
                                                    {item.imageUrl ? (
                                                        <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(234,88,12,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            <UtensilsCrossed size={28} style={{ opacity: 0.3, color: 'var(--foreground-secondary)' }} />
                                                        </div>
                                                    )}
                                                    {/* Badges */}
                                                    <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                        {item.isBestSeller && (
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 100, fontSize: '0.6rem', fontWeight: 700, background: '#F59E0B', color: 'white' }}>
                                                                <Award size={9} /> Best
                                                            </span>
                                                        )}
                                                        {item.discount > 0 && (
                                                            <span style={{ padding: '2px 6px', borderRadius: 100, fontSize: '0.6rem', fontWeight: 700, background: '#EF4444', color: 'white' }}>
                                                                {item.discount}% OFF
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Veg/Non-veg */}
                                                    <div style={{ position: 'absolute', top: 6, right: 6 }}>
                                                        <span style={{
                                                            width: 16, height: 16, borderRadius: 3,
                                                            border: `2px solid ${item.isVeg ? '#16A34A' : '#DC2626'}`,
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            background: 'rgba(255,255,255,0.9)',
                                                        }}>
                                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.isVeg ? '#16A34A' : '#DC2626' }} />
                                                        </span>
                                                    </div>
                                                </div>
                                                <div style={{ padding: 10 }}>
                                                    <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</h4>
                                                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{item.categoryName}</p>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            {item.discount > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', textDecoration: 'line-through' }}>₹{item.price}</span>}
                                                            <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '0.85rem' }}>
                                                                ₹{item.discount > 0 ? Math.round(item.price * (1 - item.discount / 100)) : item.price}
                                                            </span>
                                                        </div>
                                                        <span style={{
                                                            fontSize: '0.6rem', padding: '2px 6px', borderRadius: 100, fontWeight: 500,
                                                            background: item.isAvailable ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                                            color: item.isAvailable ? '#10B981' : '#EF4444',
                                                        }}>
                                                            {item.isAvailable ? 'Available' : 'Unavailable'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <UtensilsCrossed size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                                        <p>No menu items found</p>
                                    </div>
                                )}
                            </>
                        )}

                        {activeTab === 'offers' && (
                            <>
                                {vendor.specialOffers && vendor.specialOffers.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                                        {vendor.specialOffers.map((offer) => (
                                            <div key={offer.itemId} style={{
                                                display: 'flex', gap: 12, padding: 14, borderRadius: 14,
                                                background: 'linear-gradient(135deg, rgba(239,68,68,0.05), rgba(245,158,11,0.05))',
                                                border: '1px solid rgba(239,68,68,0.15)',
                                            }}>
                                                <div style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
                                                    {offer.imageUrl ? (
                                                        <img src={offer.imageUrl} alt={offer.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <div style={{ width: '100%', height: '100%', background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            <Tag size={20} color="#EF4444" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{offer.name}</h4>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', textDecoration: 'line-through' }}>₹{offer.price}</span>
                                                        <span style={{ fontSize: '1rem', fontWeight: 700, color: '#10B981' }}>₹{Math.round(offer.price * (1 - offer.discount / 100))}</span>
                                                    </div>
                                                    <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 700, background: '#EF4444', color: 'white' }}>
                                                        {offer.discount}% OFF
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <Tag size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                                        <p>No special offers available</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}
