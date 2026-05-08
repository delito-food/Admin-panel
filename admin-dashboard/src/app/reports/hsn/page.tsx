'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    Download,
    RefreshCw,
    Calendar,
    Loader2,
    IndianRupee,
    BarChart3,
    FileText,
    Hash,
    Layers,
} from 'lucide-react';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useApi } from '@/hooks/useApi';

export default function HSNSummaryPage() {
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [downloadingPDF, setDownloadingPDF] = useState(false);

    const apiUrl = useMemo(() => {
        let url = '/api/reports/hsn';
        const params: string[] = [];
        if (dateFrom) params.push(`from=${dateFrom}`);
        if (dateTo) params.push(`to=${dateTo}`);
        if (params.length) url += '?' + params.join('&');
        return url;
    }, [dateFrom, dateTo]);

    const { data, loading, refetch } = useApi<any>(apiUrl);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setTimeout(() => setRefreshing(false), 500);
    };

    const handleDownloadCSV = () => {
        let url = '/api/reports/hsn?format=csv';
        if (dateFrom) url += `&from=${dateFrom}`;
        if (dateTo) url += `&to=${dateTo}`;
        window.open(url, '_blank');
    };

    const handleDownloadPDF = async () => {
        setDownloadingPDF(true);
        try {
            let url = '/api/reports/hsn?format=pdf';
            if (dateFrom) url += `&from=${dateFrom}`;
            if (dateTo) url += `&to=${dateTo}`;
            const res = await fetch(url);
            if (!res.ok) { alert('Failed to generate PDF'); return; }
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'HSN_Summary_Report.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch { alert('PDF download failed'); }
        finally { setDownloadingPDF(false); }
    };

    return (
        <div className="page-container">
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">
                        <Hash size={28} style={{ color: 'var(--primary)' }} />
                        HSN Summary
                    </h1>
                    <p className="page-subtitle">Harmonized System of Nomenclature summary for GSTR-1 filing</p>
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

            {/* Date filters */}
            <div className="glass-card" style={{ padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <Calendar size={16} style={{ color: 'var(--foreground-secondary)' }} />
                <span style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)' }}>Period:</span>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.82rem' }} />
                <span style={{ color: 'var(--foreground-secondary)', fontSize: '0.82rem' }}>to</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.82rem' }} />
                {(dateFrom || dateTo) && (
                    <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                        Clear
                    </button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                    {!dateFrom && !dateTo && 'Showing current month'}
                </span>
            </div>

            {/* Summary stats */}
            {data?.totals && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
                    <StatCard label="Total Value" value={`₹${data.totals.totalValue.toLocaleString('en-IN')}`} icon={<IndianRupee size={18} />} color="#F4511E" />
                    <StatCard label="Taxable Value" value={`₹${data.totals.taxableValue.toLocaleString('en-IN')}`} icon={<FileText size={18} />} color="#3B82F6" />
                    <StatCard label="Total CGST" value={`₹${data.totals.totalCGST.toLocaleString('en-IN')}`} icon={<BarChart3 size={18} />} color="#10B981" />
                    <StatCard label="Total SGST" value={`₹${data.totals.totalSGST.toLocaleString('en-IN')}`} icon={<BarChart3 size={18} />} color="#F59E0B" />
                    <StatCard label="Total Tax" value={`₹${data.totals.totalTax.toLocaleString('en-IN')}`} icon={<IndianRupee size={18} />} color="#EF4444" />
                    <StatCard label="HSN Categories" value={data.hsnRows?.length || 0} icon={<Layers size={18} />} color="#8B5CF6" />
                </div>
            )}

            {/* HSN Table */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                    <Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            ) : !data?.hsnRows?.length ? (
                <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                    <Hash size={48} style={{ color: 'var(--foreground-secondary)', opacity: 0.3, margin: '0 auto 12px' }} />
                    <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground-secondary)' }}>No HSN data available</p>
                    <p style={{ fontSize: '0.82rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>No delivered orders found for this period</p>
                </div>
            ) : (
                <div className="glass-card" style={{ overflow: 'auto' }}>
                    <div style={{ minWidth: 950 }}>
                        {/* Table header */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '0.7fr 2fr 0.4fr 0.5fr 0.8fr 0.8fr 0.5fr 0.7fr 0.5fr 0.7fr 0.7fr',
                            padding: '12px 16px',
                            background: 'var(--surface-hover)',
                            borderBottom: '1px solid var(--glass-border)',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            color: 'var(--foreground-secondary)',
                        }}>
                            <span>HSN Code</span>
                            <span>Description</span>
                            <span style={{ textAlign: 'center' }}>UQC</span>
                            <span style={{ textAlign: 'center' }}>Qty</span>
                            <span style={{ textAlign: 'right' }}>Total Value</span>
                            <span style={{ textAlign: 'right' }}>Taxable Value</span>
                            <span style={{ textAlign: 'center' }}>CGST%</span>
                            <span style={{ textAlign: 'right' }}>CGST</span>
                            <span style={{ textAlign: 'center' }}>SGST%</span>
                            <span style={{ textAlign: 'right' }}>SGST</span>
                            <span style={{ textAlign: 'right' }}>Total Tax</span>
                        </div>

                        {/* Rows */}
                        {data.hsnRows.map((row: any, i: number) => (
                            <motion.div
                                key={row.hsnCode}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: i * 0.1 }}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '0.7fr 2fr 0.4fr 0.5fr 0.8fr 0.8fr 0.5fr 0.7fr 0.5fr 0.7fr 0.7fr',
                                    padding: '14px 16px',
                                    borderBottom: '1px solid var(--glass-border)',
                                    fontSize: '0.85rem',
                                    background: i % 2 === 0 ? 'transparent' : 'var(--surface-hover)',
                                    alignItems: 'center',
                                }}
                            >
                                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary)', fontSize: '0.88rem' }}>{row.hsnCode}</span>
                                <span style={{ fontWeight: 500 }}>{row.description}</span>
                                <span style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>{row.uqc}</span>
                                <span style={{ textAlign: 'center', fontWeight: 600 }}>{row.totalQuantity.toLocaleString('en-IN')}</span>
                                <span style={{ textAlign: 'right', fontWeight: 500 }}>₹{row.totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                <span style={{ textAlign: 'right', fontWeight: 600 }}>₹{row.taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                <span style={{ textAlign: 'center', fontSize: '0.78rem' }}>{row.cgstRate}%</span>
                                <span style={{ textAlign: 'right' }}>₹{row.cgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                <span style={{ textAlign: 'center', fontSize: '0.78rem' }}>{row.sgstRate}%</span>
                                <span style={{ textAlign: 'right' }}>₹{row.sgstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                <span style={{ textAlign: 'right', fontWeight: 700, color: '#EF4444' }}>₹{row.totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                            </motion.div>
                        ))}

                        {/* Totals row */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '0.7fr 2fr 0.4fr 0.5fr 0.8fr 0.8fr 0.5fr 0.7fr 0.5fr 0.7fr 0.7fr',
                            padding: '14px 16px',
                            background: 'var(--primary)',
                            color: 'white',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                        }}>
                            <span>TOTAL</span>
                            <span></span>
                            <span></span>
                            <span></span>
                            <span style={{ textAlign: 'right' }}>₹{data.totals.totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                            <span style={{ textAlign: 'right' }}>₹{data.totals.taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                            <span></span>
                            <span style={{ textAlign: 'right' }}>₹{data.totals.totalCGST.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                            <span></span>
                            <span style={{ textAlign: 'right' }}>₹{data.totals.totalSGST.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                            <span style={{ textAlign: 'right' }}>₹{data.totals.totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* HSN Details Card */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 20 }}>
                {data?.hsnRows?.map((row: any) => (
                    <motion.div
                        key={row.hsnCode}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass-card"
                        style={{ padding: '16px 20px' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(244,81,30,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--primary)', fontSize: '0.82rem' }}>{row.hsnCode}</span>
                            </div>
                            <div>
                                <p style={{ fontSize: '0.88rem', fontWeight: 600 }}>{row.description}</p>
                                <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>GST Rate: {row.cgstRate + row.sgstRate}%</p>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <DetailRow label="Total Value" value={`₹${row.totalValue.toLocaleString('en-IN')}`} />
                            <DetailRow label="Taxable Value" value={`₹${row.taxableValue.toLocaleString('en-IN')}`} />
                            <DetailRow label={`CGST (${row.cgstRate}%)`} value={`₹${row.cgstAmount.toLocaleString('en-IN')}`} />
                            <DetailRow label={`SGST (${row.sgstRate}%)`} value={`₹${row.sgstAmount.toLocaleString('en-IN')}`} />
                            <DetailRow label="Quantity" value={row.totalQuantity.toLocaleString('en-IN')} />
                            <DetailRow label="Total Tax" value={`₹${row.totalTax.toLocaleString('en-IN')}`} highlight />
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Info box */}
            <div className="glass-card" style={{ padding: '14px 18px', marginTop: 16, background: 'rgba(244,81,30,0.04)', border: '1px solid rgba(244,81,30,0.12)' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>ℹ️ About HSN Summary</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.75rem', color: 'var(--foreground-secondary)', lineHeight: 1.6 }}>
                    <p><strong>HSN 9963:</strong> Restaurant services — Food items supplied through the platform. Taxed at 5% GST (2.5% CGST + 2.5% SGST) for restaurant services.</p>
                    <p><strong>HSN 996812:</strong> Courier & delivery services — Delivery charges collected from customers. Taxed at 18% GST (9% CGST + 9% SGST).</p>
                    <p><strong>HSN 998599:</strong> Other support services — Platform fees, packing fees, small order support fees. Taxed at 18% GST.</p>
                    <p style={{ fontStyle: 'italic', color: '#F59E0B' }}>This HSN summary is required for GSTR-1 monthly/quarterly return filing. Export as CSV and upload to the GST portal.</p>
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
                    <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                </div>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
                    {icon}
                </div>
            </div>
        </motion.div>
    );
}

function DetailRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div style={{ padding: '6px 8px', borderRadius: 6, background: highlight ? 'rgba(239,68,68,0.06)' : 'var(--surface-hover)' }}>
            <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</p>
            <p style={{ fontSize: '0.82rem', fontWeight: 600, color: highlight ? '#EF4444' : 'var(--foreground)' }}>{value}</p>
        </div>
    );
}





