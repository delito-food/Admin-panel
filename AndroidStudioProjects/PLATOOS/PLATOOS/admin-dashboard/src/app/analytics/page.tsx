'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    RefreshCw, IndianRupee, Package, Users, Store, Bike,
    TrendingUp, Clock, CheckCircle2, XCircle, Star,
    BarChart3, Loader2, ArrowUpRight, Percent
} from 'lucide-react';

interface AnalyticsData {
    platformEarnings: {
        total: number; today: number; thisWeek: number; thisMonth: number;
        fromCommissions: number; fromDeliveryFees: number;
    };
    orders: {
        total: number; today: number; thisWeek: number; thisMonth: number;
        pending: number; completed: number; cancelled: number; averageOrderValue: number;
    };
    vendors: {
        total: number; verified: number; suspended: number; online: number;
        topPerformers: Array<{ vendorId: string; shopName: string; totalOrders: number; totalRevenue: number; rating: number; }>;
    };
    deliveryPartners: {
        total: number; verified: number; suspended: number; online: number;
        topPerformers: Array<{ deliveryPersonId: string; fullName: string; totalDeliveries: number; rating: number; }>;
    };
    customers: { total: number; newThisMonth: number; activeThisMonth: number; };
    revenueByDay: Array<{ date: string; revenue: number; orders: number; platformEarnings: number; }>;
}

function StatCard({ title, value, icon: Icon, color = 'primary', subtitle }: {
    title: string; value: string | number; icon: React.ElementType; subtitle?: string;
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
                    {subtitle && <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{subtitle}</p>}
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: colorMap[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={colorMap[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

export default function AnalyticsPage() {
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => { fetchAnalytics(); }, []);

    const fetchAnalytics = async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/analytics');
            const result = await response.json();
            if (result.success) setAnalytics(result.data);
            else setError(result.error || 'Failed to fetch analytics');
        } catch (err) { setError('Failed to fetch analytics'); console.error('Analytics fetch error:', err); }
        finally { setIsLoading(false); }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        try { const response = await fetch('/api/analytics'); const result = await response.json(); if (result.success) setAnalytics(result.data); }
        catch (err) { console.error('Analytics refresh error:', err); }
        finally { setRefreshing(false); }
    };

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

    if (isLoading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Platform Analytics</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading analytics...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20, alignItems: 'center', paddingTop: 80 }}>
                <XCircle size={48} style={{ color: '#EF4444' }} />
                <p style={{ color: 'var(--foreground-secondary)' }}>{error}</p>
                <button onClick={fetchAnalytics} style={{ padding: '8px 20px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Retry</button>
            </div>
        );
    }

    if (!analytics) return null;

    const retentionRate = analytics.customers.total > 0
        ? Math.round((analytics.customers.activeThisMonth / analytics.customers.total) * 100) : 0;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Platform Analytics</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Comprehensive business insights</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem', transition: 'all 0.2s' }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* ─── Platform Earnings Hero ─── */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card"
                style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                    background: 'linear-gradient(135deg, #288990 0%, #1a6b70 100%)',
                    padding: 24, color: 'white',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <IndianRupee size={20} />
                        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, opacity: 0.9 }}>Platform Earnings</h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
                        <div>
                            <p style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>Total Earnings</p>
                            <p style={{ fontSize: '1.8rem', fontWeight: 700 }}>{formatCurrency(analytics.platformEarnings.total)}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>Today</p>
                            <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(analytics.platformEarnings.today)}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>This Week</p>
                            <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(analytics.platformEarnings.thisWeek)}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>This Month</p>
                            <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(analytics.platformEarnings.thisMonth)}</p>
                        </div>
                    </div>
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.2)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                            <p style={{ fontSize: '0.7rem', opacity: 0.7 }}>From Order Commissions (5%)</p>
                            <p style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 2 }}>{formatCurrency(analytics.platformEarnings.fromCommissions)}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: '0.7rem', opacity: 0.7 }}>From Delivery Fees (20%)</p>
                            <p style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: 2 }}>{formatCurrency(analytics.platformEarnings.fromDeliveryFees)}</p>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* ─── Orders & Customers ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Orders Overview */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <Package size={18} color="#288990" />
                        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Orders Overview</h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                        {[
                            { label: 'Total Orders', value: analytics.orders.total, bg: 'rgba(40,137,144,0.08)', color: '#288990' },
                            { label: 'Completed', value: analytics.orders.completed, bg: 'rgba(16,185,129,0.08)', color: '#10B981' },
                            { label: 'Pending', value: analytics.orders.pending, bg: 'rgba(245,158,11,0.08)', color: '#F59E0B' },
                            { label: 'Cancelled', value: analytics.orders.cancelled, bg: 'rgba(239,68,68,0.08)', color: '#EF4444' },
                        ].map(item => (
                            <div key={item.label} style={{ padding: 12, borderRadius: 10, background: item.bg }}>
                                <p style={{ fontSize: '0.7rem', color: item.color, marginBottom: 4 }}>{item.label}</p>
                                <p style={{ fontSize: '1.4rem', fontWeight: 700, color: item.color }}>{item.value}</p>
                            </div>
                        ))}
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[
                            { label: 'Average Order Value', value: formatCurrency(analytics.orders.averageOrderValue) },
                            { label: "Today's Orders", value: analytics.orders.today },
                            { label: 'This Week', value: analytics.orders.thisWeek },
                        ].map(item => (
                            <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                <span style={{ color: 'var(--foreground-secondary)' }}>{item.label}</span>
                                <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{item.value}</span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Customers */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="glass-card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <Users size={18} color="#A855F7" />
                        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Customers</h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                        {[
                            { label: 'Total Users', value: analytics.customers.total, color: '#A855F7', bg: 'rgba(168,85,247,0.08)' },
                            { label: 'New This Month', value: analytics.customers.newThisMonth, color: '#6366F1', bg: 'rgba(99,102,241,0.08)' },
                            { label: 'Active This Month', value: analytics.customers.activeThisMonth, color: '#EC4899', bg: 'rgba(236,72,153,0.08)' },
                        ].map(item => (
                            <div key={item.label} style={{ textAlign: 'center', padding: 14, borderRadius: 10, background: item.bg }}>
                                <p style={{ fontSize: '1.5rem', fontWeight: 700, color: item.color }}>{item.value}</p>
                                <p style={{ fontSize: '0.68rem', color: item.color, marginTop: 4 }}>{item.label}</p>
                            </div>
                        ))}
                    </div>
                    <div style={{ padding: 14, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginBottom: 8 }}>Customer Retention Rate</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ flex: 1, height: 8, borderRadius: 100, background: 'var(--border)', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(retentionRate, 100)}%`, height: '100%', borderRadius: 100, background: 'linear-gradient(90deg, #A855F7, #EC4899)', transition: 'width 0.6s ease' }} />
                            </div>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--foreground)' }}>{retentionRate}%</span>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* ─── Vendors & Delivery Partners ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Vendors */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Store size={18} color="#F97316" />
                            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Vendors</h2>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                        {[
                            { label: 'Total', value: analytics.vendors.total, color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
                            { label: 'Verified', value: analytics.vendors.verified, color: '#10B981', bg: 'rgba(16,185,129,0.08)' },
                            { label: 'Online', value: analytics.vendors.online, color: '#3B82F6', bg: 'rgba(59,130,246,0.08)' },
                            { label: 'Suspended', value: analytics.vendors.suspended, color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
                        ].map(item => (
                            <div key={item.label} style={{ textAlign: 'center', padding: 10, borderRadius: 10, background: item.bg }}>
                                <p style={{ fontSize: '1.3rem', fontWeight: 700, color: item.color }}>{item.value}</p>
                                <p style={{ fontSize: '0.6rem', color: item.color, marginTop: 2, textTransform: 'uppercase', fontWeight: 500 }}>{item.label}</p>
                            </div>
                        ))}
                    </div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top Performers</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {analytics.vendors.topPerformers.map((vendor, index) => (
                            <div key={vendor.vendorId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700 }}>{index + 1}</span>
                                    <span style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--foreground)' }}>{vendor.shopName}</span>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '0.7rem' }}>
                                    <p style={{ color: 'var(--foreground-secondary)' }}>{vendor.totalOrders} orders</p>
                                    <p style={{ color: '#10B981', fontWeight: 600 }}>{formatCurrency(vendor.totalRevenue)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Delivery Partners */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="glass-card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Bike size={18} color="#10B981" />
                            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Delivery Partners</h2>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                        {[
                            { label: 'Total', value: analytics.deliveryPartners.total, color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
                            { label: 'Verified', value: analytics.deliveryPartners.verified, color: '#10B981', bg: 'rgba(16,185,129,0.08)' },
                            { label: 'Online', value: analytics.deliveryPartners.online, color: '#3B82F6', bg: 'rgba(59,130,246,0.08)' },
                            { label: 'Suspended', value: analytics.deliveryPartners.suspended, color: '#EF4444', bg: 'rgba(239,68,68,0.08)' },
                        ].map(item => (
                            <div key={item.label} style={{ textAlign: 'center', padding: 10, borderRadius: 10, background: item.bg }}>
                                <p style={{ fontSize: '1.3rem', fontWeight: 700, color: item.color }}>{item.value}</p>
                                <p style={{ fontSize: '0.6rem', color: item.color, marginTop: 2, textTransform: 'uppercase', fontWeight: 500 }}>{item.label}</p>
                            </div>
                        ))}
                    </div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top Performers</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {analytics.deliveryPartners.topPerformers.map((dp, index) => (
                            <div key={dp.deliveryPersonId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ width: 22, height: 22, borderRadius: 6, background: '#10B981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700 }}>{index + 1}</span>
                                    <span style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--foreground)' }}>{dp.fullName}</span>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '0.7rem' }}>
                                    <p style={{ color: 'var(--foreground-secondary)' }}>{dp.totalDeliveries} deliveries</p>
                                    <p style={{ color: '#F59E0B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                                        <Star size={10} fill="#F59E0B" /> {dp.rating.toFixed(1)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>

            {/* ─── Revenue Trend ─── */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BarChart3 size={18} color="#288990" />
                    <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Revenue Trend (Last 14 Days)</h2>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th style={{ textAlign: 'right' }}>Orders</th>
                                <th style={{ textAlign: 'right' }}>Revenue</th>
                                <th style={{ textAlign: 'right' }}>Platform Earnings</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analytics.revenueByDay.slice(-14).reverse().map((day) => (
                                <tr key={day.date}>
                                    <td>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--foreground)' }}>
                                            {new Date(day.date).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{day.orders}</span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--foreground)' }}>{formatCurrency(day.revenue)}</span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#10B981' }}>{formatCurrency(day.platformEarnings)}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </motion.div>
        </motion.div>
    );
}
