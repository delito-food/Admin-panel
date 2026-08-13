'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    FileText,
    Download,
    RefreshCw,
    Calendar,
    Loader2,
    Building2,
    Bike,
    IndianRupee,
    TrendingDown,
    Users,
    Receipt,
    Search,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { downloadAuthenticatedFile } from '@/lib/api-client';

type Section = '194O' | '194C' | 'vendor-1pct';

/** Safe number formatting — handles undefined/null/NaN gracefully */
function fmt(val: any): string {
    const n = Number(val);
    if (isNaN(n) || val == null) return '0';
    return n.toLocaleString('en-IN');
}

export default function TDSReportPage() {
    const [section, setSection] = useState<Section>('194O');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [downloadingPDF, setDownloadingPDF] = useState(false);

    // Build API URL
    const apiUrl = useMemo(() => {
        let url = `/api/reports/tds?section=${section}`;
        if (dateFrom) url += `&from=${dateFrom}`;
        if (dateTo) url += `&to=${dateTo}`;
        return url;
    }, [section, dateFrom, dateTo]);

    const { data, loading, refetch } = useApi<any>(apiUrl);
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setTimeout(() => setRefreshing(false), 500);
    };

    const handleDownloadCSV = async () => {
        let url = `/api/reports/tds?section=${section}&format=csv`;
        if (dateFrom) url += `&from=${dateFrom}`;
        if (dateTo) url += `&to=${dateTo}`;
        // /api/* needs a bearer token — a plain window.open() navigation cannot carry it
        try {
            await downloadAuthenticatedFile(url, `TDS_${section}_Report.csv`);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'CSV download failed');
        }
    };

    const handleDownloadPDF = async () => {
        setDownloadingPDF(true);
        try {
            let url = `/api/reports/tds?section=${section}&format=pdf`;
            if (dateFrom) url += `&from=${dateFrom}`;
            if (dateTo) url += `&to=${dateTo}`;
            await downloadAuthenticatedFile(url, `TDS_${section}_Report.pdf`);
        } catch (err) { alert(err instanceof Error ? err.message : 'PDF download failed'); }
        finally { setDownloadingPDF(false); }
    };

    const sectionInfo: Record<Section, { label: string; desc: string; icon: React.ReactNode; color: string }> = {
        '194O': { label: 'Section 194O', desc: 'TDS on e-commerce vendor payments (0.1% on gross sales)', icon: <Building2 size={20} />, color: '#F4511E' },
        '194C': { label: 'Section 194C', desc: 'TDS on delivery partner payments (1% on contractor earnings)', icon: <Bike size={20} />, color: '#8B5CF6' },
        'vendor-1pct': { label: 'Vendor 1% TDS', desc: 'TDS 1% deducted from vendor payouts', icon: <TrendingDown size={20} />, color: '#F59E0B' },
    };

    const currentSection = sectionInfo[section];

    // Filter data
    const filteredVendors = useMemo(() => {
        if (!data?.vendors) return [];
        if (!searchQuery) return data.vendors;
        const q = searchQuery.toLowerCase();
        return data.vendors.filter((v: any) =>
            v.vendorName?.toLowerCase().includes(q) ||
            v.pan?.toLowerCase().includes(q) ||
            v.gstin?.toLowerCase().includes(q)
        );
    }, [data?.vendors, searchQuery]);

    const filteredDP = useMemo(() => {
        if (!data?.deliveryPartners) return [];
        if (!searchQuery) return data.deliveryPartners;
        const q = searchQuery.toLowerCase();
        return data.deliveryPartners.filter((d: any) =>
            d.name?.toLowerCase().includes(q) ||
            d.pan?.toLowerCase().includes(q) ||
            d.phone?.includes(q)
        );
    }, [data?.deliveryPartners, searchQuery]);

    const totals = data?.totals || {};

    return (
        <div className="page-container">
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <Receipt size={28} style={{ color: 'var(--primary)' }} />
                        TDS Reports
                    </h1>
                    <p className="page-subtitle">Tax Deducted at Source — Section 194O, 194C & Vendor 1% TDS</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleDownloadPDF} className="btn btn-outline" disabled={loading || !data || downloadingPDF}>
                        {downloadingPDF ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} PDF
                    </button>
                    <button onClick={handleDownloadCSV} className="btn btn-outline" disabled={loading || !data}>
                        <Download size={16} /> CSV
                    </button>
                    <button onClick={handleRefresh} className="btn btn-outline" disabled={refreshing}>
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            {/* Section Tabs */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                {(Object.keys(sectionInfo) as Section[]).map(key => {
                    const s = sectionInfo[key];
                    const active = key === section;
                    return (
                        <button
                            key={key}
                            onClick={() => setSection(key)}
                            style={{
                                flex: '1 1 220px', padding: '14px 16px', borderRadius: 12,
                                border: active ? `2px solid ${s.color}` : '1px solid var(--glass-border)',
                                background: active ? `${s.color}10` : 'var(--surface)',
                                cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${s.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color }}>
                                    {s.icon}
                                </div>
                                <div>
                                    <p style={{ fontSize: '0.88rem', fontWeight: 700, color: active ? s.color : 'var(--foreground)' }}>{s.label}</p>
                                    <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{s.desc}</p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Filters */}
            <div className="glass-card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search by name, PAN, GSTIN..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px 8px 30px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none' }}
                    />
                </div>
                <Calendar size={14} style={{ color: 'var(--foreground-secondary)' }} />
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.8rem' }} />
                <span style={{ color: 'var(--foreground-secondary)', fontSize: '0.8rem' }}>to</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.8rem' }} />
                {data?.quarter && (
                    <span style={{ padding: '5px 12px', borderRadius: 20, background: `${currentSection.color}12`, color: currentSection.color, fontSize: '0.72rem', fontWeight: 600, border: `1px solid ${currentSection.color}30` }}>
                        {data.quarter}
                    </span>
                )}
            </div>

            {/* Summary cards */}
            {data?.totals && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {section === '194C' ? (
                        <>
                            <StatCard label="Partners" value={filteredDP.length} icon={<Users size={18} />} color="#8B5CF6" />
                            <StatCard label="Total Deliveries" value={fmt(totals.totalDeliveries)} icon={<Bike size={18} />} color="#3B82F6" />
                            <StatCard label="Total Earnings" value={`₹${fmt(totals.totalEarnings)}`} icon={<IndianRupee size={18} />} color="#10B981" />
                            <StatCard label="TDS Deducted (1%)" value={`₹${fmt(totals.totalTDS)}`} icon={<TrendingDown size={18} />} color="#EF4444" />
                            <StatCard label="Net After TDS" value={`₹${fmt(totals.totalNetAfterTDS)}`} icon={<IndianRupee size={18} />} color="#F59E0B" />
                        </>
                    ) : (
                        <>
                            <StatCard label="Vendors" value={filteredVendors.length} icon={<Building2 size={18} />} color="#F4511E" />
                            <StatCard label="Total Orders" value={fmt(totals.totalOrders)} icon={<FileText size={18} />} color="#3B82F6" />
                            <StatCard label="Gross Sales" value={`₹${fmt(totals.totalGrossSales)}`} icon={<IndianRupee size={18} />} color="#10B981" />
                            <StatCard label="Commission" value={`₹${fmt(totals.totalCommission)}`} icon={<TrendingDown size={18} />} color="#8B5CF6" />
                            <StatCard label="TDS (0.1%)" value={`₹${fmt(totals.totalTDS)}`} icon={<TrendingDown size={18} />} color="#EF4444" />
                            <StatCard label="Net After TDS" value={`₹${fmt(totals.totalNetAfterTDS)}`} icon={<IndianRupee size={18} />} color="#F59E0B" />
                        </>
                    )}
                </div>
            )}

            {/* Data table */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                    <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            ) : section === '194C' ? (
                /* Delivery Partners table */
                <div className="glass-card" style={{ overflow: 'auto' }}>
                    <div style={{ minWidth: 900 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '0.6fr 1.2fr 0.8fr 0.8fr 0.6fr 0.8fr 0.5fr 0.7fr 0.8fr', padding: '10px 14px', background: 'var(--surface-hover)', borderBottom: '1px solid var(--glass-border)', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-secondary)' }}>
                            <span>ID</span><span>Name</span><span>PAN</span><span>Phone</span><span>Deliveries</span><span>Earnings</span><span>TDS%</span><span>TDS Amt</span><span>Net Payable</span>
                        </div>
                        {filteredDP.length === 0 ? (
                            <div style={{ padding: 30, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No data found for this period</div>
                        ) : filteredDP.map((row: any, i: number) => (
                            <div key={row.deliveryPersonId} style={{ display: 'grid', gridTemplateColumns: '0.6fr 1.2fr 0.8fr 0.8fr 0.6fr 0.8fr 0.5fr 0.7fr 0.8fr', padding: '10px 14px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.82rem', background: i % 2 === 0 ? 'transparent' : 'var(--surface-hover)' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{row.deliveryPersonId?.slice(-6).toUpperCase()}</span>
                                <span style={{ fontWeight: 500 }}>{row.name}</span>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: row.pan ? 'var(--foreground)' : '#EF4444' }}>{row.pan || 'Missing'}</span>
                                <span style={{ fontSize: '0.78rem' }}>{row.phone}</span>
                                <span style={{ textAlign: 'center' }}>{row.totalDeliveries}</span>
                                <span style={{ fontWeight: 600 }}>₹{fmt(row.totalEarnings)}</span>
                                <span style={{ textAlign: 'center', color: '#EF4444', fontWeight: 600 }}>{row.tdsRate}%</span>
                                <span style={{ color: '#EF4444', fontWeight: 600 }}>₹{fmt(row.tdsAmount)}</span>
                                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>₹{fmt(row.netAfterTDS)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                /* Vendor table (194O / vendor-1pct) */
                <div className="glass-card" style={{ overflow: 'auto' }}>
                    <div style={{ minWidth: 1100 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.2fr 0.7fr 0.7fr 0.8fr 0.4fr 0.7fr 0.6fr 0.7fr 0.4fr 0.6fr 0.7fr', padding: '10px 14px', background: 'var(--surface-hover)', borderBottom: '1px solid var(--glass-border)', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-secondary)' }}>
                            <span>ID</span><span>Vendor</span><span>PAN</span><span>GSTIN</span><span>Gross Sales</span><span>Orders</span><span>Commission</span><span>GST/Comm</span><span>Net Pay</span><span>TDS%</span><span>TDS Amt</span><span>After TDS</span>
                        </div>
                        {filteredVendors.length === 0 ? (
                            <div style={{ padding: 30, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No data found for this period</div>
                        ) : filteredVendors.map((row: any, i: number) => (
                            <div key={row.vendorId} style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.2fr 0.7fr 0.7fr 0.8fr 0.4fr 0.7fr 0.6fr 0.7fr 0.4fr 0.6fr 0.7fr', padding: '10px 14px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.8rem', background: i % 2 === 0 ? 'transparent' : 'var(--surface-hover)' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{row.vendorId?.slice(-6).toUpperCase()}</span>
                                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.vendorName}</span>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: row.pan ? 'var(--foreground)' : '#EF4444' }}>{row.pan || 'Missing'}</span>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{row.gstin || '—'}</span>
                                <span style={{ fontWeight: 600 }}>₹{fmt(row.totalGrossSales)}</span>
                                <span style={{ textAlign: 'center' }}>{row.totalOrders}</span>
                                <span>₹{fmt(row.commission)}</span>
                                <span style={{ fontSize: '0.75rem' }}>₹{fmt(row.gstOnCommission)}</span>
                                <span>₹{fmt(row.netPayable)}</span>
                                <span style={{ textAlign: 'center', color: '#EF4444', fontWeight: 600 }}>{row.tdsRate}%</span>
                                <span style={{ color: '#EF4444', fontWeight: 600 }}>₹{fmt(row.tdsAmount)}</span>
                                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>₹{fmt(row.netAfterTDS)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Info box */}
            <div className="glass-card" style={{ padding: '14px 18px', marginTop: 16, background: 'rgba(244,81,30,0.04)', border: '1px solid rgba(244,81,30,0.12)' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>ℹ️ About TDS Sections</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.75rem', color: 'var(--foreground-secondary)', lineHeight: 1.6 }}>
                    <p><strong>Section 194O:</strong> E-commerce operator must deduct TDS @0.1% on gross amount of sale of goods/services facilitated through the platform. Applicable on vendor payments.</p>
                    <p><strong>Section 194C:</strong> TDS @1% (individual/HUF) or @2% (others) on payments to contractors. Applies to delivery partner payouts as they are independent contractors.</p>
                    <p><strong>Vendor 1% TDS:</strong> Same as 194O — shows the 1% TDS deducted from each vendor&apos;s payout before settlement.</p>
                    <p style={{ fontStyle: 'italic', color: '#F59E0B' }}>Note: TDS is not deductible if the total payment to a vendor/contractor during the FY does not exceed ₹5,00,000 (Sec 194O) or ₹30,000 per transaction / ₹1,00,000 per FY (Sec 194C). Verify thresholds with your CA.</p>
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
    return (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</p>
                    <p style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
                    {icon}
                </div>
            </div>
        </motion.div>
    );
}
