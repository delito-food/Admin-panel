'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bike, RefreshCw, Search, CheckCircle2, Clock,
    X, CreditCard, TrendingUp, Gift, IndianRupee,
    Loader2, Wallet, Package
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface DeliveryPartnerPayout {
    deliveryPersonId: string;
    fullName: string;
    profilePhotoUrl: string;
    phoneNumber: string;
    city: string;
    isOnline: boolean;
    isVerified: boolean;
    totalDeliveries: number;
    deliveryFees: number;
    deliveryCount: number;
    incentives: number;
    tips: number;
    totalEarnings: number;
    paidAmount: number;
    pendingAmount: number;
    codCollected: number;
    codSettled: number;
    codPending: number;
    bankDetails?: { accountNumber?: string; ifsc?: string; bankName?: string } | null;
    upiId?: string | null;
    recentDeliveries?: Array<{
        orderId: string;
        distanceKm: number;
        earnings: number;
        tip: number;
        date: string;
    }>;
}

interface PayoutRecord {
    payoutId: string;
    deliveryPersonId: string;
    deliveryPersonName: string;
    amount: number;
    method: string;
    transactionId: string | null;
    status: string;
    createdAt: string;
    notes: string | null;
}

interface DeliveryPayoutData {
    deliveryPartners: DeliveryPartnerPayout[];
    recentPayouts: PayoutRecord[];
    summary: {
        totalEarnings: number;
        totalPaidAmount: number;
        totalPendingPayouts: number;
        totalTips: number;
        totalDeliveryFees: number;
        totalDeliveries: number;
        totalCodCollected: number;
        totalCodSettled: number;
        totalCodPending: number;
        partnersWithPending: number;
        activePartners: number;
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

export default function DeliveryPayoutsPage() {
    const { data, loading, refetch } = useApi<DeliveryPayoutData>('/api/delivery/payouts');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [showPayoutModal, setShowPayoutModal] = useState<DeliveryPartnerPayout | null>(null);
    const [payoutAmount, setPayoutAmount] = useState<number>(0);
    const [payoutMethod, setPayoutMethod] = useState('Cash');
    const [transactionId, setTransactionId] = useState('');
    const [notes, setNotes] = useState('');
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'history'>('all');

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    };

    const handlePayout = async () => {
        if (!showPayoutModal || payoutAmount <= 0) { alert('Please enter a valid payout amount'); return; }
        if (payoutAmount > showPayoutModal.pendingAmount) { alert('Payout amount cannot exceed pending amount'); return; }

        setProcessing(true);
        try {
            const response = await fetch('/api/payouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipientType: 'delivery',
                    recipientId: showPayoutModal.deliveryPersonId,
                    recipientName: showPayoutModal.fullName,
                    amount: payoutAmount,
                    method: payoutMethod === 'UPI' ? 'upi' : (payoutMethod === 'Cash' ? 'cash' : 'bank_transfer'),
                    accountNumber: showPayoutModal.bankDetails?.accountNumber || null,
                    ifscCode: showPayoutModal.bankDetails?.ifsc || null,
                    upiId: showPayoutModal.upiId || null,
                    notes: notes || `Payout to ${showPayoutModal.fullName}`,
                }),
            });
            const result = await response.json();
            if (result.success) {
                await refetch();
                setShowPayoutModal(null);
                setPayoutAmount(0);
                setTransactionId('');
                setNotes('');
                alert(result.message || 'Payout recorded successfully!');
            } else {
                alert(result.error || 'Failed to process payout');
            }
        } catch {
            alert('Failed to process payout');
        }
        setProcessing(false);
    };

    const openPayoutModal = (partner: DeliveryPartnerPayout) => {
        setShowPayoutModal(partner);
        setPayoutAmount(partner.pendingAmount);
        setPayoutMethod('Cash');
        setTransactionId('');
        setNotes('');
    };

    const allPartners = data?.deliveryPartners
        ?.filter(d =>
            d.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            d.phoneNumber.includes(searchTerm)
        ) || [];

    const [syncing, setSyncing] = useState(false);

    const partnersWithPending = allPartners.filter(p => p.pendingAmount > 0);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const res = await fetch('/api/delivery/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const result = await res.json();
            if (result.success) {
                await refetch();
                alert(result.message || 'Earnings synced successfully!');
            } else {
                alert(result.error || 'Sync failed');
            }
        } catch {
            alert('Failed to sync earnings');
        }
        setSyncing(false);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Payouts</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading payout data...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    const displayPartners = activeTab === 'pending' ? partnersWithPending : allPartners;

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
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Payouts</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Process and track payments to delivery partners</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 10,
                            background: 'var(--surface)', color: 'var(--foreground)',
                            border: '1px solid var(--border)', cursor: syncing ? 'not-allowed' : 'pointer',
                            opacity: syncing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                        {syncing ? 'Syncing...' : 'Sync Earnings'}
                    </button>
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
            </div>

            {/* Stats */}
            <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TrendingUp size={18} /> Overview
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                    <StatCard title="Total Earnings" value={formatCurrency(data?.summary.totalEarnings || 0)} icon={IndianRupee} color="primary" />
                    <StatCard title="Total Paid" value={formatCurrency(data?.summary.totalPaidAmount || 0)} icon={CheckCircle2} color="success" />
                    <StatCard title="Pending Payouts" value={formatCurrency(data?.summary.totalPendingPayouts || 0)} icon={Clock} color="warning" />
                    <StatCard title="Active Partners" value={data?.summary.activePartners || 0} icon={Bike} color="primary" />
                    <StatCard title="Total Deliveries" value={data?.summary.totalDeliveries || 0} icon={Package} color="primary" />
                    <StatCard title="Total Tips" value={formatCurrency(data?.summary.totalTips || 0)} icon={Gift} color="success" />
                </div>
            </div>

            {/* Tabs */}
            <div className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {[
                        { id: 'all' as const, label: `All Partners (${allPartners.length})` },
                        { id: 'pending' as const, label: `Pending (${partnersWithPending.length})` },
                        { id: 'history' as const, label: 'Payment History' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                flex: 1, padding: '14px 16px', fontSize: '0.85rem', fontWeight: 500,
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                borderBottom: `2px solid ${activeTab === tab.id ? 'var(--primary)' : 'transparent'}`,
                                color: activeTab === tab.id ? 'var(--primary)' : 'var(--foreground-secondary)',
                                transition: 'all 0.2s',
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {(activeTab === 'all' || activeTab === 'pending') && (
                    <>
                        {/* Search */}
                        <div style={{ padding: '16px 16px 0' }}>
                            <div style={{ position: 'relative', maxWidth: 360 }}>
                                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                                <input
                                    type="text"
                                    placeholder="Search by name or phone..."
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

                        {/* Table */}
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Delivery Partner</th>
                                        <th style={{ textAlign: 'right' }}>Deliveries</th>
                                        <th style={{ textAlign: 'right' }}>Fees</th>
                                        <th style={{ textAlign: 'right' }}>Tips</th>
                                        <th style={{ textAlign: 'right' }}>Total Earnings</th>
                                        <th style={{ textAlign: 'right' }}>Paid</th>
                                        <th style={{ textAlign: 'right' }}>Pending</th>
                                        <th style={{ textAlign: 'center' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayPartners.map((partner) => (
                                        <tr key={partner.deliveryPersonId}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <div style={{
                                                        width: 36, height: 36, borderRadius: 10,
                                                        background: 'rgba(40,137,144,0.1)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        overflow: 'hidden', flexShrink: 0
                                                    }}>
                                                        {partner.profilePhotoUrl ? (
                                                            <img src={partner.profilePhotoUrl} alt={partner.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        ) : (
                                                            <Bike size={16} color="#288990" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{partner.fullName}</p>
                                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{partner.phoneNumber}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 500 }}>{partner.deliveryCount || partner.totalDeliveries || 0}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(partner.deliveryFees || 0)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#10B981' }}>
                                                    <Gift size={13} /> {formatCurrency(partner.tips || 0)}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#288990' }}>{formatCurrency(partner.totalEarnings || 0)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981' }}>{formatCurrency(partner.paidAmount || 0)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ fontWeight: 600, color: partner.pendingAmount > 0 ? '#F59E0B' : 'var(--foreground-secondary)' }}>
                                                    {formatCurrency(partner.pendingAmount || 0)}
                                                </span>
                                            </td>

                                            <td style={{ textAlign: 'right', color: '#10B981', fontWeight: 500 }}>{formatCurrency(partner.paidAmount || 0)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ fontWeight: 600, color: partner.pendingAmount > 0 ? '#F59E0B' : 'var(--foreground-secondary)' }}>
                                                    {formatCurrency(partner.pendingAmount || 0)}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {partner.pendingAmount > 0 ? (
                                                    <button
                                                        onClick={() => openPayoutModal(partner)}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                                            padding: '5px 12px', borderRadius: 8,
                                                            background: 'var(--primary)', color: 'white',
                                                            border: 'none', cursor: 'pointer',
                                                            fontSize: '0.75rem', fontWeight: 600,
                                                            transition: 'all 0.2s',
                                                        }}
                                                    >
                                                        <Wallet size={13} /> Pay
                                                    </button>
                                                ) : (
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {displayPartners.length === 0 && (
                                        <tr>
                                            <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                                <Package size={36} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                                <p>{activeTab === 'pending' ? 'No pending payouts' : 'No delivery partners found'}</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {activeTab === 'history' && (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium">
                            <thead>
                                <tr>
                                    <th>Delivery Partner</th>
                                    <th style={{ textAlign: 'right' }}>Amount</th>
                                    <th style={{ textAlign: 'center' }}>Method</th>
                                    <th>Transaction ID</th>
                                    <th style={{ textAlign: 'center' }}>Status</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data?.recentPayouts.map((payout) => (
                                    <tr key={payout.payoutId}>
                                        <td style={{ fontWeight: 500 }}>{payout.deliveryPersonName}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{formatCurrency(payout.amount)}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                padding: '3px 8px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 500,
                                                background: 'rgba(99,102,241,0.1)', color: '#6366F1'
                                            }}>
                                                <CreditCard size={11} /> {payout.method}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--foreground-secondary)' }}>
                                            {payout.transactionId || '-'}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span className={`badge ${payout.status === 'completed' ? 'badge-approved' : 'badge-pending'}`} style={{ fontSize: '0.7rem' }}>
                                                {payout.status}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                            {payout.createdAt ? new Date(payout.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                        </td>
                                    </tr>
                                ))}
                                {(!data?.recentPayouts || data.recentPayouts.length === 0) && (
                                    <tr>
                                        <td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                            No payout history
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Payout Modal */}
            <AnimatePresence>
                {showPayoutModal && (
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
                        onClick={() => setShowPayoutModal(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            className="glass-card"
                            style={{ padding: 24, maxWidth: 420, width: '100%' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Process Payout</h3>
                                <button onClick={() => setShowPayoutModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}>
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Partner info */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12,
                                background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 20,
                            }}>
                                <div style={{
                                    width: 40, height: 40, borderRadius: 10,
                                    background: 'rgba(40,137,144,0.1)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    overflow: 'hidden', flexShrink: 0,
                                }}>
                                    {showPayoutModal.profilePhotoUrl ? (
                                        <img src={showPayoutModal.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <Bike size={18} color="#288990" />
                                    )}
                                </div>
                                <div>
                                    <p style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)' }}>{showPayoutModal.fullName}</p>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                        Pending: <span style={{ fontWeight: 600, color: '#F59E0B' }}>{formatCurrency(showPayoutModal.pendingAmount)}</span>
                                    </p>
                                </div>
                            </div>

                            {/* Breakdown */}
                            <div style={{
                                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20,
                            }}>
                                {[
                                    { label: 'Delivery Fees', value: formatCurrency(showPayoutModal.deliveryFees || 0), color: 'var(--foreground)' },
                                    { label: 'Incentives', value: formatCurrency(showPayoutModal.incentives || 0), color: '#8B5CF6' },
                                    { label: 'Already Paid', value: formatCurrency(showPayoutModal.paidAmount || 0), color: '#10B981' },
                                ].map(item => (
                                    <div key={item.label} style={{
                                        padding: 12, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'center',
                                    }}>
                                        <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', marginBottom: 4 }}>{item.label}</p>
                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', color: item.color }}>{item.value}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Form */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Payout Amount</label>
                                    <div style={{ position: 'relative' }}>
                                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>₹</span>
                                        <input
                                            type="number" value={payoutAmount}
                                            onChange={(e) => setPayoutAmount(Number(e.target.value))}
                                            max={showPayoutModal.pendingAmount}
                                            style={{
                                                width: '100%', padding: '8px 12px 8px 28px',
                                                borderRadius: 10, border: '1px solid var(--border)',
                                                background: 'var(--surface)', color: 'var(--foreground)',
                                                fontSize: '0.85rem', outline: 'none',
                                            }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Payment Method</label>
                                    <select
                                        value={payoutMethod}
                                        onChange={(e) => setPayoutMethod(e.target.value)}
                                        style={{
                                            width: '100%', padding: '8px 12px',
                                            borderRadius: 10, border: '1px solid var(--border)',
                                            background: 'var(--surface)', color: 'var(--foreground)',
                                            fontSize: '0.85rem', outline: 'none',
                                        }}
                                    >
                                        <option>Bank Transfer</option>
                                        <option>UPI</option>
                                        <option>Cash</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Transaction ID</label>
                                    <input
                                        type="text" value={transactionId}
                                        onChange={(e) => setTransactionId(e.target.value)}
                                        placeholder="Enter transaction reference..."
                                        style={{
                                            width: '100%', padding: '8px 12px',
                                            borderRadius: 10, border: '1px solid var(--border)',
                                            background: 'var(--surface)', color: 'var(--foreground)',
                                            fontSize: '0.85rem', outline: 'none',
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Notes (Optional)</label>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Add any notes..."
                                        rows={2}
                                        style={{
                                            width: '100%', padding: '8px 12px',
                                            borderRadius: 10, border: '1px solid var(--border)',
                                            background: 'var(--surface)', color: 'var(--foreground)',
                                            fontSize: '0.85rem', outline: 'none', resize: 'vertical',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                                <button
                                    onClick={() => setShowPayoutModal(null)}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: 10,
                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                        color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
                                    }}
                                >Cancel</button>
                                <button
                                    onClick={handlePayout}
                                    disabled={processing || payoutAmount <= 0}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: 10,
                                        background: 'var(--primary)', border: 'none',
                                        color: 'white', cursor: processing ? 'not-allowed' : 'pointer',
                                        fontWeight: 600, fontSize: '0.85rem',
                                        opacity: processing || payoutAmount <= 0 ? 0.6 : 1,
                                    }}
                                >
                                    {processing ? 'Processing...' : `Pay ${formatCurrency(payoutAmount)}`}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
