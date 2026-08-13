'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    Receipt, RefreshCw, Download, IndianRupee,
    Store, TrendingUp, Loader2, FileSpreadsheet,
    ChevronDown, Filter, Percent, ShieldCheck, Info,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useApi } from '@/hooks/useApi';
import { downloadAuthenticatedFile } from '@/lib/api-client';

// ─── Types (mirror /api/reports/gst) ───

interface GSTEntry {
    invoiceNumber: string;
    orderId: string;
    vendorId: string;
    vendorName: string;
    orderDate: string;
    placeOfSupply: string;
    grossItemTotal: number;
    itemDiscount: number;
    postSupplyDiscount: number;
    totalDiscount: number;
    foodTaxable: number;
    deliveryTaxable: number;
    platformTaxable: number;
    commissionTaxable: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalGst: number;
    invoiceValue: number;
    commission: number;
    gstOnCommission: number;
    totalPlatformEarning: number;
    paymentMode: string;
}

interface PeriodRow {
    month: string;
    monthKey: string;
    ordersCount: number;
    grossSales: number;
    totalDiscount: number;
    foodTaxable: number;
    deliveryTaxable: number;
    platformTaxable: number;
    commissionTaxable: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalGst: number;
    invoiceValue: number;
    totalCommission: number;
    totalPlatformEarning: number;
}

interface VendorRow {
    vendorId: string;
    vendorName: string;
    gstin: string;
    ordersCount: number;
    grossSales: number;
    totalDiscount: number;
    foodTaxable: number;
    deliveryTaxable: number;
    commissionTaxable: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalGst: number;
}

interface B2CSRow {
    rate: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    invoiceCount: number;
}

interface HSNRow {
    hsn: string;
    description: string;
    uqc: string;
    quantity: number;
    rate: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
}

interface GSTReportData {
    meta: {
        legalName: string;
        tradeName: string;
        gstin: string;
        address: string;
        placeOfSupply: string;
        periodFrom: string;
        periodTo: string;
        generatedAt: string;
        basisOfPreparation: string;
    };
    summary: {
        totalOrders: number;
        grossSales: number;
        totalItemDiscount: number;
        totalPostSupplyDiscount: number;
        totalDiscount: number;
        foodTaxable: number;
        deliveryTaxable: number;
        platformTaxable: number;
        commissionTaxable: number;
        totalTaxableValue: number;
        totalCgst: number;
        totalSgst: number;
        totalIgst: number;
        totalGstCollected: number;
        totalInvoiceValue: number;
        totalCommission: number;
        totalGstOnCommission: number;
        totalPlatformEarning: number;
        totalPlatformEarningExclGst: number;
        totalGstOnFood: number;
        totalGstOnDelivery: number;
        totalGstOnPlatformFee: number;
        commissionRate: number;
    };
    b2cs: B2CSRow[];
    hsnSummary: HSNRow[];
    documentSummary: {
        natureOfDocument: string;
        from: string;
        to: string;
        totalIssued: number;
        cancelled: number;
        net: number;
    };
    gstr3b: {
        outwardTaxableSupplies: { label: string; taxableValue: number; igst: number; cgst: number; sgst: number; cess: number };
        supplies95: { label: string; taxableValue: number; igst: number; cgst: number; sgst: number; cess: number };
        netTaxPayable: number;
    };
    monthlyData: PeriodRow[];
    vendorData: VendorRow[];
    entries: GSTEntry[];
    entriesTruncated: boolean;
}

const COLORS = ['#F4511E', '#FF9904', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#6366F1', '#EC4899'];

const tooltipStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: 'var(--shadow-md)',
    fontSize: '0.8125rem',
    padding: '10px 14px',
};

function StatCard({ title, value, subtitle, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; subtitle?: string;
    icon: React.ElementType; color?: 'primary' | 'success' | 'warning' | 'error';
}) {
    const colorMap = {
        primary: { bg: 'rgba(244, 81, 30, 0.15)', text: '#F4511E' },
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
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{title}</p>
                    <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--foreground)', wordBreak: 'break-word' }}>{value}</p>
                    {subtitle && <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{subtitle}</p>}
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: colorMap[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={18} color={colorMap[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

type TabKey = 'overview' | 'gstr1' | 'gstr3b' | 'periods' | 'vendors' | 'register';

const TABS: { key: TabKey; label: string; short: string }[] = [
    { key: 'overview', label: 'Overview', short: 'Overview' },
    { key: 'gstr1', label: 'GSTR-1', short: 'GSTR-1' },
    { key: 'gstr3b', label: 'GSTR-3B', short: 'GSTR-3B' },
    { key: 'periods', label: 'Tax Periods', short: 'Periods' },
    { key: 'vendors', label: 'By Restaurant', short: 'Restaurants' },
    { key: 'register', label: 'Invoice Register', short: 'Register' },
];

export default function GSTReportPage() {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [appliedStart, setAppliedStart] = useState('');
    const [appliedEnd, setAppliedEnd] = useState('');
    const [showDateFilter, setShowDateFilter] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [exporting, setExporting] = useState<string | null>(null);

    const buildQuery = (s: string, e: string) => {
        const params = new URLSearchParams();
        if (s) params.set('startDate', s);
        if (e) params.set('endDate', e);
        return params.toString();
    };

    const [endpoint, setEndpoint] = useState('/api/reports/gst');
    const { data, loading, refetch } = useApi<GSTReportData>(endpoint);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<TabKey>('overview');

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const applyFilter = () => {
        setAppliedStart(startDate);
        setAppliedEnd(endDate);
        const q = buildQuery(startDate, endDate);
        setEndpoint(`/api/reports/gst${q ? '?' + q : ''}`);
        setShowDateFilter(false);
    };

    const clearFilter = () => {
        setStartDate(''); setEndDate('');
        setAppliedStart(''); setAppliedEnd('');
        setEndpoint('/api/reports/gst');
        setShowDateFilter(false);
    };

    const isFiltered = !!(appliedStart || appliedEnd);

    const exportSection = async (section: string, format: 'xlsx' | 'csv' = 'xlsx') => {
        setShowExportMenu(false);
        setExporting(section);
        try {
            const params = new URLSearchParams();
            if (appliedStart) params.set('startDate', appliedStart);
            if (appliedEnd) params.set('endDate', appliedEnd);
            params.set('format', format);
            params.set('section', section);
            // Must go through authenticatedFetch — /api/* requires a bearer token
            await downloadAuthenticatedFile(
                `/api/reports/gst?${params.toString()}`,
                `GST-${section}.${format}`
            );
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Export failed. Please try again.');
        } finally {
            setExporting(null);
        }
    };

    const inr = (amount: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);

    const num = (amount: number) => (amount || 0).toFixed(2);

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const chartData = useMemo(() => {
        if (!data?.monthlyData) return [];
        return data.monthlyData.slice(0, 12).reverse().map(m => ({
            name: m.month.split(' ')[0].slice(0, 3),
            taxable: Math.round(m.taxableValue),
            gst: Math.round(m.totalGst),
        }));
    }, [data]);

    const ratePieData = useMemo(() => {
        if (!data?.summary) return [];
        return [
            { name: 'Food (5%)', value: Math.round(data.summary.foodTaxable) },
            { name: 'Delivery (18%)', value: Math.round(data.summary.deliveryTaxable) },
            { name: 'Platform fee (18%)', value: Math.round(data.summary.platformTaxable) },
            { name: 'Commission (18%)', value: Math.round(data.summary.commissionTaxable) },
        ].filter(d => d.value > 0);
    }, [data]);

    if (loading) {
        return (
            <div className="page-container">
                <h1 className="page-title"><Receipt size={26} style={{ color: 'var(--primary)' }} /> GST Report</h1>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                    <Loader2 className="animate-spin" size={40} style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    const meta = data?.meta;
    const s = data?.summary;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="page-container"
        >
            {/* ─── Header ─── */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <Receipt size={26} style={{ color: 'var(--primary)' }} />
                        GST Report
                    </h1>
                    <p className="page-subtitle">
                        GSTR-1 / GSTR-3B ready · Food 5% · Delivery, platform fee &amp; commission 18%
                    </p>
                </div>
                <div className="page-header-actions">
                    {/* Tax period filter */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => { setShowDateFilter(v => !v); setShowExportMenu(false); }}
                            className="btn btn-outline"
                            style={isFiltered ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}
                        >
                            <Filter size={16} />
                            {isFiltered ? `${appliedStart || 'Start'} → ${appliedEnd || 'End'}` : 'Tax Period'}
                            <ChevronDown size={14} />
                        </button>
                        {showDateFilter && (
                            <div className="dropdown-panel">
                                <p style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>Select tax period</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>From</label>
                                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-control" />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>To</label>
                                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-control" />
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {[
                                        { label: 'This Month', fn: () => { const n = new Date(); const st = new Date(n.getFullYear(), n.getMonth(), 1); setStartDate(st.toISOString().split('T')[0]); setEndDate(n.toISOString().split('T')[0]); } },
                                        { label: 'Last Month', fn: () => { const n = new Date(); const st = new Date(n.getFullYear(), n.getMonth() - 1, 1); const en = new Date(n.getFullYear(), n.getMonth(), 0); setStartDate(st.toISOString().split('T')[0]); setEndDate(en.toISOString().split('T')[0]); } },
                                        { label: 'This Quarter', fn: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3); const st = new Date(n.getFullYear(), q * 3, 1); setStartDate(st.toISOString().split('T')[0]); setEndDate(n.toISOString().split('T')[0]); } },
                                        { label: 'FY to date', fn: () => { const n = new Date(); const fyStart = n.getMonth() >= 3 ? new Date(n.getFullYear(), 3, 1) : new Date(n.getFullYear() - 1, 3, 1); setStartDate(fyStart.toISOString().split('T')[0]); setEndDate(n.toISOString().split('T')[0]); } },
                                    ].map(p => (
                                        <button key={p.label} onClick={p.fn} className="chip-button">{p.label}</button>
                                    ))}
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={clearFilter} className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }}>Clear</button>
                                    <button onClick={applyFilter} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Apply</button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Export menu */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => { setShowExportMenu(v => !v); setShowDateFilter(false); }}
                            className="btn btn-outline"
                            disabled={!!exporting}
                        >
                            {exporting
                                ? <Loader2 size={16} className="animate-spin" />
                                : <Download size={16} />}
                            {exporting ? 'Exporting…' : 'Export'}
                            <ChevronDown size={14} />
                        </button>
                        {showExportMenu && (
                            <div className="dropdown-panel" style={{ minWidth: 280, gap: 2, padding: 6 }}>
                                <p className="dropdown-heading">Excel workbook — or click CSV</p>
                                {[
                                    { key: 'register', label: 'Invoice register (all columns)' },
                                    { key: 'b2cs', label: 'GSTR-1 Table 7 — B2C (Others)' },
                                    { key: 'hsn', label: 'GSTR-1 Table 12 — HSN summary' },
                                    { key: 'monthly', label: 'Tax period summary' },
                                    { key: 'vendor', label: 'Restaurant-wise summary' },
                                ].map(opt => (
                                    <div key={opt.key} className="export-option">
                                        <button onClick={() => exportSection(opt.key, 'xlsx')} className="dropdown-item" style={{ flex: 1 }}>
                                            <FileSpreadsheet size={14} /> {opt.label}
                                        </button>
                                        <button
                                            onClick={() => exportSection(opt.key, 'csv')}
                                            className="export-option-csv"
                                            title={`Download ${opt.label} as CSV instead`}
                                        >
                                            CSV
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <button onClick={handleRefresh} disabled={refreshing} className="btn btn-primary">
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* ─── Return header (identification block) ─── */}
            {meta && (
                <div className="glass-card gst-meta-grid" style={{ padding: 16, marginBottom: 16 }}>
                    <div>
                        <p className="gst-meta-label">Legal name</p>
                        <p className="gst-meta-value">{meta.legalName}</p>
                    </div>
                    <div>
                        <p className="gst-meta-label">GSTIN</p>
                        <p className="gst-meta-value" style={{ fontFamily: 'monospace' }}>{meta.gstin}</p>
                    </div>
                    <div>
                        <p className="gst-meta-label">Place of supply</p>
                        <p className="gst-meta-value">{meta.placeOfSupply}</p>
                    </div>
                    <div>
                        <p className="gst-meta-label">Tax period</p>
                        <p className="gst-meta-value">
                            {meta.periodFrom ? formatDate(meta.periodFrom) : '—'} → {meta.periodTo ? formatDate(meta.periodTo) : '—'}
                        </p>
                    </div>
                    <div>
                        <p className="gst-meta-label">Invoices</p>
                        <p className="gst-meta-value">{data?.documentSummary.totalIssued ?? 0} issued · {data?.documentSummary.cancelled ?? 0} cancelled</p>
                    </div>
                    <div>
                        <p className="gst-meta-label">Generated</p>
                        <p className="gst-meta-value">{new Date(meta.generatedAt).toLocaleString('en-IN')}</p>
                    </div>
                </div>
            )}

            {/* ─── Control totals ─── */}
            <div className="stat-grid" style={{ marginBottom: 16 }}>
                <StatCard title="Total Taxable Value" value={inr(s?.totalTaxableValue || 0)} subtitle={`${s?.totalOrders || 0} invoices`} icon={Receipt} color="primary" />
                <StatCard title="CGST" value={inr(s?.totalCgst || 0)} subtitle="Central GST payable" icon={IndianRupee} color="success" />
                <StatCard title="SGST" value={inr(s?.totalSgst || 0)} subtitle="State GST payable" icon={IndianRupee} color="warning" />
                <StatCard title="Total GST" value={inr(s?.totalGstCollected || 0)} subtitle="CGST + SGST + IGST" icon={ShieldCheck} color="error" />
            </div>

            <div className="stat-grid" style={{ marginBottom: 16 }}>
                <StatCard title="Gross Sales" value={inr(s?.grossSales || 0)} subtitle="Before any discount" icon={TrendingUp} color="primary" />
                <StatCard title="Invoice Discounts" value={inr(s?.totalItemDiscount || 0)} subtitle="Reduce taxable value" icon={Percent} color="success" />
                <StatCard title="Post-supply Discounts" value={inr(s?.totalPostSupplyDiscount || 0)} subtitle="Coins, promo, HungerGame" icon={Percent} color="warning" />
                <StatCard title="Invoice Value" value={inr(s?.totalInvoiceValue || 0)} subtitle="Taxable value + GST" icon={IndianRupee} color="primary" />
                <StatCard title="Commission Income" value={inr(s?.totalCommission || 0)} subtitle={`${s?.commissionRate || 15}% of sales, excl. GST`} icon={Percent} color="success" />
            </div>

            {/* ─── Tabs ─── */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden', padding: 0 }}>
                <div className="tab-bar">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setActiveTab(t.key)}
                            className={`tab-button ${activeTab === t.key ? 'active' : ''}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div style={{ padding: 16 }}>
                    {/* ── Overview ── */}
                    {activeTab === 'overview' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                            <div style={{ minWidth: 0 }}>
                                <h3 className="section-heading">Taxable value &amp; GST by tax period</h3>
                                <ResponsiveContainer width="100%" height={260}>
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}`} width={56} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`₹${value}`, '']} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                        <Bar dataKey="taxable" name="Taxable value" fill="#10B981" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="gst" name="GST" fill="#F4511E" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            <div style={{ minWidth: 0 }}>
                                <h3 className="section-heading">Taxable value by supply type</h3>
                                <ResponsiveContainer width="100%" height={260}>
                                    <PieChart>
                                        <Pie data={ratePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                                            {ratePieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                        </Pie>
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`₹${value}`, 'Taxable value']} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <h3 className="section-heading">Rate-wise reconciliation</h3>
                                <div className="table-scroll">
                                    <table className="table-premium">
                                        <thead>
                                            <tr>
                                                <th>Supply</th>
                                                <th>HSN / SAC</th>
                                                <th style={{ textAlign: 'right' }}>Rate</th>
                                                <th style={{ textAlign: 'right' }}>Taxable Value</th>
                                                <th style={{ textAlign: 'right' }}>CGST</th>
                                                <th style={{ textAlign: 'right' }}>SGST</th>
                                                <th style={{ textAlign: 'right' }}>Total Tax</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[
                                                { label: 'Restaurant service (food)', hsn: '9963', rate: 5, taxable: s?.foodTaxable || 0 },
                                                { label: 'Delivery charges', hsn: '996812', rate: 18, taxable: s?.deliveryTaxable || 0 },
                                                { label: 'Platform / convenience fee', hsn: '998599', rate: 18, taxable: s?.platformTaxable || 0 },
                                                { label: 'Commission on restaurant sales', hsn: '998399', rate: 18, taxable: s?.commissionTaxable || 0 },
                                            ].map(row => {
                                                const tax = row.taxable * row.rate / 100;
                                                return (
                                                    <tr key={row.label}>
                                                        <td style={{ fontWeight: 500 }}>{row.label}</td>
                                                        <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{row.hsn}</td>
                                                        <td style={{ textAlign: 'right' }}>{row.rate}%</td>
                                                        <td style={{ textAlign: 'right' }}>{num(row.taxable)}</td>
                                                        <td style={{ textAlign: 'right' }}>{num(tax / 2)}</td>
                                                        <td style={{ textAlign: 'right' }}>{num(tax / 2)}</td>
                                                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#F4511E' }}>{num(tax)}</td>
                                                    </tr>
                                                );
                                            })}
                                            <tr style={{ fontWeight: 700 }}>
                                                <td colSpan={3}>Total</td>
                                                <td style={{ textAlign: 'right' }}>{num(s?.totalTaxableValue || 0)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(s?.totalCgst || 0)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(s?.totalSgst || 0)}</td>
                                                <td style={{ textAlign: 'right', color: '#F4511E' }}>{num(s?.totalGstCollected || 0)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <p className="note-block">
                                    <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                                    <span>
                                        Menu and offer discounts shown on the invoice reduce the taxable value (sec. 15(3)(a)).
                                        Coins, promo codes and HungerGame rewards are applied after the supply and are reported
                                        separately without reducing the taxable value. {meta?.basisOfPreparation}
                                    </span>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── GSTR-1 ── */}
                    {activeTab === 'gstr1' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                            <div>
                                <h3 className="section-heading">Table 7 — B2C (Others)</h3>
                                <div className="table-scroll">
                                    <table className="table-premium">
                                        <thead>
                                            <tr>
                                                <th>Place of Supply</th>
                                                <th style={{ textAlign: 'right' }}>Rate</th>
                                                <th style={{ textAlign: 'right' }}>Taxable Value</th>
                                                <th style={{ textAlign: 'right' }}>IGST</th>
                                                <th style={{ textAlign: 'right' }}>CGST</th>
                                                <th style={{ textAlign: 'right' }}>SGST</th>
                                                <th style={{ textAlign: 'right' }}>Invoices</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data?.b2cs.map(b => (
                                                <tr key={b.rate}>
                                                    <td>{meta?.placeOfSupply}</td>
                                                    <td style={{ textAlign: 'right' }}>{b.rate}%</td>
                                                    <td style={{ textAlign: 'right' }}>{num(b.taxableValue)}</td>
                                                    <td style={{ textAlign: 'right' }}>{num(b.igst)}</td>
                                                    <td style={{ textAlign: 'right' }}>{num(b.cgst)}</td>
                                                    <td style={{ textAlign: 'right' }}>{num(b.sgst)}</td>
                                                    <td style={{ textAlign: 'right' }}>{b.invoiceCount}</td>
                                                </tr>
                                            ))}
                                            {(!data?.b2cs || data.b2cs.length === 0) && (
                                                <tr><td colSpan={7} className="empty-cell">No supplies in this period</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h3 className="section-heading">Table 12 — HSN-wise summary of outward supplies</h3>
                                <div className="table-scroll">
                                    <table className="table-premium">
                                        <thead>
                                            <tr>
                                                <th>HSN / SAC</th>
                                                <th>Description</th>
                                                <th>UQC</th>
                                                <th style={{ textAlign: 'right' }}>Qty</th>
                                                <th style={{ textAlign: 'right' }}>Rate</th>
                                                <th style={{ textAlign: 'right' }}>Taxable Value</th>
                                                <th style={{ textAlign: 'right' }}>CGST</th>
                                                <th style={{ textAlign: 'right' }}>SGST</th>
                                                <th style={{ textAlign: 'right' }}>Total Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data?.hsnSummary.map(h => (
                                                <tr key={`${h.hsn}-${h.rate}`}>
                                                    <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{h.hsn}</td>
                                                    <td>{h.description}</td>
                                                    <td>{h.uqc}</td>
                                                    <td style={{ textAlign: 'right' }}>{h.quantity}</td>
                                                    <td style={{ textAlign: 'right' }}>{h.rate}%</td>
                                                    <td style={{ textAlign: 'right' }}>{num(h.taxableValue)}</td>
                                                    <td style={{ textAlign: 'right' }}>{num(h.cgst)}</td>
                                                    <td style={{ textAlign: 'right' }}>{num(h.sgst)}</td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(h.total)}</td>
                                                </tr>
                                            ))}
                                            {(!data?.hsnSummary || data.hsnSummary.length === 0) && (
                                                <tr><td colSpan={9} className="empty-cell">No supplies in this period</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h3 className="section-heading">Table 13 — Documents issued</h3>
                                <div className="table-scroll">
                                    <table className="table-premium">
                                        <thead>
                                            <tr>
                                                <th>Nature of document</th>
                                                <th>From</th>
                                                <th>To</th>
                                                <th style={{ textAlign: 'right' }}>Total</th>
                                                <th style={{ textAlign: 'right' }}>Cancelled</th>
                                                <th style={{ textAlign: 'right' }}>Net issued</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td>{data?.documentSummary.natureOfDocument}</td>
                                                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{data?.documentSummary.from || '—'}</td>
                                                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{data?.documentSummary.to || '—'}</td>
                                                <td style={{ textAlign: 'right' }}>{data?.documentSummary.totalIssued ?? 0}</td>
                                                <td style={{ textAlign: 'right' }}>{data?.documentSummary.cancelled ?? 0}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{data?.documentSummary.net ?? 0}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── GSTR-3B ── */}
                    {activeTab === 'gstr3b' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <h3 className="section-heading">Table 3.1 — Details of outward supplies</h3>
                            <div className="table-scroll">
                                <table className="table-premium">
                                    <thead>
                                        <tr>
                                            <th>Nature of supply</th>
                                            <th style={{ textAlign: 'right' }}>Taxable Value</th>
                                            <th style={{ textAlign: 'right' }}>IGST</th>
                                            <th style={{ textAlign: 'right' }}>CGST</th>
                                            <th style={{ textAlign: 'right' }}>SGST/UTGST</th>
                                            <th style={{ textAlign: 'right' }}>Cess</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[data?.gstr3b.outwardTaxableSupplies, data?.gstr3b.supplies95].filter(Boolean).map((row, i) => (
                                            <tr key={i}>
                                                <td style={{ fontWeight: 500 }}>{row!.label}</td>
                                                <td style={{ textAlign: 'right' }}>{num(row!.taxableValue)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(row!.igst)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(row!.cgst)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(row!.sgst)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(row!.cess)}</td>
                                            </tr>
                                        ))}
                                        <tr style={{ fontWeight: 700 }}>
                                            <td>Net tax payable</td>
                                            <td style={{ textAlign: 'right' }}>—</td>
                                            <td style={{ textAlign: 'right' }}>0.00</td>
                                            <td style={{ textAlign: 'right' }}>{num(s?.totalCgst || 0)}</td>
                                            <td style={{ textAlign: 'right' }}>{num(s?.totalSgst || 0)}</td>
                                            <td style={{ textAlign: 'right' }}>0.00</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <p className="note-block">
                                <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                                <span>
                                    Restaurant supplies made through the platform are reported under section 9(5); the tax on those
                                    supplies is discharged by Delito as the e-commerce operator. Figures are indicative and should
                                    be reconciled with the books before filing.
                                </span>
                            </p>
                        </div>
                    )}

                    {/* ── Tax periods ── */}
                    {activeTab === 'periods' && (
                        <div className="table-scroll">
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Tax Period</th>
                                        <th style={{ textAlign: 'right' }}>Invoices</th>
                                        <th style={{ textAlign: 'right' }}>Gross Sales</th>
                                        <th style={{ textAlign: 'right' }}>Discounts</th>
                                        <th style={{ textAlign: 'right' }}>Taxable Value</th>
                                        <th style={{ textAlign: 'right' }}>CGST</th>
                                        <th style={{ textAlign: 'right' }}>SGST</th>
                                        <th style={{ textAlign: 'right' }}>Total GST</th>
                                        <th style={{ textAlign: 'right' }}>Invoice Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.monthlyData.map(m => (
                                        <tr key={m.monthKey}>
                                            <td style={{ fontWeight: 500 }}>{m.month}</td>
                                            <td style={{ textAlign: 'right' }}>{m.ordersCount}</td>
                                            <td style={{ textAlign: 'right' }}>{num(m.grossSales)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981' }}>{num(m.totalDiscount)}</td>
                                            <td style={{ textAlign: 'right' }}>{num(m.taxableValue)}</td>
                                            <td style={{ textAlign: 'right' }}>{num(m.cgst)}</td>
                                            <td style={{ textAlign: 'right' }}>{num(m.sgst)}</td>
                                            <td style={{ textAlign: 'right', color: '#F4511E', fontWeight: 600 }}>{num(m.totalGst)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(m.invoiceValue)}</td>
                                        </tr>
                                    ))}
                                    {(!data?.monthlyData || data.monthlyData.length === 0) && (
                                        <tr><td colSpan={9} className="empty-cell">No data available</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Vendors ── */}
                    {activeTab === 'vendors' && (
                        <div className="table-scroll">
                            <table className="table-premium">
                                <thead>
                                    <tr>
                                        <th>Restaurant</th>
                                        <th>GSTIN</th>
                                        <th style={{ textAlign: 'right' }}>Invoices</th>
                                        <th style={{ textAlign: 'right' }}>Gross Sales</th>
                                        <th style={{ textAlign: 'right' }}>Discounts</th>
                                        <th style={{ textAlign: 'right' }}>Taxable Value</th>
                                        <th style={{ textAlign: 'right' }}>Commission</th>
                                        <th style={{ textAlign: 'right' }}>Total GST</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.vendorData.map(v => (
                                        <tr key={v.vendorId}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(244, 81, 30, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                        <Store size={15} color="#F4511E" />
                                                    </div>
                                                    <span style={{ fontWeight: 500 }}>{v.vendorName}</span>
                                                </div>
                                            </td>
                                            <td style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{v.gstin || 'Unregistered'}</td>
                                            <td style={{ textAlign: 'right' }}>{v.ordersCount}</td>
                                            <td style={{ textAlign: 'right' }}>{num(v.grossSales)}</td>
                                            <td style={{ textAlign: 'right', color: '#10B981' }}>{num(v.totalDiscount)}</td>
                                            <td style={{ textAlign: 'right' }}>{num(v.taxableValue)}</td>
                                            <td style={{ textAlign: 'right' }}>{num(v.commissionTaxable)}</td>
                                            <td style={{ textAlign: 'right', color: '#F4511E', fontWeight: 600 }}>{num(v.totalGst)}</td>
                                        </tr>
                                    ))}
                                    {(!data?.vendorData || data.vendorData.length === 0) && (
                                        <tr><td colSpan={8} className="empty-cell">No restaurant data available</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Invoice register ── */}
                    {activeTab === 'register' && (
                        <>
                            <div className="table-scroll">
                                <table className="table-premium">
                                    <thead>
                                        <tr>
                                            <th>Invoice No.</th>
                                            <th>Date</th>
                                            <th>Restaurant</th>
                                            <th style={{ textAlign: 'right' }}>Gross</th>
                                            <th style={{ textAlign: 'right' }}>Discount</th>
                                            <th style={{ textAlign: 'right' }}>Taxable Value</th>
                                            <th style={{ textAlign: 'right' }}>CGST</th>
                                            <th style={{ textAlign: 'right' }}>SGST</th>
                                            <th style={{ textAlign: 'right' }}>Invoice Value</th>
                                            <th>Payment</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data?.entries.map(e => (
                                            <tr key={e.orderId}>
                                                <td style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{e.invoiceNumber}</td>
                                                <td style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>{formatDate(e.orderDate)}</td>
                                                <td style={{ fontWeight: 500 }}>{e.vendorName}</td>
                                                <td style={{ textAlign: 'right' }}>{num(e.grossItemTotal)}</td>
                                                <td style={{ textAlign: 'right', color: '#10B981' }}>{num(e.totalDiscount)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(e.taxableValue)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(e.cgst)}</td>
                                                <td style={{ textAlign: 'right' }}>{num(e.sgst)}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{num(e.invoiceValue)}</td>
                                                <td>
                                                    <span className="badge" style={{
                                                        background: e.paymentMode === 'COD' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                                        color: e.paymentMode === 'COD' ? '#F59E0B' : '#10B981',
                                                    }}>{e.paymentMode}</span>
                                                </td>
                                            </tr>
                                        ))}
                                        {(!data?.entries || data.entries.length === 0) && (
                                            <tr><td colSpan={10} className="empty-cell">No invoices found</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {data?.entriesTruncated && (
                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 10 }}>
                                    Showing the 500 most recent invoices — export the register for the complete list.
                                </p>
                            )}
                        </>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}
