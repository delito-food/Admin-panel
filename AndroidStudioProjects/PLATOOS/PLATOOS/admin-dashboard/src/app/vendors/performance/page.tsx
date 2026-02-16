'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, TrendingUp, Star, XCircle, ShoppingBag, DollarSign, Clock, RefreshCw, Search, ArrowUp, ArrowDown, X, CheckCircle2, Loader2, Package } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useApi } from '@/hooks/useApi';

interface VendorPerformance {
    vendorId: string; shopName: string; fullName: string; shopImageUrl: string; city: string; pincode: string;
    isOnline: boolean; isVerified: boolean; cuisineTypes: string[];
    totalOrders: number; completedOrders: number; cancelledOrders: number; pendingOrders: number; preparingOrders: number;
    totalRevenue: number; avgRating: number; totalRatings: number; cancellationRate: number; completionRate: number;
    avgPreparationTime: number; commissionRate: number; customCommission: boolean;
}
interface PerformanceData {
    vendors: VendorPerformance[];
    summary: { totalVendors: number; activeVendors: number; totalRevenue: number; totalOrders: number; avgCancellationRate: number; avgRating: number; };
}

const PIE_COLORS = ['#10B981', '#F59E0B', '#EF4444', '#6366F1'];
const tt: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 };
const fld: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' };

function StatCard({ title, value, icon: Icon, color, sub }: { title: string; value: string | number; icon: React.ElementType; color: string; sub?: string }) {
    const colors: Record<string, string> = { primary: '#288990', success: '#10B981', warning: '#F59E0B', danger: '#EF4444' };
    const c = colors[color] || colors.primary;
    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{title}</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)', marginTop: 2 }}>{value}</p>
                    {sub && <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{sub}</p>}
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color="white" />
                </div>
            </div>
        </motion.div>
    );
}

export default function VendorPerformancePage() {
    const { data, loading, refetch } = useApi<PerformanceData>('/api/vendors/performance');
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'revenue' | 'orders' | 'rating' | 'cancellation'>('revenue');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [refreshing, setRefreshing] = useState(false);
    const [selectedVendor, setSelectedVendor] = useState<VendorPerformance | null>(null);

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

    const filteredVendors = data?.vendors
        .filter(v => v.shopName.toLowerCase().includes(searchTerm.toLowerCase()) || v.city.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => {
            let c = 0;
            switch (sortBy) { case 'revenue': c = a.totalRevenue - b.totalRevenue; break; case 'orders': c = a.totalOrders - b.totalOrders; break; case 'rating': c = a.avgRating - b.avgRating; break; case 'cancellation': c = a.cancellationRate - b.cancellationRate; break; }
            return sortOrder === 'desc' ? -c : c;
        }) || [];

    const topVendorsChart = filteredVendors.slice(0, 10).map(v => ({ name: v.shopName.length > 15 ? v.shopName.slice(0, 15) + '...' : v.shopName, revenue: v.totalRevenue, orders: v.totalOrders }));

    const orderStatusData = data?.vendors.reduce((acc, v) => { acc.completed += v.completedOrders; acc.pending += v.pendingOrders; acc.cancelled += v.cancelledOrders; acc.preparing += v.preparingOrders; return acc; }, { completed: 0, pending: 0, cancelled: 0, preparing: 0 });

    const pieData = orderStatusData ? [
        { name: 'Completed', value: orderStatusData.completed },
        { name: 'Preparing', value: orderStatusData.preparing },
        { name: 'Cancelled', value: orderStatusData.cancelled },
        { name: 'Pending', value: orderStatusData.pending },
    ].filter(d => d.value > 0) : [];

    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendor Performance</h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}><Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} /></div>
        </div>
    );

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendor Performance</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Order volume, revenue, ratings &amp; cancellation analysis</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem' }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <StatCard title="Total Revenue" value={formatCurrency(data?.summary.totalRevenue || 0)} icon={DollarSign} color="primary" />
                <StatCard title="Total Orders" value={(data?.summary.totalOrders || 0).toLocaleString()} icon={ShoppingBag} color="success" />
                <StatCard title="Avg Rating" value={`⭐ ${data?.summary.avgRating || 0}`} icon={Star} color="warning" />
                <StatCard title="Avg Cancellation" value={`${data?.summary.avgCancellationRate || 0}%`} icon={XCircle} color="danger" />
            </div>

            {/* Charts Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
                {/* Top Vendors Chart */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TrendingUp size={18} color="#288990" /> Top 10 Vendors by Revenue
                    </h3>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topVendorsChart} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                                <Tooltip formatter={(value) => formatCurrency(value as number)} contentStyle={tt} />
                                <Bar dataKey="revenue" fill="#288990" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div>

                {/* Order Status Distribution */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Package size={18} color="#FF9904" /> Order Status Distribution
                    </h3>
                    <div style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={pieData} innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value">
                                    {pieData.map((_, index) => (<Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />))}
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
                    <input type="text" placeholder="Search vendors..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...fld, paddingLeft: 36, fontSize: '0.8rem' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Sort by:</span>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{ ...fld, width: 'auto', cursor: 'pointer' }}>
                        <option value="revenue">Revenue</option><option value="orders">Orders</option><option value="rating">Rating</option><option value="cancellation">Cancellation Rate</option>
                    </select>
                    <button onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {sortOrder === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
                    </button>
                </div>
            </div>

            {/* Vendors Table */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium"><thead><tr>
                        <th>Vendor</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Orders</th>
                        <th style={{ textAlign: 'center' }}>Rating</th><th style={{ textAlign: 'center' }}>Cancellation</th><th style={{ textAlign: 'center' }}>Status</th>
                    </tr></thead><tbody>
                            {filteredVendors.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>No vendors found</td></tr>
                                : filteredVendors.map(v => (
                                    <tr key={v.vendorId} onClick={() => setSelectedVendor(v)} style={{ cursor: 'pointer' }}>
                                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(40,137,144,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                                {v.shopImageUrl ? <img src={v.shopImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Store size={16} color="#288990" />}
                                            </div>
                                            <div><p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{v.shopName}</p><p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{v.city}</p></div>
                                        </div></td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{formatCurrency(v.totalRevenue)}</td>
                                        <td style={{ textAlign: 'right' }}>{v.totalOrders}</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
                                                <Star size={14} style={{ color: '#F59E0B', fill: '#F59E0B' }} /> {v.avgRating}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600, background: v.cancellationRate <= 5 ? 'rgba(16,185,129,0.1)' : v.cancellationRate <= 10 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: v.cancellationRate <= 5 ? '#10B981' : v.cancellationRate <= 10 ? '#F59E0B' : '#EF4444' }}>
                                                {v.cancellationRate}%
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {v.isOnline
                                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: '#10B981', fontWeight: 500 }}><CheckCircle2 size={14} /> Online</span>
                                                : <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>Offline</span>}
                                        </td>
                                    </tr>
                                ))}
                        </tbody></table>
                </div>
            </motion.div>

            {/* Detail Modal */}
            <AnimatePresence>{selectedVendor && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setSelectedVendor(null)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="glass-card" style={{ padding: 24, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(40,137,144,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                {selectedVendor.shopImageUrl ? <img src={selectedVendor.shopImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Store size={24} color="#288990" />}
                            </div>
                            <div style={{ flex: 1 }}>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{selectedVendor.shopName}</h2>
                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedVendor.city} • {selectedVendor.pincode}</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                    {selectedVendor.cuisineTypes.map(c => (
                                        <span key={c} style={{ padding: '2px 10px', borderRadius: 100, background: 'rgba(40,137,144,0.1)', color: '#288990', fontSize: '0.65rem', fontWeight: 600 }}>{c}</span>
                                    ))}
                                </div>
                            </div>
                            <button onClick={() => setSelectedVendor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={20} /></button>
                        </div>

                        {/* Key Metrics */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                            {[
                                { label: 'Total Revenue', val: formatCurrency(selectedVendor.totalRevenue), c: '#10B981' },
                                { label: 'Total Orders', val: selectedVendor.totalOrders, c: 'var(--foreground)' },
                                { label: 'Avg Rating', val: `⭐ ${selectedVendor.avgRating} (${selectedVendor.totalRatings})`, c: '#F59E0B' },
                                { label: 'Avg Prep Time', val: `${selectedVendor.avgPreparationTime} min`, c: 'var(--foreground)' },
                            ].map((m, i) => (
                                <div key={i} style={{ padding: 12, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'center' }}>
                                    <p style={{ fontSize: '1.15rem', fontWeight: 700, color: m.c }}>{m.val}</p>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{m.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Order Breakdown */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                            {[
                                { label: 'Completed', val: selectedVendor.completedOrders, bg: 'rgba(16,185,129,0.08)', bc: 'rgba(16,185,129,0.2)', c: '#10B981' },
                                { label: 'Preparing', val: selectedVendor.preparingOrders, bg: 'rgba(245,158,11,0.08)', bc: 'rgba(245,158,11,0.2)', c: '#F59E0B' },
                                { label: 'Pending', val: selectedVendor.pendingOrders, bg: 'rgba(59,130,246,0.08)', bc: 'rgba(59,130,246,0.2)', c: '#3B82F6' },
                                { label: 'Cancelled', val: selectedVendor.cancelledOrders, bg: 'rgba(239,68,68,0.08)', bc: 'rgba(239,68,68,0.2)', c: '#EF4444' },
                            ].map((s, i) => (
                                <div key={i} style={{ padding: 10, borderRadius: 10, background: s.bg, border: `1px solid ${s.bc}`, textAlign: 'center' }}>
                                    <p style={{ fontSize: '1rem', fontWeight: 700, color: s.c }}>{s.val}</p>
                                    <p style={{ fontSize: '0.65rem', color: s.c, opacity: 0.8 }}>{s.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Commission */}
                        <div style={{ padding: 12, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                Commission Rate: <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{selectedVendor.commissionRate}%</span>
                                {selectedVendor.customCommission && <span style={{ color: '#A855F7', fontWeight: 500 }}> (Custom)</span>}
                            </p>
                        </div>
                    </motion.div>
                </motion.div>
            )}</AnimatePresence>
        </motion.div>
    );
}
