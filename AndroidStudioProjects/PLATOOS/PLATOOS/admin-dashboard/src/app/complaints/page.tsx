'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertTriangle, RefreshCw, Search, MessageSquare, Clock,
    CheckCircle2, XCircle, X, IndianRupee, Package, User,
    Phone, Mail, Store, Bike, Filter, ArrowUpRight, Loader2, Eye
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface Complaint {
    complaintId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    type: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    orderId: string;
    vendorId: string;
    vendorName: string;
    deliveryPersonId: string;
    deliveryPersonName: string;
    orderTotal: number;
    paymentMode: string;
    razorpayPaymentId: string;
    refundRequested: boolean;
    refundAmount: number;
    refundStatus: string;
    refundId: string;
    resolution: string;
    adminNotes: string;
    createdAt: string;
    updatedAt: string;
}

interface ComplaintData {
    complaints: Complaint[];
    summary: {
        total: number;
        open: number;
        inProgress: number;
        resolved: number;
        refundPending: number;
        highPriority: number;
    };
}

const complaintTypeLabels: Record<string, string> = {
    ORDER_NOT_DELIVERED: 'Order Not Delivered',
    WRONG_ORDER: 'Wrong Order',
    MISSING_ITEMS: 'Missing Items',
    FOOD_QUALITY: 'Food Quality',
    LATE_DELIVERY: 'Late Delivery',
    DELIVERY_PERSON_BEHAVIOR: 'Delivery Person Issue',
    PAYMENT_ISSUE: 'Payment Issue',
    REFUND_REQUEST: 'Refund Request',
    OTHER: 'Other',
};

const statusStyleMap: Record<string, { bg: string; color: string }> = {
    OPEN: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
    IN_PROGRESS: { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B' },
    AWAITING_CUSTOMER: { bg: 'rgba(59,130,246,0.1)', color: '#3B82F6' },
    RESOLVED: { bg: 'rgba(16,185,129,0.1)', color: '#10B981' },
    CLOSED: { bg: 'rgba(107,114,128,0.1)', color: '#6B7280' },
    REFUNDED: { bg: 'rgba(168,85,247,0.1)', color: '#A855F7' },
};

const priorityStyleMap: Record<string, { bg: string; color: string }> = {
    LOW: { bg: 'rgba(107,114,128,0.1)', color: '#6B7280' },
    MEDIUM: { bg: 'rgba(59,130,246,0.1)', color: '#3B82F6' },
    HIGH: { bg: 'rgba(249,115,22,0.1)', color: '#F97316' },
    URGENT: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
};

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

/* shared inline field style */
const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none',
};

export default function ComplaintsPage() {
    const { data, loading, refetch } = useApi<ComplaintData>('/api/complaints');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('');
    const [filterPriority, setFilterPriority] = useState<string>('');

    // Resolution form
    const [resolution, setResolution] = useState('');
    const [adminNotes, setAdminNotes] = useState('');
    const [newStatus, setNewStatus] = useState('');
    const [processing, setProcessing] = useState(false);

    // Refund modal
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [refundAmount, setRefundAmount] = useState(0);
    const [refundReason, setRefundReason] = useState('');
    const [processingRefund, setProcessingRefund] = useState(false);

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const openComplaintDetails = (complaint: Complaint) => {
        setSelectedComplaint(complaint);
        setResolution(complaint.resolution || '');
        setAdminNotes(complaint.adminNotes || '');
        setNewStatus(complaint.status);
    };

    const handleUpdateComplaint = async () => {
        if (!selectedComplaint) return;
        setProcessing(true);
        try {
            const response = await fetch('/api/complaints', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ complaintId: selectedComplaint.complaintId, status: newStatus, resolution, adminNotes }),
            });
            const result = await response.json();
            if (result.success) { await refetch(); setSelectedComplaint(null); }
            else alert(result.error || 'Failed to update complaint');
        } catch { alert('Failed to update complaint'); }
        setProcessing(false);
    };

    const openRefundModal = () => {
        if (!selectedComplaint) return;
        setRefundAmount(selectedComplaint.refundAmount || selectedComplaint.orderTotal);
        setRefundReason(selectedComplaint.type === 'ORDER_NOT_DELIVERED' ? 'Order not delivered' : 'Customer complaint resolution');
        setShowRefundModal(true);
    };

    const handleProcessRefund = async () => {
        if (!selectedComplaint || refundAmount <= 0) return;
        setProcessingRefund(true);
        try {
            const response = await fetch('/api/refunds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: selectedComplaint.orderId, complaintId: selectedComplaint.complaintId,
                    amount: refundAmount, reason: refundReason,
                    refundType: refundAmount >= selectedComplaint.orderTotal ? 'full' : 'partial',
                }),
            });
            const result = await response.json();
            if (result.success) { await refetch(); setShowRefundModal(false); setSelectedComplaint(null); alert(`Refund of ₹${refundAmount} processed successfully!`); }
            else alert(result.error || 'Failed to process refund');
        } catch { alert('Failed to process refund'); }
        setProcessingRefund(false);
    };

    const filteredComplaints = data?.complaints?.filter(c => {
        const matchesSearch =
            c.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.orderId.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch && (!filterStatus || c.status === filterStatus) && (!filterPriority || c.priority === filterPriority);
    }) || [];

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Customer Complaints</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading complaints...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Customer Complaints</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Manage and resolve customer issues</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem', transition: 'all 0.2s' }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                <StatCard title="Total" value={data?.summary.total || 0} icon={MessageSquare} color="primary" />
                <StatCard title="Open" value={data?.summary.open || 0} icon={AlertTriangle} color="error" />
                <StatCard title="In Progress" value={data?.summary.inProgress || 0} icon={Clock} color="warning" />
                <StatCard title="Resolved" value={data?.summary.resolved || 0} icon={CheckCircle2} color="success" />
                <StatCard title="Refund Pending" value={data?.summary.refundPending || 0} icon={IndianRupee} color="warning" />
                <StatCard title="High Priority" value={data?.summary.highPriority || 0} icon={ArrowUpRight} color="error" />
            </div>

            {/* Table */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                {/* Search & Filters */}
                <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 400 }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                        <input type="text" placeholder="Search by name, subject, or order ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ ...fieldStyle, padding: '8px 12px 8px 36px', fontSize: '0.8rem' }} />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <Filter size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)', pointerEvents: 'none' }} />
                        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                            style={{ ...fieldStyle, padding: '8px 12px 8px 30px', fontSize: '0.8rem', cursor: 'pointer', width: 'auto' }}>
                            <option value="">All Status</option>
                            <option value="OPEN">Open</option>
                            <option value="IN_PROGRESS">In Progress</option>
                            <option value="RESOLVED">Resolved</option>
                            <option value="CLOSED">Closed</option>
                            <option value="REFUNDED">Refunded</option>
                        </select>
                    </div>
                    <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
                        style={{ ...fieldStyle, padding: '8px 12px', fontSize: '0.8rem', cursor: 'pointer', width: 'auto' }}>
                        <option value="">All Priority</option>
                        <option value="URGENT">Urgent</option>
                        <option value="HIGH">High</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="LOW">Low</option>
                    </select>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium">
                        <thead>
                            <tr>
                                <th>Customer</th>
                                <th>Type</th>
                                <th>Subject</th>
                                <th style={{ textAlign: 'center' }}>Priority</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                                <th style={{ textAlign: 'center' }}>Refund</th>
                                <th>Date</th>
                                <th style={{ textAlign: 'center' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredComplaints.length === 0 ? (
                                <tr>
                                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <MessageSquare size={36} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                                        <p>No complaints found</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredComplaints.map((complaint) => {
                                    const pStyle = priorityStyleMap[complaint.priority] || priorityStyleMap.LOW;
                                    const sStyle = statusStyleMap[complaint.status] || statusStyleMap.CLOSED;
                                    return (
                                        <tr key={complaint.complaintId} style={{ cursor: 'pointer' }} onClick={() => openComplaintDetails(complaint)}>
                                            <td>
                                                <div>
                                                    <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{complaint.customerName}</p>
                                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{complaint.customerPhone}</p>
                                                </div>
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>{complaintTypeLabels[complaint.type] || complaint.type}</span>
                                            </td>
                                            <td style={{ maxWidth: 200 }}>
                                                <p style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground)' }}>{complaint.subject}</p>
                                                {complaint.orderId && (
                                                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                                        Order: #{complaint.orderId.slice(-8).toUpperCase()}
                                                    </p>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 600, background: pStyle.bg, color: pStyle.color }}>
                                                    {complaint.priority}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 600, background: sStyle.bg, color: sStyle.color }}>
                                                    {complaint.status.replace('_', ' ')}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                {complaint.refundRequested ? (
                                                    <span style={{
                                                        display: 'inline-block', padding: '3px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 500,
                                                        background: complaint.refundStatus === 'COMPLETED' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                                                        color: complaint.refundStatus === 'COMPLETED' ? '#10B981' : '#F59E0B',
                                                    }}>
                                                        {complaint.refundStatus || 'Requested'}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: 'var(--foreground-secondary)', fontSize: '0.8rem' }}>—</span>
                                                )}
                                            </td>
                                            <td>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>{formatDate(complaint.createdAt)}</span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <button style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    padding: '5px 12px', borderRadius: 8,
                                                    background: 'var(--surface)', color: 'var(--foreground)',
                                                    border: '1px solid var(--border)', cursor: 'pointer',
                                                    fontSize: '0.75rem', fontWeight: 500, transition: 'all 0.2s',
                                                }}>
                                                    <Eye size={13} /> View
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </motion.div>

            {/* ─── Complaint Details Modal ─── */}
            <AnimatePresence>
                {selectedComplaint && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                        onClick={() => setSelectedComplaint(null)}>
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()} className="glass-card"
                            style={{ padding: 24, maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>

                            {/* Modal header */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Complaint Details</h3>
                                <button onClick={() => setSelectedComplaint(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={18} /></button>
                            </div>

                            {/* Info cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
                                {/* Customer */}
                                <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        <User size={14} color="var(--foreground-secondary)" />
                                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Customer</span>
                                    </div>
                                    <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{selectedComplaint.customerName}</p>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}><Phone size={10} />{selectedComplaint.customerPhone}</p>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}><Mail size={10} />{selectedComplaint.customerEmail}</p>
                                </div>

                                {/* Order */}
                                {selectedComplaint.orderId && (
                                    <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                            <Package size={14} color="var(--foreground-secondary)" />
                                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Order</span>
                                        </div>
                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--foreground)' }}>#{selectedComplaint.orderId.slice(-8).toUpperCase()}</p>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{formatCurrency(selectedComplaint.orderTotal)} • {selectedComplaint.paymentMode}</p>
                                    </div>
                                )}

                                {/* Vendor */}
                                {selectedComplaint.vendorName && (
                                    <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                            <Store size={14} color="var(--foreground-secondary)" />
                                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Vendor</span>
                                        </div>
                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{selectedComplaint.vendorName}</p>
                                    </div>
                                )}

                                {/* Delivery person */}
                                {selectedComplaint.deliveryPersonName && (
                                    <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                            <Bike size={14} color="var(--foreground-secondary)" />
                                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Delivery Person</span>
                                        </div>
                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--foreground)' }}>{selectedComplaint.deliveryPersonName}</p>
                                    </div>
                                )}
                            </div>

                            {/* Complaint content */}
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                    {(() => { const ps = priorityStyleMap[selectedComplaint.priority] || priorityStyleMap.LOW; return <span style={{ padding: '3px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 600, background: ps.bg, color: ps.color }}>{selectedComplaint.priority}</span>; })()}
                                    {(() => { const ss = statusStyleMap[selectedComplaint.status] || statusStyleMap.CLOSED; return <span style={{ padding: '3px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 600, background: ss.bg, color: ss.color }}>{selectedComplaint.status.replace('_', ' ')}</span>; })()}
                                    <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>{complaintTypeLabels[selectedComplaint.type]}</span>
                                </div>
                                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}>{selectedComplaint.subject}</h4>
                                <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selectedComplaint.description}</p>
                            </div>

                            {/* Refund Request */}
                            {selectedComplaint.refundRequested && (
                                <div style={{ padding: 14, borderRadius: 12, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', color: '#A855F7' }}>Refund Requested</p>
                                        <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                            Amount: {formatCurrency(selectedComplaint.refundAmount || selectedComplaint.orderTotal)} • Status: {selectedComplaint.refundStatus || 'Pending'}
                                        </p>
                                    </div>
                                    {selectedComplaint.refundStatus !== 'COMPLETED' && selectedComplaint.orderId && (
                                        <button onClick={openRefundModal} style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            padding: '6px 14px', borderRadius: 8,
                                            background: '#A855F7', color: 'white', border: 'none', cursor: 'pointer',
                                            fontSize: '0.75rem', fontWeight: 600,
                                        }}>
                                            <IndianRupee size={13} /> Process Refund
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Resolution Form */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Update Status</label>
                                    <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                                        <option value="OPEN">Open</option>
                                        <option value="IN_PROGRESS">In Progress</option>
                                        <option value="AWAITING_CUSTOMER">Awaiting Customer</option>
                                        <option value="RESOLVED">Resolved</option>
                                        <option value="CLOSED">Closed</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Resolution</label>
                                    <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Describe how the issue was resolved..."
                                        rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Admin Notes (Internal)</label>
                                    <textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Internal notes..."
                                        rows={2} style={{ ...fieldStyle, resize: 'vertical' }} />
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
                                {selectedComplaint.orderId && !selectedComplaint.refundRequested && (
                                    <button onClick={openRefundModal} style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        padding: '10px 16px', borderRadius: 10,
                                        background: 'rgba(168,85,247,0.1)', color: '#A855F7',
                                        border: '1px solid rgba(168,85,247,0.3)', cursor: 'pointer',
                                        fontWeight: 500, fontSize: '0.85rem',
                                    }}>
                                        <IndianRupee size={15} /> Issue Refund
                                    </button>
                                )}
                                <div style={{ flex: 1 }} />
                                <button onClick={() => setSelectedComplaint(null)} style={{
                                    padding: '10px 20px', borderRadius: 10,
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
                                }}>Cancel</button>
                                <button onClick={handleUpdateComplaint} disabled={processing} style={{
                                    padding: '10px 20px', borderRadius: 10,
                                    background: 'var(--primary)', border: 'none',
                                    color: 'white', cursor: processing ? 'not-allowed' : 'pointer',
                                    fontWeight: 600, fontSize: '0.85rem',
                                    opacity: processing ? 0.6 : 1,
                                }}>
                                    {processing ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ─── Refund Modal ─── */}
            <AnimatePresence>
                {showRefundModal && selectedComplaint && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                        onClick={() => setShowRefundModal(false)}>
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()} className="glass-card"
                            style={{ padding: 24, maxWidth: 420, width: '100%' }}>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Process Refund</h3>
                                <button onClick={() => setShowRefundModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={18} /></button>
                            </div>

                            {/* Order info */}
                            <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 20 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8rem' }}>
                                    <div><span style={{ color: 'var(--foreground-secondary)' }}>Order ID</span><p style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--foreground)' }}>#{selectedComplaint.orderId.slice(-8).toUpperCase()}</p></div>
                                    <div><span style={{ color: 'var(--foreground-secondary)' }}>Original Amount</span><p style={{ fontWeight: 600, color: 'var(--foreground)' }}>{formatCurrency(selectedComplaint.orderTotal)}</p></div>
                                    <div><span style={{ color: 'var(--foreground-secondary)' }}>Payment Mode</span><p style={{ fontWeight: 500, color: 'var(--foreground)' }}>{selectedComplaint.paymentMode || 'N/A'}</p></div>
                                    {selectedComplaint.razorpayPaymentId && (
                                        <div><span style={{ color: 'var(--foreground-secondary)' }}>Razorpay ID</span><p style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--foreground)' }}>{selectedComplaint.razorpayPaymentId}</p></div>
                                    )}
                                </div>
                            </div>

                            {/* Refund form */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Refund Amount</label>
                                    <div style={{ position: 'relative' }}>
                                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>₹</span>
                                        <input type="number" value={refundAmount} onChange={(e) => setRefundAmount(Number(e.target.value))} max={selectedComplaint.orderTotal}
                                            style={{ ...fieldStyle, paddingLeft: 28 }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                        <button onClick={() => setRefundAmount(selectedComplaint.orderTotal)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 500, background: 'rgba(16,185,129,0.1)', color: '#10B981', border: 'none', cursor: 'pointer' }}>Full Refund</button>
                                        <button onClick={() => setRefundAmount(Math.round(selectedComplaint.orderTotal * 0.5))} style={{ padding: '4px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 500, background: 'rgba(245,158,11,0.1)', color: '#F59E0B', border: 'none', cursor: 'pointer' }}>50%</button>
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 6, display: 'block' }}>Reason</label>
                                    <input type="text" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason for refund" style={fieldStyle} />
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                                <button onClick={() => setShowRefundModal(false)} style={{
                                    flex: 1, padding: '10px', borderRadius: 10,
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
                                }}>Cancel</button>
                                <button onClick={handleProcessRefund} disabled={processingRefund || refundAmount <= 0} style={{
                                    flex: 1, padding: '10px', borderRadius: 10,
                                    background: '#A855F7', border: 'none',
                                    color: 'white', cursor: processingRefund ? 'not-allowed' : 'pointer',
                                    fontWeight: 600, fontSize: '0.85rem',
                                    opacity: processingRefund || refundAmount <= 0 ? 0.6 : 1,
                                }}>
                                    {processingRefund ? 'Processing...' : `Refund ${formatCurrency(refundAmount)}`}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
