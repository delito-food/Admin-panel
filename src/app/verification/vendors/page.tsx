'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Eye, CheckCircle, XCircle, Store, Phone, MapPin,
    FileText, X, Clock, ShieldCheck, RefreshCw, User, Loader2,
    Image as ImageIcon, Tag, CreditCard, AlertTriangle, RotateCcw,
    CheckSquare, Square, Leaf, Drumstick, ExternalLink, MessageSquare,
    BadgeCheck, FileWarning, Send, AlertCircle
} from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';

interface VendorMenuItem {
    itemId: string; name: string; description: string; price: number;
    categoryName: string; imageUrl: string; isVeg: boolean; isBestSeller: boolean;
    preparationTime: number; discount: number; isVerified: boolean;
    verificationStatus: string; verificationNotes: string;
}

interface DocumentStatus {
    status: string; // not_uploaded | pending | approved | rejected | needs_revision
    note: string;
    reviewedAt: string;
}

interface VerificationMessage {
    id: string;
    sender: 'admin' | 'vendor';
    senderName: string;
    message: string;
    documentKey?: string;
    createdAt: string;
}

interface PendingVendor {
    vendorId: string; shopName: string; fullName: string; phoneNumber: string;
    email: string; address: string; city: string; pincode: string;
    fssaiLicense: string; gstNumber: string; panCardNumber: string;
    fssaiLicenseUrl: string; gstDocumentUrl: string; panCardUrl: string;
    bankProofUrl: string; menuPhotoUrl: string;
    profileImageUrl: string; shopImageUrl: string;
    cuisineTypes: string[];
    bankAccountNumber: string; bankAccountHolderName: string; bankName: string; bankIfscCode: string; upiId: string;
    documentStatuses: Record<string, DocumentStatus>;
    verificationMessages: VerificationMessage[];
    verificationNotes: string;
    menuItems: VendorMenuItem[];
    submittedAt: string;
    verificationStatus: string;
    preferredLanguage: string;
}

const REQUIRED_DOCS: { key: string; label: string; urlField: keyof PendingVendor; numberField?: keyof PendingVendor }[] = [
    { key: 'fssai', label: 'FSSAI License', urlField: 'fssaiLicenseUrl', numberField: 'fssaiLicense' },
    { key: 'pan', label: 'PAN Card', urlField: 'panCardUrl', numberField: 'panCardNumber' },
    { key: 'gst', label: 'GST Registration', urlField: 'gstDocumentUrl', numberField: 'gstNumber' },
    { key: 'bank', label: 'Bank Account Proof', urlField: 'bankProofUrl' },
    { key: 'menuPhoto', label: 'Menu Photo', urlField: 'menuPhotoUrl' },
];

const REJECTION_REASONS = [
    'Image not clear or readable',
    'Document expired',
    'Wrong document uploaded',
    'Information mismatch',
    'Document partially visible',
    'Fake / tampered document',
    'Missing information',
];

export default function VendorVerificationPage() {
    const { data: vendors, loading, refetch } = useApi<PendingVendor[]>('/api/verification/vendors');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedVendor, setSelectedVendor] = useState<PendingVendor | null>(null);
    const [rejectionNotes, setRejectionNotes] = useState('');
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'docs' | 'menu' | 'messages'>('docs');
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [refreshing, setRefreshing] = useState(false);
    // Per-document review state
    const [docReviewKey, setDocReviewKey] = useState<string | null>(null);
    const [docReviewAction, setDocReviewAction] = useState<'reject' | 'needs_revision'>('reject');
    const [docReviewReasons, setDocReviewReasons] = useState<string[]>([]);
    const [docReviewCustom, setDocReviewCustom] = useState('');
    const [docProcessing, setDocProcessing] = useState(false);
    // Image preview
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    // Messaging
    const [adminMessage, setAdminMessage] = useState('');
    const [adminMsgDocKey, setAdminMsgDocKey] = useState<string | null>(null);
    const [sendingMessage, setSendingMessage] = useState(false);

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

    const handleSendMessage = async (vendorId: string, docKey?: string) => {
        if (!adminMessage.trim()) return;
        setSendingMessage(true);
        try {
            const res = await apiPatch('/api/verification/vendors', {
                vendorId,
                messageAction: 'send_message',
                messageText: adminMessage.trim(),
                messageDocKey: docKey || undefined,
            });
            if (res.success) {
                setAdminMessage('');
                setAdminMsgDocKey(null);
                await refetch();
            }
        } catch (e) { console.error(e); }
        finally { setSendingMessage(false); }
    };

    const filteredVendors = (vendors || []).filter(v =>
        (v.shopName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.fullName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.phoneNumber || '').includes(searchQuery)
    );

    const handleApprove = async (vendor: PendingVendor) => {
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/vendors', { vendorId: vendor.vendorId, action: 'approve' });
            if (res.success) { refetch(); setSelectedVendor(null); }
        } catch (e) { console.error('Approval error:', e); }
        finally { setProcessing(false); }
    };

    const handleReject = async () => {
        if (!selectedVendor) return;
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/vendors', { vendorId: selectedVendor.vendorId, action: 'reject', notes: rejectionNotes });
            if (res.success) { refetch(); setSelectedVendor(null); setShowRejectModal(false); setRejectionNotes(''); }
        } catch (e) { console.error('Rejection error:', e); }
        finally { setProcessing(false); }
    };

    // Per-document approve
    const handleDocApprove = async (vendorId: string, docKey: string) => {
        setDocProcessing(true);
        try {
            const res = await apiPatch('/api/verification/vendors', { vendorId, documentKey: docKey, documentAction: 'approve' });
            if (res.success) { await refetch(); }
        } catch (e) { console.error(e); }
        finally { setDocProcessing(false); }
    };

    // Per-document reject/revision
    const handleDocReject = async () => {
        if (!selectedVendor || !docReviewKey) return;
        const notes = [...docReviewReasons, docReviewCustom].filter(Boolean).join('; ');
        setDocProcessing(true);
        try {
            const res = await apiPatch('/api/verification/vendors', {
                vendorId: selectedVendor.vendorId,
                documentKey: docReviewKey,
                documentAction: docReviewAction,
                documentNote: notes,
            });
            if (res.success) { await refetch(); setDocReviewKey(null); setDocReviewReasons([]); setDocReviewCustom(''); }
        } catch (e) { console.error(e); }
        finally { setDocProcessing(false); }
    };

    const getDocStatus = (vendor: PendingVendor, key: string): DocumentStatus => {
        return vendor.documentStatuses?.[key] || { status: 'not_uploaded', note: '', reviewedAt: '' };
    };

    const getDocStatusColor = (status: string) => {
        switch (status) {
            case 'approved': return { bg: 'rgba(16,185,129,0.12)', color: '#10B981', label: 'Approved' };
            case 'rejected': return { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', label: 'Rejected' };
            case 'needs_revision': return { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', label: 'Needs Revision' };
            case 'pending': return { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', label: 'Pending' };
            default: return { bg: 'rgba(156,163,175,0.12)', color: '#9CA3AF', label: 'Not Uploaded' };
        }
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return 'N/A';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const toggleItemSelect = (id: string) => {
        setSelectedItems(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    };

    const getMenuItemsByCategory = (items: VendorMenuItem[]) => {
        const grouped: Record<string, VendorMenuItem[]> = {};
        items.forEach(item => { const cat = item.categoryName || 'Uncategorized'; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(item); });
        return grouped;
    };

    // Calculate doc stats
    const getDocStats = (vendor: PendingVendor) => {
        let approved = 0, pending = 0, rejected = 0, notUploaded = 0;
        REQUIRED_DOCS.forEach(d => {
            const s = getDocStatus(vendor, d.key).status;
            if (s === 'approved') approved++;
            else if (s === 'pending') pending++;
            else if (s === 'rejected' || s === 'needs_revision') rejected++;
            else notUploaded++;
        });
        return { approved, pending, rejected, notUploaded, total: REQUIRED_DOCS.length };
    };

    if (loading) {
        return (
            <div>
                <div style={{ marginBottom: 32 }}><h1 className="page-title">Vendor Verification</h1><p className="page-description">Loading vendor data...</p></div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #F4511E, #D84315)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(244, 81, 30, 0.3)' }}>
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
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #F4511E, #D84315)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ShieldCheck size={20} style={{ color: 'white' }} />
                        </div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Vendor Verification</h1>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--foreground-secondary)', marginLeft: 52, marginTop: 2 }}>Review vendor documents, licenses & menu items</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ marginTop: 12, opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px 40px -12px' }}>
                {[
                    { label: 'Pending Review', value: (vendors || []).length, icon: Clock, gradient: 'linear-gradient(135deg, #F59E0B, #D97706)', shadow: 'rgba(245, 158, 11, 0.2)' },
                    { label: 'Total Documents', value: (vendors || []).length * 5, icon: FileText, gradient: 'linear-gradient(135deg, #F4511E, #D84315)', shadow: 'rgba(244, 81, 30, 0.2)' },
                    { label: 'Issues Found', value: (vendors || []).reduce((sum, v) => sum + getDocStats(v).rejected, 0), icon: AlertTriangle, gradient: 'linear-gradient(135deg, #EF4444, #DC2626)', shadow: 'rgba(239, 68, 68, 0.2)' },
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

            {/* Search */}
            <div className="glass-card" style={{ padding: 20, marginBottom: 32 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                    <div className="input-group" style={{ flex: '1 1 300px' }}>
                        <Search size={18} className="input-icon" />
                        <input type="text" placeholder="Search by shop name, owner, or phone..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input" />
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #F4511E, #D84315)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Store size={14} style={{ color: 'white' }} />
                        </div>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Pending</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', background: 'var(--primary)', color: 'white', borderRadius: 9999 }}>{filteredVendors.length}</span>
                    </div>
                </div>
            </div>

            {/* Vendors Grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px' }}>
                <AnimatePresence mode="popLayout">
                    {filteredVendors.map((vendor, index) => {
                        const stats = getDocStats(vendor);
                        return (
                            <div key={vendor.vendorId} style={{ flex: '1 1 460px', maxWidth: '50%', padding: '0 12px', marginBottom: 24 }}>
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: index * 0.05 }}
                                    className="glass-card" style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ display: 'flex', gap: 16 }}>
                                        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #F4511E, #D84315)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <Store size={24} style={{ color: 'white' }} />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                                <div>
                                                    <h3 style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vendor.shopName}</h3>
                                                    <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}><User size={13} /> {vendor.fullName}</p>
                                                </div>
                                                <span className={`badge ${vendor.verificationStatus === 'rejected' ? 'badge-rejected' : vendor.verificationStatus === 'needs_revision' ? 'badge-pending' : 'badge-pending'}`} style={{ flexShrink: 0 }}>
                                                    {vendor.verificationStatus === 'rejected' ? <><XCircle size={12} /> Rejected</> : vendor.verificationStatus === 'needs_revision' ? <><RotateCcw size={12} /> Needs Revision</> : <><Clock size={12} /> Pending</>}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Doc status summary */}
                                    <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
                                        {REQUIRED_DOCS.map(d => {
                                            const s = getDocStatus(vendor, d.key);
                                            const sc = getDocStatusColor(s.status);
                                            return (
                                                <span key={d.key} style={{ padding: '3px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600, background: sc.bg, color: sc.color }}>
                                                    {d.label.split(' ')[0]}
                                                </span>
                                            );
                                        })}
                                    </div>

                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--glass-border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}><Phone size={14} /> {vendor.phoneNumber}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}><MapPin size={14} /> {vendor.city}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}><FileText size={14} /> {stats.approved}/{stats.total} docs approved</div>
                                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 600, background: vendor.preferredLanguage === 'hi' ? 'rgba(249,115,22,0.1)' : 'rgba(59,130,246,0.1)', color: vendor.preferredLanguage === 'hi' ? '#F97316' : '#3B82F6' }}>
                                            {vendor.preferredLanguage === 'hi' ? '🇮🇳 हिन्दी' : '🌐 English'}
                                        </span>
                                    </div>

                                    {/* Verification Status Banner */}
                                    {(vendor.verificationStatus === 'rejected' || vendor.verificationStatus === 'needs_revision') && vendor.verificationNotes && (
                                        <div style={{
                                            marginTop: 12, padding: '10px 14px', borderRadius: 10,
                                            background: vendor.verificationStatus === 'rejected' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
                                            border: `1px solid ${vendor.verificationStatus === 'rejected' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                <AlertCircle size={13} color={vendor.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B'} />
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: vendor.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B' }}>
                                                    {vendor.verificationStatus === 'rejected' ? 'Rejection Reason' : 'Revision Required'}
                                                </span>
                                            </div>
                                            <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', lineHeight: 1.4, margin: 0 }}>{vendor.verificationNotes}</p>
                                        </div>
                                    )}

                                    {/* Messages from Vendor */}
                                    {(vendor.verificationMessages || []).filter(m => m.sender === 'vendor').length > 0 && (
                                        <div style={{
                                            marginTop: 10, padding: '10px 14px', borderRadius: 10,
                                            background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                                <MessageSquare size={13} color="#3B82F6" />
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#3B82F6' }}>
                                                    Message from Vendor ({(vendor.verificationMessages || []).filter(m => m.sender === 'vendor').length})
                                                </span>
                                            </div>
                                            {(vendor.verificationMessages || []).filter(m => m.sender === 'vendor').slice(-1).map(msg => (
                                                <p key={msg.id} style={{ fontSize: '0.78rem', color: 'var(--foreground)', lineHeight: 1.4, margin: 0 }}>
                                                    &ldquo;{msg.message}&rdquo;
                                                    {msg.documentKey && <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', marginLeft: 6 }}>
                                                        — re: {REQUIRED_DOCS.find(d => d.key === msg.documentKey)?.label || msg.documentKey}
                                                    </span>}
                                                </p>
                                            ))}
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 20 }}>
                                        <button onClick={() => { setSelectedVendor(vendor); setActiveTab('docs'); }} className="btn btn-outline" style={{ flex: 1 }}><Eye size={16} /> Review Docs</button>
                                        <button onClick={() => handleApprove(vendor)} disabled={processing} className="btn btn-success" style={{ flex: 1 }}><CheckCircle size={16} /> Approve All</button>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--glass-border)', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                        <span>Submitted: {formatDate(vendor.submittedAt)}</span>
                                        <button onClick={() => { setSelectedVendor(vendor); setShowRejectModal(true); }}
                                            style={{ background: 'none', border: 'none', color: 'var(--accent-error)', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', padding: '4px 8px', borderRadius: 6 }}>Reject All</button>
                                    </div>
                                </motion.div>
                            </div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* Empty state */}
            {filteredVendors.length === 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '64px 32px', textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #10B981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}><CheckCircle size={28} style={{ color: 'white' }} /></div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>All caught up!</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>No pending vendor verifications.</p>
                </motion.div>
            )}

            {/* ===== DETAIL MODAL ===== */}
            <AnimatePresence>
                {selectedVendor && !showRejectModal && !docReviewKey && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setSelectedVendor(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 1000 }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #F4511E, #D84315)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Store size={22} style={{ color: 'white' }} />
                                    </div>
                                    <div>
                                        <h2 className="modal-title" style={{ margin: 0 }}>{selectedVendor.shopName}</h2>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedVendor.fullName} · {selectedVendor.phoneNumber} · {selectedVendor.city}</p>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedVendor(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>

                            {/* Tabs */}
                            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', padding: '0 24px' }}>
                                {[
                                    { key: 'docs' as const, label: 'Documents (5)', icon: FileText },
                                    { key: 'menu' as const, label: `Menu (${(selectedVendor.menuItems || []).length})`, icon: Tag },
                                    { key: 'messages' as const, label: `Messages${(selectedVendor.verificationMessages || []).length > 0 ? ` (${selectedVendor.verificationMessages.length})` : ''}`, icon: MessageSquare },
                                ].map(tab => (
                                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', fontSize: '0.875rem', fontWeight: 600,
                                            color: activeTab === tab.key ? 'var(--primary)' : 'var(--foreground-secondary)',
                                            borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                                            borderTop: 'none', borderRight: 'none', borderLeft: 'none', background: 'none', cursor: 'pointer' }}>
                                        <tab.icon size={16} /> {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="modal-body" style={{ padding: 24, maxHeight: '60vh', overflowY: 'auto' }}>
                                {/* Verification Status Banner */}
                                {(selectedVendor.verificationStatus === 'rejected' || selectedVendor.verificationStatus === 'needs_revision') && (
                                    <div style={{
                                        padding: '14px 16px', borderRadius: 12, marginBottom: 20,
                                        background: selectedVendor.verificationStatus === 'rejected'
                                            ? 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))'
                                            : 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))',
                                        border: `1px solid ${selectedVendor.verificationStatus === 'rejected' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <AlertCircle size={16} color={selectedVendor.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B'} />
                                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: selectedVendor.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B' }}>
                                                {selectedVendor.verificationStatus === 'rejected' ? '⛔ Application Rejected' : '⚠️ Revision Required'}
                                            </span>
                                        </div>
                                        {selectedVendor.verificationNotes && (
                                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground)', lineHeight: 1.5, margin: 0 }}>
                                                {selectedVendor.verificationNotes}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'docs' && (
                                    <div>
                                        {/* Per-document review cards */}
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 16 }}>
                                            Required Documents ({getDocStats(selectedVendor).approved}/5 Approved)
                                        </h4>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                            {REQUIRED_DOCS.map(doc => {
                                                const ds = getDocStatus(selectedVendor, doc.key);
                                                const sc = getDocStatusColor(ds.status);
                                                const url = selectedVendor[doc.urlField] as string;
                                                const numVal = doc.numberField ? (selectedVendor[doc.numberField] as string) : '';

                                                return (
                                                    <div key={doc.key} style={{ background: 'var(--surface-hover)', borderRadius: 14, padding: 16, border: `1px solid ${ds.status === 'approved' ? 'rgba(16,185,129,0.3)' : ds.status === 'rejected' || ds.status === 'needs_revision' ? 'rgba(239,68,68,0.3)' : 'var(--glass-border)'}` }}>
                                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                                            {/* Image thumbnail */}
                                                            <div style={{ width: 100, height: 80, borderRadius: 10, overflow: 'hidden', background: 'var(--background)', flexShrink: 0, cursor: url ? 'pointer' : 'default' }}
                                                                onClick={() => url && setPreviewImage(url)}>
                                                                {url ? (
                                                                    <img src={url} alt={doc.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                ) : (
                                                                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                        <FileWarning size={24} style={{ color: 'var(--foreground-secondary)', opacity: 0.4 }} />
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Info */}
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                                    <h5 style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--foreground)', margin: 0 }}>{doc.label}</h5>
                                                                    <span style={{ padding: '2px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700, background: sc.bg, color: sc.color }}>{sc.label}</span>
                                                                </div>
                                                                {numVal && (
                                                                    <p style={{ fontSize: '0.8rem', color: 'var(--foreground)', fontFamily: 'monospace', margin: '2px 0' }}>{numVal}</p>
                                                                )}
                                                                {ds.note && (ds.status === 'rejected' || ds.status === 'needs_revision') && (
                                                                    <p style={{ fontSize: '0.75rem', color: '#EF4444', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                        <MessageSquare size={12} /> {ds.note}
                                                                    </p>
                                                                )}
                                                                {url && (
                                                                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, textDecoration: 'none' }}>
                                                                        <ExternalLink size={12} /> Open full size
                                                                    </a>
                                                                )}
                                                            </div>

                                                            {/* Actions */}
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                                                {ds.status !== 'approved' && url && (
                                                                    <>
                                                                        <button onClick={() => handleDocApprove(selectedVendor.vendorId, doc.key)} disabled={docProcessing}
                                                                            style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(16,185,129,0.9)', color: 'white', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                            <BadgeCheck size={13} /> Approve
                                                                        </button>
                                                                        <button onClick={() => { setDocReviewKey(doc.key); setDocReviewAction('reject'); setDocReviewReasons([]); setDocReviewCustom(''); }}
                                                                            style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#EF4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                            <XCircle size={13} /> Reject
                                                                        </button>
                                                                        <button onClick={() => { setDocReviewKey(doc.key); setDocReviewAction('needs_revision'); setDocReviewReasons([]); setDocReviewCustom(''); }}
                                                                            style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(245,158,11,0.12)', color: '#D97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                            <RotateCcw size={13} /> Revision
                                                                        </button>
                                                                    </>
                                                                )}
                                                                {ds.status === 'approved' && (
                                                                    <span style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, background: 'rgba(16,185,129,0.12)', color: '#10B981', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                        <CheckCircle size={13} /> Verified
                                                                    </span>
                                                                )}
                                                                {!url && (
                                                                    <span style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, background: 'rgba(156,163,175,0.12)', color: '#9CA3AF' }}>
                                                                        Not uploaded
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Bank & Other Info */}
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginTop: 28, marginBottom: 16 }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CreditCard size={14} /> Bank Information</span>
                                        </h4>

                                        {/* Passbook / Bank Proof image */}
                                        {(selectedVendor.bankProofUrl || (selectedVendor as { bankPassbookUrl?: string }).bankPassbookUrl) ? (
                                            <div style={{ marginBottom: 20, padding: 14, borderRadius: 14, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)' }}>
                                                <p style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 10 }}>
                                                    🏦 Bank Passbook / Cancelled Cheque
                                                </p>
                                                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                                                    <div
                                                        style={{ width: 160, height: 120, borderRadius: 10, overflow: 'hidden', background: 'var(--background)', flexShrink: 0, cursor: 'pointer', border: '1px solid var(--glass-border)' }}
                                                        onClick={() => setPreviewImage(selectedVendor.bankProofUrl || (selectedVendor as { bankPassbookUrl?: string }).bankPassbookUrl || '')}
                                                    >
                                                        <img
                                                            src={selectedVendor.bankProofUrl || (selectedVendor as { bankPassbookUrl?: string }).bankPassbookUrl}
                                                            alt="Bank Passbook"
                                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                        />
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Click image to view full size</p>
                                                        <a href={selectedVendor.bankProofUrl || (selectedVendor as { bankPassbookUrl?: string }).bankPassbookUrl} target="_blank" rel="noopener noreferrer"
                                                            style={{ fontSize: '0.78rem', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                                                            <ExternalLink size={13} /> Open full size
                                                        </a>
                                                        {(() => {
                                                            const ds = getDocStatus(selectedVendor, 'bank');
                                                            const sc = getDocStatusColor(ds.status);
                                                            return (
                                                                <span style={{ padding: '3px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, background: sc.bg, color: sc.color, display: 'inline-block' }}>
                                                                    {sc.label}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ marginBottom: 20, padding: 14, borderRadius: 14, background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <FileWarning size={18} color="#EF4444" />
                                                <p style={{ fontSize: '0.82rem', color: '#EF4444', fontWeight: 500 }}>Bank Passbook not uploaded yet</p>
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -8px' }}>
                                            {[
                                                { label: 'Account Holder', value: selectedVendor.bankAccountHolderName || 'Not provided' },
                                                { label: 'Account Number', value: selectedVendor.bankAccountNumber || 'Not provided' },
                                                { label: 'Bank Name', value: selectedVendor.bankName || 'Not provided' },
                                                { label: 'IFSC Code', value: selectedVendor.bankIfscCode || 'Not provided' },
                                                { label: 'UPI ID', value: selectedVendor.upiId || 'Not provided' },
                                            ].map(item => (
                                                <div key={item.label} style={{ flex: '1 1 180px', padding: '0 8px', marginBottom: 12 }}>
                                                    <div style={{ background: 'var(--surface-hover)', borderRadius: 12, padding: '12px 14px' }}>
                                                        <p style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 4 }}>{item.label}</p>
                                                        <p style={{ fontWeight: 600, fontSize: '0.85rem', color: item.value === 'Not provided' ? 'var(--foreground-secondary)' : 'var(--foreground)' }}>{item.value}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Cuisine */}
                                        {(selectedVendor.cuisineTypes || []).length > 0 && (
                                            <div style={{ marginTop: 8 }}>
                                                <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 12 }}>Cuisine Types</h4>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                    {selectedVendor.cuisineTypes.map(c => (
                                                        <span key={c} style={{ padding: '6px 14px', borderRadius: 9999, fontSize: '0.8rem', fontWeight: 500, background: 'var(--surface-hover)' }}>{c}</span>
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
                                                <p style={{ fontWeight: 500 }}>No menu items submitted</p>
                                            </div>
                                        ) : (
                                            Object.entries(getMenuItemsByCategory(selectedVendor.menuItems)).map(([category, items]) => (
                                                <div key={category} style={{ marginBottom: 28 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                                                        <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)' }}>{category}</span>
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 10px', borderRadius: 9999, background: 'var(--surface-hover)' }}>{items.length}</span>
                                                        <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -8px' }}>
                                                        {items.map(item => (
                                                            <div key={item.itemId} style={{ flex: '1 1 260px', maxWidth: '33.33%', padding: '0 8px', marginBottom: 16 }}>
                                                                <div style={{ background: 'var(--surface-hover)', borderRadius: 14, overflow: 'hidden' }}>
                                                                    <div style={{ position: 'relative', height: 120, background: 'var(--background)' }}>
                                                                        {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ImageIcon size={24} style={{ opacity: 0.3 }} /></div>}
                                                                        <span style={{ position: 'absolute', top: 8, right: 8, padding: '3px 8px', borderRadius: 6, fontSize: '0.65rem', fontWeight: 700, background: item.isVeg ? 'rgba(16,185,129,0.9)' : 'rgba(239,68,68,0.9)', color: 'white', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                            {item.isVeg ? <Leaf size={10} /> : <Drumstick size={10} />} {item.isVeg ? 'VEG' : 'NON-VEG'}
                                                                        </span>
                                                                    </div>
                                                                    <div style={{ padding: '10px 14px' }}>
                                                                        <h5 style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>{item.name}</h5>
                                                                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary)' }}>₹{item.price}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                                {activeTab === 'messages' && (
                                    <div>
                                        {/* Message Thread */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, maxHeight: 350, overflowY: 'auto' }}>
                                            {(selectedVendor.verificationMessages || []).length === 0 ? (
                                                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                                    <MessageSquare size={36} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
                                                    <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>No messages yet</p>
                                                    <p style={{ fontSize: '0.78rem', marginTop: 4 }}>Send a message about documents or verification status</p>
                                                </div>
                                            ) : (
                                                (selectedVendor.verificationMessages || []).map(msg => (
                                                    <div key={msg.id} style={{
                                                        display: 'flex', flexDirection: 'column',
                                                        alignItems: msg.sender === 'admin' ? 'flex-end' : 'flex-start',
                                                    }}>
                                                        <div style={{
                                                            maxWidth: '75%', padding: '10px 14px', borderRadius: 14,
                                                            background: msg.sender === 'admin'
                                                                ? 'linear-gradient(135deg, rgba(244,81,30,0.12), rgba(244,81,30,0.06))'
                                                                : 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(249,115,22,0.06))',
                                                            border: `1px solid ${msg.sender === 'admin' ? 'rgba(244,81,30,0.2)' : 'rgba(249,115,22,0.2)'}`,
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: msg.sender === 'admin' ? '#F4511E' : '#F97316' }}>
                                                                    {msg.sender === 'admin' ? '👨‍💼 Admin' : `🏪 ${msg.senderName || 'Vendor'}`}
                                                                </span>
                                                                {msg.documentKey && (
                                                                    <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4, background: 'var(--surface-hover)', color: 'var(--foreground-secondary)' }}>
                                                                        {REQUIRED_DOCS.find(d => d.key === msg.documentKey)?.label || msg.documentKey}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p style={{ fontSize: '0.82rem', color: 'var(--foreground)', lineHeight: 1.4, margin: 0 }}>{msg.message}</p>
                                                            <p style={{ fontSize: '0.65rem', color: 'var(--foreground-secondary)', marginTop: 4, textAlign: 'right' }}>
                                                                {formatDate(msg.createdAt)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {/* Send Message Input */}
                                        <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: 16 }}>
                                            <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                <button onClick={() => setAdminMsgDocKey(null)}
                                                    style={{ padding: '4px 10px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', background: !adminMsgDocKey ? 'var(--primary)' : 'var(--surface-hover)', color: !adminMsgDocKey ? 'white' : 'var(--foreground)', border: `1px solid ${!adminMsgDocKey ? 'var(--primary)' : 'var(--glass-border)'}` }}>
                                                    General
                                                </button>
                                                {REQUIRED_DOCS.map(d => (
                                                    <button key={d.key} onClick={() => setAdminMsgDocKey(d.key)}
                                                        style={{ padding: '4px 10px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', background: adminMsgDocKey === d.key ? 'var(--primary)' : 'var(--surface-hover)', color: adminMsgDocKey === d.key ? 'white' : 'var(--foreground)', border: `1px solid ${adminMsgDocKey === d.key ? 'var(--primary)' : 'var(--glass-border)'}` }}>
                                                        {d.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div style={{ display: 'flex', gap: 10 }}>
                                                <textarea value={adminMessage} onChange={e => setAdminMessage(e.target.value)}
                                                    placeholder={`Message to ${selectedVendor.shopName}${adminMsgDocKey ? ` about ${REQUIRED_DOCS.find(d => d.key === adminMsgDocKey)?.label}` : ''}...`}
                                                    rows={2} className="input" style={{ flex: 1, resize: 'none' }} />
                                                <button onClick={() => handleSendMessage(selectedVendor.vendorId, adminMsgDocKey || undefined)}
                                                    disabled={sendingMessage || !adminMessage.trim()}
                                                    className="btn btn-primary"
                                                    style={{ alignSelf: 'flex-end', padding: '10px 16px' }}>
                                                    <Send size={16} /> {sendingMessage ? 'Sending...' : 'Send'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="modal-footer">
                                <button onClick={() => { setSelectedVendor(vendor => vendor); setShowRejectModal(true); }} className="btn btn-danger" disabled={processing}><XCircle size={16} /> Reject All</button>
                                <button onClick={() => handleApprove(selectedVendor)} className="btn btn-success" disabled={processing}><CheckCircle size={16} /> {processing ? 'Processing...' : 'Approve All'}</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ===== DOCUMENT REVIEW MODAL ===== */}
            <AnimatePresence>
                {docReviewKey && selectedVendor && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay"
                        onClick={() => setDocReviewKey(null)} style={{ zIndex: 60 }}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 480 }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">{docReviewAction === 'reject' ? 'Reject' : 'Request Revision'}: {REQUIRED_DOCS.find(d => d.key === docReviewKey)?.label}</h2>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Provide a reason so the vendor can fix the issue</p>
                                </div>
                                <button onClick={() => setDocReviewKey(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body" style={{ padding: 24 }}>
                                <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 12 }}>Select Reasons</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                                    {REJECTION_REASONS.map(reason => (
                                        <button key={reason} onClick={() => setDocReviewReasons(prev => prev.includes(reason) ? prev.filter(r => r !== reason) : [...prev, reason])}
                                            style={{ padding: '7px 14px', borderRadius: 9999, fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
                                                background: docReviewReasons.includes(reason) ? 'var(--primary)' : 'var(--surface-hover)',
                                                color: docReviewReasons.includes(reason) ? 'white' : 'var(--foreground)',
                                                border: docReviewReasons.includes(reason) ? '1px solid var(--primary)' : '1px solid var(--glass-border)' }}>
                                            {reason}
                                        </button>
                                    ))}
                                </div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>Additional Notes</label>
                                <textarea value={docReviewCustom} onChange={e => setDocReviewCustom(e.target.value)}
                                    placeholder="Optional: add more details..." rows={3} className="input" style={{ resize: 'none' }} />
                            </div>
                            <div className="modal-footer">
                                <button onClick={() => setDocReviewKey(null)} className="btn btn-outline">Cancel</button>
                                <button disabled={docProcessing || docReviewReasons.length === 0} onClick={handleDocReject}
                                    className={docReviewAction === 'reject' ? 'btn btn-danger' : 'btn btn-outline'} style={docReviewAction !== 'reject' ? { background: 'rgba(245,158,11,0.15)', color: '#D97706', border: '1px solid #F59E0B' } : {}}>
                                    {docProcessing ? 'Processing...' : docReviewAction === 'reject' ? 'Reject Document' : 'Request Revision'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ===== VENDOR REJECTION MODAL ===== */}
            <AnimatePresence>
                {showRejectModal && selectedVendor && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setShowRejectModal(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 440 }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <div><h2 className="modal-title">Reject Vendor</h2><p style={{ fontSize: '0.8125rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedVendor.shopName}</p></div>
                                <button onClick={() => setShowRejectModal(false)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body" style={{ padding: 24 }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 8 }}>Rejection Reason</label>
                                <textarea value={rejectionNotes} onChange={e => setRejectionNotes(e.target.value)} placeholder="Please provide a reason for rejection..." rows={4} className="input" style={{ resize: 'none' }} />
                            </div>
                            <div className="modal-footer">
                                <button onClick={() => setShowRejectModal(false)} className="btn btn-outline">Cancel</button>
                                <button onClick={handleReject} className="btn btn-danger" disabled={processing || !rejectionNotes.trim()}>{processing ? 'Processing...' : 'Confirm Rejection'}</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ===== IMAGE PREVIEW MODAL ===== */}
            <AnimatePresence>
                {previewImage && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay"
                        onClick={() => setPreviewImage(null)} style={{ zIndex: 70 }}>
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 16, overflow: 'hidden', position: 'relative' }}
                            onClick={e => e.stopPropagation()}>
                            <button onClick={() => setPreviewImage(null)}
                                style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 9999, background: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                                <X size={20} style={{ color: 'white' }} />
                            </button>
                            <img src={previewImage} alt="Document preview" style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

