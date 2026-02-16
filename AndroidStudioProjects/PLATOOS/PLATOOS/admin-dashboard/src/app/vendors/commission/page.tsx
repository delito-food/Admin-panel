'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Percent, RefreshCw, Search, Edit3, Check, X, AlertTriangle, Save, History, Loader2 } from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';

interface VendorCommission {
    vendorId: string; shopName: string; fullName: string; shopImageUrl: string; city: string;
    isVerified: boolean; isOnline: boolean; commissionRate: number; customCommission: boolean;
    commissionHistory: Array<{ previousRate: number; newRate: number; reason: string; changedAt: { seconds: number }; }>;
}
interface CommissionData { vendors: VendorCommission[]; platformDefaultRate: number; }

const fld: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' };

export default function CommissionSettingsPage() {
    const { data, loading, refetch } = useApi<CommissionData>('/api/vendors/commission');
    const [searchTerm, setSearchTerm] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [editingVendor, setEditingVendor] = useState<string | null>(null);
    const [newRate, setNewRate] = useState(15);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [showHistory, setShowHistory] = useState<string | null>(null);
    const [defaultRate, setDefaultRate] = useState(15);
    const [editingDefault, setEditingDefault] = useState(false);

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
    const handleEdit = (v: VendorCommission) => { setEditingVendor(v.vendorId); setNewRate(v.commissionRate); setReason(''); };

    const handleSave = async (vendorId: string) => {
        if (newRate < 0 || newRate > 100) { alert('Commission rate must be between 0 and 100'); return; }
        setSaving(true);
        try {
            const result = await apiPatch('/api/vendors/commission', { vendorId, commissionRate: newRate, reason: reason || 'Rate updated by admin' });
            if (result.success) { await refetch(); setEditingVendor(null); } else alert(result.error || 'Failed');
        } catch { alert('Failed to update commission'); }
        setSaving(false);
    };

    const handleDefaultSave = async () => {
        if (defaultRate < 0 || defaultRate > 100) { alert('Default rate must be between 0 and 100'); return; }
        setSaving(true);
        try {
            const r = await fetch('/api/vendors/commission', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultRate }) });
            const res = await r.json();
            if (res.success) { await refetch(); setEditingDefault(false); } else alert(res.error || 'Failed');
        } catch { alert('Failed to update default rate'); }
        setSaving(false);
    };

    const filteredVendors = data?.vendors.filter(v => v.shopName.toLowerCase().includes(searchTerm.toLowerCase()) || v.city.toLowerCase().includes(searchTerm.toLowerCase())) || [];

    if (loading) return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Commission Settings</h1>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}><Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} /></div>
        </div>
    );

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Commission Settings</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Set custom commission rates per vendor</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: 'white', border: 'none', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, fontWeight: 500, fontSize: '0.875rem' }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Platform Default Rate */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Percent size={22} color="white" />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Platform Default Commission</h3>
                            <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Applied to all vendors without custom rates</p>
                        </div>
                    </div>
                    {editingDefault ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="number" min="0" max="100" value={defaultRate} onChange={e => setDefaultRate(Number(e.target.value))} style={{ ...fld, width: 80, textAlign: 'center' }} />
                            <span style={{ fontSize: '1rem', fontWeight: 600 }}>%</span>
                            <button onClick={handleDefaultSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8, background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                                <Save size={14} /> {saving ? 'Saving...' : 'Save'}
                            </button>
                            <button onClick={() => setEditingDefault(false)} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={14} /></button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--primary)' }}>{data?.platformDefaultRate || 15}%</span>
                            <button onClick={() => { setDefaultRate(data?.platformDefaultRate || 15); setEditingDefault(true); }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>
                                <Edit3 size={14} /> Edit
                            </button>
                        </div>
                    )}
                </div>

                {/* GST Info */}
                <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: 'linear-gradient(135deg, rgba(168,85,247,0.06), rgba(59,130,246,0.06))', border: '1px solid rgba(168,85,247,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#A855F7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Percent size={14} color="white" />
                        </div>
                        <div>
                            <p style={{ fontWeight: 600, fontSize: '0.85rem', color: '#7C3AED' }}>GST on Commission: 18%</p>
                            <p style={{ fontSize: '0.78rem', color: '#8B5CF6', marginTop: 4 }}>An additional 18% GST is charged on the commission amount. This is the platform&apos;s earning.</p>
                            <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                <span style={{ fontWeight: 600 }}>Example:</span> For ₹1,000 order with {data?.platformDefaultRate || 15}% commission:
                                <ul style={{ marginTop: 4, marginLeft: 16, listStyle: 'disc', fontSize: '0.7rem', lineHeight: 1.8 }}>
                                    <li>Commission: ₹{((data?.platformDefaultRate || 15) * 10).toFixed(0)}</li>
                                    <li>GST (18%): ₹{((data?.platformDefaultRate || 15) * 10 * 0.18).toFixed(0)}</li>
                                    <li>Total Platform Earning: ₹{((data?.platformDefaultRate || 15) * 10 * 1.18).toFixed(0)}</li>
                                    <li>Vendor Receives: ₹{(1000 - (data?.platformDefaultRate || 15) * 10 * 1.18).toFixed(0)}</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Vendors Table */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden' }}>
                {/* Search */}
                <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ position: 'relative', maxWidth: 400 }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                        <input type="text" placeholder="Search vendors..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ ...fld, paddingLeft: 36, fontSize: '0.8rem' }} />
                    </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table-premium"><thead><tr>
                        <th>Vendor</th><th style={{ textAlign: 'center' }}>Current Rate</th><th style={{ textAlign: 'center' }}>Type</th><th style={{ textAlign: 'center' }}>Status</th><th style={{ textAlign: 'center' }}>Actions</th>
                    </tr></thead><tbody>
                            {filteredVendors.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>No vendors found</td></tr>
                                : filteredVendors.map(v => (
                                    <tr key={v.vendorId}>
                                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(40,137,144,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                                {v.shopImageUrl ? <img src={v.shopImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Store size={16} color="#288990" />}
                                            </div>
                                            <div><p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{v.shopName}</p><p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>{v.city}</p></div>
                                        </div></td>
                                        <td style={{ textAlign: 'center' }}>
                                            {editingVendor === v.vendorId ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <input type="number" min="0" max="100" value={newRate} onChange={e => setNewRate(Number(e.target.value))} style={{ ...fld, width: 60, textAlign: 'center', fontSize: '0.8rem' }} />
                                                        <span style={{ fontSize: '0.85rem' }}>%</span>
                                                    </div>
                                                    <input type="text" placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} style={{ ...fld, fontSize: '0.75rem' }} />
                                                </div>
                                            ) : <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{v.commissionRate}%</span>}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ padding: '3px 10px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 600, background: v.customCommission ? 'rgba(168,85,247,0.1)' : 'rgba(107,114,128,0.1)', color: v.customCommission ? '#A855F7' : '#6B7280' }}>
                                                {v.customCommission ? 'Custom' : 'Default'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {v.isVerified
                                                ? <span style={{ fontSize: '0.78rem', color: '#10B981', fontWeight: 500 }}>Verified</span>
                                                : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: '#F59E0B', fontWeight: 500 }}><AlertTriangle size={12} /> Pending</span>}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {editingVendor === v.vendorId ? (
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                    <button onClick={() => handleSave(v.vendorId)} disabled={saving} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(16,185,129,0.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={14} color="#10B981" /></button>
                                                    <button onClick={() => setEditingVendor(null)} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} color="#EF4444" /></button>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                    <button onClick={() => handleEdit(v)} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(40,137,144,0.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Edit3 size={14} color="#288990" /></button>
                                                    {v.commissionHistory?.length > 0 && (
                                                        <button onClick={() => setShowHistory(v.vendorId === showHistory ? null : v.vendorId)} style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><History size={14} color="var(--foreground-secondary)" /></button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                        </tbody></table>
                </div>
            </motion.div>

            {/* History Modal */}
            <AnimatePresence>{showHistory && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowHistory(null)}>
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={e => e.stopPropagation()} className="glass-card" style={{ padding: 24, maxWidth: 420, width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><History size={18} /> Commission History</h3>
                            <button onClick={() => setShowHistory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)' }}><X size={18} /></button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '60vh', overflowY: 'auto' }}>
                            {data?.vendors.find(v => v.vendorId === showHistory)?.commissionHistory.slice().reverse().map((h, i) => (
                                <div key={i} style={{ padding: 12, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                        <span style={{ fontWeight: 600, color: '#EF4444', fontSize: '0.85rem' }}>{h.previousRate}%</span>
                                        <span style={{ color: 'var(--foreground-secondary)' }}>→</span>
                                        <span style={{ fontWeight: 600, color: '#10B981', fontSize: '0.85rem' }}>{h.newRate}%</span>
                                    </div>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>{h.reason}</p>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 4, opacity: 0.7 }}>
                                        {new Date(h.changedAt.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </motion.div>
            )}</AnimatePresence>
        </motion.div>
    );
}
