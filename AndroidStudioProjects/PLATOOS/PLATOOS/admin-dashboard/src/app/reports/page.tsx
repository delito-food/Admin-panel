'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Calendar,
    TrendingUp,
    Download,
    IndianRupee,
    ShoppingBag,
    Users,
    Store,
    ChevronDown,
    Star,
    Loader2,
    BarChart3,
    PieChartIcon,
    Clock,
    Award,
    Activity,
    ArrowRight
} from 'lucide-react';
import Link from 'next/link';
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
    LineChart,
    Line
} from 'recharts';
import { useApi, DashboardStats, Vendor, Order } from '@/hooks/useApi';

const dateRanges = ['Last 7 Days', 'Last 30 Days', 'Last 3 Months', 'This Year'];

const categoryColors: Record<string, string> = {
    'Pizza': '#288990',
    'Biryani': '#FF9904',
    'Chinese': '#F6D59F',
    'Burgers': '#E9190C',
    'Desserts': '#6366F1',
    'North Indian': '#10B981',
    'South Indian': '#F59E0B',
    'Italian': '#8B5CF6',
    'Others': '#9CA3AF',
};

const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: 'var(--shadow-md)',
    fontSize: '0.8125rem',
    padding: '10px 14px',
};

export default function ReportsPage() {
    const [selectedRange, setSelectedRange] = useState('Last 7 Days');
    const [showRangeDropdown, setShowRangeDropdown] = useState(false);

    const { data: dashboardData, loading: dashboardLoading } = useApi<DashboardStats>('/api/dashboard');
    const { data: vendors, loading: vendorsLoading } = useApi<Vendor[]>('/api/vendors');
    const { data: orders, loading: ordersLoading } = useApi<Order[]>('/api/orders');

    const loading = dashboardLoading || vendorsLoading || ordersLoading;

    // Helper: Get start date based on range
    const startDate = useMemo(() => {
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Start of today
        if (selectedRange === 'Last 7 Days') {
            const date = new Date(now);
            date.setDate(now.getDate() - 6); // Includes today
            return date;
        }
        if (selectedRange === 'Last 30 Days') {
            const date = new Date(now);
            date.setDate(now.getDate() - 29);
            return date;
        }
        if (selectedRange === 'Last 3 Months') {
            const date = new Date(now);
            date.setMonth(now.getMonth() - 2); // Current + prev 2 months
            date.setDate(1); // Start of month
            return date;
        }
        if (selectedRange === 'This Year') {
            return new Date(now.getFullYear(), 0, 1);
        }
        return new Date(0); // Fallback
    }, [selectedRange]);

    const filteredOrders = useMemo(() => {
        if (!orders) return [];
        return orders.filter(o => new Date(o.createdAt) >= startDate);
    }, [orders, startDate]);

    const stats = useMemo(() => {
        // Stats cards usually show "Total" (All Time) or "Today". 
        // We'll keep them as "All Time" overview for consistency with the labels, 
        // or we could filter them too. Given the labels "Total Revenue", "Total Orders", 
        // it implies All Time. Let's keep them as is from dashboardData for Global Overview.
        // If users want range-specific stats, we'd typically add a "Period Revenue" card.
        const totalRevenue = dashboardData?.stats?.totalRevenue || 0;
        const totalOrders = dashboardData?.stats?.totalOrders || 0;
        const totalCustomers = dashboardData?.stats?.totalCustomers || 0;
        const activeVendors = dashboardData?.vendors?.active || 0;

        const todayOrders = dashboardData?.stats?.todayOrders || 0;
        const todayRevenue = dashboardData?.stats?.todayRevenue || 0;

        return [
            { label: 'Total Revenue', value: `₹${totalRevenue.toLocaleString()}`, subtitle: todayRevenue > 0 ? `₹${todayRevenue.toLocaleString()} today` : 'No revenue today', icon: IndianRupee, iconBg: 'linear-gradient(135deg, #10B981, #059669)' },
            { label: 'Total Orders', value: totalOrders.toLocaleString(), subtitle: todayOrders > 0 ? `${todayOrders} today` : 'No orders today', icon: ShoppingBag, iconBg: 'linear-gradient(135deg, #288990, #1e6e75)' },
            { label: 'Active Customers', value: totalCustomers.toLocaleString(), subtitle: `${totalCustomers > 0 ? 'Registered users' : 'No customers yet'}`, icon: Users, iconBg: 'linear-gradient(135deg, #F59E0B, #D97706)' },
            { label: 'Active Vendors', value: activeVendors.toLocaleString(), subtitle: `${(vendors || []).length} total registered`, icon: Store, iconBg: 'linear-gradient(135deg, #EF4444, #DC2626)' },
        ];
    }, [dashboardData, vendors]);

    const topVendors = useMemo(() => {
        if (!vendors) return [];
        // Filtering top vendors by range is complex without order-vendor mapping for range.
        // We'll keep this as "All Time Top Vendors" for now.
        return [...vendors]
            .sort((a, b) => (b.totalEarnings || 0) - (a.totalEarnings || 0))
            .slice(0, 5)
            .map(v => ({ name: v.shopName, orders: v.totalOrders || 0, revenue: v.totalEarnings || 0, rating: v.rating || 0 }));
    }, [vendors]);

    const categoryData = useMemo(() => {
        if (!vendors) return [];
        // Supply-based distribution (All Time)
        const categoryCounts: Record<string, number> = {};
        vendors.forEach(v => {
            (v.menuItems || []).forEach(item => {
                const cat = item.categoryName || 'Others';
                categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
            });
            if (!(v.menuItems || []).length) {
                (v.cuisineTypes || []).forEach(c => { categoryCounts[c] = (categoryCounts[c] || 0) + 1; });
            }
        });
        const total = Object.values(categoryCounts).reduce((sum, c) => sum + c, 0);
        if (total === 0) return [];
        return Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
            .map(([name, count]) => ({ name, value: Math.round((count / total) * 100) || 1, color: categoryColors[name] || categoryColors['Others'] }));
    }, [vendors]);

    const revenueData = useMemo(() => {
        if (!filteredOrders) return [];

        // If range is daily (7 or 30 days), aggregate by day.
        // If range is monthly (3 Months, This Year), aggregate by month for smoother view?
        // Actually, "Last 3 Months" is better as weeks or months. 
        // Let's stick to Daily for 7/30 days, and Monthly for Year.
        const isDaily = selectedRange === 'Last 7 Days' || selectedRange === 'Last 30 Days';

        if (isDaily) {
            // Generate all dates in range
            const data: Record<string, { revenue: number; orders: number; dateObject: Date }> = {};
            const daysCount = selectedRange === 'Last 7 Days' ? 7 : 30;
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            for (let i = daysCount - 1; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(now.getDate() - i);
                const key = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); // "10 Feb"
                data[key] = { revenue: 0, orders: 0, dateObject: d };
            }

            filteredOrders.forEach(order => {
                const d = new Date(order.createdAt);
                d.setHours(0, 0, 0, 0);
                const key = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                if (data[key]) {
                    data[key].revenue += order.total || 0;
                    data[key].orders += 1;
                }
            });

            return Object.entries(data).map(([name, stats]) => ({ name, revenue: stats.revenue, orders: stats.orders }));
        } else {
            // Monthly view for longer ranges
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const data: Record<string, { revenue: number; orders: number }> = {};

            // Initialize months present in the range? 
            // For "This Year", init all months. For "Last 3 Months", init relevant.
            // Simplified: Just aggregate what we have, or init all months if "This Year".
            if (selectedRange === 'This Year') {
                months.forEach(m => data[m] = { revenue: 0, orders: 0 });
            }

            filteredOrders.forEach(order => {
                const d = new Date(order.createdAt);
                const m = months[d.getMonth()];
                if (!data[m]) data[m] = { revenue: 0, orders: 0 };
                data[m].revenue += order.total || 0;
                data[m].orders += 1;
            });

            // If "Last 3 Months", filter out empty months or sort them?
            // Better to just return sorted by date. But existing logic used month names array.
            if (selectedRange === 'This Year') {
                return months.map(name => ({ name, ...data[name] }));
            } else {
                // Sort by date found
                // (Simple fallback for Last 3 Months: group by Month Year)
                // Or stick to daily for 3 months? 90 points is a lot but area chart handles it.
                // Let's use Daily for 3 months too for better granularity if data is scarce.
                return months.map(name => ({ name, ...data[name] })).filter(d => d.orders > 0 || d.revenue > 0);
            }
        }
    }, [filteredOrders, selectedRange]);

    const monthlyData = useMemo(() => {
        // "Monthly Performance" chart usually implies Year View.
        // We can just reuse filteredOrders or keep it All Time Year?
        // Let's make it respect the filter if "This Year" is selected, otherwise it might be empty for "Last 7 Days".
        // Actually, if "Last 7 Days" is selected, Monthly Chart is useless.
        // We could hide it or switch it to "Daily Performance Bar Chart"?
        // For simplicity, let's just show aggregation of filteredOrders by month.
        if (!orders) return [];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthData: Record<string, { revenue: number; orders: number }> = {};
        months.forEach(m => { monthData[m] = { revenue: 0, orders: 0 }; });

        // Use all orders or filtered? Users expect reports to update.
        // If range is "Last 7 days", showing "Jan: 1000" (if 7 days are in Jan) is correct for that range.
        const sourceData = selectedRange === 'This Year' ? orders : filteredOrders;

        sourceData.forEach(order => {
            // Only count if within "This Year" if using all orders?
            // If source is filteredOrders, it's already filtered.
            const d = new Date(order.createdAt);
            // If selectedRange is "Last 7 Days" (e.g. Feb 10-17), it will populate Feb.
            if (selectedRange === 'This Year' && d.getFullYear() !== new Date().getFullYear()) return;

            const month = months[d.getMonth()];
            if (month) { monthData[month].orders += 1; monthData[month].revenue += order.total || 0; }
        });

        return months.map(month => ({ month, ...monthData[month] }));
    }, [orders, filteredOrders, selectedRange]);

    const deliveryMetrics = useMemo(() => {
        const hours = ['10AM', '12PM', '2PM', '4PM', '6PM', '8PM', '10PM'];
        if (!filteredOrders) return hours.map((time) => ({ time, avgDeliveryTime: 0, orders: 0 }));

        const hourData: Record<string, { totalTime: number; count: number }> = {};
        hours.forEach(h => { hourData[h] = { totalTime: 0, count: 0 }; });

        filteredOrders.forEach(order => {
            const hour = new Date(order.createdAt).getHours();
            const estTime = order.estimatedDeliveryTime || 30;
            let slot = '';
            if (hour >= 10 && hour < 12) slot = '10AM';
            else if (hour >= 12 && hour < 14) slot = '12PM';
            else if (hour >= 14 && hour < 16) slot = '2PM';
            else if (hour >= 16 && hour < 18) slot = '4PM';
            else if (hour >= 18 && hour < 20) slot = '6PM';
            else if (hour >= 20 && hour < 22) slot = '8PM';
            else if (hour >= 22) slot = '10PM';

            if (slot && hourData[slot]) {
                hourData[slot].totalTime += estTime;
                hourData[slot].count += 1;
            }
        });

        return hours.map((time) => ({
            time,
            avgDeliveryTime: hourData[time].count > 0 ? Math.round(hourData[time].totalTime / hourData[time].count) : 0,
            orders: hourData[time].count,
        }));
    }, [filteredOrders]);

    if (loading) {
        return (
            <div>
                <div style={{ marginBottom: 32 }}>
                    <h1 className="page-title">Reports & Analytics</h1>
                    <p className="page-description">Loading analytics...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px var(--primary-glow)' }}>
                            <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: 'white' }} />
                        </div>
                        <p style={{ fontSize: 14, color: 'var(--foreground-secondary)' }}>Crunching the numbers...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Page Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 40 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Activity size={20} style={{ color: 'white' }} />
                        </div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Reports & Analytics</h1>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--foreground-secondary)', marginLeft: 52, marginTop: 2 }}>Comprehensive platform performance insights</p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                    <Link href="/reports/gst" className="btn btn-outline" style={{ color: '#10B981', borderColor: '#10B981' }}>
                        <IndianRupee size={16} />
                        GST Report
                    </Link>
                    <Link href="/reports/advanced" className="btn btn-outline" style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}>
                        <BarChart3 size={16} />
                        Advanced Analytics
                        <ArrowRight size={16} />
                    </Link>
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setShowRangeDropdown(!showRangeDropdown)} className="btn btn-outline">
                            <Calendar size={16} />
                            {selectedRange}
                            <ChevronDown size={16} />
                        </button>
                        <AnimatePresence>
                            {showRangeDropdown && (
                                <motion.div initial={{ opacity: 0, y: -10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }} className="dropdown-menu right-0">
                                    {dateRanges.map(range => (
                                        <button key={range} onClick={() => { setSelectedRange(range); setShowRangeDropdown(false); }} className={`dropdown-item ${selectedRange === range ? 'active' : ''}`}>
                                            {range}
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <button className="btn btn-primary">
                        <Download size={16} />
                        Export
                    </button>
                </div>
            </div>

            {/* Stat Cards — using flex with explicit margins */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px 40px -12px' }}>
                {stats.map((stat, index) => (
                    <div key={stat.label} style={{ width: '25%', minWidth: 220, padding: '0 12px', marginBottom: 16, flex: '1 1 220px' }}>
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.08 }}
                            style={{
                                background: 'var(--glass-bg)',
                                backdropFilter: 'blur(16px)',
                                border: '1px solid var(--glass-border)',
                                borderRadius: 16,
                                padding: '24px 24px 20px',
                                position: 'relative',
                                overflow: 'hidden',
                                boxShadow: 'var(--shadow)',
                                transition: 'all 0.3s ease',
                            }}
                        >
                            {/* Top accent line */}
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: stat.iconBg, borderRadius: '16px 16px 0 0' }} />

                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                <div>
                                    <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 8 }}>{stat.label}</p>
                                    <p style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.2 }}>{stat.value}</p>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 10 }}>{stat.subtitle}</p>
                                </div>
                                <div style={{ width: 52, height: 52, borderRadius: 14, background: stat.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                    <stat.icon size={24} style={{ color: 'white' }} />
                                </div>
                            </div>
                        </motion.div>
                    </div>
                ))}
            </div>

            {/* Charts Row 1: Revenue Trend + Orders by Category */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px 40px -12px' }}>
                {/* Revenue Trend — 2/3 */}
                <div style={{ flex: '2 1 400px', padding: '0 12px', marginBottom: 16 }}>
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card" style={{ padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <BarChart3 size={18} style={{ color: 'white' }} />
                            </div>
                            <div>
                                <h3 style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '1rem', margin: 0 }}>Revenue Trend</h3>
                                <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Weekly revenue overview</p>
                            </div>
                        </div>
                        <div style={{ height: 320 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={revenueData}>
                                    <defs>
                                        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#288990" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#288990" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                                    <XAxis dataKey="name" stroke="var(--foreground-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="var(--foreground-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v / 1000}K`} />
                                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`₹${Number(v).toLocaleString()}`, 'Revenue']} />
                                    <Area type="monotone" dataKey="revenue" stroke="#288990" strokeWidth={2.5} fill="url(#revenueGrad)" dot={{ fill: '#288990', strokeWidth: 0, r: 3 }} activeDot={{ r: 5, fill: '#288990', stroke: 'white', strokeWidth: 2 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </motion.div>
                </div>

                {/* Orders by Category — 1/3 */}
                <div style={{ flex: '1 1 300px', padding: '0 12px', marginBottom: 16 }}>
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card" style={{ padding: 24, height: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #F59E0B, #D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <PieChartIcon size={18} style={{ color: 'white' }} />
                            </div>
                            <div>
                                <h3 style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '1rem', margin: 0 }}>Orders by Category</h3>
                                <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Cuisine distribution</p>
                            </div>
                        </div>
                        <div style={{ height: 220 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={categoryData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" strokeWidth={0}>
                                        {categoryData.map((entry, i) => (<Cell key={`c-${i}`} fill={entry.color} />))}
                                    </Pie>
                                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, 'Share']} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12, justifyContent: 'center' }}>
                            {categoryData.map(cat => (
                                <div key={cat.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, flexShrink: 0 }} />
                                    {cat.name}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Charts Row 2: Monthly Performance + Delivery Time */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px 40px -12px' }}>
                {/* Monthly Performance — wider */}
                <div style={{ flex: '3 1 400px', padding: '0 12px', marginBottom: 16 }}>
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card" style={{ padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #10B981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <TrendingUp size={18} style={{ color: 'white' }} />
                            </div>
                            <div>
                                <h3 style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '1rem', margin: 0 }}>Monthly Performance</h3>
                                <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Revenue and order volume by month</p>
                            </div>
                        </div>
                        <div style={{ height: 320 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthlyData} barGap={4}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                                    <XAxis dataKey="month" stroke="var(--foreground-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis yAxisId="left" stroke="var(--foreground-secondary)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v.toLocaleString()}`} />
                                    <YAxis yAxisId="right" orientation="right" stroke="var(--foreground-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip contentStyle={tooltipStyle} />
                                    <Legend wrapperStyle={{ paddingTop: 12, fontSize: 12 }} />
                                    <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#288990" radius={[6, 6, 0, 0]} />
                                    <Bar yAxisId="right" dataKey="orders" name="Orders" fill="#FF9904" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </motion.div>
                </div>

                {/* Delivery Time — narrower */}
                <div style={{ flex: '2 1 300px', padding: '0 12px', marginBottom: 16 }}>
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="glass-card" style={{ padding: 24, height: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #F59E0B, #D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Clock size={18} style={{ color: 'white' }} />
                            </div>
                            <div>
                                <h3 style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '1rem', margin: 0 }}>Delivery Time</h3>
                                <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Average delivery by hour</p>
                            </div>
                        </div>
                        <div style={{ height: 320 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={deliveryMetrics}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
                                    <XAxis dataKey="time" stroke="var(--foreground-secondary)" fontSize={11} tickLine={false} axisLine={false} />
                                    <YAxis stroke="var(--foreground-secondary)" fontSize={12} unit=" min" tickLine={false} axisLine={false} />
                                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} min`, 'Avg. Time']} />
                                    <Line type="monotone" dataKey="avgDeliveryTime" stroke="#FF9904" strokeWidth={2.5} dot={{ fill: '#FF9904', strokeWidth: 0, r: 3 }} activeDot={{ r: 5, fill: '#FF9904', stroke: 'white', strokeWidth: 2 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Top Vendors Table */}
            <div style={{ marginBottom: 40 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', boxShadow: 'var(--shadow-sm)' }}>
                            <Award size={18} />
                        </div>
                        <span style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--foreground)' }}>Top Performing Vendors</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 12px', background: 'var(--primary)', color: 'white', borderRadius: 9999 }}>{topVendors.length}</span>
                    </div>
                </div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="glass-card" style={{ overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium">
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Vendor</th>
                                    <th>Orders</th>
                                    <th>Revenue</th>
                                    <th>Rating</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topVendors.map((vendor, index) => (
                                    <tr key={vendor.name}>
                                        <td>
                                            <span style={{
                                                width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.875rem', fontWeight: 700,
                                                background: index === 0 ? 'linear-gradient(135deg, #FBBF24, #D97706)' : index === 1 ? 'linear-gradient(135deg, #D1D5DB, #6B7280)' : index === 2 ? 'linear-gradient(135deg, #FB923C, #EA580C)' : 'var(--surface-hover)',
                                                color: index < 3 ? 'white' : 'var(--foreground-secondary)',
                                            }}>
                                                {index + 1}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Store size={18} style={{ color: 'white' }} />
                                                </div>
                                                <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{vendor.name}</span>
                                            </div>
                                        </td>
                                        <td style={{ fontWeight: 600 }}>{vendor.orders}</td>
                                        <td style={{ fontWeight: 600, color: 'var(--accent-success)' }}>₹{(vendor.revenue || 0).toLocaleString()}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Star size={16} style={{ color: 'var(--accent-warning)', fill: 'var(--accent-warning)' }} />
                                                <span style={{ fontWeight: 600 }}>{(vendor.rating || 0).toFixed(1)}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {topVendors.length === 0 && (
                        <div className="empty-state">
                            <div className="empty-state-icon">
                                <Store size={32} />
                            </div>
                            <p style={{ fontSize: '1.125rem', fontWeight: 500, color: 'var(--foreground)' }}>No vendor data available</p>
                            <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Check back when vendors start processing orders</p>
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
}
