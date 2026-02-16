'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    Receipt, RefreshCw, Download, IndianRupee,
    Calendar, Store, TrendingUp, Loader2,
    FileText, ChevronDown, Filter, Percent
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import { useApi } from '@/hooks/useApi';

interface GSTEntry {
    orderId: string;
    vendorId: string;
    vendorName: string;
    orderDate: string;
    itemTotal: number;
    discount: number;
    itemTotalAfterDiscount: number;
    deliveryFee: number;
    commission: number;
    gstOnCommission: number;
    gstOnFood: number;
    gstOnDelivery: number;
    totalGst: number;
    totalPlatformEarning: number;
    paymentMode: string;
}

interface MonthlyGST {
    month: string;
    monthKey: string;
    ordersCount: number;
    totalItemSales: number;
    totalDeliveryFees: number;
    totalCommission: number;
    totalGstOnCommission: number;
    totalGstOnFood: number;
    totalGstOnDelivery: number;
    totalGst: number;
    totalPlatformEarning: number;
}

interface VendorGST {
    vendorId: string;
    vendorName: string;
    ordersCount: number;
    totalItemSales: number;
    totalCommission: number;
    totalGst: number;
    totalPlatformEarning: number;
}

interface GSTReportData {
    entries: GSTEntry[];
    monthlyData: MonthlyGST[];
    vendorData: VendorGST[];
    summary: {
        totalOrders: number;
        totalItemSales: number;
        totalDeliveryFees: number;
        totalCommission: number;
        totalGstOnCommission: number;
        totalGstOnFood: number;
        totalGstOnDelivery: number;
        totalGstCollected: number;
        totalPlatformEarning: number;
        commissionRate: number;
        gstOnCommissionRate: number;
        gstOnFoodRate: number;
        gstOnDeliveryRate: number;
        gstRate: number;
    };
}

function StatCard({ title, value, subtitle, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; subtitle?: string;
    icon: React.ElementType; color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const colorMap = {
        primary: { bg: 'rgba(40, 137, 144, 0.15)', text: '#288990' },
        success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
        warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
        error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
    };
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card"
            style={{ padding: 16 }}
        >
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

const COLORS = ['#288990', '#FF9904', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#6366F1', '#EC4899'];

const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: 'var(--shadow-md)',
    fontSize: '0.8125rem',
    padding: '10px 14px',
};

export default function GSTReportPage() {
    const { data, loading, refetch } = useApi<GSTReportData>('/api/reports/gst');
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<'summary' | 'monthly' | 'vendor' | 'transactions'>('summary');
    const [showDateFilter, setShowDateFilter] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
    };

    const chartData = useMemo(() => {
        if (!data?.monthlyData) return [];
        return data.monthlyData.slice(0, 12).reverse().map(m => ({
            name: m.month.split(' ')[0].slice(0, 3),
            commission: Math.round(m.totalCommission),
            gst: Math.round(m.totalGst),
            total: Math.round(m.totalPlatformEarning),
        }));
    }, [data]);

    const vendorPieData = useMemo(() => {
        if (!data?.vendorData) return [];
        return data.vendorData.slice(0, 8).map(v => ({
            name: v.vendorName.length > 15 ? v.vendorName.slice(0, 15) + '...' : v.vendorName,
            value: Math.round(v.totalGst),
        }));
    }, [data]);

    const downloadCSV = () => {
        if (!data?.entries) return;

        const headers = [
            'Order ID',
            'Vendor',
            'Date',
            'Item Total',
            'Discount',
            'Taxable Value',
            'Delivery Fee',
            'Commission (15%)',
            'GST on Food (5%)',
            'GST on Delivery (18%)',
            'GST on Commission (18%)',
            'Total GST',
            'Platform Earning',
            'Payment Mode'
        ];
        const rows = data.entries.map(e => [
            e.orderId,
            e.vendorName,
            formatDate(e.orderDate),
            e.itemTotal.toFixed(2),
            (e.discount || 0).toFixed(2),
            e.itemTotalAfterDiscount.toFixed(2),
            (e.deliveryFee || 0).toFixed(2),
            e.commission.toFixed(2),
            (e.gstOnFood || 0).toFixed(2),
            (e.gstOnDelivery || 0).toFixed(2),
            e.gstOnCommission.toFixed(2),
            e.totalGst.toFixed(2),
            e.totalPlatformEarning.toFixed(2),
            e.paymentMode,
        ]);

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gst-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>GST Report</h1>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

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
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
                        <Receipt size={28} style={{ marginRight: 10, verticalAlign: 'middle', color: 'var(--primary)' }} />
                        GST Report
                    </h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        GST: 5% on Food, 18% on Delivery & Commission
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={downloadCSV}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 10,
                            background: 'var(--surface)', color: 'var(--foreground)',
                            border: '1px solid var(--border)', cursor: 'pointer',
                            fontWeight: 500, fontSize: '0.875rem'
                        }}
                    >
                        <Download size={16} /> Export CSV
                    </button>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 10,
                            background: 'var(--primary)', color: 'white',
                            border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer',
                            opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem'
                        }}
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* Summary Cards - Row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <StatCard
                    title="Total GST Collected"
                    value={formatCurrency(data?.summary.totalGstCollected || 0)}
                    subtitle="All GST combined"
                    icon={Receipt}
                    color="primary"
                />
                <StatCard
                    title="GST on Food (5%)"
                    value={formatCurrency(data?.summary.totalGstOnFood || 0)}
                    subtitle="On item total after discount"
                    icon={IndianRupee}
                    color="success"
                />
                <StatCard
                    title="GST on Delivery (18%)"
                    value={formatCurrency(data?.summary.totalGstOnDelivery || 0)}
                    subtitle="On delivery fee"
                    icon={IndianRupee}
                    color="warning"
                />
                <StatCard
                    title="GST on Commission (18%)"
                    value={formatCurrency(data?.summary.totalGstOnCommission || 0)}
                    subtitle="On 15% commission"
                    icon={Percent}
                    color="error"
                />
            </div>

            {/* Summary Cards - Row 2 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <StatCard
                    title="Total Commission"
                    value={formatCurrency(data?.summary.totalCommission || 0)}
                    subtitle={`${data?.summary.commissionRate || 15}% of sales`}
                    icon={Percent}
                    color="success"
                />
                <StatCard
                    title="Platform Earnings"
                    value={formatCurrency(data?.summary.totalPlatformEarning || 0)}
                    subtitle="Commission + GST on Commission"
                    icon={TrendingUp}
                    color="warning"
                />
                <StatCard
                    title="Total Item Sales"
                    value={formatCurrency(data?.summary.totalItemSales || 0)}
                    subtitle={`${data?.summary.totalOrders || 0} orders`}
                    icon={IndianRupee}
                    color="primary"
                />
                <StatCard
                    title="Total Delivery Fees"
                    value={formatCurrency(data?.summary.totalDeliveryFees || 0)}
                    subtitle="Collected from customers"
                    icon={IndianRupee}
                    color="primary"
                />
            </div>

            {/* Tabs */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                    {(['summary', 'monthly', 'vendor', 'transactions'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setActiveTab(t)}
                            style={{
                                flex: 1, padding: '14px 16px', fontSize: '0.85rem', fontWeight: 500,
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                borderBottom: `2px solid ${activeTab === t ? 'var(--primary)' : 'transparent'}`,
                                color: activeTab === t ? 'var(--primary)' : 'var(--foreground-secondary)',
                                transition: 'all 0.2s'
                            }}
                        >
                            {t === 'summary' && 'Overview'}
                            {t === 'monthly' && 'Monthly Breakdown'}
                            {t === 'vendor' && 'By Vendor'}
                            {t === 'transactions' && 'Transactions'}
                        </button>
                    ))}
                </div>

                <div style={{ padding: 20 }}>
                    {/* Summary Tab */}
                    {activeTab === 'summary' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                            {/* Bar Chart */}
                            <div>
                                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>Monthly Commission & GST</h3>
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${v}`} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`₹${value}`, '']} />
                                        <Legend />
                                        <Bar dataKey="commission" name="Commission" fill="#10B981" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="gst" name="GST" fill="#288990" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Pie Chart */}
                            <div>
                                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>GST by Vendor (Top 8)</h3>
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie
                                            data={vendorPieData}
                                            dataKey="value"
                                            nameKey="name"
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={80}
                                            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        >
                                            {vendorPieData.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`₹${value}`, 'GST']} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Rate Info */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ padding: 16, background: 'rgba(40, 137, 144, 0.08)', borderRadius: 12 }}>
                                    <h4 style={{ fontWeight: 600, marginBottom: 8 }}>GST Calculation Formula</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, fontSize: '0.85rem' }}>
                                        <div>
                                            <p style={{ color: 'var(--foreground-secondary)', marginBottom: 4 }}>Platform Commission</p>
                                            <p style={{ fontWeight: 600 }}>15% of Item Total</p>
                                        </div>
                                        <div>
                                            <p style={{ color: 'var(--foreground-secondary)', marginBottom: 4 }}>GST on Commission</p>
                                            <p style={{ fontWeight: 600 }}>18% of Commission</p>
                                        </div>
                                        <div>
                                            <p style={{ color: 'var(--foreground-secondary)', marginBottom: 4 }}>Effective GST Rate on Sales</p>
                                            <p style={{ fontWeight: 600 }}>2.7%</p>
                                        </div>
                                        <div>
                                            <p style={{ color: 'var(--foreground-secondary)', marginBottom: 4 }}>Vendor Payout</p>
                                            <p style={{ fontWeight: 600 }}>Item Total - Commission - GST</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Monthly Tab */}
                    {activeTab === 'monthly' && (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Month</th>
                                        <th style={{ textAlign: 'right' }}>Orders</th>
                                        <th style={{ textAlign: 'right' }}>Item Sales</th>
                                        <th style={{ textAlign: 'right' }}>Commission (15%)</th>
                                        <th style={{ textAlign: 'right' }}>GST (18%)</th>
                                        <th style={{ textAlign: 'right' }}>Platform Earning</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.monthlyData.map(m => (
                                        <tr key={m.monthKey}>
                                            <td style={{ fontWeight: 500 }}>{m.month}</td>
                                            <td style={{ textAlign: 'right' }}>{m.ordersCount}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(m.totalItemSales)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981' }}>{formatCurrency(m.totalCommission)}</td>
                                            <td style={{ textAlign: 'right', color: '#288990', fontWeight: 600 }}>{formatCurrency(m.totalGst)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(m.totalPlatformEarning)}</td>
                                        </tr>
                                    ))}
                                    {(!data?.monthlyData || data.monthlyData.length === 0) && (
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                                No data available
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Vendor Tab */}
                    {activeTab === 'vendor' && (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Vendor</th>
                                        <th style={{ textAlign: 'right' }}>Orders</th>
                                        <th style={{ textAlign: 'right' }}>Item Sales</th>
                                        <th style={{ textAlign: 'right' }}>Commission</th>
                                        <th style={{ textAlign: 'right' }}>GST Collected</th>
                                        <th style={{ textAlign: 'right' }}>Platform Earning</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.vendorData.map(v => (
                                        <tr key={v.vendorId}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(40, 137, 144, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <Store size={16} color="#288990" />
                                                    </div>
                                                    <span style={{ fontWeight: 500 }}>{v.vendorName}</span>
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'right' }}>{v.ordersCount}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(v.totalItemSales)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981' }}>{formatCurrency(v.totalCommission)}</td>
                                            <td style={{ textAlign: 'right', color: '#288990', fontWeight: 600 }}>{formatCurrency(v.totalGst)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(v.totalPlatformEarning)}</td>
                                        </tr>
                                    ))}
                                    {(!data?.vendorData || data.vendorData.length === 0) && (
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                                No vendor data available
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Transactions Tab */}
                    {activeTab === 'transactions' && (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Vendor</th>
                                        <th>Date</th>
                                        <th style={{ textAlign: 'right' }}>Item Total</th>
                                        <th style={{ textAlign: 'right' }}>Commission</th>
                                        <th style={{ textAlign: 'right' }}>GST</th>
                                        <th>Payment</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.entries.map(e => (
                                        <tr key={e.orderId}>
                                            <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{e.orderId.slice(0, 8)}...</td>
                                            <td style={{ fontWeight: 500 }}>{e.vendorName}</td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>{formatDate(e.orderDate)}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(e.itemTotal)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981' }}>{formatCurrency(e.commission)}</td>
                                            <td style={{ textAlign: 'right', color: '#288990', fontWeight: 600 }}>{formatCurrency(e.gstOnCommission)}</td>
                                            <td>
                                                <span style={{
                                                    padding: '3px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 500,
                                                    background: e.paymentMode === 'COD' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                                    color: e.paymentMode === 'COD' ? '#F59E0B' : '#10B981'
                                                }}>
                                                    {e.paymentMode}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {(!data?.entries || data.entries.length === 0) && (
                                        <tr>
                                            <td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                                No transactions found
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}

