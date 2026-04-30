'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    Coins, Search, RefreshCw, Loader2, Users, TrendingUp, TrendingDown,
    Gift,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

function fmt(n: any): string { const v = Number(n); return isNaN(v) ? '0' : v.toLocaleString('en-IN'); }

export default function CoinsPage() {
    const { data, loading, refetch } = useApi<any>('/api/coins');
    const [search, setSearch] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<'all' | 'active' | 'zero'>('all');

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setTimeout(() => setRefreshing(false), 400); };

    const summary = data?.summary || {};
    const customers: any[] = data?.customers || [];

    const filtered = useMemo(() => {
        let list = customers;
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q));
        }
        if (filter === 'active') list = list.filter(c => c.coinBalance > 0);
        if (filter === 'zero') list = list.filter(c => c.coinBalance === 0 && c.totalEarned > 0);
        return list;
    }, [customers, search, filter]);

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1 className="page-title"><Coins size={28} style={{ color: '#F59E0B' }} /> Platform Coins</h1>
                    <p className="page-subtitle">Coin balances, earn/redeem tracking, and customer-wise details</p>
                </div>
                <button onClick={handleRefresh} className="btn btn-outline" disabled={refreshing}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
            ) : (<>
                {/* Summary Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                    <StatCard label="Total Coins on Platform" value={fmt(summary.totalCoinsOnPlatform)} icon={<Coins size={20} />} color="#F59E0B" subtitle={`≈ ₹${fmt(summary.totalCoinValueINR)}`} />
                    <StatCard label="Total Earned" value={fmt(summary.totalCoinsEarned)} icon={<TrendingUp size={20} />} color="#10B981" />
                    <StatCard label="Total Redeemed" value={fmt(summary.totalCoinsRedeemed)} icon={<TrendingDown size={20} />} color="#EF4444" subtitle={`≈ ₹${fmt(summary.totalRedeemedValueINR)}`} />
                    <StatCard label="Customers with Coins" value={`${fmt(summary.customersWithCoins)} / ${fmt(summary.totalCustomers)}`} icon={<Users size={20} />} color="#3B82F6" />
                    <StatCard label="Avg Coins/Customer" value={fmt(summary.avgCoinsPerCustomer)} icon={<Gift size={20} />} color="#8B5CF6" />
                </div>

                {/* Filters */}
                <div className="glass-card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 220px', position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                        <input type="text" placeholder="Search customer name, phone, email..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '8px 10px 8px 30px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none' }} />
                    </div>
                    {(['all', 'active', 'zero'] as const).map(f => (
                        <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 20, border: filter === f ? '2px solid #F59E0B' : '1px solid var(--glass-border)', background: filter === f ? 'rgba(245,158,11,0.1)' : 'var(--surface)', color: filter === f ? '#F59E0B' : 'var(--foreground-secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
                            {f === 'all' ? 'All' : f === 'active' ? '🪙 Has Coins' : '↻ Used All'}
                        </button>
                    ))}
                    <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>{filtered.length} customers</span>
                </div>

                {/* Customer Table */}
                <div className="glass-card" style={{ overflow: 'auto' }}>
                    <div style={{ minWidth: 900 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.8fr 0.8fr 0.7fr 0.6fr 0.6fr', padding: '10px 14px', background: 'var(--surface-hover)', borderBottom: '1px solid var(--glass-border)', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-secondary)' }}>
                            <span>Customer</span><span style={{ textAlign: 'right' }}>Balance</span><span style={{ textAlign: 'right' }}>Earned</span><span style={{ textAlign: 'right' }}>Redeemed</span><span style={{ textAlign: 'right' }}>Disc. (₹)</span><span style={{ textAlign: 'center' }}>Orders w/ Coins</span><span style={{ textAlign: 'center' }}>Total Orders</span>
                        </div>
                        {filtered.length === 0 ? (
                            <div style={{ padding: 30, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No customers found</div>
                        ) : filtered.slice(0, 200).map((c: any, i: number) => (
                            <motion.div key={c.customerId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.5) }} style={{ display: 'grid', gridTemplateColumns: '1.8fr 0.8fr 0.8fr 0.8fr 0.7fr 0.6fr 0.6fr', padding: '10px 14px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.82rem', background: i % 2 === 0 ? 'transparent' : 'var(--surface-hover)', alignItems: 'center' }}>
                                <div>
                                    <p style={{ fontWeight: 600, fontSize: '0.82rem' }}>{c.name || 'Customer'}</p>
                                    <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>{c.phone} {c.email ? `• ${c.email}` : ''}</p>
                                </div>
                                <span style={{ textAlign: 'right', fontWeight: 700, color: c.coinBalance > 0 ? '#F59E0B' : 'var(--foreground-secondary)', fontSize: '0.9rem' }}>
                                    🪙 {fmt(c.coinBalance)}
                                </span>
                                <span style={{ textAlign: 'right', color: '#10B981', fontWeight: 500 }}>+{fmt(c.totalEarned)}</span>
                                <span style={{ textAlign: 'right', color: '#EF4444', fontWeight: 500 }}>-{fmt(c.totalRedeemed)}</span>
                                <span style={{ textAlign: 'right' }}>₹{fmt(c.coinDiscount)}</span>
                                <span style={{ textAlign: 'center' }}>{c.ordersWithCoins}</span>
                                <span style={{ textAlign: 'center' }}>{c.totalOrders}</span>
                            </motion.div>
                        ))}
                        {filtered.length > 200 && <div style={{ padding: 12, textAlign: 'center', color: 'var(--foreground-secondary)', fontSize: '0.78rem' }}>Showing top 200 of {filtered.length} customers</div>}
                    </div>
                </div>

                {/* Info */}
                <div className="glass-card" style={{ padding: '14px 18px', marginTop: 16, background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.12)' }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#F59E0B', marginBottom: 6 }}>ℹ️ How Coins Work</p>
                    <div style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', lineHeight: 1.7 }}>
                        <p>• Customers earn coins via referrals (100 coins per successful referral)</p>
                        <p>• 1 coin = ₹1 discount value</p>
                        <p>• Coins are applied at checkout as a discount on orders</p>
                        <p>• Platform liability = Total coins on platform × ₹1</p>
                    </div>
                </div>
            </>)}
        </div>
    );
}

function StatCard({ label, value, icon, color, subtitle }: { label: string; value: string; icon: React.ReactNode; color: string; subtitle?: string }) {
    return (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</p>
                    <p style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                    {subtitle && <p style={{ fontSize: '0.72rem', color, fontWeight: 500, marginTop: 2 }}>{subtitle}</p>}
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</div>
            </div>
        </motion.div>
    );
}






