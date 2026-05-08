'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bike, RefreshCw, Search, CheckCircle2, Clock,
    X, CreditCard, TrendingUp, Gift, IndianRupee,
    Loader2, Wallet, Package, Send, CheckCircle,
    Download, FileText
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { downloadPayoutSlip } from '@/lib/payout-slip';

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
    pendingAmount: number;       // gross: earnings - paid (matches delivery app)
    netPendingAmount?: number;   // informational: after COD deduction
    codCollected: number;
    codSettled: number;
    codPending: number;
    issuedPayout?: { payoutId: string; amount: number; method: string; issuedAt: string | null } | null;
    bankDetails?: { accountNumber?: string; ifsc?: string; bankName?: string; accountHolderName?: string } | null;
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
        primary: { bg: 'rgba(244, 81, 30, 0.15)', text: '#F4511E' },
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
    // Tracks payout that has been issued but not yet confirmed (within the same modal session)
    const [issuedPayoutId, setIssuedPayoutId] = useState<string | null>(null);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    };

    const handleExportCSV = () => {
        if (!data?.recentPayouts?.length) { alert('No payout data to export'); return; }
        const headers = ['Delivery Partner', 'Amount', 'Method', 'Transaction ID', 'Status', 'Date', 'Notes'];
        const rows = data.recentPayouts.map(p => [
            `"${p.deliveryPersonName}"`,
            p.amount.toFixed(2),
            p.method,
            p.transactionId || '',
            p.status,
            p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '',
            `"${(p.notes || '').replace(/"/g, '""')}"`,
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `delivery-payouts-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadSlip = (payout: PayoutRecord) => {
        const partner = data?.deliveryPartners.find(d => d.deliveryPersonId === payout.deliveryPersonId);
        downloadPayoutSlip({
            recipientType: 'delivery',
            recipientName: payout.deliveryPersonName,
            recipientPhone: partner?.phoneNumber,
            recipientCity: partner?.city,
            bankDetails: partner?.bankDetails,
            upiId: partner?.upiId,
            payoutId: payout.payoutId,
            amount: payout.amount,
            method: payout.method,
            transactionId: payout.transactionId,
            status: payout.status,
            notes: payout.notes,
            createdAt: payout.createdAt,
            totalEarnings: partner?.totalEarnings,
            totalPaid: partner?.paidAmount,
            pendingAfter: partner ? Math.max(0, partner.pendingAmount) : undefined,
        });
    };

    // Step 1: Issue payout — creates record with "issued" status
    const handlePayout = async () => {
        if (!showPayoutModal || payoutAmount <= 0) { alert('Please enter a valid payout amount'); return; }
        if (payoutAmount > showPayoutModal.pendingAmount + 1) { alert('Payout amount cannot exceed pending amount'); return; }

        const methodMap: Record<string, string> = { 'NEFT': 'NEFT', 'IMPS': 'IMPS', 'UPI': 'UPI', 'Cash': 'Cash' };
        const mappedMethod = methodMap[payoutMethod] || 'Cash';

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
                    method: mappedMethod,
                    notes: notes || `Payout to ${showPayoutModal.fullName}`,
                }),
            });
            const result = await response.json();
            if (result.success) {
                setIssuedPayoutId(result.payoutId);
                await refetch();
                // Stay in modal — now show Confirm button
            } else {
                alert(result.error || 'Failed to issue payout');
            }
        } catch {
            alert('Failed to issue payout');
        }
        setProcessing(false);
    };

    // Step 2: Confirm payout — marks as completed, deducts from pending, generates receipt
    const handleConfirmPayout = async (payoutId?: string, name?: string) => {
        const resolvedId = payoutId || issuedPayoutId;
        const resolvedName = name || showPayoutModal?.fullName || '';
        if (!resolvedId) { alert('No payout to confirm'); return; }

        setProcessing(true);
        try {
            const response = await fetch('/api/payouts', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payoutId: resolvedId,
                    recipientType: 'delivery',
                    actualTransactionId: transactionId || undefined,
                }),
            });
            const result = await response.json();
            if (result.success) {
                await refetch();
                setShowPayoutModal(null);
                setIssuedPayoutId(null);
                setPayoutAmount(0);
                setTransactionId('');
                setNotes('');
                alert(`✅ Payout confirmed!\nTXN: ${result.transactionId}\n${resolvedName} will now see their receipt.`);
            } else {
                alert(result.error || 'Failed to confirm payout');
            }
        } catch {
            alert('Failed to confirm payout');
        }
        setProcessing(false);
    };

    const openPayoutModal = (partner: DeliveryPartnerPayout) => {
        setShowPayoutModal(partner);
        setPayoutAmount(partner.pendingAmount);
        setPayoutMethod('Cash');
        setTransactionId('');
        setNotes('');
        setIssuedPayoutId(null);
    };

    const allPartners = data?.deliveryPartners
        ?.filter(d =>
            d.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            d.phoneNumber.includes(searchTerm)
        ) || [];

    const [syncing, setSyncing] = useState(false);
    const [reconciling, setReconciling] = useState(false);

    const partnersWithPending = allPartners.filter(p => p.pendingAmount > 0);

    const handleReconcile = async () => {
        setReconciling(true);
        try {
            const res = await fetch('/api/payouts/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const result = await res.json();
            if (result.success) {
                await refetch();
                alert(result.message || 'Reconciliation complete!');
            } else {
                alert(result.error || 'Reconciliation failed');
            }
        } catch {
            alert('Failed to reconcile payouts');
        }
        setReconciling(false);
    };

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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                        onClick={handleExportCSV}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 10,
                            background: 'rgba(16,185,129,0.1)', color: '#10B981',
                            border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer',
                            fontWeight: 500, fontSize: '0.875rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        <Download size={16} />
                        Export Report
                    </button>
                    <button
                        onClick={handleReconcile}
                        disabled={reconciling}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 10,
                            background: 'rgba(139,92,246,0.1)', color: '#8B5CF6',
                            border: '1px solid rgba(139,92,246,0.3)', cursor: reconciling ? 'not-allowed' : 'pointer',
                            opacity: reconciling ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        <CheckCircle2 size={16} className={reconciling ? 'animate-spin' : ''} />
                        {reconciling ? 'Reconciling...' : 'Reconcile Payouts'}
                    </button>
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
                                                        background: 'rgba(244,81,30,0.1)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        overflow: 'hidden', flexShrink: 0
                                                    }}>
                                                        {partner.profilePhotoUrl ? (
                                                            <img src={partner.profilePhotoUrl} alt={partner.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        ) : (
                                                            <Bike size={16} color="#F4511E" />
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
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#F4511E' }}>{formatCurrency(partner.totalEarnings || 0)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981' }}>{formatCurrency(partner.paidAmount || 0)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                {(() => {
                                                    const netPayable = (partner.pendingAmount || 0) - (partner.codPending || 0);
                                                    const isNegative = netPayable < 0;
                                                    return (
                                                        <div>
                                                            <span style={{ fontWeight: 600, color: isNegative ? '#EF4444' : partner.pendingAmount > 0 ? '#F59E0B' : 'var(--foreground-secondary)' }}>
                                                                {isNegative ? `-${formatCurrency(Math.abs(netPayable))}` : formatCurrency(netPayable)}
                                                            </span>
                                                            {partner.codPending > 0 && (
                                                                <p style={{ fontSize: '0.65rem', color: '#EF4444', marginTop: 2 }}>
                                                                    COD due: {formatCurrency(partner.codPending)}
                                                                </p>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {(() => {
                                                    const netPayable = (partner.pendingAmount || 0) - (partner.codPending || 0);
                                                    const hasPendingCod = (partner.codPending || 0) >= (partner.pendingAmount || 0);
                                                    if (hasPendingCod && partner.codPending > 0) {
                                                        return (
                                                            <span style={{ fontSize: '0.7rem', color: '#EF4444', fontWeight: 500 }}>
                                                                Clear COD first
                                                            </span>
                                                        );
                                                    } else if (partner.pendingAmount > 0) {
                                                        return (
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
                                                        );
                                                    } else {
                                                        return <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>—</span>;
                                                    }
                                                })()}
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
                                    <th style={{ textAlign: 'center' }}>Action</th>
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
                                            {payout.transactionId || <span style={{ opacity: 0.5 }}>pending...</span>}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                                padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                                                background: payout.status === 'completed' ? 'rgba(16,185,129,0.12)' : payout.status === 'issued' ? 'rgba(245,158,11,0.12)' : payout.status === 'cancelled' ? 'rgba(239,68,68,0.12)' : 'rgba(156,163,175,0.12)',
                                                color: payout.status === 'completed' ? '#10B981' : payout.status === 'issued' ? '#F59E0B' : payout.status === 'cancelled' ? '#EF4444' : '#9CA3AF',
                                            }}>
                                                {payout.status === 'completed' ? '✓ Completed' : payout.status === 'issued' ? '⏳ Issued' : payout.status === 'cancelled' ? '✗ Cancelled' : payout.status}
                                            </span>
                                        </td>
                                        <td style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                            {payout.createdAt ? new Date(payout.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                                                {payout.status === 'issued' && (
                                                    <button
                                                        onClick={() => handleConfirmPayout(payout.payoutId, payout.deliveryPersonName)}
                                                        disabled={processing}
                                                        style={{
                                                            padding: '4px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600,
                                                            background: 'rgba(16,185,129,0.15)', color: '#10B981',
                                                            border: '1px solid rgba(16,185,129,0.3)', cursor: 'pointer',
                                                        }}
                                                    >
                                                        ✓ Mark Completed
                                                    </button>
                                                )}
                                                {payout.status === 'completed' && (
                                                    <button
                                                        onClick={() => handleDownloadSlip(payout)}
                                                        style={{
                                                            padding: '4px 10px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600,
                                                            background: 'rgba(99,102,241,0.1)', color: '#6366F1',
                                                            border: '1px solid rgba(99,102,241,0.25)', cursor: 'pointer',
                                                            display: 'inline-flex', alignItems: 'center', gap: 3,
                                                        }}
                                                    >
                                                        <FileText size={11} /> Slip
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {(!data?.recentPayouts || data.recentPayouts.length === 0) && (
                                    <tr>
                                        <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
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
                                    background: 'rgba(244,81,30,0.1)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    overflow: 'hidden', flexShrink: 0,
                                }}>
                                    {showPayoutModal.profilePhotoUrl ? (
                                        <img src={showPayoutModal.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <Bike size={18} color="#F4511E" />
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

                            {/* COD Pending Notice */}
                            {showPayoutModal.codPending > 0 && (
                                <div style={{
                                    padding: 12, borderRadius: 12, marginBottom: 16,
                                    background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                }}>
                                    <span style={{ fontSize: '1.1rem' }}>💵</span>
                                    <div>
                                        <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#D97706' }}>COD Cash Held: {formatCurrency(showPayoutModal.codPending)}</p>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>This amount is deducted from pending payout</p>
                                    </div>
                                </div>
                            )}

                            {/* Bank Details / UPI */}
                            {(showPayoutModal.bankDetails?.accountNumber || showPayoutModal.upiId) ? (
                                <div style={{
                                    padding: 14, borderRadius: 12,
                                    background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
                                    marginBottom: 16,
                                }}>
                                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#10B981', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>💳 Payment Details</p>
                                    {showPayoutModal.bankDetails?.accountHolderName && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Holder</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)' }}>{showPayoutModal.bankDetails.accountHolderName}</span>
                                        </div>
                                    )}
                                    {showPayoutModal.bankDetails?.accountNumber && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Account</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', fontFamily: 'monospace' }}>
                                                ••••{showPayoutModal.bankDetails.accountNumber.slice(-4)}
                                            </span>
                                        </div>
                                    )}
                                    {showPayoutModal.bankDetails?.ifsc && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>IFSC</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', fontFamily: 'monospace' }}>{showPayoutModal.bankDetails.ifsc}</span>
                                        </div>
                                    )}
                                    {showPayoutModal.bankDetails?.bankName && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Bank</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>{showPayoutModal.bankDetails.bankName}</span>
                                        </div>
                                    )}
                                    {showPayoutModal.upiId && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>UPI</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', fontFamily: 'monospace' }}>{showPayoutModal.upiId}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div style={{
                                    padding: 12, borderRadius: 12, marginBottom: 16,
                                    background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                                    textAlign: 'center',
                                }}>
                                    <p style={{ fontSize: '0.8rem', color: '#EF4444', fontWeight: 500 }}>⚠️ No bank details or UPI ID on file</p>
                                </div>
                            )}

                            {/* Issued status banner */}
                            {issuedPayoutId && (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
                                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
                                    marginBottom: 16,
                                }}>
                                    <span style={{ fontSize: '1.2rem' }}>⏳</span>
                                    <div>
                                        <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#D97706' }}>Payment Issued — Awaiting Confirmation</p>
                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>Make the transfer now, then click Confirm to complete & send receipt to the delivery partner.</p>
                                    </div>
                                </div>
                            )}

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
                                            disabled={!!issuedPayoutId}
                                            style={{
                                                width: '100%', padding: '8px 12px 8px 28px',
                                                borderRadius: 10, border: '1px solid var(--border)',
                                                background: issuedPayoutId ? 'var(--surface-muted, #f5f5f5)' : 'var(--surface)',
                                                color: 'var(--foreground)',
                                                fontSize: '0.85rem', outline: 'none',
                                                opacity: issuedPayoutId ? 0.6 : 1,
                                            }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Payment Method</label>
                                    <select
                                        value={payoutMethod}
                                        onChange={(e) => setPayoutMethod(e.target.value)}
                                        disabled={!!issuedPayoutId}
                                        style={{
                                            width: '100%', padding: '8px 12px',
                                            borderRadius: 10, border: '1px solid var(--border)',
                                            background: issuedPayoutId ? 'var(--surface-muted, #f5f5f5)' : 'var(--surface)',
                                            color: 'var(--foreground)',
                                            fontSize: '0.85rem', outline: 'none',
                                            opacity: issuedPayoutId ? 0.6 : 1,
                                        }}
                                    >
                                        <option>NEFT</option>
                                        <option>IMPS</option>
                                        <option>UPI</option>
                                        <option>Cash</option>
                                    </select>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                                        {payoutMethod === 'NEFT' || payoutMethod === 'IMPS'
                                            ? '🏦 Bank transfer — manually via your bank app/netbanking'
                                            : payoutMethod === 'UPI'
                                            ? '📱 UPI transfer — manually send to their UPI ID'
                                            : '💵 Cash — hand over cash and confirm receipt'}
                                    </p>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>
                                        Transaction ID {issuedPayoutId && <span style={{ color: '#D97706' }}>(Enter after transfer)</span>}
                                    </label>
                                    <input
                                        type="text" value={transactionId}
                                        onChange={(e) => setTransactionId(e.target.value)}
                                        placeholder="Enter UTR / transaction reference..."
                                        style={{
                                            width: '100%', padding: '8px 12px',
                                            borderRadius: 10, border: `1px solid ${issuedPayoutId ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
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
                                    onClick={() => { setShowPayoutModal(null); setIssuedPayoutId(null); }}
                                    style={{
                                        padding: '10px 16px', borderRadius: 10,
                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                        color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
                                    }}
                                >Cancel</button>

                                {/* Issue Payment button — shown when no payout issued yet */}
                                {!issuedPayoutId && (
                                    <button
                                        onClick={handlePayout}
                                        disabled={processing || payoutAmount <= 0}
                                        style={{
                                            flex: 1, padding: '10px', borderRadius: 10,
                                            background: '#F59E0B', border: 'none',
                                            color: 'white', cursor: processing ? 'not-allowed' : 'pointer',
                                            fontWeight: 600, fontSize: '0.85rem',
                                            opacity: processing || payoutAmount <= 0 ? 0.6 : 1,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        }}
                                    >
                                        <Send size={15} />
                                        {processing ? 'Issuing...' : `Issue ₹${payoutAmount.toLocaleString('en-IN')}`}
                                    </button>
                                )}

                                {/* Confirm Payment button — shown after issue */}
                                {issuedPayoutId && (
                                    <button
                                        onClick={() => handleConfirmPayout()}
                                        disabled={processing}
                                        style={{
                                            flex: 1, padding: '10px', borderRadius: 10,
                                            background: '#10B981', border: 'none',
                                            color: 'white', cursor: processing ? 'not-allowed' : 'pointer',
                                            fontWeight: 600, fontSize: '0.85rem',
                                            opacity: processing ? 0.6 : 1,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        }}
                                    >
                                        <CheckCircle size={15} />
                                        {processing ? 'Confirming...' : 'Confirm Payment'}
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
