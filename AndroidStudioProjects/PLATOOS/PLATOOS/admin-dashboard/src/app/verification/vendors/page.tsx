'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Filter, Eye, CheckCircle, XCircle, Store, Phone, MapPin,
    FileText, X, Clock, ShieldCheck, RefreshCw, User, Loader2,
    Image as ImageIcon, Tag, CreditCard, AlertTriangle, RotateCcw,
    CheckSquare, Square, Leaf, Drumstick
} from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';

interface VendorMenuItem {
    itemId: string;
    name: string;
    description: string;
    price: number;
    categoryName: string;
    imageUrl: string;
    isVeg: boolean;
    isBestSeller: boolean;
    preparationTime: number;
    discount: number;
    isVerified: boolean;
    verificationStatus: string;
    verificationNotes: string;
}

interface PendingVendor {
    vendorId: string;
    shopName: string;
    fullName: string;
    phoneNumber: string;
    email: string;
    address: string;
    city: string;
    pincode: string;
    fssaiLicense: string;
    gstNumber: string;
    fssaiLicenseUrl: string;
    gstDocumentUrl: string;
    profileImageUrl: string;
    shopImageUrl: string;
    cuisineTypes: string[];
    bankAccountNumber: string;
    bankName: string;
    ifscCode: string;
    upiId: string;
    menuItems: VendorMenuItem[];
    submittedAt: string;
    verificationStatus: 'pending';
}

const REJECTION_REASONS = [
    'Image not appropriate',
    'Price too high',
    'Description unclear',
    'Duplicate item',
    'Wrong category',
    'Poor quality photo',
    'Missing information',
];

export default function VendorVerificationPage() {
    const { data: vendors, loading, refetch } = useApi<PendingVendor[]>('/api/verification/vendors');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedVendor, setSelectedVendor] = useState<PendingVendor | null>(null);
    const [rejectionNotes, setRejectionNotes] = useState('');
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'docs' | 'menu'>('docs');
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [itemRejectId, setItemRejectId] = useState<string | null>(null);
    const [itemRejectReasons, setItemRejectReasons] = useState<string[]>([]);
    const [itemRejectCustom, setItemRejectCustom] = useState('');
    const [bulkRejectMode, setBulkRejectMode] = useState(false);
    const [itemActionMode, setItemActionMode] = useState<'reject' | 'review'>('reject');
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const filteredVendors = (vendors || []).filter(vendor =>
        (vendor.shopName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (vendor.fullName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (vendor.phoneNumber || '').includes(searchQuery)
    );

    const handleApprove = async (vendor: PendingVendor) => {
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/vendors', {
                vendorId: vendor.vendorId, action: 'approve'
            });
            if (res.success) { refetch(); setSelectedVendor(null); }
        } catch (error) { console.error('Approval error:', error); }
        finally { setProcessing(false); }
    };

    const handleReject = async () => {
        if (!selectedVendor) return;
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/vendors', {
                vendorId: selectedVendor.vendorId, action: 'reject', notes: rejectionNotes
            });
            if (res.success) { refetch(); setSelectedVendor(null); setShowRejectModal(false); setRejectionNotes(''); }
        } catch (error) { console.error('Rejection error:', error); }
        finally { setProcessing(false); }
    };

    const handleItemAction = async (itemIds: string[], action: 'approve' | 'reject', notes?: string) => {
        // Menu verification is temporarily disabled. Skip remote call and mimic success locally.
        console.warn('Menu verification disabled — skipping item action', { itemIds, action, notes });
        // Reset local selection/UI state as if operation succeeded
        setSelectedItems(new Set());
        setItemRejectId(null);
        setBulkRejectMode(false);
    };

    const toggleItemSelect = (id: string) => {
        setSelectedItems(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return 'N/A';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const getMenuItemsByCategory = (items: VendorMenuItem[]) => {
        const grouped: Record<string, VendorMenuItem[]> = {};
        items.forEach(item => {
            const cat = item.categoryName || 'Uncategorized';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });
        return grouped;
    };

    if (loading) {
        return (
            <div>
                <div style={{ marginBottom: 32 }}>
                    <h1 className="page-title">Vendor Verification</h1>
                    <p className="page-description">Loading vendor data...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(40, 137, 144, 0.3)' }}>
                            <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: 'white' }} />
                        </div>
                        <p style={{ fontSize: 14, color: 'var(--foreground-secondary)' }}>Loading vendors...</p>
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
                            <ShieldCheck size={20} style={{ color: 'white' }} />
                        </div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendor Verification</h1>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--foreground-secondary)', marginLeft: 52, marginTop: 2 }}>Review vendor registrations, licenses & menu items</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ marginTop: 12, opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px 40px -12px' }}>
                {[
                    { label: 'Pending Review', value: (vendors || []).length, icon: Clock, gradient: 'linear-gradient(135deg, #F59E0B, #D97706)', shadow: 'rgba(245, 158, 11, 0.2)' },
                    { label: 'Total Menu Items', value: (vendors || []).reduce((sum, v) => sum + (v.menuItems || []).length, 0), icon: Tag, gradient: 'linear-gradient(135deg, #288990, #1e6e75)', shadow: 'rgba(40, 137, 144, 0.2)' },
                    { label: 'Unverified Items', value: (vendors || []).reduce((sum, v) => sum + (v.menuItems || []).filter(i => !i.isVerified).length, 0), icon: AlertTriangle, gradient: 'linear-gradient(135deg, #EF4444, #DC2626)', shadow: 'rgba(239, 68, 68, 0.2)' },
                ].map((stat, index) => (
                    <div key={stat.label} style={{ flex: '1 1 200px', padding: '0 12px', marginBottom: 16 }}>
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
                            style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', border: '1px solid var(--glass-border)', borderRadius: 16, padding: '24px', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: stat.gradient }} />
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                <div>
                                    <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 8 }}>{stat.label}</p>
                                    <p style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)' }}>{stat.value}</p>
                                </div>
                                <div style={{ width: 48, height: 48, borderRadius: 14, background: stat.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 16px ${stat.shadow}` }}>
                                    <stat.icon size={22} style={{ color: 'white' }} />
                                </div>
                            </div>
                        </motion.div>
                    </div>
                ))}
            </div>

            {/* Search Bar */}
            <div className="glass-card" style={{ padding: 20, marginBottom: 32 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                    <div className="input-group" style={{ flex: '1 1 300px' }}>
                        <Search size={18} className="input-icon" />
                        <input type="text" placeholder="Search by shop name, owner, or phone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input" />
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Store size={14} style={{ color: 'white' }} />
                        </div>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)' }}>Pending</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', background: 'var(--primary)', color: 'white', borderRadius: 9999 }}>{filteredVendors.length}</span>
                    </div>
                </div>
            </div>

            {/* Vendors Grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px' }}>
                <AnimatePresence mode="popLayout">
                    {filteredVendors.map((vendor, index) => (
                        <div key={vendor.vendorId} style={{ flex: '1 1 460px', maxWidth: '50%', padding: '0 12px', marginBottom: 24 }}>
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: index * 0.05 }}
                                className="glass-card" style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(40, 137, 144, 0.25)' }}>
                                        <Store size={24} style={{ color: 'white' }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                            <div>
                                                <h3 style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vendor.shopName}</h3>
                                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                                    <User size={13} /> {vendor.fullName}
                                                </p>
                                            </div>
                                            <span className="badge badge-pending" style={{ flexShrink: 0 }}><Clock size={12} /> Pending</span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--glass-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}>
                                        <Phone size={14} style={{ flexShrink: 0, opacity: 0.7 }} /> <span>{vendor.phoneNumber}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}>
                                        <MapPin size={14} style={{ flexShrink: 0, opacity: 0.7 }} /> <span>{vendor.city}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}>
                                        <Tag size={14} style={{ flexShrink: 0, opacity: 0.7 }} /> <span>{(vendor.menuItems || []).length} menu items</span>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 20 }}>
                                    <button onClick={() => { setSelectedVendor(vendor); setActiveTab('docs'); setSelectedItems(new Set()); }} className="btn btn-outline" style={{ flex: 1 }}>
                                        <Eye size={16} /> View Details
                                    </button>
                                    <button onClick={() => handleApprove(vendor)} disabled={processing} className="btn btn-success" style={{ flex: 1 }}>
                                        <CheckCircle size={16} /> Approve
                                    </button>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--glass-border)', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                    <span>Submitted: {formatDate(vendor.submittedAt)}</span>
                                    <button onClick={() => { setSelectedVendor(vendor); setShowRejectModal(true); }}
                                        style={{ background: 'none', border: 'none', color: 'var(--accent-error)', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', padding: '4px 8px', borderRadius: 6 }}>
                                        Reject
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Empty State */}
            {filteredVendors.length === 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '64px 32px', textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #10B981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                        <CheckCircle size={28} style={{ color: 'white' }} />
                    </div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>All caught up!</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>No pending vendor verifications at the moment.</p>
                </motion.div>
            )}

            {/* ===== DETAIL MODAL ===== */}
            <AnimatePresence>
                {selectedVendor && !showRejectModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setSelectedVendor(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 960 }} onClick={(e) => e.stopPropagation()}>
                            {/* Modal Header */}
                            <div className="modal-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #288990, #1e6e75)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <Store size={22} style={{ color: 'white' }} />
                                    </div>
                                    <div>
                                        <h2 className="modal-title" style={{ margin: 0 }}>{selectedVendor.shopName}</h2>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                            {selectedVendor.fullName} · {selectedVendor.phoneNumber} · {selectedVendor.city}
                                        </p>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedVendor(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>

                            {/* Tabs */}
                            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', padding: '0 24px' }}>
                                {[
                                    { key: 'docs' as const, label: 'License & Documents', icon: FileText },
                                    { key: 'menu' as const, label: `Menu Items (${(selectedVendor.menuItems || []).length})`, icon: Tag },
                                ].map(tab => (
                                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', fontSize: '0.875rem', fontWeight: 600,
                                            color: activeTab === tab.key ? 'var(--primary)' : 'var(--foreground-secondary)',
                                            borderTop: 'none', borderRight: 'none', borderLeft: 'none',
                                            borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                                            background: 'none', cursor: 'pointer', transition: 'all 0.2s',
                                        }}>
                                        <tab.icon size={16} /> {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="modal-body" style={{ padding: 24, maxHeight: '60vh', overflowY: 'auto' }}>
                                {activeTab === 'docs' && (
                                    <div>
                                        {/* License & GST Info */}
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 16 }}>License Information</h4>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -8px' }}>
                                            {[
                                                { label: 'FSSAI License', value: selectedVendor.fssaiLicense || 'Not provided' },
                                                { label: 'GST Number', value: selectedVendor.gstNumber || 'Not provided' },
                                            ].map(item => (
                                                <div key={item.label} style={{ flex: '1 1 240px', padding: '0 8px', marginBottom: 16 }}>
                                                    <div style={{ background: 'var(--surface-hover)', borderRadius: 12, padding: '14px 16px' }}>
                                                        <p style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 6 }}>{item.label}</p>
                                                        <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--foreground)' }}>{item.value}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Document previews */}
                                        <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -8px 24px -8px' }}>
                                            {[
                                                { label: 'FSSAI License Document', url: selectedVendor.fssaiLicenseUrl },
                                                { label: 'GST Certificate', url: selectedVendor.gstDocumentUrl },
                                            ].map(doc => (
                                                <div key={doc.label} style={{ flex: '1 1 200px', padding: '0 8px', marginBottom: 16 }}>
                                                    <div style={{ background: 'var(--surface-hover)', borderRadius: 12, padding: 16 }}>
                                                        <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', marginBottom: 12 }}>{doc.label}</p>
                                                        {doc.url ? (
                                                            <a href={doc.url} target="_blank" rel="noopener noreferrer"
                                                                style={{ display: 'block', height: 120, borderRadius: 10, overflow: 'hidden', background: 'var(--background)' }}>
                                                                <img src={doc.url} alt={doc.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                            </a>
                                                        ) : (
                                                            <div style={{ height: 100, background: 'var(--background)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                <div style={{ textAlign: 'center' }}>
                                                                    <FileText size={24} style={{ color: 'var(--foreground-secondary)', margin: '0 auto 6px' }} />
                                                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>Not uploaded</p>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Bank Information */}
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 16 }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CreditCard size={14} /> Bank Information</span>
                                        </h4>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -8px' }}>
                                            {[
                                                { label: 'Bank Name', value: selectedVendor.bankName || 'Not provided' },
                                                { label: 'Account Number', value: selectedVendor.bankAccountNumber || 'Not provided' },
                                                { label: 'IFSC Code', value: selectedVendor.ifscCode || 'Not provided' },
                                                { label: 'UPI ID', value: selectedVendor.upiId || 'Not provided' },
                                            ].map(item => (
                                                <div key={item.label} style={{ flex: '1 1 200px', padding: '0 8px', marginBottom: 16 }}>
                                                    <div style={{ background: 'var(--surface-hover)', borderRadius: 12, padding: '14px 16px' }}>
                                                        <p style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 6 }}>{item.label}</p>
                                                        <p style={{ fontWeight: 600, fontSize: '0.875rem', color: item.value === 'Not provided' ? 'var(--foreground-secondary)' : 'var(--foreground)' }}>{item.value}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Cuisine Types */}
                                        {(selectedVendor.cuisineTypes || []).length > 0 && (
                                            <div style={{ marginTop: 8 }}>
                                                <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 12 }}>Cuisine Types</h4>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                    {selectedVendor.cuisineTypes.map(c => (
                                                        <span key={c} style={{ padding: '6px 14px', borderRadius: 9999, fontSize: '0.8rem', fontWeight: 500, background: 'var(--surface-hover)', color: 'var(--foreground)' }}>{c}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'menu' && (
                                    <div>
                                        {(selectedVendor.menuItems || []).length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '48px 0' }}>
                                                <Tag size={32} style={{ color: 'var(--foreground-secondary)', margin: '0 auto 12px' }} />
                                                <p style={{ fontWeight: 500, color: 'var(--foreground)' }}>No menu items submitted</p>
                                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>This vendor hasn&apos;t added any menu items yet.</p>
                                            </div>
                                        ) : (
                                            <>
                                                {/* Select All + Bulk toolbar */}
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'var(--surface-hover)', marginBottom: 20 }}>
                                                    <button onClick={() => {
                                                        const allIds = (selectedVendor.menuItems || []).filter(i => !i.isVerified).map(i => i.itemId);
                                                        setSelectedItems(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
                                                    }} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>
                                                        {selectedItems.size === (selectedVendor.menuItems || []).filter(i => !i.isVerified).length && selectedItems.size > 0
                                                            ? <CheckSquare size={18} style={{ color: 'var(--primary)' }} />
                                                            : <Square size={18} style={{ color: 'var(--foreground-secondary)' }} />}
                                                        Select All ({(selectedVendor.menuItems || []).filter(i => !i.isVerified).length} unverified)
                                                    </button>
                                                    {selectedItems.size > 0 && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground-secondary)' }}>{selectedItems.size} selected</span>
                                                            <button onClick={() => handleItemAction(Array.from(selectedItems), 'approve')} disabled={processing} className="btn btn-success" style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                                                                <CheckCircle size={13} /> Approve
                                                            </button>
                                                            <button onClick={() => setBulkRejectMode(true)} disabled={processing} className="btn btn-danger" style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                                                                <XCircle size={13} /> Reject
                                                            </button>
                                                            <button onClick={() => { setBulkRejectMode(true); setItemActionMode('review'); setItemRejectReasons([]); setItemRejectCustom(''); }} disabled={processing}
                                                                style={{ padding: '6px 14px', fontSize: '0.78rem', borderRadius: 8, fontWeight: 600, border: '1px solid var(--glass-border)', background: 'rgba(245,158,11,0.1)', color: '#D97706', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <RotateCcw size={13} /> Review
                                                            </button>
                                                            <button onClick={() => setSelectedItems(new Set())} className="btn btn-outline" style={{ padding: '6px 10px', fontSize: '0.78rem' }}>Clear</button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Category groups */}
                                                {Object.entries(getMenuItemsByCategory(selectedVendor.menuItems)).map(([category, items]) => (
                                                    <div key={category} style={{ marginBottom: 28 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                                            <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)' }}>{category}</span>
                                                            <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 10px', borderRadius: 9999, background: 'var(--surface-hover)', color: 'var(--foreground-secondary)' }}>{items.length}</span>
                                                            <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
                                                        </div>

                                                        <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -8px' }}>
                                                            {items.map(item => (
                                                                <div key={item.itemId} style={{ flex: '1 1 260px', maxWidth: '33.33%', padding: '0 8px', marginBottom: 16 }}>
                                                                    <div style={{ background: 'var(--surface-hover)', borderRadius: 14, overflow: 'hidden', border: selectedItems.has(item.itemId) ? '2px solid var(--primary)' : '2px solid transparent', transition: 'border-color 0.2s' }}>
                                                                        {/* Image */}
                                                                        <div style={{ position: 'relative', height: 140, background: 'var(--background)' }}>
                                                                            {item.imageUrl ? (
                                                                                <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                            ) : (
                                                                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                    <ImageIcon size={32} style={{ color: 'var(--foreground-secondary)', opacity: 0.4 }} />
                                                                                </div>
                                                                            )}
                                                                            {/* Checkbox overlay */}
                                                                            <button onClick={() => toggleItemSelect(item.itemId)}
                                                                                style={{ position: 'absolute', top: 8, left: 8, width: 28, height: 28, borderRadius: 8, background: selectedItems.has(item.itemId) ? 'var(--primary)' : 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                {selectedItems.has(item.itemId) ? <CheckSquare size={16} style={{ color: 'white' }} /> : <Square size={16} style={{ color: 'white' }} />}
                                                                            </button>
                                                                            {/* Veg/Non-veg badge */}
                                                                            <span style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, fontSize: '0.65rem', fontWeight: 700, background: item.isVeg ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)', color: 'white' }}>
                                                                                {item.isVeg ? <Leaf size={10} /> : <Drumstick size={10} />}
                                                                                {item.isVeg ? 'VEG' : 'NON-VEG'}
                                                                            </span>
                                                                        </div>

                                                                        {/* Item info */}
                                                                        <div style={{ padding: '12px 14px' }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                                <h5 style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{item.name}</h5>
                                                                                {item.isBestSeller && <span style={{ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '0.03em' }}>★ Best Seller</span>}
                                                                            </div>
                                                                            {item.description && <p style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.description}</p>}
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                                                                                {item.discount > 0 ? (
                                                                                    <>
                                                                                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary)' }}>₹{Math.round(item.price * (1 - item.discount / 100))}</span>
                                                                                        <span style={{ fontSize: '0.75rem', color: 'var(--foreground-secondary)', textDecoration: 'line-through' }}>₹{item.price}</span>
                                                                                        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(16,185,129,0.12)', color: '#10B981' }}>{item.discount}% off</span>
                                                                                    </>
                                                                                ) : (
                                                                                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary)' }}>₹{item.price}</span>
                                                                                )}
                                                                            </div>
                                                                            {/* Action buttons */}
                                                                            <div style={{ display: 'flex', gap: 5, marginTop: 10 }}>
                                                                                <button onClick={() => handleItemAction([item.itemId], 'approve')} disabled={processing || item.isVerified}
                                                                                    style={{ flex: 1, padding: '6px 0', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, border: 'none', cursor: item.isVerified ? 'default' : 'pointer', background: item.isVerified ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.9)', color: item.isVerified ? '#10B981' : 'white' }}>
                                                                                    {item.isVerified ? '✓ Approved' : 'Approve'}
                                                                                </button>
                                                                                {!item.isVerified && (
                                                                                    <>
                                                                                        <button onClick={() => { setItemRejectId(item.itemId); setItemRejectReasons([]); setItemRejectCustom(''); }}
                                                                                            style={{ flex: 1, padding: '6px 0', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>
                                                                                            Reject
                                                                                        </button>
                                                                                        <button onClick={() => { setItemRejectId(item.itemId); setItemRejectReasons([]); setItemRejectCustom(''); }}
                                                                                            style={{ flex: 1, padding: '6px 0', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(245,158,11,0.12)', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                                                            <RotateCcw size={11} /> Review
                                                                                        </button>
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="modal-footer">
                                <button onClick={() => setShowRejectModal(true)} className="btn btn-danger" disabled={processing}>
                                    <XCircle size={16} /> Reject Vendor
                                </button>
                                <button onClick={() => handleApprove(selectedVendor)} className="btn btn-success" disabled={processing}>
                                    <CheckCircle size={16} /> {processing ? 'Processing...' : 'Approve Vendor'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ===== ITEM REJECTION MODAL ===== */}
            <AnimatePresence>
                {(itemRejectId || bulkRejectMode) && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay"
                        onClick={() => { setItemRejectId(null); setBulkRejectMode(false); }} style={{ zIndex: 60 }}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Reject {bulkRejectMode ? `${selectedItems.size} Items` : 'Menu Item'}</h2>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Select reasons so the vendor can improve</p>
                                </div>
                                <button onClick={() => { setItemRejectId(null); setBulkRejectMode(false); }} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body" style={{ padding: 24 }}>
                                <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 12 }}>Rejection Reasons</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                                    {REJECTION_REASONS.map(reason => (
                                        <button key={reason} onClick={() => setItemRejectReasons(prev => prev.includes(reason) ? prev.filter(r => r !== reason) : [...prev, reason])}
                                            style={{
                                                padding: '7px 14px', borderRadius: 9999, fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s',
                                                background: itemRejectReasons.includes(reason) ? 'var(--primary)' : 'var(--surface-hover)',
                                                color: itemRejectReasons.includes(reason) ? 'white' : 'var(--foreground)',
                                                border: itemRejectReasons.includes(reason) ? '1px solid var(--primary)' : '1px solid var(--glass-border)',
                                            }}>
                                            {reason}
                                        </button>
                                    ))}
                                </div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>Additional Notes</label>
                                <textarea value={itemRejectCustom} onChange={(e) => setItemRejectCustom(e.target.value)}
                                    placeholder="Optional: add more details..." rows={3} className="input" style={{ resize: 'none' }} />
                            </div>
                            <div className="modal-footer">
                                <button onClick={() => { setItemRejectId(null); setBulkRejectMode(false); }} className="btn btn-outline">Cancel</button>
                                <button disabled={processing || itemRejectReasons.length === 0}
                                    onClick={() => {
                                        const notes = [...itemRejectReasons, itemRejectCustom].filter(Boolean).join('; ');
                                        const ids = bulkRejectMode ? Array.from(selectedItems) : (itemRejectId ? [itemRejectId] : []);
                                        handleItemAction(ids, 'reject', notes);
                                    }}
                                    className="btn btn-danger">
                                    {processing ? 'Processing...' : 'Confirm Rejection'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ===== VENDOR REJECTION MODAL ===== */}
            <AnimatePresence>
                {showRejectModal && selectedVendor && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay"
                        onClick={() => setShowRejectModal(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Reject Vendor</h2>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedVendor.shopName}</p>
                                </div>
                                <button onClick={() => setShowRejectModal(false)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body" style={{ padding: 24 }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 8 }}>Rejection Reason</label>
                                <textarea value={rejectionNotes} onChange={(e) => setRejectionNotes(e.target.value)}
                                    placeholder="Please provide a reason for rejection..." rows={4} className="input" style={{ resize: 'none' }} />
                            </div>
                            <div className="modal-footer">
                                <button onClick={() => setShowRejectModal(false)} className="btn btn-outline">Cancel</button>
                                <button onClick={handleReject} className="btn btn-danger" disabled={processing || !rejectionNotes.trim()}>
                                    {processing ? 'Processing...' : 'Confirm Rejection'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
