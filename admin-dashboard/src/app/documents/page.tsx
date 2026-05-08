'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    FileText, Search, RefreshCw, Store, Bike, CheckCircle, XCircle,
    Eye, X, Loader2, Shield, CreditCard, Building2, Car, Phone,
    Mail, MapPin, ExternalLink, AlertTriangle, Download,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';

type Tab = 'vendors' | 'delivery';

function fmt(n: any): string { const v = Number(n); return isNaN(v) ? '0' : v.toLocaleString('en-IN'); }

export default function DocumentsPage() {
    const { data, loading, refetch } = useApi<any>('/api/documents');
    const [tab, setTab] = useState<Tab>('vendors');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<any>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<'all' | 'verified' | 'unverified' | 'missing'>('all');

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setTimeout(() => setRefreshing(false), 400); };

    const summary = data?.summary || {};
    const items: any[] = tab === 'vendors' ? (data?.vendors || []) : (data?.deliveryPartners || []);

    const filtered = useMemo(() => {
        let list = items;
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(i => i.name?.toLowerCase().includes(q) || i.phone?.includes(q) || i.pan?.toLowerCase().includes(q) || i.ownerName?.toLowerCase().includes(q) || i.email?.toLowerCase().includes(q));
        }
        if (filter === 'verified') list = list.filter(i => i.isVerified);
        if (filter === 'unverified') list = list.filter(i => !i.isVerified);
        if (filter === 'missing') {
            if (tab === 'vendors') list = list.filter(i => !i.pan || !i.gstin || !i.fssaiLicense || !i.bankPassbookUrl);
            else list = list.filter(i => !i.pan || !i.driverLicenseNumber || !i.vehicleDocumentUrl || !i.bankPassbookUrl);
        }
        return list;
    }, [items, search, filter, tab]);

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1 className="page-title"><FileText size={28} style={{ color: 'var(--primary)' }} /> Document Details</h1>
                    <p className="page-subtitle">Vendor & Delivery Partner KYC, Licenses, and Bank Details</p>
                </div>
                <button onClick={handleRefresh} className="btn btn-outline" disabled={refreshing}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <TabBtn active={tab === 'vendors'} onClick={() => { setTab('vendors'); setSelected(null); }} icon={<Store size={18} />} label="Vendors" count={summary.totalVendors || 0} color="#F4511E" />
                <TabBtn active={tab === 'delivery'} onClick={() => { setTab('delivery'); setSelected(null); }} icon={<Bike size={18} />} label="Delivery Partners" count={summary.totalDP || 0} color="#8B5CF6" />
            </div>

            {/* Summary Cards */}
            {!loading && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {tab === 'vendors' ? (<>
                        <Stat label="Total Vendors" value={fmt(summary.totalVendors)} color="#F4511E" />
                        <Stat label="Verified" value={fmt(summary.verifiedVendors)} color="#10B981" />
                        <Stat label="With PAN" value={fmt(summary.vendorsWithPAN)} color="#3B82F6" />
                        <Stat label="With GSTIN" value={fmt(summary.vendorsWithGST)} color="#F59E0B" />
                        <Stat label="With FSSAI" value={fmt(summary.vendorsWithFSSAI)} color="#8B5CF6" />
                    </>) : (<>
                        <Stat label="Total Partners" value={fmt(summary.totalDP)} color="#8B5CF6" />
                        <Stat label="Verified" value={fmt(summary.verifiedDP)} color="#10B981" />
                        <Stat label="With PAN" value={fmt(summary.dpWithPAN)} color="#3B82F6" />
                        <Stat label="With License" value={fmt(summary.dpWithLicense)} color="#F59E0B" />
                        <Stat label="With Vehicle Doc" value={fmt(summary.dpWithVehicleDoc)} color="#EF4444" />
                    </>)}
                </div>
            )}

            {/* Filters */}
            <div className="glass-card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                    <input type="text" placeholder="Search name, phone, PAN, email..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '8px 10px 8px 30px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.82rem', outline: 'none' }} />
                </div>
                {(['all', 'verified', 'unverified', 'missing'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 20, border: filter === f ? '2px solid var(--primary)' : '1px solid var(--glass-border)', background: filter === f ? 'rgba(244,81,30,0.1)' : 'var(--surface)', color: filter === f ? 'var(--primary)' : 'var(--foreground-secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                        {f === 'missing' ? '⚠ Missing Docs' : f}
                    </button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>{filtered.length} results</span>
            </div>

            {/* Table */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={32} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
            ) : (
                <div className="glass-card" style={{ overflow: 'auto' }}>
                    <div style={{ minWidth: tab === 'vendors' ? 1000 : 950 }}>
                        {tab === 'vendors' ? (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.8fr 0.8fr 0.8fr 0.5fr 0.5fr', padding: '10px 14px', background: 'var(--surface-hover)', borderBottom: '1px solid var(--glass-border)', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-secondary)' }}>
                                    <span>Vendor</span><span>PAN</span><span>GSTIN</span><span>FSSAI</span><span>Bank</span><span>Status</span><span>View</span>
                                </div>
                                {filtered.length === 0 ? <Empty /> : filtered.map((v: any, i: number) => (
                                    <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.8fr 0.8fr 0.8fr 0.5fr 0.5fr', padding: '10px 14px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.82rem', background: i % 2 === 0 ? 'transparent' : 'var(--surface-hover)', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {v.profileImageUrl ? <img src={v.profileImageUrl} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover' }} /> : <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Store size={14} /></div>}
                                            <div><p style={{ fontWeight: 600, fontSize: '0.82rem' }}>{v.name}</p><p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>{v.phone}</p></div>
                                        </div>
                                        <DocBadge value={v.pan} />
                                        <DocBadge value={v.gstin} />
                                        <DocBadge value={v.fssaiLicense} />
                                        <DocBadge value={v.bankAccountNumber} label={v.bankName ? `${v.bankName}` : ''} />
                                        <span>{v.isVerified ? <CheckCircle size={16} style={{ color: '#10B981' }} /> : <XCircle size={16} style={{ color: '#EF4444' }} />}</span>
                                        <button onClick={() => setSelected(v)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(244,81,30,0.1)', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}><Eye size={13} /> View</button>
                                    </div>
                                ))}
                            </>
                        ) : (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 0.5fr 0.5fr', padding: '10px 14px', background: 'var(--surface-hover)', borderBottom: '1px solid var(--glass-border)', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--foreground-secondary)' }}>
                                    <span>Partner</span><span>PAN</span><span>Aadhaar</span><span>License</span><span>Vehicle</span><span>Status</span><span>View</span>
                                </div>
                                {filtered.length === 0 ? <Empty /> : filtered.map((d: any, i: number) => (
                                    <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 0.8fr 0.8fr 0.8fr 0.5fr 0.5fr', padding: '10px 14px', borderBottom: '1px solid var(--glass-border)', fontSize: '0.82rem', background: i % 2 === 0 ? 'transparent' : 'var(--surface-hover)', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {d.profilePhotoUrl ? <img src={d.profilePhotoUrl} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover' }} /> : <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Bike size={14} /></div>}
                                            <div><p style={{ fontWeight: 600, fontSize: '0.82rem' }}>{d.name}</p><p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>{d.phone}</p></div>
                                        </div>
                                        <DocBadge value={d.pan} />
                                        <DocBadge value={d.aadhaarNumber} />
                                        <DocBadge value={d.driverLicenseNumber} />
                                        <DocBadge value={d.vehicleNumber} label={d.vehicleType} />
                                        <span>{d.isVerified ? <CheckCircle size={16} style={{ color: '#10B981' }} /> : <XCircle size={16} style={{ color: '#EF4444' }} />}</span>
                                        <button onClick={() => setSelected(d)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(139,92,246,0.1)', color: '#8B5CF6', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}><Eye size={13} /> View</button>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Detail Modal */}
            <AnimatePresence>
                {selected && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 40, overflowY: 'auto' }} onClick={() => setSelected(null)}>
                        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} onClick={e => e.stopPropagation()} className="glass-card" style={{ width: '100%', maxWidth: 700, margin: '0 20px 40px', padding: 0, overflow: 'hidden' }}>
                            {/* Modal Header */}
                            <div style={{ padding: '16px 20px', background: tab === 'vendors' ? '#F4511E' : '#8B5CF6', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    {(selected.profileImageUrl || selected.profilePhotoUrl) ? <img src={selected.profileImageUrl || selected.profilePhotoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} /> : <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{tab === 'vendors' ? <Store size={22} /> : <Bike size={22} />}</div>}
                                    <div>
                                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{selected.name}</h3>
                                        <p style={{ fontSize: '0.78rem', opacity: 0.9 }}>{selected.ownerName ? `Owner: ${selected.ownerName}` : selected.vehicleType ? `${selected.vehicleType} • ${selected.vehicleNumber}` : ''}</p>
                                    </div>
                                </div>
                                <button onClick={() => setSelected(null)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: 'white' }}><X size={18} /></button>
                            </div>

                            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {/* Contact info */}
                                <Section title="Contact Information">
                                    <Row icon={<Phone size={14} />} label="Phone" value={selected.phone} />
                                    <Row icon={<Mail size={14} />} label="Email" value={selected.email} />
                                    <Row icon={<MapPin size={14} />} label="Address" value={[selected.address, selected.city, selected.pincode].filter(Boolean).join(', ')} />
                                </Section>

                                {/* Documents */}
                                <Section title="Documents & KYC">
                                    <DocRow label="PAN" number={selected.pan} url={selected.panUrl} />
                                    {selected.type === 'vendor' ? (<>
                                        <DocRow label="GSTIN" number={selected.gstin} url={selected.gstCertificateUrl} />
                                        <DocRow label="FSSAI License" number={selected.fssaiLicense} url={selected.fssaiUrl} />
                                        <DocRow label="Aadhaar" number={selected.aadhaarNumber} url={selected.aadhaarUrl} url2={selected.aadhaarBackUrl} />
                                        <DocRow label="Shop License" number="" url={selected.shopLicenseUrl} />
                                        {selected.shopImageUrl && <DocRow label="Shop Photo" number="" url={selected.shopImageUrl} />}
                                        <DocRow label="Bank Passbook 📋" number="" url={selected.bankPassbookUrl || selected.bankProofUrl} required />
                                    </>) : (<>
                                        <DocRow label="Aadhaar" number={selected.aadhaarNumber} url={selected.aadhaarFrontUrl} url2={selected.aadhaarBackUrl} />
                                        <DocRow label="Driver License" number={selected.driverLicenseNumber} url={selected.driverLicenseUrl} />
                                        <DocRow label="Vehicle RC" number={selected.vehicleNumber} url={selected.vehicleDocumentUrl} />
                                        {selected.vehicleInsuranceUrl && <DocRow label="Insurance" number="" url={selected.vehicleInsuranceUrl} />}
                                        <DocRow label="Bank Passbook 📋" number="" url={selected.bankPassbookUrl} required />
                                    </>)}
                                </Section>

                                {/* Bank Details */}
                                <Section title="Bank Details">
                                    <Row icon={<Building2 size={14} />} label="Bank" value={selected.bankName} />
                                    <Row icon={<CreditCard size={14} />} label="Account No." value={selected.bankAccountNumber} masked />
                                    <Row icon={<Building2 size={14} />} label="IFSC" value={selected.ifscCode} />
                                    <Row icon={<CreditCard size={14} />} label="UPI ID" value={selected.upiId} />
                                </Section>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Subcomponents ──

function TabBtn({ active, onClick, icon, label, count, color }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number; color: string }) {
    return (
        <button onClick={onClick} style={{ flex: '1 1 0', padding: '14px 16px', borderRadius: 12, border: active ? `2px solid ${color}` : '1px solid var(--glass-border)', background: active ? `${color}10` : 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</div>
                <div>
                    <p style={{ fontSize: '0.88rem', fontWeight: 700, color: active ? color : 'var(--foreground)' }}>{label}</p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>{count} total</p>
                </div>
            </div>
        </button>
    );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: '10px 14px' }}>
            <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</p>
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color }}>{value}</p>
        </motion.div>
    );
}

function DocBadge({ value, label }: { value: string; label?: string }) {
    if (!value) return <span style={{ fontSize: '0.72rem', color: '#EF4444', display: 'flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={12} /> Missing</span>;
    return (
        <div>
            <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{value.length > 14 ? value.slice(0, 6) + '...' + value.slice(-4) : value}</span>
            {label && <p style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)' }}>{label}</p>}
        </div>
    );
}

function Empty() { return <div style={{ padding: 30, textAlign: 'center', color: 'var(--foreground-secondary)', fontSize: '0.85rem' }}>No results found</div>; }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{title}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface-hover)', borderRadius: 10, padding: 12 }}>{children}</div>
        </div>
    );
}

function Row({ icon, label, value, masked }: { icon: React.ReactNode; label: string; value: string; masked?: boolean }) {
    if (!value) return null;
    const display = masked && value.length > 6 ? value.slice(0, 4) + '****' + value.slice(-4) : value;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--foreground-secondary)' }}>{icon}</span>
            <span style={{ color: 'var(--foreground-secondary)', minWidth: 90, fontSize: '0.75rem' }}>{label}:</span>
            <span style={{ fontWeight: 500 }}>{display}</span>
        </div>
    );
}

function DocRow({ label, number, url, url2, required }: { label: string; number: string; url: string; url2?: string; required?: boolean }) {
    const hasDocs = !!number || !!url;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', padding: '6px 0', borderBottom: '1px solid var(--glass-border)' }}>
            <span style={{ minWidth: 110, fontSize: '0.75rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {required && !hasDocs && <AlertTriangle size={11} color="#EF4444" />}
                {label}:
            </span>
            {number ? <span style={{ fontFamily: 'monospace', fontWeight: 500, fontSize: '0.82rem' }}>{number}</span> : !url && <span style={{ color: required ? '#EF4444' : '#F59E0B', fontSize: '0.75rem', fontWeight: required ? 600 : 400 }}>{required ? '⚠️ Not uploaded (Required)' : 'Not provided'}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(244,81,30,0.1)', color: 'var(--primary)', fontSize: '0.68rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={11} /> View</a>}
                {url2 && <a href={url2} target="_blank" rel="noopener noreferrer" style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.1)', color: '#8B5CF6', fontSize: '0.68rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={11} /> Back</a>}
            </span>
        </div>
    );
}

