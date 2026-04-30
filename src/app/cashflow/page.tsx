'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    ArrowDownRight, ArrowUpRight, RefreshCw, TrendingUp, TrendingDown,
    IndianRupee, Loader2, Wallet, Store, Bike, CreditCard, Banknote,
    AlertCircle, CheckCircle2, MinusCircle, ArrowRight, PieChart as PieChartIcon,
    BarChart3, Calendar, ChevronDown, ChevronUp, Info
} from 'lucide-react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, PieChart, Pie, Cell,
    ComposedChart, Line, Bar, Area
} from 'recharts';
import { useApi } from '@/hooks/useApi';

/* ── Types ── */
interface PaymentModeSplit {
    online: { count: number; revenue: number };
    cod: { count: number; revenue: number };
}

interface PeriodData {
    totalOrders: number; deliveredOrders: number; cancelledOrders: number;
    totalRevenue: number; onlinePayments: number; codCollected: number;
    codSettled: number; codPending: number;
    subtotalSum: number;
    commission: number; gstOnCommission: number;
    deliveryFeesCollected: number; smallOrderFees: number; tipsCollected: number;
    vendorPayouts: number; deliveryPartnerPayouts: number;
    tipPayouts: number; refundsIssued: number; totalOutflow: number;
    deliveryFeeProfit: number; platformNet: number; totalDiscount: number;
    paymentModeSplit: PaymentModeSplit;
}

interface DailyTrend {
    date: string; revenue: number; commission: number;
    vendorPayout: number; deliveryPayout: number; platformNet: number; orders: number;
}

interface CashflowData {
    periods: Record<string, PeriodData>;
    dailyTrend: DailyTrend[];
}

/* ── Helpers ── */
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const fmtShort = (n: number) => {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${Math.round(n)}`;
};
const pct = (part: number, total: number) => total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%';

const COLORS = {
    primary: '#F4511E',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    purple: '#8B5CF6',
    blue: '#3B82F6',
    orange: '#F97316',
    teal: '#14B8A6',
};

type PeriodKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'allTime';

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'thisWeek', label: 'This Week' },
    { key: 'thisMonth', label: 'This Month' },
    { key: 'lastMonth', label: 'Last Month' },
    { key: 'allTime', label: 'All Time' },
];

/* ── Flow Step Component ── */
function FlowStep({ label, value, color, icon: Icon, subtitle }: {
    label: string; value: number; color: string; icon: React.ElementType; subtitle?: string;
}) {
    return (
        <div style={{
            textAlign: 'center', padding: '12px 8px', borderRadius: 14, flex: '1 1 120px',
            background: `linear-gradient(135deg, ${color}0D, ${color}05)`,
            border: `1px solid ${color}20`,
            minWidth: 120,
        }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                <Icon size={16} color={color} />
            </div>
            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>{label}</p>
            <p style={{ fontSize: '1.05rem', fontWeight: 700, color }}>{fmt(value)}</p>
            {subtitle && <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{subtitle}</p>}
        </div>
    );
}

export default function CashflowPage() {
    const { data, loading, refetch } = useApi<CashflowData>('/api/cashflow');
    const [refreshing, setRefreshing] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('thisMonth');
    const [showDetailedTable, setShowDetailedTable] = useState(false);

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

    const period = data?.periods[selectedPeriod];

    /* ── Loading State ── */
    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Wallet size={28} style={{ color: 'var(--primary)' }} /> Cashflow
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
            </div>
        </div>
    );

    /* ── Pie data (period-aware) ── */
    const paymentPie = period ? [
        { name: 'Online', value: period.paymentModeSplit.online.revenue, count: period.paymentModeSplit.online.count },
        { name: 'Cash on Delivery', value: period.paymentModeSplit.cod.revenue, count: period.paymentModeSplit.cod.count },
    ].filter(d => d.value > 0) : [];
    const pieColors = [COLORS.primary, COLORS.warning];

    /* ── Outflow breakdown pie ── */
    const outflowPie = period ? [
        { name: 'Vendors', value: period.vendorPayouts },
        { name: 'Delivery', value: period.deliveryPartnerPayouts },
        { name: 'GST', value: period.gstOnCommission },
        { name: 'Tips', value: period.tipPayouts },
        { name: 'Refunds', value: period.refundsIssued },
    ].filter(d => d.value > 0) : [];
    const outflowColors = [COLORS.orange, COLORS.warning, COLORS.error, COLORS.purple, '#DC2626'];

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 20 }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Wallet size={28} style={{ color: 'var(--primary)' }} /> Cashflow
                    </h1>
                    <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Track every rupee — from customers to your platform
                    </p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* ── Period Selector ── */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PERIOD_OPTIONS.map(p => (
                    <button key={p.key} onClick={() => setSelectedPeriod(p.key)} style={{
                        padding: '8px 16px', borderRadius: 10, fontSize: '0.82rem', fontWeight: 600,
                        background: selectedPeriod === p.key ? 'var(--primary)' : 'var(--surface)',
                        color: selectedPeriod === p.key ? 'white' : 'var(--foreground)',
                        border: `1px solid ${selectedPeriod === p.key ? 'var(--primary)' : 'var(--border)'}`,
                        cursor: 'pointer', transition: 'all 0.2s',
                    }}>
                        {p.label}
                    </button>
                ))}
            </div>

            {period && (<>
                {/* ══════════════════════════════════════════════════════
                    SECTION 1: THREE KEY NUMBERS — The Big Picture
                   ══════════════════════════════════════════════════════ */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                    {/* Total Revenue (Money In) */}
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card"
                        style={{ padding: 20, borderLeft: `4px solid ${COLORS.primary}` }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <div>
                                <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                                    💰 Total Money In
                                </p>
                                <p style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.1 }}>{fmt(period.totalRevenue)}</p>
                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>
                                    {period.deliveredOrders} orders • {period.cancelledOrders} cancelled
                                </p>
                            </div>
                            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${COLORS.primary}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ArrowDownRight size={22} color={COLORS.primary} />
                            </div>
                        </div>
                    </motion.div>

                    {/* Total Payouts (Money Out) */}
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card"
                        style={{ padding: 20, borderLeft: `4px solid ${COLORS.error}` }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <div>
                                <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                                    📤 Total Money Out
                                </p>
                                <p style={{ fontSize: '1.6rem', fontWeight: 700, color: COLORS.error, lineHeight: 1.1 }}>{fmt(period.totalOutflow)}</p>
                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>
                                    Vendors + Delivery + GST + Tips + Refunds
                                </p>
                            </div>
                            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${COLORS.error}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ArrowUpRight size={22} color={COLORS.error} />
                            </div>
                        </div>
                    </motion.div>

                    {/* Platform Net (What You Keep) */}
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card"
                        style={{
                            padding: 20,
                            borderLeft: `4px solid ${period.platformNet >= 0 ? COLORS.success : COLORS.error}`,
                            background: period.platformNet >= 0
                                ? 'linear-gradient(135deg, rgba(16,185,129,0.06), transparent)'
                                : 'linear-gradient(135deg, rgba(239,68,68,0.06), transparent)',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <div>
                                <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                                    ✅ Platform Keeps
                                </p>
                                <p style={{ fontSize: '1.6rem', fontWeight: 700, color: period.platformNet >= 0 ? COLORS.success : COLORS.error, lineHeight: 1.1 }}>
                                    {fmt(period.platformNet)}
                                </p>
                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>
                                    {pct(period.platformNet, period.totalRevenue)} of revenue
                                </p>
                            </div>
                            <div style={{ width: 42, height: 42, borderRadius: 12, background: period.platformNet >= 0 ? `${COLORS.success}18` : `${COLORS.error}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {period.platformNet >= 0 ? <TrendingUp size={22} color={COLORS.success} /> : <TrendingDown size={22} color={COLORS.error} />}
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* ══════════════════════════════════════════════════════
                    SECTION 2: MONEY FLOW WATERFALL
                    Visual: Customer pays → Where it goes → What remains
                   ══════════════════════════════════════════════════════ */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <Info size={16} color="var(--primary)" />
                        <p style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--foreground)' }}>Where Does the Money Go?</p>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginBottom: 20 }}>
                        For every ₹100 a customer pays, here&apos;s the breakdown:
                    </p>

                    {/* Visual flow arrows */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                        <FlowStep label="Customer Pays" value={period.totalRevenue} color={COLORS.primary} icon={IndianRupee}
                            subtitle={`${period.totalOrders} orders`} />
                        <ArrowRight size={20} color="var(--foreground-secondary)" style={{ flexShrink: 0 }} />
                        <FlowStep label="To Vendors" value={period.vendorPayouts} color={COLORS.orange} icon={Store}
                            subtitle={`${pct(period.vendorPayouts, period.totalRevenue)}`} />
                        <ArrowRight size={20} color="var(--foreground-secondary)" style={{ flexShrink: 0 }} />
                        <FlowStep label="To Delivery" value={period.deliveryPartnerPayouts} color={COLORS.warning} icon={Bike}
                            subtitle={`${pct(period.deliveryPartnerPayouts, period.totalRevenue)}`} />
                        <ArrowRight size={20} color="var(--foreground-secondary)" style={{ flexShrink: 0 }} />
                        <FlowStep label="GST & Others" value={period.gstOnCommission + period.tipPayouts + period.refundsIssued} color={COLORS.error} icon={MinusCircle}
                            subtitle="GST + Tips + Refunds" />
                        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--foreground-secondary)', flexShrink: 0 }}>=</span>
                        <FlowStep label="Platform Keeps" value={period.platformNet} color={period.platformNet >= 0 ? COLORS.success : COLORS.error} icon={Wallet}
                            subtitle={`${pct(period.platformNet, period.totalRevenue)} margin`} />
                    </div>
                </motion.div>

                {/* ══════════════════════════════════════════════════════
                    SECTION 3: DETAILED INFLOW / OUTFLOW BREAKDOWN
                   ══════════════════════════════════════════════════════ */}
                <div className="cashflow-two-col">

                    {/* INFLOW - How Customers Paid */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: `${COLORS.success}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ArrowDownRight size={18} color={COLORS.success} />
                            </div>
                            <div>
                                <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Revenue Breakdown</p>
                                <p style={{ fontSize: '1.15rem', fontWeight: 700, color: COLORS.success }}>{fmt(period.totalRevenue)}</p>
                            </div>
                        </div>

                        {/* How customers paid */}
                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 8 }}>
                            Payment Method
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                            {[
                                { label: 'Online Payments', value: period.onlinePayments, icon: CreditCard, color: COLORS.primary, count: period.paymentModeSplit.online.count },
                                { label: 'Cash on Delivery', value: period.codCollected, icon: Banknote, color: COLORS.warning, count: period.paymentModeSplit.cod.count },
                            ].filter(r => r.value > 0).map(row => (
                                <div key={row.label} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '10px 12px', borderRadius: 10,
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <row.icon size={14} color={row.color} />
                                        <div>
                                            <span style={{ fontSize: '0.82rem', color: 'var(--foreground)' }}>{row.label}</span>
                                            <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginLeft: 6 }}>({row.count} orders)</span>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>{fmt(row.value)}</span>
                                        <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', display: 'block' }}>{pct(row.value, period.totalRevenue)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* What the revenue includes */}
                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 8 }}>
                            Revenue Components
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {[
                                { label: 'Food Subtotal', value: period.subtotalSum, color: 'var(--foreground)' },
                                { label: 'Delivery Fees', value: period.deliveryFeesCollected, color: COLORS.blue },
                                { label: 'Small Order Fees', value: period.smallOrderFees, color: COLORS.purple },
                                { label: 'Tips', value: period.tipsCollected, color: COLORS.teal },
                                { label: 'Discounts Given', value: -period.totalDiscount, color: COLORS.error },
                            ].filter(r => r.value !== 0).map(row => (
                                <div key={row.label} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '6px 12px', borderRadius: 8,
                                    background: 'var(--surface)',
                                }}>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>{row.label}</span>
                                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: row.color }}>
                                        {row.value < 0 ? `−${fmt(Math.abs(row.value))}` : fmt(row.value)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* COD Status */}
                        {period.codCollected > 0 && (
                            <div style={{
                                marginTop: 16, padding: '12px 14px', borderRadius: 12,
                                background: period.codPending > 0 ? `${COLORS.warning}0A` : `${COLORS.success}0A`,
                                border: `1px solid ${period.codPending > 0 ? `${COLORS.warning}25` : `${COLORS.success}25`}`,
                            }}>
                                <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 8 }}>
                                    COD Collection Status
                                </p>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>Collected</p>
                                        <p style={{ fontSize: '0.95rem', fontWeight: 700, color: COLORS.success }}>{fmt(period.codSettled)}</p>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>Pending</p>
                                        <p style={{ fontSize: '0.95rem', fontWeight: 700, color: period.codPending > 0 ? COLORS.warning : COLORS.success }}>
                                            {fmt(period.codPending)}
                                        </p>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>Total COD</p>
                                        <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--foreground)' }}>{fmt(period.codCollected)}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </motion.div>

                    {/* OUTFLOW - Where Money Goes */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card" style={{ padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: `${COLORS.error}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <ArrowUpRight size={18} color={COLORS.error} />
                            </div>
                            <div>
                                <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Payouts & Expenses</p>
                                <p style={{ fontSize: '1.15rem', fontWeight: 700, color: COLORS.error }}>{fmt(period.totalOutflow)}</p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {[
                                { label: 'Vendor Payouts', subtitle: `${pct(period.vendorPayouts, period.subtotalSum)} of food subtotal`, value: period.vendorPayouts, icon: Store, color: COLORS.orange },
                                { label: 'Delivery Partner Payouts', subtitle: 'Base + per-km rate', value: period.deliveryPartnerPayouts, icon: Bike, color: COLORS.warning },
                                { label: 'GST on Commission', subtitle: '18% of commission', value: period.gstOnCommission, icon: IndianRupee, color: COLORS.error },
                                { label: 'Tips (Passed to Partners)', subtitle: 'Fully forwarded', value: period.tipPayouts, icon: IndianRupee, color: COLORS.purple },
                                { label: 'Refunds Issued', subtitle: 'Customer refunds', value: period.refundsIssued, icon: MinusCircle, color: '#DC2626' },
                            ].filter(r => r.value > 0).map(row => (
                                <div key={row.label} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '10px 12px', borderRadius: 10, background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <row.icon size={14} color={row.color} />
                                        <div>
                                            <span style={{ fontSize: '0.82rem', color: 'var(--foreground)', display: 'block' }}>{row.label}</span>
                                            <span style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>{row.subtitle}</span>
                                        </div>
                                    </div>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: COLORS.error }}>
                                        −{fmt(row.value)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Outflow Pie */}
                        {outflowPie.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                                <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 8 }}>
                                    Outflow Split
                                </p>
                                <div style={{ height: 160 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={outflowPie} innerRadius={40} outerRadius={60} paddingAngle={3} dataKey="value">
                                                {outflowPie.map((_, i) => (
                                                    <Cell key={i} fill={outflowColors[i % outflowColors.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}
                                                formatter={(value: number | undefined) => fmt(value || 0)}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                                    {outflowPie.map((item, i) => (
                                        <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>
                                            <div style={{ width: 8, height: 8, borderRadius: 4, background: outflowColors[i % outflowColors.length] }} />
                                            {item.name} ({pct(item.value, period.totalOutflow)})
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Net Result */}
                        <div style={{
                            marginTop: 16, padding: '14px 16px', borderRadius: 12,
                            background: period.platformNet >= 0
                                ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))'
                                : 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))',
                            border: `1px solid ${period.platformNet >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {period.platformNet >= 0 ? <CheckCircle2 size={16} color={COLORS.success} /> : <AlertCircle size={16} color={COLORS.error} />}
                                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: period.platformNet >= 0 ? COLORS.success : COLORS.error }}>
                                        Platform Keeps
                                    </span>
                                </div>
                                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: period.platformNet >= 0 ? COLORS.success : COLORS.error }}>
                                    {fmt(period.platformNet)}
                                </span>
                            </div>
                            <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                                What the platform earns after all payouts &amp; taxes
                            </p>
                        </div>
                    </motion.div>
                </div>

                {/* ══════════════════════════════════════════════════════
                    SECTION 4: DELIVERY FEE P&L
                   ══════════════════════════════════════════════════════ */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 14 }}>
                        🚚 Delivery Fee Profit / Loss
                    </p>
                    <div className="cashflow-delivery-pl">
                        <div style={{ textAlign: 'center', padding: '12px 14px', borderRadius: 12, background: `${COLORS.blue}0A`, border: `1px solid ${COLORS.blue}18` }}>
                            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Charged to Customers</p>
                            <p style={{ fontSize: '1.15rem', fontWeight: 700, color: COLORS.blue }}>{fmt(period.deliveryFeesCollected)}</p>
                        </div>
                        <span className="cashflow-operator" style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--foreground-secondary)' }}>−</span>
                        <div style={{ textAlign: 'center', padding: '12px 14px', borderRadius: 12, background: `${COLORS.warning}0A`, border: `1px solid ${COLORS.warning}18` }}>
                            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>Paid to Partners</p>
                            <p style={{ fontSize: '1.15rem', fontWeight: 700, color: COLORS.warning }}>{fmt(period.deliveryPartnerPayouts)}</p>
                        </div>
                        <span className="cashflow-operator" style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--foreground-secondary)' }}>=</span>
                        <div style={{
                            textAlign: 'center', padding: '12px 14px', borderRadius: 12,
                            background: period.deliveryFeeProfit >= 0 ? `${COLORS.success}0A` : `${COLORS.error}0A`,
                            border: `1px solid ${period.deliveryFeeProfit >= 0 ? `${COLORS.success}18` : `${COLORS.error}18`}`,
                        }}>
                            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase' }}>
                                {period.deliveryFeeProfit >= 0 ? 'Profit' : 'Subsidy (Loss)'}
                            </p>
                            <p style={{ fontSize: '1.15rem', fontWeight: 700, color: period.deliveryFeeProfit >= 0 ? COLORS.success : COLORS.error }}>
                                {period.deliveryFeeProfit >= 0 ? '+' : ''}{fmt(period.deliveryFeeProfit)}
                            </p>
                        </div>
                    </div>
                </motion.div>

                {/* ══════════════════════════════════════════════════════
                    SECTION 5: CHARTS — Trend + Payment Mode
                   ══════════════════════════════════════════════════════ */}
                <div className="cashflow-chart-grid">
                    {/* Trend Chart */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                            <BarChart3 size={18} color="var(--primary)" />
                            <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--foreground)' }}>Revenue & Earnings Trend (14 Days)</p>
                        </div>
                        <div style={{ height: 300 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={data?.dailyTrend || []}>
                                    <defs>
                                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.2} />
                                            <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--foreground-secondary)', fontSize: 11 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--foreground-secondary)', fontSize: 11 }}
                                        tickFormatter={(v) => fmtShort(v)} />
                                    <Tooltip
                                        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-md)' }}
                                        formatter={(value: number | undefined, name?: string) => [fmt(value || 0), name || '']}
                                    />
                                    <Area type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS.primary} strokeWidth={2} fill="url(#revGrad)" />
                                    <Bar dataKey="vendorPayout" name="Vendor Payout" fill={COLORS.orange} radius={[4, 4, 0, 0]} opacity={0.6} barSize={12} />
                                    <Bar dataKey="deliveryPayout" name="Delivery Payout" fill={COLORS.warning} radius={[4, 4, 0, 0]} opacity={0.6} barSize={12} />
                                    <Line type="monotone" dataKey="platformNet" name="Platform Net" stroke={COLORS.success} strokeWidth={2.5} dot={{ r: 3, fill: COLORS.success }} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 12 }}>
                            {[
                                { label: 'Revenue', color: COLORS.primary },
                                { label: 'Vendor Payout', color: COLORS.orange },
                                { label: 'Delivery Payout', color: COLORS.warning },
                                { label: 'Platform Net', color: COLORS.success },
                            ].map(l => (
                                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                    <div style={{ width: 8, height: 8, borderRadius: 4, background: l.color }} />
                                    {l.label}
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    {/* Payment Mode Split (now period-aware) */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card" style={{ padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                            <PieChartIcon size={18} color="var(--primary)" />
                            <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--foreground)' }}>Payment Mode</p>
                        </div>
                        {paymentPie.length > 0 ? (
                            <>
                                <div style={{ height: 200 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={paymentPie} innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value">
                                                {paymentPie.map((_, i) => (
                                                    <Cell key={i} fill={pieColors[i]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}
                                                formatter={(value: number | undefined) => fmt(value || 0)}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                                    {paymentPie.map((item, i) => (
                                        <div key={item.name} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 12px', borderRadius: 10, background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <div style={{ width: 10, height: 10, borderRadius: 5, background: pieColors[i] }} />
                                                <span style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)' }}>{item.name}</span>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>{fmt(item.value)}</span>
                                                <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginLeft: 6 }}>({item.count})</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                <PieChartIcon size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                <p style={{ fontSize: '0.85rem' }}>No payment data for this period</p>
                            </div>
                        )}
                    </motion.div>
                </div>

                {/* ══════════════════════════════════════════════════════
                    SECTION 6: PERIOD COMPARISON TABLE (Collapsible)
                   ══════════════════════════════════════════════════════ */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                    <button
                        onClick={() => setShowDetailedTable(!showDetailedTable)}
                        style={{
                            width: '100%', padding: '16px 20px', borderBottom: showDetailedTable ? '1px solid var(--border)' : 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Calendar size={18} color="var(--primary)" />
                            <p style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Period Comparison</p>
                        </div>
                        {showDetailedTable ? <ChevronUp size={18} color="var(--foreground-secondary)" /> : <ChevronDown size={18} color="var(--foreground-secondary)" />}
                    </button>

                    {showDetailedTable && (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table-premium">
                                <thead><tr>
                                    <th>Metric</th>
                                    {['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'allTime'].map(k => (
                                        <th key={k} style={{ textAlign: 'right' }}>
                                            {k === 'today' ? 'Today' : k === 'yesterday' ? 'Yesterday' : k === 'thisWeek' ? 'This Week' : k === 'thisMonth' ? 'This Month' : k === 'lastMonth' ? 'Last Month' : 'All Time'}
                                        </th>
                                    ))}
                                </tr></thead>
                                <tbody>
                                    {[
                                        { label: 'Delivered Orders', key: 'deliveredOrders', format: (v: number) => v.toString(), isHighlight: false },
                                        { label: 'Cancelled Orders', key: 'cancelledOrders', format: (v: number) => v.toString(), isHighlight: false },
                                        { label: 'Total Revenue', key: 'totalRevenue', format: fmt, isHighlight: false },
                                        { label: 'Vendor Payouts', key: 'vendorPayouts', format: fmt, isHighlight: false },
                                        { label: 'Delivery Payouts', key: 'deliveryPartnerPayouts', format: fmt, isHighlight: false },
                                        { label: 'Commission (15%)', key: 'commission', format: fmt, isHighlight: false },
                                        { label: 'GST on Commission', key: 'gstOnCommission', format: fmt, isHighlight: false },
                                        { label: 'Delivery Fee P/L', key: 'deliveryFeeProfit', format: fmt, isHighlight: false },
                                        { label: 'COD Collected', key: 'codCollected', format: fmt, isHighlight: false },
                                        { label: 'COD Pending', key: 'codPending', format: fmt, isHighlight: false },
                                        { label: 'Refunds', key: 'refundsIssued', format: fmt, isHighlight: false },
                                        { label: 'Platform Net', key: 'platformNet', format: fmt, isHighlight: true },
                                    ].map(row => (
                                        <tr key={row.key} style={row.isHighlight ? { background: 'rgba(16,185,129,0.04)' } : {}}>
                                            <td style={{ fontWeight: row.isHighlight ? 700 : 500, fontSize: '0.82rem' }}>{row.label}</td>
                                            {['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'allTime'].map(k => {
                                                const p = data?.periods[k];
                                                const val = p ? (p as any)[row.key] : 0;
                                                const isNetOrProfit = row.key === 'platformNet' || row.key === 'deliveryFeeProfit';
                                                return (
                                                    <td key={k} style={{
                                                        textAlign: 'right', fontWeight: row.isHighlight ? 700 : 500,
                                                        fontSize: '0.82rem',
                                                        color: isNetOrProfit
                                                            ? (val >= 0 ? COLORS.success : COLORS.error)
                                                            : 'var(--foreground)',
                                                    }}>
                                                        {row.format(val)}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </motion.div>
            </>)}

            {/* Empty state when no period data */}
            {!period && !loading && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--foreground-secondary)' }}>
                    <Wallet size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
                    <p style={{ fontSize: '1rem', fontWeight: 600 }}>No cashflow data available</p>
                    <p style={{ fontSize: '0.85rem', marginTop: 4 }}>Data will appear once orders start coming in</p>
                </div>
            )}
        </motion.div>
    );
}
