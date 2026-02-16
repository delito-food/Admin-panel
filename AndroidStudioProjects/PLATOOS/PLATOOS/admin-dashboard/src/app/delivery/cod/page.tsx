'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bike, IndianRupee, RefreshCw, Search, CheckCircle2, Clock, X, Banknote, AlertTriangle, Loader2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';

interface DeliveryCOD {
    deliveryPersonId: string; fullName: string; profilePhotoUrl: string;
    phoneNumber: string; city: string; isOnline: boolean; isVerified: boolean;
    codCollected: number; codSettled: number; codPending: number;
    pendingOrders: number; pendingOrderIds?: string[]; totalCodOrders: number;
}
interface RecentSettlement {
    settlementId: string; deliveryPersonId: string; deliveryPersonName: string;
    amount: number; ordersCount: number; method: string; status: string;
    createdAt: string; processedAt: string | null; notes: string | null; receiptId: string | null;
}
interface CODData {
    deliveryPartners: DeliveryCOD[];
    recentSettlements: RecentSettlement[];
    summary: { totalCodCollected: number; totalCodSettled: number; totalCodPending: number; partnersWithPending: number; };
}

function StatCard({ title, value, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; icon: React.ElementType;
    color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const cm = { primary: { bg: 'rgba(40,137,144,0.15)', text: '#288990' }, success: { bg: 'rgba(16,185,129,0.15)', text: '#10B981' }, warning: { bg: 'rgba(245,158,11,0.15)', text: '#F59E0B' }, error: { bg: 'rgba(239,68,68,0.15)', text: '#EF4444' } };
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{title}</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: cm[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={cm[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

const fld: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' };

export default function CODTrackingPage() {
    const { data, loading, refetch } = useApi<CODData>('/api/delivery/cod');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [showSettleModal, setShowSettleModal] = useState<DeliveryCOD | null>(null);
    const [settleAmount, setSettleAmount] = useState(0);
    const [settleMethod, setSettleMethod] = useState('Cash');
    const [notes, setNotes] = useState('');
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
    const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

    const handleSettle = async () => {
        if (!showSettleModal || settleAmount <= 0) { alert('Please enter a valid amount'); return; }
        if (settleAmount > showSettleModal.codPending) { alert('Settlement amount cannot exceed pending COD'); return; }
        setProcessing(true);
        try {
            const r = await fetch('/api/delivery/cod', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deliveryPersonId: showSettleModal.deliveryPersonId, deliveryPersonName: showSettleModal.fullName, amount: settleAmount, method: settleMethod, notes: notes || null, orderIds: showSettleModal.pendingOrderIds || [] })
            });
            const res = await r.json();
            if (res.success) { await refetch(); setShowSettleModal(null); setSettleAmount(0); setNotes(''); alert(res.message || `COD settlement of ₹${settleAmount} recorded!`); }
            else alert(res.error || 'Failed');
        } catch { alert('Failed to record settlement'); }
        setProcessing(false);
    };
    const openSettle = (p: DeliveryCOD) => { setShowSettleModal(p); setSettleAmount(p.codPending); setSettleMethod('Cash'); setNotes(''); };
    const fp = data?.deliveryPartners.filter(d => d.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || d.phoneNumber.includes(searchTerm)) || [];

    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>COD Collection Tracking</h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}><Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} /></div>
        </div>
    );

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>COD Collection Tracking</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Track pending COD amounts per delivery partner</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem' }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <StatCard title="Total COD Collected" value={fmt(data?.summary.totalCodCollected || 0)} icon={IndianRupee} color="primary" />
                <StatCard title="Total Settled" value={fmt(data?.summary.totalCodSettled || 0)} icon={CheckCircle2} color="success" />
                <StatCard title="Pending Collection" value={fmt(data?.summary.totalCodPending || 0)} icon={Clock} color="warning" />
                <StatCard title="Partners with Pending" value={data?.summary.partnersWithPending || 0} icon={Bike} color="primary" />
            </div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {(['pending', 'history'] as const).map(t => (
                        <button key={t} onClick={() => setActiveTab(t)} style={{ flex: 1, padding: '14px 16px', fontSize: '0.85rem', fontWeight: 500, background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: `2px solid ${activeTab === t ? 'var(--primary)' : 'transparent'}`, color: activeTab === t ? 'var(--primary)' : 'var(--foreground-secondary)', transition: 'all 0.2s' }}>
                            {t === 'pending' ? 'Pending COD' : 'Settlement History'}
                        </button>
                    ))}
                </div>

                {activeTab === 'pending' && (<>
                    <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ position: 'relative', maxWidth: 400 }}>
                            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input type="text" placeholder="Search by name or phone..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...fld, paddingLeft: 36, fontSize: '0.8rem' }} />
                        </div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium"><thead><tr>
                            <th>Delivery Partner</th><th style={{ textAlign: 'right' }}>COD Collected</th><th style={{ textAlign: 'right' }}>Settled</th><th style={{ textAlign: 'right' }}>Pending</th><th style={{ textAlign: 'center' }}>COD Orders</th><th style={{ textAlign: 'center' }}>Actions</th>
                        </tr></thead><tbody>
                                {fp.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>No partners found</td></tr>
                                    : fp.map(p => (
                                        <tr key={p.deliveryPersonId}>
                                            <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(40,137,144,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                                    {p.profilePhotoUrl ? <img src={p.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Bike size={16} color="#288990" />}
                                                </div>
                                                <div><p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.fullName}</p><p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{p.phoneNumber}</p></div>
                                            </div></td>
                                            <td style={{ textAlign: 'right', fontSize: '0.85rem' }}>{fmt(p.codCollected)}</td>
                                            <td style={{ textAlign: 'right', fontSize: '0.85rem', color: '#10B981', fontWeight: 500 }}>{fmt(p.codSettled)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: p.codPending > 0 ? '#F59E0B' : 'var(--foreground-secondary)' }}>{fmt(p.codPending)}</span>
                                                {p.codPending > 5000 && <AlertTriangle size={13} style={{ marginLeft: 6, color: '#EF4444', verticalAlign: 'middle' }} />}
                                            </td>
                                            <td style={{ textAlign: 'center', fontSize: '0.85rem' }}>{p.totalCodOrders}</td>
                                            <td style={{ textAlign: 'center' }}>{p.codPending > 0 && (
                                                <button onClick={() => openSettle(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 8, background: '#10B981', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
                                                    <Banknote size={13} /> Settle
                                                </button>
                                            )}</td>
                                        </tr>
                                    ))}
                            </tbody></table>
                    </div>
                </>)}

                {activeTab === 'history' && (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium"><thead><tr>
                            <th>Receipt ID</th><th>Partner</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'center' }}>Orders</th><th style={{ textAlign: 'center' }}>Method</th><th style={{ textAlign: 'center' }}>Status</th><th>Notes</th><th>Date</th>
                        </tr></thead><tbody>
                                {(!data?.recentSettlements?.length) ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>No settlement history yet</td></tr>
                                    : data.recentSettlements.map(s => (
                                        <tr key={s.settlementId}>
                                            <td><span style={{ fontFamily: 'monospace', fontSize: '0.78rem', padding: '2px 6px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)' }}>#{s.settlementId.slice(-8).toUpperCase()}</span></td>
                                            <td style={{ fontWeight: 500, fontSize: '0.85rem' }}>{s.deliveryPersonName}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{fmt(s.amount)}</td>
                                            <td style={{ textAlign: 'center' }}><span style={{ padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 500, background: 'rgba(59,130,246,0.1)', color: '#3B82F6' }}>{s.ordersCount || 0}</span></td>
                                            <td style={{ textAlign: 'center' }}><span style={{ padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 500, background: 'rgba(59,130,246,0.1)', color: '#3B82F6' }}>{s.method}</span></td>
                                            <td style={{ textAlign: 'center' }}><span style={{ padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 600, background: s.status === 'completed' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', color: s.status === 'completed' ? '#10B981' : '#F59E0B' }}>{s.status}</span></td>
                                            <td style={{ maxWidth: 150, fontSize: '0.8rem', color: 'var(--foreground-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.notes || '—'}</td>
                                            <td>{s.createdAt ? <div style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}><div>{new Date(s.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div><div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{new Date(s.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div></div> : '—'}</td>
                                        </tr>
                                    ))}
                            </tbody></table>
                    </div>
                )}
            </motion.div>

            {/* Settlement Modal */}
            <AnimatePresence>{showSettleModal && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowSettleModal(null)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="glass-card" style={{ padding: 24, maxWidth: 420, width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Record COD Settlement</h3>
                            <button onClick={() => setShowSettleModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={18} /></button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 20 }}>
                            <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(40,137,144,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                {showSettleModal.profilePhotoUrl ? <img src={showSettleModal.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Bike size={20} color="#288990" />}
                            </div>
                            <div>
                                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{showSettleModal.fullName}</p>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>Pending: <span style={{ fontWeight: 600, color: '#F59E0B' }}>{fmt(showSettleModal.codPending)}</span></p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div><label style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6, display: 'block' }}>Settlement Amount</label>
                                <div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }}>₹</span>
                                    <input type="number" value={settleAmount} onChange={e => setSettleAmount(Number(e.target.value))} max={showSettleModal.codPending} style={{ ...fld, paddingLeft: 28 }} /></div></div>
                            <div><label style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6, display: 'block' }}>Method</label>
                                <select value={settleMethod} onChange={e => setSettleMethod(e.target.value)} style={{ ...fld, cursor: 'pointer' }}><option>Cash</option><option>Bank Transfer</option><option>UPI</option></select></div>
                            <div><label style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 6, display: 'block' }}>Notes (Optional)</label>
                                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes..." rows={2} style={{ ...fld, resize: 'vertical' }} /></div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                            <button onClick={() => setShowSettleModal(null)} style={{ flex: 1, padding: 10, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground)', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem' }}>Cancel</button>
                            <button onClick={handleSettle} disabled={processing || settleAmount <= 0} style={{ flex: 1, padding: 10, borderRadius: 10, background: '#10B981', border: 'none', color: 'white', cursor: processing ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.85rem', opacity: processing || settleAmount <= 0 ? 0.6 : 1 }}>
                                {processing ? 'Processing...' : `Settle ${fmt(settleAmount)}`}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}</AnimatePresence>
        </motion.div>
    );
}
