'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Store,
  Bike,
  Users,
  ShoppingBag,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Loader2,
  DollarSign,
  Wallet,
  IndianRupee,
  Package,
  CheckCircle2,
  Clock,
  XCircle,
  Star,
  UserPlus,
  Activity,
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { useApi, DashboardStats, Order } from '@/hooks/useApi';

// Loading Skeleton
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      <div className="h-8 w-48 bg-[var(--border)] rounded" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-32 bg-[var(--border)] rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-[var(--border)] rounded-xl" />
    </div>
  );
}

// Compact Stat Card
function StatCard({
  title,
  value,
  subValue,
  icon: Icon,
  color = 'primary'
}: {
  title: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'blue';
}) {
  const colorMap = {
    primary: { bg: 'rgba(40, 137, 144, 0.15)', text: '#288990' },
    success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
    warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
    error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
    blue: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3B82F6' }
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
          <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginBottom: 4 }}>{title}</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
          {subValue && (
            <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{subValue}</p>
          )}
        </div>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: colorMap[color].bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Icon size={20} color={colorMap[color].text} />
        </div>
      </div>
    </motion.div>
  );
}

// Earnings Card (larger)
function EarningsCard({
  title,
  earnings,
  subtitle
}: {
  title: string;
  earnings: { platformEarnings: number; commission: number; gst: number; deliveryFees: number; orderCount: number };
  subtitle: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card"
      style={{ padding: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #10B981, #059669)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Wallet size={16} color="white" />
        </div>
        <div>
          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)' }}>{title}</p>
          <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>{subtitle}</p>
        </div>
      </div>
      
      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#10B981', marginBottom: 12 }}>
        ₹{earnings.platformEarnings.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--glass-border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
          <span style={{ color: 'var(--foreground-secondary)' }}>Commission (15%)</span>
          <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>₹{earnings.commission.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
          <span style={{ color: 'var(--foreground-secondary)' }}>GST (18%)</span>
          <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>₹{earnings.gst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
          <span style={{ color: 'var(--foreground-secondary)' }}>Delivery Fees</span>
          <span style={{ color: 'var(--foreground-secondary)' }}>₹{earnings.deliveryFees.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (to partners)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginTop: 4, paddingTop: 6, borderTop: '1px dashed var(--glass-border)' }}>
          <span style={{ color: 'var(--foreground-secondary)' }}>Orders</span>
          <span style={{ color: 'var(--foreground)', fontWeight: 600 }}>{earnings.orderCount}</span>
        </div>
      </div>
    </motion.div>
  );
}

// Top Performers Card
function TopPerformersCard({
  title,
  performers,
  icon: Icon,
  color,
  href
}: {
  title: string;
  performers: Array<{ id: string; name: string; totalOrders: number; revenue: number; rating: number }>;
  icon: React.ElementType;
  color: string;
  href: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card"
      style={{ padding: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Icon size={14} color="white" />
          </div>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>{title}</span>
        </div>
        <Link href={href} style={{ fontSize: '0.7rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
          View All <ArrowRight size={12} />
        </Link>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {performers.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', textAlign: 'center', padding: '16px 0' }}>No data available</p>
        ) : (
          performers.slice(0, 5).map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 4 ? '1px solid var(--glass-border)' : 'none' }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--surface-hover)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 600,
                color: i < 3 ? '#000' : 'var(--foreground)'
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>{p.totalOrders} orders</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground)' }}>₹{(p.revenue / 1000).toFixed(1)}k</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Star size={10} color="#F59E0B" fill="#F59E0B" />
                  <span style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>{p.rating.toFixed(1)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}

// Recent Order Row
function RecentOrderRow({
  id,
  customer,
  vendor,
  amount,
  status,
  time
}: {
  id: string;
  customer: string;
  vendor: string;
  amount: string;
  status: string;
  time: string;
}) {
  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'delivered':
        return 'badge-approved';
      case 'preparing':
        return 'badge-pending';
      case 'cancelled':
        return 'badge-rejected';
      default:
        return 'badge-active';
    }
  };

  return (
    <tr>
      <td>
        <span className="font-semibold text-[var(--primary)]">#{id.slice(-6)}</span>
      </td>
      <td>{customer}</td>
      <td>{vendor}</td>
      <td className="font-medium">{amount}</td>
      <td>
        <span className={`badge ${getStatusBadge(status)}`}>{status}</span>
      </td>
      <td className="text-[var(--foreground-secondary)]">{time}</td>
    </tr>
  );
}

// Format time ago
function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export default function DashboardPage() {
  const { data: dashboardData, loading: dashboardLoading, refetch: refetchDashboard } = useApi<DashboardStats>('/api/dashboard');
  const { data: recentOrders, loading: ordersLoading, refetch: refetchOrders } = useApi<Order[]>('/api/orders?limit=100');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchDashboard(), refetchOrders()]);
    setRefreshing(false);
  };

  // Default empty earnings data
  const emptyEarnings = { platformEarnings: 0, commission: 0, gst: 0, deliveryFees: 0, totalRevenue: 0, orderCount: 0 };

  // Extract data from API response
  const platformEarnings = dashboardData?.platformEarnings || { today: emptyEarnings, thisWeek: emptyEarnings, thisMonth: emptyEarnings, allTime: emptyEarnings };
  const ordersOverview = dashboardData?.ordersOverview || { total: 0, completed: 0, pending: 0, cancelled: 0, avgOrderValue: 0 };
  const vendorStats = dashboardData?.vendorStats || { total: 0, verified: 0, suspended: 0, online: 0, topPerformers: [] };
  const deliveryStats = dashboardData?.deliveryStats || { total: 0, verified: 0, suspended: 0, online: 0, topPerformers: [] };
  const customerMetrics = dashboardData?.customerMetrics || { total: 0, newThisMonth: 0, activeThisMonth: 0, retentionRate: 0 };
  const revenueTrend = dashboardData?.revenueTrend || [];
  const pendingVerifications = dashboardData?.verification || { pendingVendors: 0, pendingDeliveryPersons: 0 };

  // Chart data for last 30 days revenue
  const chartData = useMemo(() => {
    if (!revenueTrend || revenueTrend.length === 0) return [];
    return revenueTrend.map((d: { date: string; revenue: number; orders: number; platformEarnings: number }) => ({
      date: new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      revenue: d.revenue,
      orders: d.orders,
      earnings: d.platformEarnings
    }));
  }, [revenueTrend]);

  if (dashboardLoading) {
    return <LoadingSkeleton />;
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
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Platform analytics and performance overview</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 10,
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.6 : 1,
              fontWeight: 500,
              fontSize: '0.875rem',
              transition: 'all 0.2s'
            }}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {pendingVerifications.pendingVendors > 0 && (
            <Link href="/verification/vendors">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.15)', color: '#D97706', fontSize: '0.75rem', fontWeight: 600 }}>
                <Store size={14} /> {pendingVerifications.pendingVendors} Vendors Pending
              </span>
            </Link>
          )}
          {pendingVerifications.pendingDeliveryPersons > 0 && (
            <Link href="/verification/delivery">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(59,130,246,0.15)', color: '#3B82F6', fontSize: '0.75rem', fontWeight: 600 }}>
                <Bike size={14} /> {pendingVerifications.pendingDeliveryPersons} Delivery Pending
              </span>
            </Link>
          )}
        </div>
      </div>

      {/* Platform Earnings Section */}
      <div>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <IndianRupee size={18} /> Platform Earnings
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <EarningsCard title="Today" earnings={platformEarnings.today} subtitle="Last 24 hours" />
          <EarningsCard title="This Week" earnings={platformEarnings.thisWeek} subtitle="Last 7 days" />
          <EarningsCard title="This Month" earnings={platformEarnings.thisMonth} subtitle="Last 30 days" />
          <EarningsCard title="All Time" earnings={platformEarnings.allTime} subtitle="Total platform earnings" />
        </div>
      </div>

      {/* Orders Overview */}
      <div>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Package size={18} /> Orders Overview
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard title="Total Orders" value={ordersOverview.total.toLocaleString()} icon={ShoppingBag} color="primary" />
          <StatCard title="Completed" value={ordersOverview.completed.toLocaleString()} subValue={`${ordersOverview.total > 0 ? ((ordersOverview.completed / ordersOverview.total) * 100).toFixed(1) : 0}%`} icon={CheckCircle2} color="success" />
          <StatCard title="Pending" value={ordersOverview.pending.toLocaleString()} icon={Clock} color="warning" />
          <StatCard title="Cancelled" value={ordersOverview.cancelled.toLocaleString()} subValue={`${ordersOverview.total > 0 ? ((ordersOverview.cancelled / ordersOverview.total) * 100).toFixed(1) : 0}%`} icon={XCircle} color="error" />
          <StatCard title="Avg. Order Value" value={`₹${ordersOverview.avgOrderValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} icon={DollarSign} color="blue" />
        </div>
      </div>

      {/* Revenue Trend Chart */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={18} /> 30-Day Revenue Trend
          </h3>
          <div style={{ display: 'flex', gap: 12, fontSize: '0.7rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#288990' }} />
              <span style={{ color: 'var(--foreground-secondary)' }}>Revenue</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: '#10B981' }} />
              <span style={{ color: 'var(--foreground-secondary)' }}>Platform Earnings</span>
            </div>
          </div>
        </div>
        <div style={{ height: 280 }}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#288990" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#288990" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--foreground-secondary)', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--foreground-secondary)', fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: 'var(--shadow-md)' }}
                  formatter={(value, name) => [`₹${Number(value).toLocaleString('en-IN')}`, name === 'revenue' ? 'Revenue' : name === 'earnings' ? 'Platform Earnings' : String(name)]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Area type="monotone" dataKey="revenue" stroke="#288990" strokeWidth={2} fill="url(#revenueGradient)" />
                <Area type="monotone" dataKey="earnings" stroke="#10B981" strokeWidth={2} fill="url(#earningsGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--foreground-secondary)' }}>
              No revenue data available
            </div>
          )}
        </div>
      </motion.div>

      {/* Stats Grid: Vendors, Delivery, Customers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Vendor Stats */}
        <div className="glass-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #F59E0B, #D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Store size={16} color="white" />
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground)' }}>Vendor Statistics</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Total</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--foreground)' }}>{vendorStats.total}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Verified</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10B981' }}>{vendorStats.verified}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Online Now</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#3B82F6' }}>{vendorStats.online}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Suspended</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#EF4444' }}>{vendorStats.suspended}</p>
            </div>
          </div>
        </div>

        {/* Delivery Stats */}
        <div className="glass-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #3B82F6, #2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bike size={16} color="white" />
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground)' }}>Delivery Partner Stats</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Total</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--foreground)' }}>{deliveryStats.total}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Verified</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10B981' }}>{deliveryStats.verified}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Online Now</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#3B82F6' }}>{deliveryStats.online}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Suspended</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#EF4444' }}>{deliveryStats.suspended}</p>
            </div>
          </div>
        </div>

        {/* Customer Metrics */}
        <div className="glass-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={16} color="white" />
            </div>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground)' }}>Customer Metrics</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Total Customers</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--foreground)' }}>{customerMetrics.total.toLocaleString()}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>New This Month</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10B981' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <UserPlus size={16} /> {customerMetrics.newThisMonth}
                </span>
              </p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Active This Month</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#3B82F6' }}>{customerMetrics.activeThisMonth}</p>
            </div>
            <div style={{ padding: 12, background: 'var(--surface-hover)', borderRadius: 8 }}>
              <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)' }}>Retention Rate</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F59E0B' }}>{customerMetrics.retentionRate.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Top Performers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <TopPerformersCard
          title="Top Vendors"
          performers={vendorStats.topPerformers}
          icon={Store}
          color="linear-gradient(135deg, #F59E0B, #D97706)"
          href="/users/vendors"
        />
        <TopPerformersCard
          title="Top Delivery Partners"
          performers={deliveryStats.topPerformers}
          icon={Bike}
          color="linear-gradient(135deg, #3B82F6, #2563EB)"
          href="/users/delivery"
        />
      </div>

      {/* Recent Orders Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShoppingBag size={16} style={{ color: 'white' }} />
            </div>
            <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>Recent Orders</span>
          </div>
          <Link href="/orders" className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.75rem' }}>
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table-premium">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {ordersLoading ? (
                <tr><td colSpan={6} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--primary)] mx-auto" /></td></tr>
              ) : recentOrders && recentOrders.length > 0 ? (
                recentOrders.slice(0, 8).map((order) => (
                  <RecentOrderRow key={order.orderId} id={order.orderId} customer={order.customerName} vendor={order.vendorName} amount={`₹${order.total.toLocaleString()}`} status={order.status} time={formatTimeAgo(order.createdAt)} />
                ))
              ) : (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--foreground-secondary)]">No orders found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}
