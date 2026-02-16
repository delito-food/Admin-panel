'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Store, RefreshCw, Search, CreditCard, CheckCircle2,
    Clock, X, IndianRupee, Loader2, Wallet, TrendingUp,
    Package, Gift, Shield
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface VendorPayout {
    vendorId: string;
    shopName: string;
    fullName: string;
    shopImageUrl: string;
    email: string;
    phoneNumber: string;
    city: string;
    isVerified: boolean;
    commissionRate: number;
    bankDetails: { accountNumber?: string; ifsc?: string; bankName?: string } | null;
    upiId: string | null;
    totalRevenue: number;
    commissionAmount: number;
    gstOnCommission: number;
    smallOrderFees: number;
    deliveryFeeProfit: number;
    totalPlatformEarning: number;
    netPayable: number;
    paidAmount: number;
    pendingAmount: number;
    orderCount: number;
    lastOrderDate: string | null;
}

interface RecentPayout {
    payoutId: string;
    vendorId: string;
    vendorName: string;
    amount: number;
    method: string;
    status: string;
    createdAt: string;
    processedAt: string | null;
    transactionId: string | null;
    notes: string | null;
}

interface PayoutData {
    vendors: VendorPayout[];
    recentPayouts: RecentPayout[];
    summary: {
        totalPendingPayouts: number;
        totalPaidAmount: number;
        totalCommissionEarned: number;
        totalGstCollected: number;
        totalSmallOrderFees: number;
        totalDeliveryFeeProfit: number;
        totalPlatformEarning: number;
        vendorsWithPending: number;
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

export default function VendorPayoutsPage() {
    const { data, loading, refetch } = useApi<PayoutData>('/api/vendors/payouts');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [showPayoutModal, setShowPayoutModal] = useState<VendorPayout | null>(null);
    const [payoutAmount, setPayoutAmount] = useState<number>(0);
    const [payoutMethod, setPayoutMethod] = useState('Bank Transfer');
    const [transactionId, setTransactionId] = useState('');
    const [notes, setNotes] = useState('');
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    };

    const handlePayout = async () => {
        if (!showPayoutModal || payoutAmount <= 0) { alert('Please enter a valid amount'); return; }
        if (payoutAmount > showPayoutModal.pendingAmount) { alert('Payout amount cannot exceed pending amount'); return; }

        setProcessing(true);
        try {
            const response = await fetch('/api/payouts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipientType: 'vendor',
                    recipientId: showPayoutModal.vendorId,
                    recipientName: showPayoutModal.shopName,
                    amount: payoutAmount,
                    method: payoutMethod === 'UPI' ? 'upi' : (payoutMethod === 'Cash' ? 'cash' : 'bank_transfer'),
                    accountNumber: showPayoutModal.bankDetails?.accountNumber || null,
                    ifscCode: showPayoutModal.bankDetails?.ifsc || null,
                    upiId: showPayoutModal.upiId || null,
                    notes: notes || `Payout to ${showPayoutModal.shopName}`,
                }),
            });
            const result = await response.json();
            if (result.success) {
                await refetch();
                setShowPayoutModal(null);
                setPayoutAmount(0);
                setTransactionId('');
                setNotes('');
                alert(result.message || 'Payout processed successfully!');
            } else {
                alert(result.error || 'Failed to process payout');
            }
        } catch {
            alert('Failed to process payout');
        }
        setProcessing(false);
    };

    const openPayoutModal = (vendor: VendorPayout) => {
        setShowPayoutModal(vendor);
        setPayoutAmount(vendor.pendingAmount);
        setPayoutMethod('Cash');
        setTransactionId('');
        setNotes('');
    };

    const filteredVendors = data?.vendors
        .filter(v =>
            v.shopName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            v.city.toLowerCase().includes(searchTerm.toLowerCase())
        ) || [];

    const vendorsWithPending = filteredVendors.filter(v => v.pendingAmount > 0);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendor Payouts</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading payout data...</p>
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
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendor Payouts</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Process and track vendor payments</p>
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
            <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TrendingUp size={18} /> Overview
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                    <StatCard title="Platform Earnings" value={formatCurrency(data?.summary.totalPlatformEarning || 0)} icon={IndianRupee} color="primary" />
                    <StatCard title="Total Paid" value={formatCurrency(data?.summary.totalPaidAmount || 0)} icon={CheckCircle2} color="success" />
                    <StatCard title="Pending Payouts" value={formatCurrency(data?.summary.totalPendingPayouts || 0)} icon={Clock} color="warning" />
                    <StatCard title="Vendors Pending" value={data?.summary.vendorsWithPending || 0} icon={Store} color="error" />
                </div>

                {/* Revenue breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
                    {[
                        { label: 'Commission', value: formatCurrency(data?.summary.totalCommissionEarned || 0), icon: Gift, color: '#8B5CF6' },
                        { label: 'GST Collected', value: formatCurrency(data?.summary.totalGstCollected || 0), icon: Shield, color: '#EC4899' },
                        { label: 'Small Order Fees', value: formatCurrency(data?.summary.totalSmallOrderFees || 0), icon: Package, color: '#F97316' },
                        { label: 'Delivery Profit', value: formatCurrency(data?.summary.totalDeliveryFeeProfit || 0), icon: TrendingUp, color: '#06B6D4' },
                    ].map((item) => (
                        <div key={item.label} className="glass-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: 8,
                                background: `${item.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <item.icon size={15} color={item.color} />
                            </div>
                            <div>
                                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600, marginBottom: 2 }}>{item.label}</p>
                                <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--foreground)' }}>{item.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tabs */}
            <div className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {[
                        { id: 'pending' as const, label: `Pending (${vendorsWithPending.length})` },
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

                {activeTab === 'pending' && (
                    <>
                        {/* Search */}
                        <div style={{ padding: '16px 16px 0' }}>
                            <div style={{ position: 'relative', maxWidth: 360 }}>
                                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                                <input
                                    type="text"
                                    placeholder="Search by shop name or city..."
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
                                        <th>Vendor</th>
                                        <th style={{ textAlign: 'right' }}>Revenue</th>
                                        <th style={{ textAlign: 'right' }}>Commission</th>
                                        <th style={{ textAlign: 'right' }}>Net Payable</th>
                                        <th style={{ textAlign: 'right' }}>Paid</th>
                                        <th style={{ textAlign: 'right' }}>Pending</th>
                                        <th style={{ textAlign: 'center' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vendorsWithPending.map((vendor) => (
                                        <tr key={vendor.vendorId}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <div style={{
                                                        width: 36, height: 36, borderRadius: 10,
                                                        background: 'rgba(40,137,144,0.1)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        overflow: 'hidden', flexShrink: 0
                                                    }}>
                                                        {vendor.shopImageUrl ? (
                                                            <img src={vendor.shopImageUrl} alt={vendor.shopName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        ) : (
                                                            <Store size={16} color="#288990" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{vendor.shopName}</p>
                                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{vendor.city} · {vendor.orderCount} orders</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCurrency(vendor.totalRevenue)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ color: '#8B5CF6', fontWeight: 500 }}>{formatCurrency(vendor.commissionAmount)}</span>
                                                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>{vendor.commissionRate}%</p>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(vendor.netPayable)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981', fontWeight: 500 }}>{formatCurrency(vendor.paidAmount)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ fontWeight: 600, color: vendor.pendingAmount > 0 ? '#F59E0B' : 'var(--foreground-secondary)' }}>
                                                    {formatCurrency(vendor.pendingAmount)}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {vendor.pendingAmount > 0 && (
                                                    <button
                                                        onClick={() => openPayoutModal(vendor)}
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
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {vendorsWithPending.length === 0 && (
                                        <tr>
                                            <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                                <Package size={36} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                                <p>No pending payouts</p>
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
                                    <th>Vendor</th>
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
                                        <td style={{ fontWeight: 500 }}>{payout.vendorName}</td>
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

                            {/* Vendor info */}
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
                                    {showPayoutModal.shopImageUrl ? (
                                        <img src={showPayoutModal.shopImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <Store size={18} color="#288990" />
                                    )}
                                </div>
                                <div>
                                    <p style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)' }}>{showPayoutModal.shopName}</p>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                        Pending: <span style={{ fontWeight: 600, color: '#F59E0B' }}>{formatCurrency(showPayoutModal.pendingAmount)}</span>
                                    </p>
                                </div>
                            </div>

                            {/* Breakdown */}
                            <div style={{
                                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20,
                            }}>
                                {[
                                    { label: 'Revenue', value: formatCurrency(showPayoutModal.totalRevenue), color: 'var(--foreground)' },
                                    { label: 'Commission', value: formatCurrency(showPayoutModal.commissionAmount), color: '#8B5CF6' },
                                    { label: 'Net Payable', value: formatCurrency(showPayoutModal.netPayable), color: '#3B82F6' },
                                    { label: 'Already Paid', value: formatCurrency(showPayoutModal.paidAmount), color: '#10B981' },
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
