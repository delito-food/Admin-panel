'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bike, TrendingUp, Star, XCircle, Clock, RefreshCw, Search, CheckCircle2, MapPin, Phone, DollarSign, ArrowUp, ArrowDown, X, Package, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useApi } from '@/hooks/useApi';

interface DeliveryPerformance {
    deliveryPersonId: string; fullName: string; profilePhotoUrl: string; phoneNumber: string; email: string; city: string;
    vehicleType: string; vehicleNumber: string; isOnline: boolean; isOnDelivery: boolean; isVerified: boolean;
    totalDeliveries: number; completedDeliveries: number; cancelledDeliveries: number; pendingDeliveries: number;
    successRate: number; avgDeliveryTime: number; avgRating: number; totalRatings: number;
    totalEarnings: number; codCollected: number; codSettled: number; codPending: number; lastDeliveryDate: string | null;
}
interface PerformanceData {
    deliveryPartners: DeliveryPerformance[];
    summary: { totalPartners: number; activePartners: number; onDelivery: number; totalDeliveries: number; avgSuccessRate: number; avgRating: number; totalCodPending: number; };
}

const PIE_COLORS = ['#10B981', '#3B82F6', '#6B7280'];
const tt: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 };
const fld: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' };

function StatCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: React.ElementType; color: string }) {
    const colors: Record<string, string> = { primary: '#288990', success: '#10B981', warning: '#F59E0B', danger: '#EF4444' };
    const c = colors[color] || colors.primary;
    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{title}</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)', marginTop: 2 }}>{value}</p>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color="white" />
                </div>
            </div>
        </motion.div>
    );
}

export default function DeliveryPerformancePage() {
    const { data, loading, refetch } = useApi<PerformanceData>('/api/delivery/performance');
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'deliveries' | 'success' | 'rating' | 'earnings'>('deliveries');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [refreshing, setRefreshing] = useState(false);
    const [selectedPartner, setSelectedPartner] = useState<DeliveryPerformance | null>(null);

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

    const filteredPartners = data?.deliveryPartners
        .filter(d => d.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || d.city.toLowerCase().includes(searchTerm.toLowerCase()) || d.phoneNumber.includes(searchTerm))
        .sort((a, b) => {
            let c = 0;
            switch (sortBy) { case 'deliveries': c = a.totalDeliveries - b.totalDeliveries; break; case 'success': c = a.successRate - b.successRate; break; case 'rating': c = a.avgRating - b.avgRating; break; case 'earnings': c = a.totalEarnings - b.totalEarnings; break; }
            return sortOrder === 'desc' ? -c : c;
        }) || [];

    const topPartnersChart = filteredPartners.slice(0, 10).map(d => ({ name: d.fullName.length > 12 ? d.fullName.slice(0, 12) + '...' : d.fullName, deliveries: d.totalDeliveries }));
    const statusData = [
        { name: 'Online', value: data?.summary.activePartners || 0 },
        { name: 'On Delivery', value: data?.summary.onDelivery || 0 },
        { name: 'Offline', value: (data?.summary.totalPartners || 0) - (data?.summary.activePartners || 0) },
    ].filter(d => d.value > 0);

    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Partner Performance</h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}><Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} /></div>
        </div>
    );

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Partner Performance</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Success rate, delivery time, ratings &amp; earnings</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem' }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <StatCard title="Total Deliveries" value={(data?.summary.totalDeliveries || 0).toLocaleString()} icon={Bike} color="primary" />
                <StatCard title="Avg Success Rate" value={`${data?.summary.avgSuccessRate || 0}%`} icon={CheckCircle2} color="success" />
                <StatCard title="Avg Rating" value={`⭐ ${data?.summary.avgRating || 0}`} icon={Star} color="warning" />
                <StatCard title="COD Pending" value={formatCurrency(data?.summary.totalCodPending || 0)} icon={DollarSign} color="danger" />
            </div>

            {/* Charts Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TrendingUp size={18} color="#288990" /> Top 10 Partners by Deliveries
                    </h3>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topPartnersChart} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis type="number" />
                                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                                <Tooltip contentStyle={tt} />
                                <Bar dataKey="deliveries" fill="#288990" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Bike size={18} color="#FF9904" /> Partner Status
                    </h3>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={statusData} innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value">
                                    {statusData.map((_, index) => (<Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />))}
                                </Pie>
                                <Tooltip contentStyle={tt} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 250 }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                    <input type="text" placeholder="Search by name, city, or phone..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...fld, paddingLeft: 36, fontSize: '0.8rem' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Sort by:</span>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{ ...fld, width: 'auto', cursor: 'pointer' }}>
                        <option value="deliveries">Deliveries</option><option value="success">Success Rate</option><option value="rating">Rating</option><option value="earnings">Earnings</option>
                    </select>
                    <button onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {sortOrder === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
                    </button>
                </div>
            </div>

            {/* Partners Table */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium"><thead><tr>
                        <th>Partner</th><th style={{ textAlign: 'right' }}>Deliveries</th><th style={{ textAlign: 'center' }}>Success Rate</th>
                        <th style={{ textAlign: 'center' }}>Avg Time</th><th style={{ textAlign: 'center' }}>Rating</th><th style={{ textAlign: 'right' }}>Earnings</th><th style={{ textAlign: 'center' }}>Status</th>
                    </tr></thead><tbody>
                            {filteredPartners.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>No partners found</td></tr>
                                : filteredPartners.map(p => (
                                    <tr key={p.deliveryPersonId} onClick={() => setSelectedPartner(p)} style={{ cursor: 'pointer' }}>
                                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(40,137,144,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                                {p.profilePhotoUrl ? <img src={p.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Bike size={16} color="#288990" />}
                                            </div>
                                            <div><p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.fullName}</p><p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{p.vehicleType}</p></div>
                                        </div></td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.totalDeliveries}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600, background: p.successRate >= 95 ? 'rgba(16,185,129,0.1)' : p.successRate >= 85 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: p.successRate >= 95 ? '#10B981' : p.successRate >= 85 ? '#F59E0B' : '#EF4444' }}>
                                                {p.successRate}%
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{p.avgDeliveryTime > 0 ? `${p.avgDeliveryTime} min` : '—'}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
                                                <Star size={14} style={{ color: '#F59E0B', fill: '#F59E0B' }} /> {p.avgRating}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{formatCurrency(p.totalEarnings)}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            {p.isOnDelivery
                                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#3B82F6', fontWeight: 500 }}><Bike size={13} /> On Delivery</span>
                                                : p.isOnline
                                                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#10B981', fontWeight: 500 }}><CheckCircle2 size={13} /> Online</span>
                                                    : <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>Offline</span>}
                                        </td>
                                    </tr>
                                ))}
                        </tbody></table>
                </div>
            </motion.div>

            {/* Detail Modal */}
            <AnimatePresence>{selectedPartner && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setSelectedPartner(null)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="glass-card" style={{ padding: 24, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
                            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(40,137,144,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                {selectedPartner.profilePhotoUrl ? <img src={selectedPartner.profilePhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Bike size={24} color="#288990" />}
                            </div>
                            <div style={{ flex: 1 }}>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{selectedPartner.fullName}</h2>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
                                    {[
                                        { icon: Phone, text: selectedPartner.phoneNumber },
                                        { icon: MapPin, text: selectedPartner.city },
                                        { icon: Bike, text: `${selectedPartner.vehicleType} — ${selectedPartner.vehicleNumber}` },
                                    ].map((item, i) => (
                                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                            <item.icon size={13} /> {item.text}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <button onClick={() => setSelectedPartner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={20} /></button>
                        </div>

                        {/* Key Metrics */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                            {[
                                { label: 'Total Deliveries', val: selectedPartner.totalDeliveries, c: 'var(--foreground)' },
                                { label: 'Success Rate', val: `${selectedPartner.successRate}%`, c: '#10B981' },
                                { label: 'Avg Rating', val: `⭐ ${selectedPartner.avgRating} (${selectedPartner.totalRatings})`, c: '#F59E0B' },
                                { label: 'Avg Time', val: `${selectedPartner.avgDeliveryTime || 0} min`, c: 'var(--foreground)' },
                            ].map((m, i) => (
                                <div key={i} style={{ padding: 12, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                    <p style={{ fontSize: '1.15rem', fontWeight: 700, color: m.c }}>{m.val}</p>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{m.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Delivery Breakdown */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                            {[
                                { label: 'Completed', val: selectedPartner.completedDeliveries, bg: 'rgba(16,185,129,0.08)', bc: 'rgba(16,185,129,0.2)', c: '#10B981' },
                                { label: 'Pending', val: selectedPartner.pendingDeliveries, bg: 'rgba(59,130,246,0.08)', bc: 'rgba(59,130,246,0.2)', c: '#3B82F6' },
                                { label: 'Cancelled', val: selectedPartner.cancelledDeliveries, bg: 'rgba(239,68,68,0.08)', bc: 'rgba(239,68,68,0.2)', c: '#EF4444' },
                                { label: 'Earnings', val: formatCurrency(selectedPartner.totalEarnings), bg: 'rgba(139,92,246,0.08)', bc: 'rgba(139,92,246,0.2)', c: '#8B5CF6' },
                            ].map((s, i) => (
                                <div key={i} style={{ padding: 10, borderRadius: 10, background: s.bg, border: `1px solid ${s.bc}`, textAlign: 'center' }}>
                                    <p style={{ fontSize: '0.95rem', fontWeight: 700, color: s.c }}>{s.val}</p>
                                    <p style={{ fontSize: '0.6rem', color: s.c, opacity: 0.8 }}>{s.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* COD */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                            {[
                                { label: 'COD Collected', val: formatCurrency(selectedPartner.codCollected), c: '#10B981' },
                                { label: 'COD Settled', val: formatCurrency(selectedPartner.codSettled), c: '#3B82F6' },
                                { label: 'COD Pending', val: formatCurrency(selectedPartner.codPending), c: '#F59E0B' },
                            ].map((m, i) => (
                                <div key={i} style={{ padding: 12, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                    <p style={{ fontSize: '1rem', fontWeight: 700, color: m.c }}>{m.val}</p>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{m.label}</p>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </motion.div>
            )}</AnimatePresence>
        </motion.div>
    );
}
