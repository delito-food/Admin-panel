'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    FileText,
    Download,
    Eye,
    X,
    RefreshCw,
    Calendar,
    Store,
    Filter,
    Loader2,
    IndianRupee,
    TrendingUp,
    Percent,
    Receipt,
    ChevronLeft,
    ChevronRight,
    ArrowUpDown,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client';

interface VendorCommissionSummary {
    vendorId: string;
    shopName: string;
    shopImageUrl: string;
    city: string;
    gstin: string;
    fssaiLicense: string;
    isVerified: boolean;
    commissionRate: number;
    orderCount: number;
    grossSales: number;
    commission: number;
    gstOnCommission: number;
    totalDeduction: number;
    netPayout: number;
}

interface CommissionSummaryData {
    month: string;
    platformDefaultRate: number;
    vendors: VendorCommissionSummary[];
    totals: {
        vendors: number;
        orders: number;
        grossSales: number;
        commission: number;
        gstOnCommission: number;
        totalDeduction: number;
        netPayout: number;
    };
}

interface PreviewData {
    platform: { name: string; gstin: string; fssaiLicense: string; address: string; email: string; website: string };
    vendor: { name: string; gstin: string; fssaiLicense: string; address: string; state: string };
    invoiceNumber: string;
    invoiceDate: string;
    billingPeriod: string;
    commissionRate: number;
    weeklyBreakdown: Array<{
        weekLabel: string; orders: number; grossSales: number; commission: number;
        gstOnCommission: number; totalDeduction: number; netPayout: number;
    }>;
    monthlyTotals: {
        orders: number; grossSales: number; commission: number;
        gstOnCommission: number; totalDeduction: number; netPayout: number;
    };
    gstBreakup: {
        igstRate: number; igstAmount: number; cgstRate: number; cgstAmount: number;
        sgstRate: number; sgstAmount: number; totalGst: number; totalCommissionPlusGst: number;
    };
}

const fmtC = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CommissionInvoicesPage() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [data, setData] = useState<CommissionSummaryData | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [previewVendor, setPreviewVendor] = useState<VendorCommissionSummary | null>(null);
    const [previewData, setPreviewData] = useState<PreviewData | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [sortField, setSortField] = useState<'grossSales' | 'commission' | 'orders'>('grossSales');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const fetchData = async (month: string) => {
        setLoading(true);
        try {
            const res = await authenticatedFetch('/api/vendors/commission-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ month }),
            });
            const result = await res.json();
            if (result.success) {
                setData(result.data);
            }
        } catch (err) {
            console.error('Failed to fetch commission data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(selectedMonth);
    }, [selectedMonth]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchData(selectedMonth);
        setRefreshing(false);
    };

    const handleMonthChange = (delta: number) => {
        const [y, m] = selectedMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    };

    const handleQuickMonth = (offset: number) => {
        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    };

    // Download PDF
    const handleDownload = async (vendorId: string, shopName: string) => {
        setDownloadingId(vendorId);
        try {
            const res = await authenticatedFetch(
                `/api/vendors/commission-invoice?vendorId=${vendorId}&month=${selectedMonth}&format=pdf`
            );
            if (!res.ok) {
                const err = await res.json();
                alert(err.error || 'Failed to generate invoice');
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const slug = shopName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
            a.download = `Commission-Invoice-${slug}-${selectedMonth}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch {
            alert('Failed to download invoice. Please try again.');
        } finally {
            setDownloadingId(null);
        }
    };

    // Preview
    const handlePreview = async (vendor: VendorCommissionSummary) => {
        setPreviewVendor(vendor);
        setPreviewLoading(true);
        try {
            const res = await authenticatedFetch(
                `/api/vendors/commission-invoice?vendorId=${vendor.vendorId}&month=${selectedMonth}&format=json`
            );
            const result = await res.json();
            if (result.success) {
                setPreviewData(result.data);
            }
        } catch {
            // Silent
        } finally {
            setPreviewLoading(false);
        }
    };

    // Sorting
    const handleSort = (field: typeof sortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('desc');
        }
    };

    // Filter & Sort vendors
    const filteredVendors = useMemo(() => {
        if (!data?.vendors) return [];
        let list = [...data.vendors];

        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            list = list.filter(v =>
                v.shopName.toLowerCase().includes(q) ||
                v.city.toLowerCase().includes(q) ||
                v.vendorId.toLowerCase().includes(q)
            );
        }

        list.sort((a, b) => {
            const mul = sortDir === 'asc' ? 1 : -1;
            if (sortField === 'orders') return (a.orderCount - b.orderCount) * mul;
            return ((a[sortField] as number) - (b[sortField] as number)) * mul;
        });

        return list;
    }, [data, searchTerm, sortField, sortDir]);

    const monthLabel = (() => {
        const [y, m] = selectedMonth.split('-').map(Number);
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        return `${months[m - 1]} ${y}`;
    })();

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}
        >
            {/* ─── Header ─── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Receipt size={28} style={{ color: '#2E7D32' }} />
                        Commission Invoices
                    </h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                        Generate &amp; download commission tax invoices for vendors
                    </p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                        borderRadius: 10, background: '#2E7D32', color: 'white', border: 'none',
                        cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1,
                        fontWeight: 500, fontSize: '0.875rem',
                    }}
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* ─── Month Selector ─── */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar size={18} style={{ color: '#2E7D32' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)' }}>Billing Period:</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                            onClick={() => handleMonthChange(-1)}
                            style={{
                                width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
                                background: 'var(--surface)', cursor: 'pointer', display: 'flex',
                                alignItems: 'center', justifyContent: 'center', color: 'var(--foreground)',
                            }}
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <div style={{
                            padding: '6px 16px', borderRadius: 8, background: '#E8F5E9',
                            fontWeight: 700, fontSize: '0.95rem', color: '#2E7D32',
                            minWidth: 160, textAlign: 'center',
                        }}>
                            {monthLabel}
                        </div>
                        <button
                            onClick={() => handleMonthChange(1)}
                            style={{
                                width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
                                background: 'var(--surface)', cursor: 'pointer', display: 'flex',
                                alignItems: 'center', justifyContent: 'center', color: 'var(--foreground)',
                            }}
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            onClick={() => handleQuickMonth(0)}
                            style={{
                                padding: '5px 12px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
                                background: selectedMonth === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` ? '#2E7D32' : 'var(--surface)',
                                color: selectedMonth === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` ? 'white' : 'var(--foreground)',
                                border: '1px solid var(--border)', cursor: 'pointer',
                            }}
                        >
                            This Month
                        </button>
                        <button
                            onClick={() => handleQuickMonth(-1)}
                            style={{
                                padding: '5px 12px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
                                background: (() => {
                                    const d = new Date(); d.setMonth(d.getMonth() - 1);
                                    return selectedMonth === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                                })() ? '#2E7D32' : 'var(--surface)',
                                color: (() => {
                                    const d = new Date(); d.setMonth(d.getMonth() - 1);
                                    return selectedMonth === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                                })() ? 'white' : 'var(--foreground)',
                                border: '1px solid var(--border)', cursor: 'pointer',
                            }}
                        >
                            Last Month
                        </button>
                    </div>
                </div>
            </motion.div>

            {/* ─── Summary Stats ─── */}
            {data && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    {[
                        { label: 'Vendors', value: data.totals.vendors, icon: <Store size={18} />, color: '#2E7D32', isCurrency: false },
                        { label: 'Total Orders', value: data.totals.orders, icon: <Receipt size={18} />, color: '#4CAF50', isCurrency: false },
                        { label: 'Gross Sales', value: data.totals.grossSales, icon: <TrendingUp size={18} />, color: '#1B5E20', isCurrency: true },
                        { label: 'Commission', value: data.totals.commission, icon: <Percent size={18} />, color: '#E65100', isCurrency: true },
                        { label: 'GST Collected', value: data.totals.gstOnCommission, icon: <IndianRupee size={18} />, color: '#7B1FA2', isCurrency: true },
                        { label: 'Net Payouts', value: data.totals.netPayout, icon: <IndianRupee size={18} />, color: '#2E7D32', isCurrency: true },
                    ].map((stat, i) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="glass-card"
                            style={{ padding: 16 }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 8,
                                    background: `${stat.color}15`, display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', color: stat.color,
                                }}>
                                    {stat.icon}
                                </div>
                                <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{stat.label}</span>
                            </div>
                            <p style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>
                                {stat.isCurrency ? fmtC(stat.value) : stat.value.toLocaleString('en-IN')}
                            </p>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* ─── Vendors Table ─── */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                {/* Search bar */}
                <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 400 }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search vendors..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{
                                width: '100%', padding: '8px 12px 8px 36px', borderRadius: 10,
                                border: '1px solid var(--border)', background: 'var(--surface)',
                                color: 'var(--foreground)', fontSize: '0.8rem', outline: 'none',
                            }}
                        />
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                        {filteredVendors.length} vendor{filteredVendors.length !== 1 ? 's' : ''} with orders
                    </div>
                </div>

                {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0' }}>
                        <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#2E7D32' }} />
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table-premium">
                            <thead>
                                <tr>
                                    <th>Vendor</th>
                                    <th style={{ textAlign: 'center' }}>Rate</th>
                                    <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => handleSort('orders')}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            Orders <ArrowUpDown size={12} />
                                        </span>
                                    </th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('grossSales')}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            Gross Sales <ArrowUpDown size={12} />
                                        </span>
                                    </th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('commission')}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            Commission <ArrowUpDown size={12} />
                                        </span>
                                    </th>
                                    <th style={{ textAlign: 'right' }}>GST (18%)</th>
                                    <th style={{ textAlign: 'right' }}>Net Payout</th>
                                    <th style={{ textAlign: 'center' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredVendors.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                            No vendors with orders found for {monthLabel}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredVendors.map(v => (
                                        <tr key={v.vendorId}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <div style={{
                                                        width: 36, height: 36, borderRadius: 8,
                                                        background: 'rgba(46,125,50,0.1)', display: 'flex',
                                                        alignItems: 'center', justifyContent: 'center',
                                                        overflow: 'hidden', flexShrink: 0,
                                                    }}>
                                                        {v.shopImageUrl ? (
                                                            <img src={v.shopImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        ) : (
                                                            <Store size={16} color="#2E7D32" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>{v.shopName}</p>
                                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', margin: 0 }}>{v.city}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: 100, fontSize: '0.75rem',
                                                    fontWeight: 700, background: '#E8F5E9', color: '#2E7D32',
                                                }}>
                                                    {v.commissionRate}%
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>
                                                {v.orderCount}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.85rem' }}>
                                                {fmtC(v.grossSales)}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.85rem', color: '#E65100' }}>
                                                {fmtC(v.commission)}
                                            </td>
                                            <td style={{ textAlign: 'right', fontSize: '0.85rem', color: '#7B1FA2' }}>
                                                {fmtC(v.gstOnCommission)}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem', color: '#2E7D32' }}>
                                                {fmtC(v.netPayout)}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                    <button
                                                        onClick={() => handlePreview(v)}
                                                        title="Preview Invoice"
                                                        style={{
                                                            width: 32, height: 32, borderRadius: 8,
                                                            background: 'rgba(46,125,50,0.1)', border: 'none',
                                                            cursor: 'pointer', display: 'flex',
                                                            alignItems: 'center', justifyContent: 'center',
                                                        }}
                                                    >
                                                        <Eye size={14} color="#2E7D32" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDownload(v.vendorId, v.shopName)}
                                                        disabled={downloadingId === v.vendorId}
                                                        title="Download PDF"
                                                        style={{
                                                            width: 32, height: 32, borderRadius: 8,
                                                            background: downloadingId === v.vendorId ? 'rgba(46,125,50,0.3)' : 'rgba(46,125,50,0.1)',
                                                            border: 'none', cursor: downloadingId === v.vendorId ? 'not-allowed' : 'pointer',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        }}
                                                    >
                                                        {downloadingId === v.vendorId ? (
                                                            <Loader2 size={14} className="animate-spin" color="#2E7D32" />
                                                        ) : (
                                                            <Download size={14} color="#2E7D32" />
                                                        )}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </motion.div>

            {/* ─── Preview Modal ─── */}
            <AnimatePresence>
                {previewVendor && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                            backdropFilter: 'blur(6px)', zIndex: 50, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', padding: 16,
                        }}
                        onClick={() => { setPreviewVendor(null); setPreviewData(null); }}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            className="glass-card"
                            style={{
                                padding: 0, maxWidth: 720, width: '100%', maxHeight: '90vh',
                                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                            }}
                        >
                            {/* Modal Header */}
                            <div style={{
                                padding: '16px 20px', background: '#2E7D32', color: 'white',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <FileText size={20} />
                                    <div>
                                        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Commission Tax Invoice Preview</h3>
                                        <p style={{ fontSize: '0.75rem', opacity: 0.85, margin: 0 }}>{previewVendor.shopName} — {monthLabel}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { setPreviewVendor(null); setPreviewData(null); }}
                                    style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    <X size={16} color="white" />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
                                {previewLoading ? (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' }}>
                                        <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#2E7D32' }} />
                                    </div>
                                ) : previewData ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                        {/* Invoice Info */}
                                        <div style={{
                                            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                                            padding: 14, borderRadius: 10, background: '#E8F5E9', border: '1px solid #C8E6C9',
                                        }}>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: '#2E7D32', fontWeight: 600, margin: '0 0 2px' }}>INVOICE NO</p>
                                                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1B5E20', margin: 0 }}>{previewData.invoiceNumber}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: '#2E7D32', fontWeight: 600, margin: '0 0 2px' }}>DATE</p>
                                                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1B5E20', margin: 0 }}>{previewData.invoiceDate}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: '#2E7D32', fontWeight: 600, margin: '0 0 2px' }}>BILLING PERIOD</p>
                                                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1B5E20', margin: 0 }}>{previewData.billingPeriod}</p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: '0.7rem', color: '#2E7D32', fontWeight: 600, margin: '0 0 2px' }}>COMMISSION RATE</p>
                                                <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1B5E20', margin: 0 }}>{previewData.commissionRate}%</p>
                                            </div>
                                        </div>

                                        {/* Vendor Info */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                            <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                                                <p style={{ fontSize: '0.7rem', color: '#2E7D32', fontWeight: 600, marginBottom: 6 }}>ISSUED BY</p>
                                                <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0 0 4px' }}>{previewData.platform.name}</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', margin: '0 0 2px' }}>GSTIN: {previewData.platform.gstin}</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', margin: 0 }}>FSSAI: {previewData.platform.fssaiLicense}</p>
                                            </div>
                                            <div style={{ padding: 12, borderRadius: 10, border: '1px solid #C8E6C9', background: '#F1F8E9' }}>
                                                <p style={{ fontSize: '0.7rem', color: '#2E7D32', fontWeight: 600, marginBottom: 6 }}>ISSUED TO</p>
                                                <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0 0 4px' }}>{previewData.vendor.name}</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', margin: '0 0 2px' }}>GSTIN: {previewData.vendor.gstin || '—'}</p>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', margin: 0 }}>FSSAI: {previewData.vendor.fssaiLicense || '—'}</p>
                                            </div>
                                        </div>

                                        {/* Weekly Breakdown */}
                                        <div>
                                            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#2E7D32', marginBottom: 8 }}>
                                                WEEKLY SALES & COMMISSION BREAKDOWN
                                            </h4>
                                            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #C8E6C9' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                                    <thead>
                                                        <tr style={{ background: '#2E7D32', color: 'white' }}>
                                                            <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Week / Period</th>
                                                            <th style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600 }}>Orders</th>
                                                            <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>Gross Sales</th>
                                                            <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>Commission</th>
                                                            <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>GST 18%</th>
                                                            <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>Total Ded.</th>
                                                            <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>Net Payout</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {previewData.weeklyBreakdown.map((w, i) => (
                                                            <tr key={i} style={{ borderBottom: '1px solid #E8F5E9' }}>
                                                                <td style={{ padding: '7px 10px', fontWeight: 500 }}>{w.weekLabel}</td>
                                                                <td style={{ padding: '7px 6px', textAlign: 'center' }}>{w.orders}</td>
                                                                <td style={{ padding: '7px 6px', textAlign: 'right' }}>{fmtC(w.grossSales)}</td>
                                                                <td style={{ padding: '7px 6px', textAlign: 'right' }}>{fmtC(w.commission)}</td>
                                                                <td style={{ padding: '7px 6px', textAlign: 'right' }}>{fmtC(w.gstOnCommission)}</td>
                                                                <td style={{ padding: '7px 6px', textAlign: 'right' }}>{fmtC(w.totalDeduction)}</td>
                                                                <td style={{ padding: '7px 6px', textAlign: 'right', color: '#2E7D32', fontWeight: 600 }}>{fmtC(w.netPayout)}</td>
                                                            </tr>
                                                        ))}
                                                        {/* Totals row */}
                                                        <tr style={{ background: '#E8F5E9', fontWeight: 700, borderTop: '2px solid #2E7D32' }}>
                                                            <td style={{ padding: '8px 10px', color: '#1B5E20' }}>MONTHLY TOTAL</td>
                                                            <td style={{ padding: '8px 6px', textAlign: 'center', color: '#1B5E20' }}>{previewData.monthlyTotals.orders}</td>
                                                            <td style={{ padding: '8px 6px', textAlign: 'right', color: '#1B5E20' }}>{fmtC(previewData.monthlyTotals.grossSales)}</td>
                                                            <td style={{ padding: '8px 6px', textAlign: 'right', color: '#E65100' }}>{fmtC(previewData.monthlyTotals.commission)}</td>
                                                            <td style={{ padding: '8px 6px', textAlign: 'right', color: '#7B1FA2' }}>{fmtC(previewData.monthlyTotals.gstOnCommission)}</td>
                                                            <td style={{ padding: '8px 6px', textAlign: 'right', color: '#C62828' }}>{fmtC(previewData.monthlyTotals.totalDeduction)}</td>
                                                            <td style={{ padding: '8px 6px', textAlign: 'right', color: '#2E7D32' }}>{fmtC(previewData.monthlyTotals.netPayout)}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {/* Payout Summary & GST Breakup side by side */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                            {/* Payout Summary */}
                                            <div style={{ padding: 14, borderRadius: 10, border: '1px solid #C8E6C9' }}>
                                                <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2E7D32', marginBottom: 10 }}>PAYOUT SUMMARY</h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>Total Gross Sales</span>
                                                        <span style={{ fontWeight: 600 }}>{fmtC(previewData.monthlyTotals.grossSales)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#C62828' }}>
                                                        <span>(−) Commission</span>
                                                        <span style={{ fontWeight: 600 }}>{fmtC(previewData.monthlyTotals.commission)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#7B1FA2' }}>
                                                        <span>(−) GST on Commission</span>
                                                        <span style={{ fontWeight: 600 }}>{fmtC(previewData.monthlyTotals.gstOnCommission)}</span>
                                                    </div>
                                                    <div style={{ height: 1, background: '#2E7D32', margin: '4px 0' }} />
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', fontWeight: 700, color: '#2E7D32' }}>
                                                        <span>NET PAYOUT</span>
                                                        <span>{fmtC(previewData.monthlyTotals.netPayout)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* GST Breakup */}
                                            <div style={{ padding: 14, borderRadius: 10, border: '1px solid #C8E6C9' }}>
                                                <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2E7D32', marginBottom: 10 }}>GST BREAKUP ON COMMISSION</h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '0.78rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>IGST ({previewData.gstBreakup.igstRate}%)</span>
                                                        <span>{fmtC(previewData.gstBreakup.igstAmount)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>CGST ({previewData.gstBreakup.cgstRate}%)</span>
                                                        <span>{fmtC(previewData.gstBreakup.cgstAmount)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>SGST / UTGST ({previewData.gstBreakup.sgstRate}%)</span>
                                                        <span>{fmtC(previewData.gstBreakup.sgstAmount)}</span>
                                                    </div>
                                                    <div style={{ height: 1, background: '#C8E6C9', margin: '2px 0' }} />
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                                                        <span>TOTAL GST</span>
                                                        <span>{fmtC(previewData.gstBreakup.totalGst)}</span>
                                                    </div>
                                                    <div style={{
                                                        display: 'flex', justifyContent: 'space-between',
                                                        fontWeight: 700, color: '#2E7D32', padding: '4px 6px',
                                                        background: '#E8F5E9', borderRadius: 6, marginTop: 2,
                                                    }}>
                                                        <span>COMMISSION + GST</span>
                                                        <span>{fmtC(previewData.gstBreakup.totalCommissionPlusGst)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{ textAlign: 'center', color: 'var(--foreground-secondary)', padding: '40px 0' }}>
                                        Failed to load invoice data
                                    </p>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div style={{
                                padding: '12px 20px', borderTop: '1px solid var(--border)',
                                display: 'flex', justifyContent: 'flex-end', gap: 10,
                            }}>
                                <button
                                    onClick={() => { setPreviewVendor(null); setPreviewData(null); }}
                                    style={{
                                        padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
                                        background: 'var(--surface)', cursor: 'pointer', fontSize: '0.82rem',
                                        fontWeight: 500, color: 'var(--foreground)',
                                    }}
                                >
                                    Close
                                </button>
                                <button
                                    onClick={() => handleDownload(previewVendor.vendorId, previewVendor.shopName)}
                                    disabled={downloadingId === previewVendor.vendorId}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                                        borderRadius: 8, background: '#2E7D32', color: 'white', border: 'none',
                                        cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                                        opacity: downloadingId === previewVendor.vendorId ? 0.6 : 1,
                                    }}
                                >
                                    {downloadingId === previewVendor.vendorId ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Download size={14} />
                                    )}
                                    Download PDF
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
