'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Package, RefreshCw, Search, Bike, User, MapPin,
    Phone, X, CheckCircle2, Clock, UserPlus, UserMinus,
    Loader2, Star
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface Order {
    orderId: string;
    vendorId: string;
    vendorName: string;
    vendorAddress: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    status: string;
    total: number;
    paymentMode: string;
    itemCount: number;
    itemNames: string;
    createdAt: string;
    deliveryPersonId: string | null;
    deliveryPersonName: string | null;
    isAssigned: boolean;
}

interface DeliveryPartner {
    deliveryPersonId: string;
    fullName: string;
    profilePhotoUrl: string;
    phoneNumber: string;
    city: string;
    vehicleType: string;
    isOnline: boolean;
    isOnDelivery: boolean;
    currentOrderId: string | null;
    rating: number;
    totalDeliveries: number;
}

interface AssignmentData {
    orders: Order[];
    deliveryPartners: DeliveryPartner[];
    summary: {
        totalPendingOrders: number;
        totalAssignedOrders: number;
        onlinePartners: number;
        availablePartners: number;
    };
}

function StatCard({ title, value, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; icon: React.ElementType;
    color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const colorMap = {
        primary: { bg: 'rgba(40, 137, 144, 0.15)', text: '#288990' },
        success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
        warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
        error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
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

export default function OrderAssignmentPage() {
    const { data, loading, refetch } = useApi<AssignmentData>('/api/orders/assignment');
    const [searchTerm, setSearchTerm] = useState('');
    const [partnerSearch, setPartnerSearch] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [processing, setProcessing] = useState(false);
    const [showConfirmUnassign, setShowConfirmUnassign] = useState<Order | null>(null);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    };

    const formatDate = (date: string) => {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    };

    const getStatusStyle = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'pending': return { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B' };
            case 'confirmed': return { bg: 'rgba(59,130,246,0.1)', color: '#3B82F6' };
            case 'preparing': return { bg: 'rgba(249,115,22,0.1)', color: '#F97316' };
            case 'ready': return { bg: 'rgba(168,85,247,0.1)', color: '#A855F7' };
            case 'picked_up': return { bg: 'rgba(6,182,212,0.1)', color: '#06B6D4' };
            case 'delivered': return { bg: 'rgba(16,185,129,0.1)', color: '#10B981' };
            case 'cancelled': return { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' };
            default: return { bg: 'rgba(107,114,128,0.1)', color: '#6B7280' };
        }
    };

    const handleAssign = async (partner: DeliveryPartner) => {
        if (!selectedOrder) return;
        setProcessing(true);
        try {
            const response = await fetch('/api/orders/assignment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: selectedOrder.orderId,
                    deliveryPersonId: partner.deliveryPersonId,
                    deliveryPersonName: partner.fullName,
                    deliveryPersonPhone: partner.phoneNumber,
                    reason: 'Manual assignment by admin',
                }),
            });
            const result = await response.json();
            if (result.success) {
                await refetch();
                setSelectedOrder(null);
            } else {
                alert(result.error || 'Failed to assign order');
            }
        } catch {
            alert('Failed to assign order');
        }
        setProcessing(false);
    };

    const handleUnassign = async () => {
        if (!showConfirmUnassign) return;
        setProcessing(true);
        try {
            const response = await fetch(`/api/orders/assignment?orderId=${showConfirmUnassign.orderId}`, { method: 'DELETE' });
            const result = await response.json();
            if (result.success) {
                await refetch();
                setShowConfirmUnassign(null);
            } else {
                alert(result.error || 'Failed to unassign order');
            }
        } catch {
            alert('Failed to unassign order');
        }
        setProcessing(false);
    };

    const filteredOrders = data?.orders?.filter(o =>
        o.orderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        o.vendorName?.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

    const filteredPartners = data?.deliveryPartners
        ?.filter(p =>
            p.fullName?.toLowerCase().includes(partnerSearch.toLowerCase()) ||
            p.phoneNumber?.includes(partnerSearch)
        )
        .sort((a, b) => {
            if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
            if (a.isOnDelivery !== b.isOnDelivery) return a.isOnDelivery ? 1 : -1;
            return b.rating - a.rating;
        }) || [];

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Manual Order Assignment</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading assignment data...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
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
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Manual Order Assignment</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Assign specific orders to delivery partners</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 10,
                        background: 'var(--primary)', color: 'white',
                        border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer',
                        opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem',
                        transition: 'all 0.2s'
                    }}
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <StatCard title="Unassigned Orders" value={data?.summary?.totalPendingOrders || 0} icon={Package} color="warning" />
                <StatCard title="Available Partners" value={data?.summary?.availablePartners || 0} icon={CheckCircle2} color="success" />
                <StatCard title="Online Partners" value={data?.summary?.onlinePartners || 0} icon={Bike} color="primary" />
                <StatCard title="Assigned Orders" value={data?.summary?.totalAssignedOrders || 0} icon={Clock} color="primary" />
            </div>

            {/* Two Column Layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Orders List */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12 }}>Orders Awaiting Assignment</h3>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input
                                type="text"
                                placeholder="Search orders..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{
                                    width: '100%', padding: '8px 12px 8px 36px',
                                    borderRadius: 10, border: '1px solid var(--border)',
                                    background: 'var(--surface)', color: 'var(--foreground)',
                                    fontSize: '0.8rem', outline: 'none',
                                }}
                            />
                        </div>
                    </div>
                    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                        {filteredOrders.length === 0 ? (
                            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                                <Package size={36} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                <p>No orders awaiting assignment</p>
                            </div>
                        ) : (
                            filteredOrders.map((order) => {
                                const statusStyle = getStatusStyle(order.status);
                                const isSelected = selectedOrder?.orderId === order.orderId;
                                return (
                                    <div
                                        key={order.orderId}
                                        onClick={() => setSelectedOrder(order)}
                                        style={{
                                            padding: '14px 16px',
                                            borderBottom: '1px solid var(--border)',
                                            cursor: 'pointer',
                                            background: isSelected ? 'rgba(40,137,144,0.06)' : 'transparent',
                                            borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--foreground)' }}>
                                                    #{order.orderId.slice(-6).toUpperCase()}
                                                </span>
                                                <span style={{
                                                    padding: '2px 8px', borderRadius: 100,
                                                    fontSize: '0.65rem', fontWeight: 500,
                                                    background: statusStyle.bg, color: statusStyle.color
                                                }}>
                                                    {order.status}
                                                </span>
                                                {order.isAssigned && (
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 100,
                                                        fontSize: '0.65rem', fontWeight: 500,
                                                        background: 'rgba(59,130,246,0.1)', color: '#3B82F6'
                                                    }}>
                                                        Assigned
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--primary)' }}>{formatCurrency(order.total)}</span>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <User size={12} /> {order.customerName}
                                            </span>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Package size={12} /> {order.vendorName}
                                            </span>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Clock size={12} /> {formatDate(order.createdAt)}
                                            </span>
                                        </div>
                                        {order.deliveryPersonName && (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                                                <span style={{ fontSize: '0.78rem', color: '#3B82F6', display: 'flex', alignItems: 'center', gap: 5 }}>
                                                    <Bike size={13} /> Assigned: {order.deliveryPersonName}
                                                </span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setShowConfirmUnassign(order); }}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        padding: '3px 10px', borderRadius: 8,
                                                        background: 'rgba(239,68,68,0.1)', color: '#EF4444',
                                                        border: 'none', cursor: 'pointer',
                                                        fontSize: '0.7rem', fontWeight: 600,
                                                    }}
                                                >
                                                    <UserMinus size={12} /> Unassign
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </motion.div>

                {/* Partners List */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="glass-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12 }}>Available Delivery Partners</h3>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input
                                type="text"
                                placeholder="Search partners..."
                                value={partnerSearch}
                                onChange={(e) => setPartnerSearch(e.target.value)}
                                style={{
                                    width: '100%', padding: '8px 12px 8px 36px',
                                    borderRadius: 10, border: '1px solid var(--border)',
                                    background: 'var(--surface)', color: 'var(--foreground)',
                                    fontSize: '0.8rem', outline: 'none',
                                }}
                            />
                        </div>
                    </div>
                    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                        {!selectedOrder ? (
                            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                                <UserPlus size={36} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                <p>Select an order to assign a delivery partner</p>
                            </div>
                        ) : filteredPartners.length === 0 ? (
                            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                                <Bike size={36} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                <p>No partners available</p>
                            </div>
                        ) : (
                            filteredPartners.map((partner) => {
                                const isAvailable = partner.isOnline && !partner.isOnDelivery;
                                const statusLabel = !partner.isOnline ? 'Offline' : partner.isOnDelivery ? 'On Delivery' : 'Available';
                                const statusColor = !partner.isOnline ? { bg: 'rgba(107,114,128,0.1)', text: '#6B7280' }
                                    : partner.isOnDelivery ? { bg: 'rgba(245,158,11,0.1)', text: '#F59E0B' }
                                        : { bg: 'rgba(16,185,129,0.1)', text: '#10B981' };

                                return (
                                    <div
                                        key={partner.deliveryPersonId}
                                        style={{
                                            padding: '14px 16px',
                                            borderBottom: '1px solid var(--border)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{
                                                width: 42, height: 42, borderRadius: 10,
                                                background: 'rgba(40,137,144,0.1)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                overflow: 'hidden', flexShrink: 0
                                            }}>
                                                {partner.profilePhotoUrl ? (
                                                    <img src={partner.profilePhotoUrl} alt={partner.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <Bike size={18} color="#288990" />
                                                )}
                                            </div>
                                            <div>
                                                <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{partner.fullName}</p>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                        <Phone size={10} /> {partner.phoneNumber}
                                                    </span>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                        <MapPin size={10} /> {partner.city}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 100,
                                                        fontSize: '0.65rem', fontWeight: 500,
                                                        background: statusColor.bg, color: statusColor.text
                                                    }}>
                                                        {statusLabel}
                                                    </span>
                                                    <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                        <Star size={10} fill="#F59E0B" color="#F59E0B" /> {partner.rating?.toFixed(1) || 'N/A'} • {partner.totalDeliveries} deliveries
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleAssign(partner)}
                                            disabled={processing || !isAvailable}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                padding: '5px 14px', borderRadius: 8,
                                                background: isAvailable ? 'var(--primary)' : 'var(--surface)',
                                                color: isAvailable ? 'white' : 'var(--foreground-secondary)',
                                                border: isAvailable ? 'none' : '1px solid var(--border)',
                                                cursor: isAvailable ? (processing ? 'not-allowed' : 'pointer') : 'not-allowed',
                                                fontSize: '0.75rem', fontWeight: 600,
                                                opacity: processing ? 0.6 : 1,
                                                transition: 'all 0.2s',
                                                flexShrink: 0,
                                            }}
                                        >
                                            <UserPlus size={13} /> Assign
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </motion.div>
            </div>

            {/* Selected Order Details */}
            <AnimatePresence>
                {selectedOrder && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="glass-card"
                        style={{ padding: 20, overflow: 'hidden' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Selected Order Details</h3>
                            <button onClick={() => setSelectedOrder(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}>
                                <X size={18} />
                            </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
                            <div>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <User size={14} /> Customer
                                </h4>
                                <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)' }}>{selectedOrder.customerName}</p>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedOrder.customerPhone}</p>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>{selectedOrder.deliveryAddress}</p>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Package size={14} /> Vendor
                                </h4>
                                <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)' }}>{selectedOrder.vendorName}</p>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedOrder.vendorAddress}</p>
                            </div>
                            <div>
                                <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>Order Info</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                    <p><span style={{ fontWeight: 500 }}>Order ID:</span> {selectedOrder.orderId.slice(-8).toUpperCase()}</p>
                                    <p><span style={{ fontWeight: 500 }}>Amount:</span> {formatCurrency(selectedOrder.total)}</p>
                                    <p><span style={{ fontWeight: 500 }}>Payment:</span> {selectedOrder.paymentMode}</p>
                                    <p><span style={{ fontWeight: 500 }}>Status:</span> {selectedOrder.status}</p>
                                    <p><span style={{ fontWeight: 500 }}>Items:</span> {selectedOrder.itemCount} ({selectedOrder.itemNames})</p>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Unassign Confirmation Modal */}
            <AnimatePresence>
                {showConfirmUnassign && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed', inset: 0,
                            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: 16,
                        }}
                        onClick={() => setShowConfirmUnassign(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            className="glass-card"
                            style={{ padding: 24, maxWidth: 420, width: '100%' }}
                        >
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 12px' }}>Confirm Unassignment</h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
                                Are you sure you want to unassign <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{showConfirmUnassign.deliveryPersonName}</span> from order <span style={{ fontWeight: 600, color: 'var(--foreground)', fontFamily: 'monospace' }}>#{showConfirmUnassign.orderId.slice(-6).toUpperCase()}</span>?
                            </p>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                    onClick={() => setShowConfirmUnassign(null)}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: 10,
                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                        color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
                                    }}
                                >Cancel</button>
                                <button
                                    onClick={handleUnassign}
                                    disabled={processing}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: 10,
                                        background: '#EF4444', border: 'none',
                                        color: 'white', cursor: processing ? 'not-allowed' : 'pointer',
                                        fontWeight: 600, fontSize: '0.85rem',
                                        opacity: processing ? 0.6 : 1,
                                    }}
                                >
                                    {processing ? 'Processing...' : 'Unassign'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
