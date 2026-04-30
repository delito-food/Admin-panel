'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Eye, CheckCircle, XCircle, Bike, Phone, MapPin,
    FileText, X, Clock, ShieldCheck, RefreshCw, User, Car, IdCard,
    Loader2, CreditCard, Mail, ExternalLink, RotateCcw, MessageSquare,
    BadgeCheck, FileWarning, AlertTriangle, Image as ImageIcon, Send,
    AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';

interface VerificationMessage {
    id: string;
    sender: 'admin' | 'delivery_person';
    senderName: string;
    message: string;
    documentKey?: string;
    createdAt: string;
}

interface DocumentStatus { status: string; note: string; reviewedAt: string; }

interface PendingDeliveryPerson {
    deliveryPersonId: string; fullName: string; phoneNumber: string; email: string;
    address: string; city: string; pincode: string;
    vehicleType: string; vehicleNumber: string; driverLicenseNumber: string;
    aadharCardUrl: string; aadharCardNumber: string;
    panCardUrl: string; panCardNumber: string;
    driverLicenseUrl: string; vehicleImageUrl: string;
    rcBookUrl: string; rcBookNumber: string;
    bankPassbookUrl: string;
    vehicleDocumentUrl: string; profilePhotoUrl: string; profileImageUrl: string;
    bankName: string; bankAccountNumber: string; bankAccountHolderName: string; ifscCode: string; upiId: string;
    documentStatuses: Record<string, DocumentStatus>;
    verificationMessages: VerificationMessage[];
    verificationNotes: string;
    submittedAt: string; verificationStatus: string; isVerified: boolean;
    preferredLanguage: string;
}

const REQUIRED_DOCS: { key: string; label: string; urlField: keyof PendingDeliveryPerson }[] = [
    { key: 'aadhar', label: 'Aadhaar Card', urlField: 'aadharCardUrl' },
    { key: 'pan', label: 'PAN Card', urlField: 'panCardUrl' },
    { key: 'license', label: 'Driving License', urlField: 'driverLicenseUrl' },
    { key: 'rc', label: 'RC of Bike', urlField: 'rcBookUrl' },
    { key: 'passbook', label: 'Bank Passbook', urlField: 'bankPassbookUrl' },
];

const REJECTION_REASONS = [
    'Image not clear or readable', 'Document expired', 'Wrong document uploaded',
    'Information mismatch', 'Document partially visible', 'Fake / tampered document',
    'Number plate not visible', 'Face not clearly visible',
];

export default function DeliveryVerificationPage() {
    const { data: deliveryPersons, loading, refetch } = useApi<PendingDeliveryPerson[]>('/api/verification/delivery');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPerson, setSelectedPerson] = useState<PendingDeliveryPerson | null>(null);
    const [rejectionNotes, setRejectionNotes] = useState('');
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'docs' | 'details' | 'bank' | 'messages'>('docs');
    const [refreshing, setRefreshing] = useState(false);
    const [docReviewKey, setDocReviewKey] = useState<string | null>(null);
    const [docReviewAction, setDocReviewAction] = useState<'reject' | 'needs_revision'>('reject');
    const [docReviewReasons, setDocReviewReasons] = useState<string[]>([]);
    const [docReviewCustom, setDocReviewCustom] = useState('');
    const [docProcessing, setDocProcessing] = useState(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [adminMessage, setAdminMessage] = useState('');
    const [adminMsgDocKey, setAdminMsgDocKey] = useState<string | null>(null);
    const [sendingMessage, setSendingMessage] = useState(false);
    const [showMessages, setShowMessages] = useState(true);

    const handleRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

    const handleSendMessage = async (personId: string, docKey?: string) => {
        if (!adminMessage.trim()) return;
        setSendingMessage(true);
        try {
            const res = await apiPatch('/api/verification/delivery', {
                deliveryPersonId: personId,
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

    const filteredPersons = (deliveryPersons || []).filter(p =>
        (p.fullName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.phoneNumber || '').includes(searchQuery) ||
        (p.vehicleNumber || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleApprove = async (person: PendingDeliveryPerson) => {
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/delivery', { deliveryPersonId: person.deliveryPersonId, action: 'approve' });
            if (res.success) { refetch(); setSelectedPerson(null); }
        } catch (e) { console.error(e); } finally { setProcessing(false); }
    };

    const handleReject = async () => {
        if (!selectedPerson) return;
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/delivery', { deliveryPersonId: selectedPerson.deliveryPersonId, action: 'reject', notes: rejectionNotes });
            if (res.success) { refetch(); setSelectedPerson(null); setShowRejectModal(false); setRejectionNotes(''); }
        } catch (e) { console.error(e); } finally { setProcessing(false); }
    };

    const handleDocApprove = async (dpId: string, docKey: string) => {
        setDocProcessing(true);
        try {
            const res = await apiPatch('/api/verification/delivery', { deliveryPersonId: dpId, documentKey: docKey, documentAction: 'approve' });
            if (res.success) await refetch();
        } catch (e) { console.error(e); } finally { setDocProcessing(false); }
    };

    const handleDocReject = async () => {
        if (!selectedPerson || !docReviewKey) return;
        const notes = [...docReviewReasons, docReviewCustom].filter(Boolean).join('; ');
        setDocProcessing(true);
        try {
            const res = await apiPatch('/api/verification/delivery', { deliveryPersonId: selectedPerson.deliveryPersonId, documentKey: docReviewKey, documentAction: docReviewAction, documentNote: notes });
            if (res.success) { await refetch(); setDocReviewKey(null); setDocReviewReasons([]); setDocReviewCustom(''); }
        } catch (e) { console.error(e); } finally { setDocProcessing(false); }
    };

    const getDocStatus = (person: PendingDeliveryPerson, key: string): DocumentStatus =>
        person.documentStatuses?.[key] || { status: 'not_uploaded', note: '', reviewedAt: '' };

    const getDocStatusStyle = (status: string) => {
        switch (status) {
            case 'approved': return { bg: 'rgba(16,185,129,0.12)', color: '#10B981', label: 'Approved' };
            case 'rejected': return { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', label: 'Rejected' };
            case 'needs_revision': return { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', label: 'Needs Revision' };
            case 'pending': return { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', label: 'Pending' };
            default: return { bg: 'rgba(156,163,175,0.12)', color: '#9CA3AF', label: 'Not Uploaded' };
        }
    };

    const getDocStats = (person: PendingDeliveryPerson) => {
        let approved = 0;
        REQUIRED_DOCS.forEach(d => { if (getDocStatus(person, d.key).status === 'approved') approved++; });
        return { approved, total: REQUIRED_DOCS.length };
    };

    const formatDate = (ds: string) => {
        if (!ds) return 'N/A';
        const d = new Date(ds);
        return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    if (loading) {
        return (
            <div>
                <div style={{ marginBottom: 32 }}><h1 className="page-title">Delivery Verification</h1></div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                    <Loader2 className="animate-spin" style={{ width: 40, height: 40, color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 40 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #6366F1, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ShieldCheck size={20} style={{ color: 'white' }} />
                        </div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Verification</h1>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--foreground-secondary)', marginLeft: 52, marginTop: 2 }}>Review partner documents — Aadhaar, License, Vehicle</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ marginTop: 12, opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px 40px -12px' }}>
                {[
                    { label: 'Pending Review', value: filteredPersons.length, icon: Clock, gradient: 'linear-gradient(135deg, #F59E0B, #D97706)', shadow: 'rgba(245,158,11,0.2)' },
                    { label: 'Total Documents', value: filteredPersons.length * 3, icon: FileText, gradient: 'linear-gradient(135deg, #6366F1, #4F46E5)', shadow: 'rgba(99,102,241,0.2)' },
                    { label: 'Issues Found', value: filteredPersons.reduce((s, p) => s + REQUIRED_DOCS.filter(d => { const st = getDocStatus(p, d.key).status; return st === 'rejected' || st === 'needs_revision'; }).length, 0), icon: AlertTriangle, gradient: 'linear-gradient(135deg, #EF4444, #DC2626)', shadow: 'rgba(239,68,68,0.2)' },
                ].map((stat, i) => (
                    <div key={stat.label} style={{ flex: '1 1 200px', padding: '0 12px', marginBottom: 16 }}>
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                            style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', border: '1px solid var(--glass-border)', borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: stat.gradient }} />
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                <div><p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 8 }}>{stat.label}</p><p style={{ fontSize: '1.75rem', fontWeight: 700 }}>{stat.value}</p></div>
                                <div style={{ width: 48, height: 48, borderRadius: 14, background: stat.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 16px ${stat.shadow}` }}><stat.icon size={22} style={{ color: 'white' }} /></div>
                            </div>
                        </motion.div>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="glass-card" style={{ padding: 20, marginBottom: 32 }}>
                <div className="input-group" style={{ maxWidth: 480 }}>
                    <Search size={18} className="input-icon" />
                    <input type="text" placeholder="Search by name, phone, or vehicle..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input" />
                </div>
            </div>

            {/* Grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px' }}>
                <AnimatePresence mode="popLayout">
                    {filteredPersons.map((person, i) => {
                        const stats = getDocStats(person);
                        return (
                            <div key={person.deliveryPersonId} style={{ flex: '1 1 460px', maxWidth: '50%', padding: '0 12px', marginBottom: 24 }}>
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.05 }}
                                    className="glass-card" style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ display: 'flex', gap: 16 }}>
                                        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #6366F1, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                                            {(person.profilePhotoUrl || person.profileImageUrl) ? <img src={person.profilePhotoUrl || person.profileImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={24} style={{ color: 'white' }} />}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <h3 style={{ fontWeight: 600, fontSize: '1.05rem', margin: 0 }}>{person.fullName}</h3>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 4 }}><IdCard size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{person.vehicleNumber || 'No vehicle #'}</p>
                                        </div>
                                        <span className={`badge ${person.verificationStatus === 'rejected' ? 'badge-rejected' : person.verificationStatus === 'needs_revision' ? 'badge-pending' : 'badge-pending'}`} style={{ flexShrink: 0 }}>
                                            {person.verificationStatus === 'rejected' ? <><XCircle size={12} /> Rejected</> : person.verificationStatus === 'needs_revision' ? <><RotateCcw size={12} /> Needs Revision</> : <><Clock size={12} /> Pending</>}
                                        </span>
                                    </div>
                                    {/* Doc chips */}
                                    <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
                                        {REQUIRED_DOCS.map(d => {
                                            const s = getDocStatus(person, d.key);
                                            const sc = getDocStatusStyle(s.status);
                                            return <span key={d.key} style={{ padding: '3px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600, background: sc.bg, color: sc.color }}>{d.label.split(' ')[0]}</span>;
                                        })}
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px 24px', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--glass-border)', fontSize: '0.8125rem', color: 'var(--foreground-secondary)', flexWrap: 'wrap' }}>
                                        <span><Phone size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{person.phoneNumber}</span>
                                        <span><MapPin size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{person.city}</span>
                                        <span><FileText size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{stats.approved}/{stats.total} approved</span>
                                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 600, background: person.preferredLanguage === 'hi' ? 'rgba(249,115,22,0.1)' : 'rgba(59,130,246,0.1)', color: person.preferredLanguage === 'hi' ? '#F97316' : '#3B82F6' }}>
                                            {person.preferredLanguage === 'hi' ? '🇮🇳 हिन्दी' : '🌐 English'}
                                        </span>
                                    </div>

                                    {/* Verification Status Banner */}
                                    {(person.verificationStatus === 'rejected' || person.verificationStatus === 'needs_revision') && person.verificationNotes && (
                                        <div style={{
                                            marginTop: 12, padding: '10px 14px', borderRadius: 10,
                                            background: person.verificationStatus === 'rejected' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
                                            border: `1px solid ${person.verificationStatus === 'rejected' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                <AlertCircle size={13} color={person.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B'} />
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: person.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B' }}>
                                                    {person.verificationStatus === 'rejected' ? 'Rejection Reason' : 'Revision Required'}
                                                </span>
                                            </div>
                                            <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', lineHeight: 1.4, margin: 0 }}>{person.verificationNotes}</p>
                                        </div>
                                    )}

                                    {/* Messages from Delivery Person */}
                                    {(person.verificationMessages || []).filter(m => m.sender === 'delivery_person').length > 0 && (
                                        <div style={{
                                            marginTop: 10, padding: '10px 14px', borderRadius: 10,
                                            background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                                <MessageSquare size={13} color="#3B82F6" />
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#3B82F6' }}>
                                                    Message from Partner ({(person.verificationMessages || []).filter(m => m.sender === 'delivery_person').length})
                                                </span>
                                            </div>
                                            {(person.verificationMessages || []).filter(m => m.sender === 'delivery_person').slice(-1).map(msg => (
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
                                        <button onClick={() => { setSelectedPerson(person); setActiveTab('docs'); }} className="btn btn-outline" style={{ flex: 1 }}><Eye size={16} /> Review Docs</button>
                                        <button onClick={() => handleApprove(person)} disabled={processing} className="btn btn-success" style={{ flex: 1 }}><CheckCircle size={16} /> Approve All</button>
                                    </div>
                                </motion.div>
                            </div>
                        );
                    })}
                    {selectedPerson && (
                        <motion.div key="modal" onClick={() => setSelectedPerson(null)}
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                            <motion.div onClick={e => e.stopPropagation()}
                                initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                className="glass-card" style={{ width: '100%', maxWidth: 800, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--glass-border)' }}>
                                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{selectedPerson.fullName} — Verification</h2>
                                    <button onClick={(e) => { e.stopPropagation(); setSelectedPerson(null); }} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                                </div>
                            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', padding: '0 24px' }}>
                                {[
                                    { key: 'docs' as const, label: `Documents (${REQUIRED_DOCS.length})`, icon: FileText },
                                    { key: 'details' as const, label: 'Personal Info', icon: User },
                                    { key: 'bank' as const, label: 'Bank', icon: CreditCard },
                                    { key: 'messages' as const, label: `Messages${(selectedPerson.verificationMessages || []).length > 0 ? ` (${selectedPerson.verificationMessages.length})` : ''}`, icon: MessageSquare },
                                ].map(tab => (
                                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', fontSize: '0.875rem', fontWeight: 600, color: activeTab === tab.key ? 'var(--primary)' : 'var(--foreground-secondary)', borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent', background: 'none', cursor: 'pointer', borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
                                        <tab.icon size={16} /> {tab.label}
                                    </button>
                                ))}
                            </div>

                            <div className="modal-body" style={{ padding: 24, maxHeight: '60vh', overflowY: 'auto' }}>
                                {/* Verification Status Banner */}
                                {(selectedPerson.verificationStatus === 'rejected' || selectedPerson.verificationStatus === 'needs_revision') && (
                                    <div style={{
                                        padding: '14px 16px', borderRadius: 12, marginBottom: 20,
                                        background: selectedPerson.verificationStatus === 'rejected'
                                            ? 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))'
                                            : 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))',
                                        border: `1px solid ${selectedPerson.verificationStatus === 'rejected' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <AlertCircle size={16} color={selectedPerson.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B'} />
                                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: selectedPerson.verificationStatus === 'rejected' ? '#EF4444' : '#F59E0B' }}>
                                                {selectedPerson.verificationStatus === 'rejected' ? '⛔ Application Rejected' : '⚠️ Revision Required'}
                                            </span>
                                        </div>
                                        {selectedPerson.verificationNotes && (
                                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground)', lineHeight: 1.5, margin: 0 }}>
                                                {selectedPerson.verificationNotes}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'docs' && (
                                    <div>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 16 }}>
                                            Required Documents ({getDocStats(selectedPerson).approved}/{REQUIRED_DOCS.length} Approved)
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                            {REQUIRED_DOCS.map(doc => {
                                                const ds = getDocStatus(selectedPerson, doc.key);
                                                const sc = getDocStatusStyle(ds.status);
                                                const url = selectedPerson[doc.urlField] as string;
                                                return (
                                                    <div key={doc.key} style={{ background: 'var(--surface-hover)', borderRadius: 14, padding: 16, border: `1px solid ${ds.status === 'approved' ? 'rgba(16,185,129,0.3)' : ds.status === 'rejected' || ds.status === 'needs_revision' ? 'rgba(239,68,68,0.3)' : 'var(--glass-border)'}` }}>
                                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                                            <div style={{ width: 100, height: 80, borderRadius: 10, overflow: 'hidden', background: 'var(--background)', flexShrink: 0, cursor: url ? 'pointer' : 'default' }} onClick={() => url && setPreviewImage(url)}>
                                                                {url ? <img src={url} alt={doc.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileWarning size={24} style={{ opacity: 0.4 }} /></div>}
                                                            </div>
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                                    <h5 style={{ fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>{doc.label}</h5>
                                                                    <span style={{ padding: '2px 10px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 700, background: sc.bg, color: sc.color }}>{sc.label}</span>
                                                                </div>
                                                                {ds.note && (ds.status === 'rejected' || ds.status === 'needs_revision') && (
                                                                    <p style={{ fontSize: '0.75rem', color: '#EF4444', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}><MessageSquare size={12} /> {ds.note}</p>
                                                                )}
                                                                {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, textDecoration: 'none' }}><ExternalLink size={12} /> Open full size</a>}
                                                            </div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                                                {ds.status !== 'approved' && url && (
                                                                    <>
                                                                        <button onClick={() => handleDocApprove(selectedPerson.deliveryPersonId, doc.key)} disabled={docProcessing} style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(16,185,129,0.9)', color: 'white', display: 'flex', alignItems: 'center', gap: 4 }}><BadgeCheck size={13} /> Approve</button>
                                                                        <button onClick={() => { setDocReviewKey(doc.key); setDocReviewAction('reject'); setDocReviewReasons([]); setDocReviewCustom(''); }} style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#EF4444', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={13} /> Reject</button>
                                                                        <button onClick={() => { setDocReviewKey(doc.key); setDocReviewAction('needs_revision'); setDocReviewReasons([]); setDocReviewCustom(''); }} style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', background: 'rgba(245,158,11,0.12)', color: '#D97706', display: 'flex', alignItems: 'center', gap: 4 }}><RotateCcw size={13} /> Revision</button>
                                                                    </>
                                                                )}
                                                                {ds.status === 'approved' && <span style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, background: 'rgba(16,185,129,0.12)', color: '#10B981', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={13} /> Verified</span>}
                                                                {!url && <span style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, background: 'rgba(156,163,175,0.12)', color: '#9CA3AF' }}>Not uploaded</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {activeTab === 'details' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                        {[
                                            { label: 'Full Name', value: selectedPerson.fullName },
                                            { label: 'Phone', value: selectedPerson.phoneNumber },
                                            { label: 'Email', value: selectedPerson.email },
                                            { label: 'Vehicle Type', value: selectedPerson.vehicleType },
                                            { label: 'Vehicle Number', value: selectedPerson.vehicleNumber },
                                            { label: 'City', value: selectedPerson.city },
                                            { label: 'Pincode', value: selectedPerson.pincode },
                                            { label: 'License Number', value: selectedPerson.driverLicenseNumber },
                                        ].map(item => (
                                            <div key={item.label} style={{ background: 'var(--surface-hover)', borderRadius: 12, padding: '12px 14px' }}>
                                                <p style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 4 }}>{item.label}</p>
                                                <p style={{ fontWeight: 600, fontSize: '0.85rem', color: item.value ? 'var(--foreground)' : 'var(--foreground-secondary)' }}>{item.value || 'Not provided'}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {activeTab === 'bank' && (
                                    <div>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 16 }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CreditCard size={14} /> Bank &amp; Payment Information</span>
                                        </h4>

                                        {/* Passbook image */}
                                        {selectedPerson.bankPassbookUrl ? (
                                            <div style={{ marginBottom: 20, padding: 14, borderRadius: 14, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)' }}>
                                                <p style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 10 }}>
                                                    🏦 Bank Passbook / Cancelled Cheque
                                                </p>
                                                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                                                    <div
                                                        style={{ width: 160, height: 120, borderRadius: 10, overflow: 'hidden', background: 'var(--background)', flexShrink: 0, cursor: 'pointer', border: '1px solid var(--glass-border)' }}
                                                        onClick={() => setPreviewImage(selectedPerson.bankPassbookUrl)}
                                                    >
                                                        <img src={selectedPerson.bankPassbookUrl} alt="Bank Passbook" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Click image to view full size</p>
                                                        <a href={selectedPerson.bankPassbookUrl} target="_blank" rel="noopener noreferrer"
                                                            style={{ fontSize: '0.78rem', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                                                            <ExternalLink size={13} /> Open full size
                                                        </a>
                                                        {(() => {
                                                            const ds = getDocStatus(selectedPerson, 'passbook');
                                                            const sc = getDocStatusStyle(ds.status);
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

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                            {[
                                                { label: 'Account Holder Name', value: selectedPerson.bankAccountHolderName },
                                                { label: 'Account Number', value: selectedPerson.bankAccountNumber },
                                                { label: 'Bank Name', value: selectedPerson.bankName },
                                                { label: 'IFSC Code', value: selectedPerson.ifscCode },
                                                { label: 'UPI ID', value: selectedPerson.upiId },
                                            ].map(item => (
                                                <div key={item.label} style={{ background: 'var(--surface-hover)', borderRadius: 12, padding: '12px 14px' }}>
                                                    <p style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--foreground-secondary)', marginBottom: 4 }}>{item.label}</p>
                                                    <p style={{ fontWeight: 600, fontSize: '0.85rem', color: item.value ? 'var(--foreground)' : 'var(--foreground-secondary)' }}>{item.value || 'Not provided'}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {activeTab === 'messages' && (
                                    <div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, maxHeight: 350, overflowY: 'auto' }}>
                                            {(selectedPerson.verificationMessages || []).length === 0 ? (
                                                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--foreground-secondary)' }}>
                                                    <MessageSquare size={36} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
                                                    <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>No messages yet</p>
                                                    <p style={{ fontSize: '0.78rem', marginTop: 4 }}>Send a message about documents or verification status</p>
                                                </div>
                                            ) : (
                                                (selectedPerson.verificationMessages || []).map(msg => (
                                                    <div key={msg.id} style={{
                                                        display: 'flex', flexDirection: 'column',
                                                        alignItems: msg.sender === 'admin' ? 'flex-end' : 'flex-start',
                                                    }}>
                                                        <div style={{
                                                            maxWidth: '75%', padding: '10px 14px', borderRadius: 14,
                                                            background: msg.sender === 'admin'
                                                                ? 'linear-gradient(135deg, rgba(244,81,30,0.12), rgba(244,81,30,0.06))'
                                                                : 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(99,102,241,0.06))',
                                                            border: `1px solid ${msg.sender === 'admin' ? 'rgba(244,81,30,0.2)' : 'rgba(99,102,241,0.2)'}`,
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: msg.sender === 'admin' ? '#F4511E' : '#6366F1' }}>
                                                                    {msg.sender === 'admin' ? '👨‍💼 Admin' : `🚴 ${msg.senderName || 'Partner'}`}
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
                                                    placeholder={`Message to ${selectedPerson.fullName}${adminMsgDocKey ? ` about ${REQUIRED_DOCS.find(d => d.key === adminMsgDocKey)?.label}` : ''}...`}
                                                    rows={2} className="input" style={{ flex: 1, resize: 'none' }} />
                                                <button onClick={() => handleSendMessage(selectedPerson.deliveryPersonId, adminMsgDocKey || undefined)}
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
                            <div className="modal-footer">
                                <button onClick={() => setShowRejectModal(true)} className="btn btn-danger" disabled={processing}><XCircle size={16} /> Reject All</button>
                                <button onClick={() => handleApprove(selectedPerson)} className="btn btn-success" disabled={processing}><CheckCircle size={16} /> {processing ? 'Processing...' : 'Approve All'}</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    </div>
    );
}

