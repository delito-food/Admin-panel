'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, CheckCircle2, Clock, Loader2, X, Store, Bike, IndianRupee } from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface Dispute {
    disputeId: string;
    payoutId: string;
    recipientType: 'vendor' | 'delivery';
    recipientId: string;
    recipientName: string;
    issue: string;
    amount: number;
    status: 'open' | 'resolved';
    adminNote: string | null;
    resolvedBy: string | null;
    createdAt: string;
    resolvedAt: string | null;
}

export default function PayoutDisputesPage() {
    const { data, loading, refetch } = useApi<Dispute[]>('/api/payout-disputes?status=all');
    const [refreshing, setRefreshing] = useState(false);
    const [selected, setSelected] = useState<Dispute | null>(null);
    const [adminNote, setAdminNote] = useState('');
    const [resolving, setResolving] = useState(false);
    const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open');

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

    const handleResolve = async () => {
        if (!selected) return;
        setResolving(true);
        try {
            const res = await fetch('/api/payout-disputes', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ disputeId: selected.disputeId, adminNote }),
            });
            const result = await res.json();
            if (result.success) {
                await refetch();
                setSelected(null);
                setAdminNote('');
                alert('✅ Dispute resolved! The vendor/delivery partner has been notified.');
            } else {
                alert(result.error || 'Failed to resolve');
            }
        } catch { alert('Failed to resolve dispute'); }
        setResolving(false);
    };

    const disputes = (data || []).filter(d => filter === 'all' || d.status === filter);
    const openCount = (data || []).filter(d => d.status === 'open').length;

    const formatCurrency = (n: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)' }}>Payout Disputes</h1>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="animate-spin" style={{ color: 'var(--primary)', width: 40, height: 40 }} />
                </div>
            </div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <AlertTriangle size={28} color="#EF4444" /> Payout Disputes
                    </h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Issues raised by vendors and delivery partners about payouts
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {openCount > 0 && (
                        <span style={{
                            padding: '5px 14px', borderRadius: 100, background: 'rgba(239,68,68,0.12)',
                            color: '#EF4444', fontWeight: 700, fontSize: '0.85rem'
                        }}>
                            {openCount} Open
                        </span>
                    )}
                    <button onClick={handleRefresh} disabled={refreshing} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                        borderRadius: 10, background: 'var(--primary)', color: 'white',
                        border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer',
                        opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem'
                    }}>
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            {/* Filter tabs */}
            <div className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {(['open', 'resolved', 'all'] as const).map(f => (
                        <button key={f} onClick={() => setFilter(f)} style={{
                            flex: 1, padding: '12px 16px', fontSize: '0.85rem', fontWeight: 500,
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            borderBottom: `2px solid ${filter === f ? 'var(--primary)' : 'transparent'}`,
                            color: filter === f ? 'var(--primary)' : 'var(--foreground-secondary)',
                            transition: 'all 0.2s', textTransform: 'capitalize'
                        }}>
                            {f === 'open' ? `⚠️ Open (${openCount})` : f === 'resolved' ? '✅ Resolved' : 'All'}
                        </button>
                    ))}
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium">
                        <thead>
                            <tr>
                                <th>Raised By</th>
                                <th>Type</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                                <th>Issue</th>
                                <th style={{ textAlign: 'center' }}>Status</th>
                                <th>Date</th>
                                <th style={{ textAlign: 'center' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {disputes.map(d => (
                                <tr key={d.disputeId}>
                                    <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {d.recipientType === 'vendor'
                                            ? <Store size={14} color="#F4511E" />
                                            : <Bike size={14} color="#8B5CF6" />}
                                        {d.recipientName || d.recipientId.slice(-8)}
                                    </td>
                                    <td>
                                        <span style={{
                                            padding: '2px 8px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                                            background: d.recipientType === 'vendor' ? 'rgba(244,81,30,0.1)' : 'rgba(139,92,246,0.1)',
                                            color: d.recipientType === 'vendor' ? '#F4511E' : '#8B5CF6'
                                        }}>
                                            {d.recipientType === 'vendor' ? 'Vendor' : 'Delivery'}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                        {d.amount > 0 ? formatCurrency(d.amount) : '—'}
                                    </td>
                                    <td style={{ maxWidth: 260, fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                        {d.issue.slice(0, 80)}{d.issue.length > 80 ? '…' : ''}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <span style={{
                                            padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                                            background: d.status === 'open' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
                                            color: d.status === 'open' ? '#EF4444' : '#10B981'
                                        }}>
                                            {d.status === 'open' ? '⚠️ Open' : '✅ Resolved'}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                        {d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <button onClick={() => { setSelected(d); setAdminNote(d.adminNote || ''); }}
                                            style={{
                                                padding: '4px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600,
                                                background: d.status === 'open' ? 'rgba(239,68,68,0.12)' : 'rgba(156,163,175,0.1)',
                                                color: d.status === 'open' ? '#EF4444' : '#9CA3AF',
                                                border: `1px solid ${d.status === 'open' ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                                                cursor: 'pointer'
                                            }}>
                                            {d.status === 'open' ? '⚡ Resolve' : 'View'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {disputes.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                        <CheckCircle2 size={36} style={{ margin: '0 auto 8px', opacity: 0.4, color: '#10B981' }} />
                                        <p>No {filter !== 'all' ? filter : ''} disputes</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Resolve Modal */}
            {selected && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={() => setSelected(null)}>
                    <div className="glass-card" style={{ padding: 24, maxWidth: 480, width: '100%' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--foreground)' }}>
                                {selected.status === 'open' ? '⚡ Resolve Dispute' : 'Dispute Details'}
                            </h3>
                            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}>
                                <X size={18} />
                            </button>
                        </div>

                        {/* Dispute info */}
                        <div style={{ padding: 14, borderRadius: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                {selected.recipientType === 'vendor' ? <Store size={16} color="#F4511E" /> : <Bike size={16} color="#8B5CF6" />}
                                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{selected.recipientName || selected.recipientId}</span>
                                {selected.amount > 0 && (
                                    <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--primary)' }}>
                                        <IndianRupee size={13} style={{ display: 'inline' }} />{formatCurrency(selected.amount).replace('₹', '')}
                                    </span>
                                )}
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--foreground)', lineHeight: 1.5, margin: 0 }}>{selected.issue}</p>
                            <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 8 }}>
                                Raised: {new Date(selected.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                        </div>

                        {selected.status === 'resolved' && selected.adminNote && (
                            <div style={{ padding: 12, borderRadius: 10, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', marginBottom: 16, fontSize: '0.83rem', color: 'var(--foreground)' }}>
                                <strong>Admin Note: </strong>{selected.adminNote}
                                <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                                    Resolved by {selected.resolvedBy} · {selected.resolvedAt ? new Date(selected.resolvedAt).toLocaleDateString('en-IN') : ''}
                                </p>
                            </div>
                        )}

                        {selected.status === 'open' && (
                            <>
                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', display: 'block', marginBottom: 6 }}>
                                        Resolution Note (shown to {selected.recipientType === 'vendor' ? 'vendor' : 'delivery partner'})
                                    </label>
                                    <textarea
                                        value={adminNote}
                                        onChange={e => setAdminNote(e.target.value)}
                                        placeholder="Explain the resolution, e.g. 'Amount corrected, payout adjusted in next cycle'..."
                                        rows={3}
                                        style={{
                                            width: '100%', padding: '8px 12px', borderRadius: 10,
                                            border: '1px solid var(--border)', background: 'var(--surface)',
                                            color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none', resize: 'vertical'
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <button onClick={() => setSelected(null)} style={{
                                        flex: 1, padding: 10, borderRadius: 10, border: '1px solid var(--border)',
                                        background: 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500
                                    }}>Cancel</button>
                                    <button onClick={handleResolve} disabled={resolving || !adminNote.trim()} style={{
                                        flex: 1, padding: 10, borderRadius: 10, border: 'none',
                                        background: '#10B981', color: 'white', cursor: resolving || !adminNote.trim() ? 'not-allowed' : 'pointer',
                                        fontWeight: 600, opacity: resolving || !adminNote.trim() ? 0.6 : 1
                                    }}>
                                        {resolving ? 'Resolving...' : '✅ Mark Resolved'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </motion.div>
    );
}

