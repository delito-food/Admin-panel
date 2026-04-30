'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AnalyticsData {
    platformEarnings: {
        total: number;
        today: number;
        thisWeek: number;
        thisMonth: number;
        fromCommissions: number;
        fromDeliveryFees: number;
    };
    orders: {
        total: number;
        today: number;
        thisWeek: number;
        thisMonth: number;
        pending: number;
        completed: number;
        cancelled: number;
        averageOrderValue: number;
    };
    vendors: {
        total: number;
        verified: number;
        suspended: number;
        online: number;
        topPerformers: Array<{
            vendorId: string;
            shopName: string;
            totalOrders: number;
            totalRevenue: number;
            rating: number;
        }>;
    };
    deliveryPartners: {
        total: number;
        verified: number;
        suspended: number;
        online: number;
        topPerformers: Array<{
            deliveryPersonId: string;
            fullName: string;
            totalDeliveries: number;
            rating: number;
        }>;
    };
    customers: {
        total: number;
        newThisMonth: number;
        activeThisMonth: number;
    };
    revenueByDay: Array<{
        date: string;
        revenue: number;
        orders: number;
        platformEarnings: number;
    }>;
}

export default function AnalyticsPage() {
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchAnalytics = async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/analytics');
            const result = await response.json();
            if (result.success) {
                setAnalytics(result.data);
            } else {
                setError(result.error || 'Failed to fetch analytics');
            }
        } catch (err) {
            setError('Failed to fetch analytics');
            console.error('Analytics fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            const response = await fetch('/api/analytics');
            const result = await response.json();
            if (result.success) {
                setAnalytics(result.data);
            }
        } catch (err) {
            console.error('Analytics refresh error:', err);
        } finally {
            setRefreshing(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 1,
        }).format(amount);
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading analytics...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center text-red-500">
                    <p>{error}</p>
                    <button
                        onClick={fetchAnalytics}
                        className="mt-4 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!analytics) return null;

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Platform Analytics</h1>
                        <p className="text-gray-600 mt-1">Comprehensive business insights</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-60 transition-all"
                        >
                            <svg
                                className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                            </svg>
                            {refreshing ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <Link href="/" className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                            ← Back to Dashboard
                        </Link>
                    </div>
                </div>

                {/* Platform Earnings - Hero Section */}
                <div className="bg-gradient-to-r from-green-600 to-green-500 rounded-2xl p-8 mb-8 text-white shadow-lg">
                    <h2 className="text-xl font-semibold opacity-90 mb-4">💰 Platform Earnings</h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div>
                            <p className="text-green-100 text-sm">Total Earnings</p>
                            <p className="text-4xl font-bold">{formatCurrency(analytics.platformEarnings.total)}</p>
                        </div>
                        <div>
                            <p className="text-green-100 text-sm">Today</p>
                            <p className="text-2xl font-bold">{formatCurrency(analytics.platformEarnings.today)}</p>
                        </div>
                        <div>
                            <p className="text-green-100 text-sm">This Week</p>
                            <p className="text-2xl font-bold">{formatCurrency(analytics.platformEarnings.thisWeek)}</p>
                        </div>
                        <div>
                            <p className="text-green-100 text-sm">This Month</p>
                            <p className="text-2xl font-bold">{formatCurrency(analytics.platformEarnings.thisMonth)}</p>
                        </div>
                    </div>
                    <div className="mt-6 pt-6 border-t border-green-400 grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-green-100 text-sm">From Order Commissions (5%)</p>
                            <p className="text-xl font-semibold">{formatCurrency(analytics.platformEarnings.fromCommissions)}</p>
                        </div>
                        <div>
                            <p className="text-green-100 text-sm">From Delivery Fees (20%)</p>
                            <p className="text-xl font-semibold">{formatCurrency(analytics.platformEarnings.fromDeliveryFees)}</p>
                        </div>
                    </div>
                </div>

                {/* Orders Stats */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">📦 Orders Overview</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-blue-50 rounded-lg">
                                <p className="text-blue-600 text-sm">Total Orders</p>
                                <p className="text-3xl font-bold text-blue-700">{analytics.orders.total}</p>
                            </div>
                            <div className="p-4 bg-green-50 rounded-lg">
                                <p className="text-green-600 text-sm">Completed</p>
                                <p className="text-3xl font-bold text-green-700">{analytics.orders.completed}</p>
                            </div>
                            <div className="p-4 bg-yellow-50 rounded-lg">
                                <p className="text-yellow-600 text-sm">Pending</p>
                                <p className="text-3xl font-bold text-yellow-700">{analytics.orders.pending}</p>
                            </div>
                            <div className="p-4 bg-red-50 rounded-lg">
                                <p className="text-red-600 text-sm">Cancelled</p>
                                <p className="text-3xl font-bold text-red-700">{analytics.orders.cancelled}</p>
                            </div>
                        </div>
                        <div className="mt-4 pt-4 border-t">
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Average Order Value</span>
                                <span className="font-semibold">{formatCurrency(analytics.orders.averageOrderValue)}</span>
                            </div>
                            <div className="flex justify-between text-sm mt-2">
                                <span className="text-gray-600">Today&apos;s Orders</span>
                                <span className="font-semibold">{analytics.orders.today}</span>
                            </div>
                            <div className="flex justify-between text-sm mt-2">
                                <span className="text-gray-600">This Week</span>
                                <span className="font-semibold">{analytics.orders.thisWeek}</span>
                            </div>
                        </div>
                    </div>

                    {/* Customers Stats */}
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">👥 Customers</h2>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-center p-4 bg-purple-50 rounded-lg">
                                <p className="text-4xl font-bold text-purple-700">{analytics.customers.total}</p>
                                <p className="text-purple-600 text-sm mt-1">Total Users</p>
                            </div>
                            <div className="text-center p-4 bg-indigo-50 rounded-lg">
                                <p className="text-4xl font-bold text-indigo-700">{analytics.customers.newThisMonth}</p>
                                <p className="text-indigo-600 text-sm mt-1">New This Month</p>
                            </div>
                            <div className="text-center p-4 bg-pink-50 rounded-lg">
                                <p className="text-4xl font-bold text-pink-700">{analytics.customers.activeThisMonth}</p>
                                <p className="text-pink-600 text-sm mt-1">Active This Month</p>
                            </div>
                        </div>
                        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600">Customer Retention Rate</p>
                            <div className="flex items-center mt-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-3">
                                    <div
                                        className="bg-purple-500 h-3 rounded-full"
                                        style={{
                                            width: `${analytics.customers.total > 0
                                                ? Math.min((analytics.customers.activeThisMonth / analytics.customers.total) * 100, 100)
                                                : 0}%`
                                        }}
                                    ></div>
                                </div>
                                <span className="ml-3 font-semibold">
                                    {analytics.customers.total > 0
                                        ? Math.round((analytics.customers.activeThisMonth / analytics.customers.total) * 100)
                                        : 0}%
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Vendors & Delivery Partners */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    {/* Vendors */}
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-gray-900">🏪 Vendors</h2>
                            <Link href="/users?tab=vendors" className="text-orange-500 text-sm hover:underline">
                                View All →
                            </Link>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mb-4">
                            <div className="text-center p-3 bg-gray-50 rounded-lg">
                                <p className="text-2xl font-bold text-gray-700">{analytics.vendors.total}</p>
                                <p className="text-xs text-gray-500">Total</p>
                            </div>
                            <div className="text-center p-3 bg-green-50 rounded-lg">
                                <p className="text-2xl font-bold text-green-700">{analytics.vendors.verified}</p>
                                <p className="text-xs text-green-600">Verified</p>
                            </div>
                            <div className="text-center p-3 bg-blue-50 rounded-lg">
                                <p className="text-2xl font-bold text-blue-700">{analytics.vendors.online}</p>
                                <p className="text-xs text-blue-600">Online</p>
                            </div>
                            <div className="text-center p-3 bg-red-50 rounded-lg">
                                <p className="text-2xl font-bold text-red-700">{analytics.vendors.suspended}</p>
                                <p className="text-xs text-red-600">Suspended</p>
                            </div>
                        </div>
                        <h3 className="text-sm font-semibold text-gray-600 mb-2">Top Performers</h3>
                        <div className="space-y-2">
                            {analytics.vendors.topPerformers.map((vendor, index) => (
                                <div key={vendor.vendorId} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                                    <div className="flex items-center">
                                        <span className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold mr-2">
                                            {index + 1}
                                        </span>
                                        <span className="font-medium text-sm">{vendor.shopName}</span>
                                    </div>
                                    <div className="text-right text-xs">
                                        <p className="text-gray-600">{vendor.totalOrders} orders</p>
                                        <p className="text-green-600">{formatCurrency(vendor.totalRevenue)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Delivery Partners */}
                    <div className="bg-white rounded-xl shadow-sm p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-gray-900">🚴 Delivery Partners</h2>
                            <Link href="/users?tab=delivery" className="text-orange-500 text-sm hover:underline">
                                View All →
                            </Link>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mb-4">
                            <div className="text-center p-3 bg-gray-50 rounded-lg">
                                <p className="text-2xl font-bold text-gray-700">{analytics.deliveryPartners.total}</p>
                                <p className="text-xs text-gray-500">Total</p>
                            </div>
                            <div className="text-center p-3 bg-green-50 rounded-lg">
                                <p className="text-2xl font-bold text-green-700">{analytics.deliveryPartners.verified}</p>
                                <p className="text-xs text-green-600">Verified</p>
                            </div>
                            <div className="text-center p-3 bg-blue-50 rounded-lg">
                                <p className="text-2xl font-bold text-blue-700">{analytics.deliveryPartners.online}</p>
                                <p className="text-xs text-blue-600">Online</p>
                            </div>
                            <div className="text-center p-3 bg-red-50 rounded-lg">
                                <p className="text-2xl font-bold text-red-700">{analytics.deliveryPartners.suspended}</p>
                                <p className="text-xs text-red-600">Suspended</p>
                            </div>
                        </div>
                        <h3 className="text-sm font-semibold text-gray-600 mb-2">Top Performers</h3>
                        <div className="space-y-2">
                            {analytics.deliveryPartners.topPerformers.map((dp, index) => (
                                <div key={dp.deliveryPersonId} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                                    <div className="flex items-center">
                                        <span className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold mr-2">
                                            {index + 1}
                                        </span>
                                        <span className="font-medium text-sm">{dp.fullName}</span>
                                    </div>
                                    <div className="text-right text-xs">
                                        <p className="text-gray-600">{dp.totalDeliveries} deliveries</p>
                                        <p className="text-yellow-600">★ {dp.rating.toFixed(1)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Revenue Chart (Simple Table View) */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">📈 Revenue Trend (Last 30 Days)</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2 px-3">Date</th>
                                    <th className="text-right py-2 px-3">Orders</th>
                                    <th className="text-right py-2 px-3">Revenue</th>
                                    <th className="text-right py-2 px-3">Platform Earnings</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analytics.revenueByDay.slice(-14).reverse().map((day) => (
                                    <tr key={day.date} className="border-b hover:bg-gray-50">
                                        <td className="py-2 px-3">{new Date(day.date).toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                                        <td className="text-right py-2 px-3 font-medium">{day.orders}</td>
                                        <td className="text-right py-2 px-3">{formatCurrency(day.revenue)}</td>
                                        <td className="text-right py-2 px-3 text-green-600 font-medium">{formatCurrency(day.platformEarnings)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

