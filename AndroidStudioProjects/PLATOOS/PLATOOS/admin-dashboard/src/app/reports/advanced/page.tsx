'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, TrendingUp, Users, Clock, XCircle, Store, MapPin, RefreshCw, Calendar, DollarSign, Truck, AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, Legend } from 'recharts';
import Link from 'next/link';

interface VendorRevenue { vendorId: string; vendorName: string; totalRevenue: number; totalOrders: number; averageOrderValue: number; completedOrders: number; cancelledOrders: number; cancellationRate: number; }
interface AreaRevenue { area: string; pincode: string; totalRevenue: number; totalOrders: number; averageOrderValue: number; }
interface HourlyData { hour: number; hourLabel: string; orderCount: number; revenue: number; }
interface DayOfWeekData { day: string; dayIndex: number; orderCount: number; revenue: number; }
interface CustomerRetention { totalCustomers: number; newCustomers: number; returningCustomers: number; retentionRate: number; averageOrdersPerCustomer: number; customersByOrderCount: { oneOrder: number; twoToFive: number; sixToTen: number; moreThanTen: number; }; topCustomers: Array<{ customerId: string; customerName: string; totalOrders: number; totalSpent: number; lastOrderDate: string; }>; }
interface DeliveryTimeAnalysis { averageDeliveryTime: number; fastestDelivery: number; slowestDelivery: number; deliveryTimeByVendor: Array<{ vendorId: string; vendorName: string; averageTime: number; totalDeliveries: number; }>; deliveryTimeByArea: Array<{ area: string; pincode: string; averageTime: number; totalDeliveries: number; }>; deliveryTimeDistribution: Array<{ range: string; count: number; percentage: number; }>; }
interface CancellationAnalysis { totalCancellations: number; cancellationRate: number; cancellationsByReason: Array<{ reason: string; count: number; percentage: number; }>; cancellationsByVendor: Array<{ vendorId: string; vendorName: string; cancellations: number; totalOrders: number; cancellationRate: number; }>; cancellationsByHour: Array<{ hour: number; hourLabel: string; count: number; }>; cancellationTrend: Array<{ date: string; cancellations: number; totalOrders: number; rate: number; }>; }
interface ReportsData { revenueByVendor: VendorRevenue[]; revenueByArea: AreaRevenue[]; peakHours: HourlyData[]; ordersByDayOfWeek: DayOfWeekData[]; customerRetention: CustomerRetention; deliveryTimeAnalysis: DeliveryTimeAnalysis; cancellationAnalysis: CancellationAnalysis; dateRange: { start: string; end: string; }; }

const PIE_COLORS = ['#288990', '#FF9904', '#10B981', '#8B5CF6', '#EC4899'];
const tt: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8rem' };

type TabType = 'revenue' | 'peakHours' | 'retention' | 'delivery' | 'cancellations';

function StatCard({ title, value, icon: Icon, color, sub }: { title: string; value: string | number; icon: React.ElementType; color: string; sub?: string }) {
    const colors: Record<string, string> = { primary: '#288990', success: '#10B981', warning: '#F59E0B', danger: '#EF4444', accent: '#8B5CF6' };
    const c = colors[color] || colors.primary;
    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{title}</p>
                    <p style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--foreground)', marginTop: 2 }}>{value}</p>
                    {sub && <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{sub}</p>}
                </div>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: c, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color="white" />
                </div>
            </div>
        </motion.div>
    );
}

function ChartCard({ title, icon: Icon, iconColor, children }: { title: string; icon: React.ElementType; iconColor?: string; children: React.ReactNode }) {
    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--foreground)' }}>
                <Icon size={16} color={iconColor || '#288990'} /> {title}
            </h3>
            {children}
        </motion.div>
    );
}

export default function AdvancedReportsPage() {
    const [data, setData] = useState<ReportsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('revenue');

    useEffect(() => { fetchReports(); }, []);

    const fetchReports = async () => {
        try { setLoading(true); const r = await fetch('/api/reports/advanced'); const res = await r.json(); if (res.success) setData(res.data); else setError(res.error || 'Failed'); } catch { setError('Failed to fetch reports'); } finally { setLoading(false); }
    };

    const handleRefresh = async () => { setRefreshing(true); await fetchReports(); setRefreshing(false); };
    const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

    const tabs = [
        { id: 'revenue' as TabType, label: 'Revenue', icon: DollarSign },
        { id: 'peakHours' as TabType, label: 'Peak Hours', icon: Clock },
        { id: 'retention' as TabType, label: 'Retention', icon: Users },
        { id: 'delivery' as TabType, label: 'Delivery', icon: Truck },
        { id: 'cancellations' as TabType, label: 'Cancellations', icon: XCircle },
    ];

    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Advanced Analytics</h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}><Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} /></div>
        </div>
    );

    if (error) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Advanced Analytics</h1>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AlertTriangle size={28} color="#EF4444" /></div>
                <p style={{ color: '#EF4444', fontWeight: 500 }}>{error}</p>
                <button onClick={fetchReports} style={{ padding: '8px 20px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem' }}>Retry</button>
            </div>
        </div>
    );

    if (!data) return null;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Link href="/reports" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                        <ArrowLeft size={18} color="var(--foreground-secondary)" />
                    </Link>
                    <div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Advanced Analytics</h1>
                        <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{data.dateRange.start} — {data.dateRange.end}</p>
                    </div>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem' }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Tabs */}
            <div className="glass-card" style={{ padding: 6 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {tabs.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: activeTab === tab.id ? 'var(--primary)' : 'transparent', color: activeTab === tab.id ? 'white' : 'var(--foreground-secondary)' }}>
                            <tab.icon size={15} /> {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
                <motion.div key={activeTab} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.2 }}>
                    {activeTab === 'revenue' && <RevenueTab data={data} fmt={formatCurrency} />}
                    {activeTab === 'peakHours' && <PeakHoursTab data={data} fmt={formatCurrency} />}
                    {activeTab === 'retention' && <RetentionTab data={data} fmt={formatCurrency} />}
                    {activeTab === 'delivery' && <DeliveryTab data={data} />}
                    {activeTab === 'cancellations' && <CancellationsTab data={data} />}
                </motion.div>
            </AnimatePresence>
        </motion.div>
    );
}

/* ── Revenue Tab ─────────────────────────────────────────────── */
function RevenueTab({ data, fmt }: { data: ReportsData; fmt: (n: number) => string }) {
    const totalRevenue = data.revenueByVendor.reduce((s, v) => s + v.totalRevenue, 0);
    const totalOrders = data.revenueByVendor.reduce((s, v) => s + v.completedOrders, 0);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <StatCard title="Total Revenue" value={fmt(totalRevenue)} icon={DollarSign} color="primary" />
                <StatCard title="Total Orders" value={totalOrders.toLocaleString()} icon={BarChart3} color="success" />
                <StatCard title="Avg Order Value" value={fmt(totalOrders > 0 ? totalRevenue / totalOrders : 0)} icon={TrendingUp} color="warning" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
                <ChartCard title="Revenue by Vendor (Top 10)" icon={Store}>
                    <div style={{ height: 320 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.revenueByVendor.slice(0, 10)} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis type="number" tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                                <YAxis type="category" dataKey="vendorName" width={120} tick={{ fontSize: 11 }} />
                                <Tooltip formatter={v => fmt(v as number)} contentStyle={tt} />
                                <Bar dataKey="totalRevenue" fill="#288990" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>
                <ChartCard title="Revenue by Area (Top 10)" icon={MapPin} iconColor="#FF9904">
                    <div style={{ height: 320 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.revenueByArea.slice(0, 10)} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis type="number" tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                                <YAxis type="category" dataKey="area" width={100} tick={{ fontSize: 11 }} />
                                <Tooltip formatter={v => fmt(v as number)} contentStyle={tt} />
                                <Bar dataKey="totalRevenue" fill="#FF9904" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
                {/* Vendor Details */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><Store size={16} color="#288990" /> Vendor Performance</h3>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium"><thead><tr>
                            <th>Vendor</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>AOV</th>
                        </tr></thead><tbody>
                                {data.revenueByVendor.slice(0, 10).map((v, i) => (
                                    <tr key={v.vendorId}>
                                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(40,137,144,0.1)', color: '#288990', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                                            <span style={{ fontWeight: 500, fontSize: '0.82rem' }}>{v.vendorName}</span>
                                        </div></td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{fmt(v.totalRevenue)}</td>
                                        <td style={{ textAlign: 'right' }}>{v.completedOrders}</td>
                                        <td style={{ textAlign: 'right' }}>{fmt(v.averageOrderValue)}</td>
                                    </tr>
                                ))}
                            </tbody></table>
                    </div>
                </motion.div>

                {/* Area Details */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><MapPin size={16} color="#FF9904" /> Area Performance</h3>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium"><thead><tr>
                            <th>Area</th><th>Pincode</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Orders</th>
                        </tr></thead><tbody>
                                {data.revenueByArea.slice(0, 10).map((a, i) => (
                                    <tr key={`${a.area}-${a.pincode}`}>
                                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,153,4,0.1)', color: '#FF9904', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                                            <span style={{ fontWeight: 500, fontSize: '0.82rem' }}>{a.area}</span>
                                        </div></td>
                                        <td style={{ color: 'var(--foreground-secondary)', fontSize: '0.8rem' }}>{a.pincode}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{fmt(a.totalRevenue)}</td>
                                        <td style={{ textAlign: 'right' }}>{a.totalOrders}</td>
                                    </tr>
                                ))}
                            </tbody></table>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}

/* ── Peak Hours Tab ──────────────────────────────────────────── */
function PeakHoursTab({ data, fmt }: { data: ReportsData; fmt: (n: number) => string }) {
    const peakHour = data.peakHours.reduce((m, h) => h.orderCount > m.orderCount ? h : m, data.peakHours[0]);
    const peakDay = data.ordersByDayOfWeek.reduce((m, d) => d.orderCount > m.orderCount ? d : m, data.ordersByDayOfWeek[0]);
    const peakRevHour = data.peakHours.reduce((m, h) => h.revenue > m.revenue ? h : m, data.peakHours[0]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <StatCard title="Peak Hour" value={peakHour?.hourLabel || 'N/A'} icon={Clock} color="success" sub={`${peakHour?.orderCount || 0} orders`} />
                <StatCard title="Busiest Day" value={peakDay?.day || 'N/A'} icon={Calendar} color="warning" sub={`${peakDay?.orderCount || 0} orders`} />
                <StatCard title="Peak Revenue Hour" value={peakRevHour?.hourLabel || 'N/A'} icon={TrendingUp} color="primary" />
            </div>

            <ChartCard title="Orders by Hour of Day" icon={Clock}>
                <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.peakHours}>
                            <defs><linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#288990" stopOpacity={0.3} /><stop offset="100%" stopColor="#288990" stopOpacity={0} /></linearGradient></defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="hourLabel" tick={{ fontSize: 10 }} interval={1} />
                            <YAxis />
                            <Tooltip contentStyle={tt} />
                            <Area type="monotone" dataKey="orderCount" stroke="#288990" strokeWidth={2} fill="url(#hourGrad)" name="Orders" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>

            <ChartCard title="Orders by Day of Week" icon={Calendar} iconColor="#FF9904">
                <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.ordersByDayOfWeek}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="day" />
                            <YAxis yAxisId="left" orientation="left" />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                            <Tooltip contentStyle={tt} formatter={(v, name) => name === 'Revenue' ? fmt(v as number) : v} />
                            <Legend />
                            <Bar yAxisId="left" dataKey="orderCount" name="Orders" fill="#288990" radius={[4, 4, 0, 0]} />
                            <Bar yAxisId="right" dataKey="revenue" name="Revenue" fill="#FF9904" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>

            {/* Staffing Insights */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>📊 Key Insights for Staffing</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
                    <div style={{ padding: 14, borderRadius: 12, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                        <p style={{ fontWeight: 600, fontSize: '0.82rem', color: '#059669' }}>🕐 Rush Hours (High Demand)</p>
                        <p style={{ fontSize: '0.75rem', color: '#10B981', marginTop: 4 }}>
                            {data.peakHours.filter(h => h.orderCount > (peakHour?.orderCount || 0) * 0.6).map(h => h.hourLabel).join(', ') || 'No data'}
                        </p>
                    </div>
                    <div style={{ padding: 14, borderRadius: 12, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                        <p style={{ fontWeight: 600, fontSize: '0.82rem', color: '#2563EB' }}>📅 High Volume Days</p>
                        <p style={{ fontSize: '0.75rem', color: '#3B82F6', marginTop: 4 }}>
                            {data.ordersByDayOfWeek.filter(d => d.orderCount > (peakDay?.orderCount || 0) * 0.6).map(d => d.day).join(', ') || 'No data'}
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

/* ── Customer Retention Tab ──────────────────────────────────── */
function RetentionTab({ data, fmt }: { data: ReportsData; fmt: (n: number) => string }) {
    const r = data.customerRetention;
    const dist = [
        { name: '1 Order', value: r.customersByOrderCount.oneOrder, color: '#EF4444' },
        { name: '2-5 Orders', value: r.customersByOrderCount.twoToFive, color: '#F59E0B' },
        { name: '6-10 Orders', value: r.customersByOrderCount.sixToTen, color: '#10B981' },
        { name: '10+ Orders', value: r.customersByOrderCount.moreThanTen, color: '#288990' },
    ].filter(i => i.value > 0);

    const segments = [
        { label: 'One-time Buyers', count: r.customersByOrderCount.oneOrder, c: '#EF4444', bg: 'rgba(239,68,68,0.06)', bc: 'rgba(239,68,68,0.15)' },
        { label: 'Regular (2-5)', count: r.customersByOrderCount.twoToFive, c: '#F59E0B', bg: 'rgba(245,158,11,0.06)', bc: 'rgba(245,158,11,0.15)' },
        { label: 'Loyal (6-10)', count: r.customersByOrderCount.sixToTen, c: '#10B981', bg: 'rgba(16,185,129,0.06)', bc: 'rgba(16,185,129,0.15)' },
        { label: 'VIP (10+)', count: r.customersByOrderCount.moreThanTen, c: '#288990', bg: 'rgba(40,137,144,0.06)', bc: 'rgba(40,137,144,0.15)' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
                <StatCard title="Total Customers" value={r.totalCustomers.toLocaleString()} icon={Users} color="primary" />
                <StatCard title="Retention Rate" value={`${r.retentionRate}%`} icon={TrendingUp} color="success" />
                <StatCard title="Returning" value={r.returningCustomers.toLocaleString()} icon={Users} color="warning" />
                <StatCard title="Avg Orders/Customer" value={r.averageOrdersPerCustomer} icon={BarChart3} color="accent" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
                <ChartCard title="Customer Order Distribution" icon={Users} iconColor="#8B5CF6">
                    <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={dist} innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value">
                                    {dist.map((e, i) => (<Cell key={`cell-${i}`} fill={e.color} />))}
                                </Pie>
                                <Tooltip contentStyle={tt} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><BarChart3 size={16} color="#8B5CF6" /> Customer Segments</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {segments.map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 10, background: s.bg, border: `1px solid ${s.bc}` }}>
                                <div>
                                    <p style={{ fontWeight: 600, fontSize: '0.82rem', color: s.c }}>{s.label}</p>
                                    <p style={{ fontSize: '0.7rem', color: s.c, opacity: 0.8 }}>{s.count} customers</p>
                                </div>
                                <span style={{ fontSize: '1.3rem', fontWeight: 700, color: s.c }}>
                                    {r.totalCustomers > 0 ? Math.round((s.count / r.totalCustomers) * 100) : 0}%
                                </span>
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>

            {/* Top Customers */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><Users size={16} color="#288990" /> Top Customers</h3>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium"><thead><tr>
                        <th>#</th><th>Customer</th><th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>Spent</th><th style={{ textAlign: 'right' }}>Last Order</th>
                    </tr></thead><tbody>
                            {r.topCustomers.map((c, i) => (
                                <tr key={c.customerId}>
                                    <td><span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, background: i < 3 ? '#288990' : 'var(--foreground-secondary)', color: 'white' }}>{i + 1}</span></td>
                                    <td style={{ fontWeight: 500 }}>{c.customerName}</td>
                                    <td style={{ textAlign: 'right' }}>{c.totalOrders}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{fmt(c.totalSpent)}</td>
                                    <td style={{ textAlign: 'right', color: 'var(--foreground-secondary)', fontSize: '0.78rem' }}>{c.lastOrderDate}</td>
                                </tr>
                            ))}
                        </tbody></table>
                </div>
            </motion.div>
        </div>
    );
}

/* ── Delivery Tab ────────────────────────────────────────────── */
function DeliveryTab({ data }: { data: ReportsData }) {
    const d = data.deliveryTimeAnalysis;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <StatCard title="Avg Delivery Time" value={`${d.averageDeliveryTime} min`} icon={Clock} color="primary" />
                <StatCard title="Fastest Delivery" value={`${d.fastestDelivery} min`} icon={Truck} color="success" />
                <StatCard title="Slowest Delivery" value={`${d.slowestDelivery} min`} icon={AlertTriangle} color="warning" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
                <ChartCard title="Delivery Time Distribution" icon={Clock}>
                    <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={d.deliveryTimeDistribution}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis dataKey="range" />
                                <YAxis />
                                <Tooltip contentStyle={tt} formatter={(v, name) => name === 'percentage' ? `${v}%` : v} />
                                <Bar dataKey="count" name="Deliveries" fill="#288990" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>

                {/* Vendor Delivery Times */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Store size={16} color="#288990" /> Delivery Time by Vendor (Fastest)</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {d.deliveryTimeByVendor.slice(0, 8).map((v, i) => (
                            <div key={v.vendorId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, background: i < 3 ? '#10B981' : 'var(--foreground-secondary)', color: 'white', flexShrink: 0 }}>{i + 1}</span>
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontWeight: 500, fontSize: '0.8rem', marginBottom: 4 }}>{v.vendorName}</p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{ flex: 1, height: 6, borderRadius: 100, background: 'var(--border)' }}>
                                            <div style={{ width: `${Math.min((v.averageTime / 60) * 100, 100)}%`, height: '100%', borderRadius: 100, background: '#288990' }} />
                                        </div>
                                        <span style={{ fontSize: '0.78rem', fontWeight: 600, width: 50, textAlign: 'right' }}>{v.averageTime} min</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>

            {/* Delivery by Area */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><MapPin size={16} color="#FF9904" /> Delivery Time by Area</h3>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium"><thead><tr>
                        <th>Area</th><th>Pincode</th><th style={{ textAlign: 'right' }}>Avg Time</th><th style={{ textAlign: 'right' }}>Deliveries</th>
                    </tr></thead><tbody>
                            {d.deliveryTimeByArea.map(a => (
                                <tr key={`${a.area}-${a.pincode}`}>
                                    <td style={{ fontWeight: 500 }}>{a.area}</td>
                                    <td style={{ color: 'var(--foreground-secondary)', fontSize: '0.8rem' }}>{a.pincode}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600, background: a.averageTime <= 30 ? 'rgba(16,185,129,0.1)' : a.averageTime <= 45 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: a.averageTime <= 30 ? '#10B981' : a.averageTime <= 45 ? '#F59E0B' : '#EF4444' }}>
                                            {a.averageTime} min
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right' }}>{a.totalDeliveries}</td>
                                </tr>
                            ))}
                        </tbody></table>
                </div>
            </motion.div>
        </div>
    );
}

/* ── Cancellations Tab ───────────────────────────────────────── */
function CancellationsTab({ data }: { data: ReportsData }) {
    const c = data.cancellationAnalysis;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <StatCard title="Total Cancellations" value={c.totalCancellations} icon={XCircle} color="warning" />
                <StatCard title="Cancellation Rate" value={`${c.cancellationRate}%`} icon={TrendingUp} color="danger" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
                <ChartCard title="Cancellation Reasons" icon={AlertTriangle} iconColor="#EF4444">
                    <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={c.cancellationsByReason.slice(0, 5)} innerRadius={50} outerRadius={90} paddingAngle={4} dataKey="count" nameKey="reason">
                                    {c.cancellationsByReason.slice(0, 5).map((_, i) => (<Cell key={`cell-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                                </Pie>
                                <Tooltip contentStyle={tt} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>

                <ChartCard title="Cancellations by Hour" icon={Clock} iconColor="#EF4444">
                    <div style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={c.cancellationsByHour}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                <XAxis dataKey="hourLabel" tick={{ fontSize: 10 }} interval={2} />
                                <YAxis />
                                <Tooltip contentStyle={tt} />
                                <Bar dataKey="count" name="Cancellations" fill="#EF4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>
            </div>

            {/* Trend */}
            <ChartCard title="Cancellation Trend (Last 30 Days)" icon={TrendingUp} iconColor="#EF4444">
                <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={c.cancellationTrend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="date" tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} tick={{ fontSize: 10 }} />
                            <YAxis yAxisId="left" />
                            <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} />
                            <Tooltip contentStyle={tt} labelFormatter={d => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} />
                            <Legend />
                            <Line yAxisId="left" type="monotone" dataKey="cancellations" name="Cancellations" stroke="#EF4444" strokeWidth={2} dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="rate" name="Rate %" stroke="#FF9904" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>

            {/* Vendors with Cancellations */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}><Store size={16} color="#EF4444" /> Vendors with Cancellations</h3>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium"><thead><tr>
                        <th>Vendor</th><th style={{ textAlign: 'right' }}>Cancellations</th><th style={{ textAlign: 'right' }}>Total Orders</th><th style={{ textAlign: 'right' }}>Rate</th>
                    </tr></thead><tbody>
                            {c.cancellationsByVendor.map(v => (
                                <tr key={v.vendorId}>
                                    <td style={{ fontWeight: 500 }}>{v.vendorName}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#EF4444' }}>{v.cancellations}</td>
                                    <td style={{ textAlign: 'right' }}>{v.totalOrders}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600, background: v.cancellationRate <= 5 ? 'rgba(16,185,129,0.1)' : v.cancellationRate <= 10 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: v.cancellationRate <= 5 ? '#10B981' : v.cancellationRate <= 10 ? '#F59E0B' : '#EF4444' }}>
                                            {v.cancellationRate}%
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody></table>
                </div>
            </motion.div>
        </div>
    );
}
