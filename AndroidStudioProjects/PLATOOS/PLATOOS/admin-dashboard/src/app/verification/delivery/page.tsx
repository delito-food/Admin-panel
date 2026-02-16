'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Filter, Eye, CheckCircle, XCircle, Bike, Phone, MapPin,
    FileText, X, Clock, ShieldCheck, RefreshCw, User, Car, IdCard,
    Loader2, CreditCard, Mail
} from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';

interface PendingDeliveryPerson {
    deliveryPersonId: string;
    fullName: string;
    phoneNumber: string;
    email: string;
    address: string;
    city: string;
    pincode: string;
    vehicleType: string;
    vehicleNumber: string;
    driverLicenseNumber: string;
    driverLicenseUrl: string;
    vehicleDocumentUrl: string;
    profilePhotoUrl: string;
    bankName: string;
    bankAccountNumber: string;
    ifscCode: string;
    upiId: string;
    submittedAt: string;
    verificationStatus: 'pending';
}

export default function DeliveryVerificationPage() {
    const { data: deliveryPersons, loading, refetch } = useApi<PendingDeliveryPerson[]>('/api/verification/delivery');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPerson, setSelectedPerson] = useState<PendingDeliveryPerson | null>(null);
    const [rejectionNotes, setRejectionNotes] = useState('');
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [activeTab, setActiveTab] = useState<'details' | 'docs' | 'bank'>('details');
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    const filteredPersons = (deliveryPersons || []).filter(person =>
        (person.fullName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (person.phoneNumber || '').includes(searchQuery) ||
        (person.vehicleNumber || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleApprove = async (person: PendingDeliveryPerson) => {
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/delivery', {
                deliveryPersonId: person.deliveryPersonId,
                action: 'approve'
            });
            if (res.success) {
                refetch();
                setSelectedPerson(null);
            }
        } catch (error) {
            console.error('Approval error:', error);
        } finally {
            setProcessing(false);
        }
    };

    const handleReject = async () => {
        if (!selectedPerson) return;
        setProcessing(true);
        try {
            const res = await apiPatch('/api/verification/delivery', {
                deliveryPersonId: selectedPerson.deliveryPersonId,
                action: 'reject',
                notes: rejectionNotes
            });
            if (res.success) {
                refetch();
                setSelectedPerson(null);
                setShowRejectModal(false);
                setRejectionNotes('');
            }
        } catch (error) {
            console.error('Rejection error:', error);
        } finally {
            setProcessing(false);
        }
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return 'N/A';
        return d.toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const getVehicleIcon = (type: string) => {
        if (type?.toLowerCase() === 'car') return <Car size={24} className="text-white" />;
        return <Bike size={24} className="text-white" />;
    };

    if (loading) {
        return (
            <div>
                <div style={{ marginBottom: 32 }}>
                    <h1 className="page-title">Delivery Verification</h1>
                    <p className="page-description">Loading partner data...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
                    <Loader2 className="animate-spin text-[var(--primary)]" size={40} />
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
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #6366F1, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ShieldCheck size={20} style={{ color: 'white' }} />
                        </div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Verification</h1>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--foreground-secondary)', marginLeft: 52, marginTop: 2 }}>Review partner registrations & documents</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ marginTop: 12, opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stat Cards */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px 40px -12px' }}>
                {[
                    { label: 'Pending Review', value: (deliveryPersons || []).length, icon: Clock, gradient: 'linear-gradient(135deg, #F59E0B, #D97706)', shadow: 'rgba(245, 158, 11, 0.2)' },
                    { label: 'Bikes', value: (deliveryPersons || []).filter(p => !p.vehicleType || p.vehicleType.toLowerCase() === 'bike').length, icon: Bike, gradient: 'linear-gradient(135deg, #6366F1, #4F46E5)', shadow: 'rgba(99, 102, 241, 0.2)' },
                    { label: 'Cars', value: (deliveryPersons || []).filter(p => p.vehicleType?.toLowerCase() === 'car').length, icon: Car, gradient: 'linear-gradient(135deg, #EC4899, #DB2777)', shadow: 'rgba(236, 72, 153, 0.2)' },
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
                        <input type="text" placeholder="Search by name, phone, or vehicle..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input" />
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #6366F1, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ShieldCheck size={14} style={{ color: 'white' }} />
                        </div>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)' }}>Pending</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', background: 'var(--primary)', color: 'white', borderRadius: 9999 }}>{filteredPersons.length}</span>
                    </div>
                </div>
            </div>

            {/* Grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', margin: '0 -12px' }}>
                <AnimatePresence mode="popLayout">
                    {filteredPersons.map((person, index) => (
                        <div key={person.deliveryPersonId} style={{ flex: '1 1 460px', maxWidth: '50%', padding: '0 12px', marginBottom: 24 }}>
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: index * 0.05 }}
                                className="glass-card" style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #6366F1, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
                                        {person.profilePhotoUrl ? (
                                            <img src={person.profilePhotoUrl} alt={person.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                                        ) : (
                                            getVehicleIcon(person.vehicleType)
                                        )}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                            <div>
                                                <h3 style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--foreground)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{person.fullName}</h3>
                                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                                    <IdCard size={13} /> {person.vehicleNumber}
                                                </p>
                                            </div>
                                            <span className="badge badge-pending" style={{ flexShrink: 0 }}><Clock size={12} /> Pending</span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--glass-border)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}>
                                        <Phone size={14} style={{ flexShrink: 0, opacity: 0.7 }} /> <span>{person.phoneNumber}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--foreground-secondary)' }}>
                                        <MapPin size={14} style={{ flexShrink: 0, opacity: 0.7 }} /> <span>{person.city}</span>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 20 }}>
                                    <button onClick={() => { setSelectedPerson(person); setActiveTab('details'); }} className="btn btn-outline" style={{ flex: 1 }}>
                                        <Eye size={16} /> View Details
                                    </button>
                                    <button onClick={() => handleApprove(person)} disabled={processing} className="btn btn-success" style={{ flex: 1 }}>
                                        <CheckCircle size={16} /> Approve
                                    </button>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--glass-border)', fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                    <span>Submitted: {formatDate(person.submittedAt)}</span>
                                    <button onClick={() => { setSelectedPerson(person); setShowRejectModal(true); }}
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
            {filteredPersons.length === 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '64px 32px', textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #10B981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                        <CheckCircle size={28} style={{ color: 'white' }} />
                    </div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>All caught up!</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 6 }}>No pending verifications.</p>
                </motion.div>
            )}

            {/* Detail Modal */}
            <AnimatePresence>
                {selectedPerson && !showRejectModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setSelectedPerson(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                    <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #6366F1, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                                        {selectedPerson.profilePhotoUrl ? (
                                            <img src={selectedPerson.profilePhotoUrl} alt={selectedPerson.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            getVehicleIcon(selectedPerson.vehicleType)
                                        )}
                                    </div>
                                    <div>
                                        <h2 className="modal-title" style={{ margin: 0 }}>{selectedPerson.fullName}</h2>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedPerson.phoneNumber} · {selectedPerson.city}</p>
                                    </div>
                                </div>
                                <button onClick={() => setSelectedPerson(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>

                            {/* Tabs */}
                            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--glass-border)', padding: '0 24px' }}>
                                {[
                                    { key: 'details' as const, label: 'Personal & Vehicle', icon: User },
                                    { key: 'docs' as const, label: 'Documents', icon: FileText },
                                    { key: 'bank' as const, label: 'Bank Details', icon: CreditCard },
                                ].map(tab => (
                                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', fontSize: '0.875rem', fontWeight: 600,
                                            color: activeTab === tab.key ? 'var(--primary)' : 'var(--foreground-secondary)',
                                            borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                                            background: 'none', cursor: 'pointer', transition: 'all 0.2s',
                                        }}>
                                        <tab.icon size={16} /> {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="modal-body" style={{ padding: 24, maxHeight: '60vh', overflowY: 'auto' }}>
                                {activeTab === 'details' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                        <div className="glass-card" style={{ padding: 16, gridColumn: 'span 2' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--foreground-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                                <MapPin size={14} /> Address
                                            </div>
                                            <p style={{ fontWeight: 500, color: 'var(--foreground)', fontSize: '0.9rem' }}>{selectedPerson.address}</p>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>{selectedPerson.city} - {selectedPerson.pincode}</p>
                                        </div>
                                        <div className="glass-card" style={{ padding: 16 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--foreground-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                                <Mail size={14} /> Email
                                            </div>
                                            <p style={{ fontWeight: 500, color: 'var(--foreground)', fontSize: '0.9rem' }}>{selectedPerson.email || 'N/A'}</p>
                                        </div>
                                        <div className="glass-card" style={{ padding: 16 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--foreground-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                                <Phone size={14} /> Phone
                                            </div>
                                            <p style={{ fontWeight: 500, color: 'var(--foreground)', fontSize: '0.9rem' }}>{selectedPerson.phoneNumber}</p>
                                        </div>
                                        <div className="glass-card" style={{ padding: 16 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--foreground-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                                {selectedPerson.vehicleType === 'Car' ? <Car size={14} /> : <Bike size={14} />} Vehicle Type
                                            </div>
                                            <p style={{ fontWeight: 500, color: 'var(--foreground)', fontSize: '0.9rem' }}>{selectedPerson.vehicleType}</p>
                                        </div>
                                        <div className="glass-card" style={{ padding: 16 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--foreground-secondary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                                                <IdCard size={14} /> Vehicle Number
                                            </div>
                                            <p style={{ fontWeight: 500, color: 'var(--foreground)', fontSize: '0.9rem' }}>{selectedPerson.vehicleNumber}</p>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'docs' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                                        {[
                                            { label: 'Driver License', url: selectedPerson.driverLicenseUrl, number: selectedPerson.driverLicenseNumber },
                                            { label: 'Vehicle RC / Document', url: selectedPerson.vehicleDocumentUrl, number: '' }
                                        ].map((doc) => (
                                            <div key={doc.label} className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
                                                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-secondary)', marginBottom: 12 }}>{doc.label}</p>
                                                {doc.url ? (
                                                    <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minHeight: 140, borderRadius: 10, overflow: 'hidden', background: 'var(--background)', display: 'block' }}>
                                                        <img src={doc.url} alt={doc.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                                                    </a>
                                                ) : (
                                                    <div style={{ flex: 1, minHeight: 140, background: 'var(--background)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>No document uploaded</p>
                                                    </div>
                                                )}
                                                {doc.number && <p style={{ fontSize: '0.8rem', fontWeight: 500, marginTop: 12, textAlign: 'center' }}>{doc.number}</p>}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeTab === 'bank' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                        {[
                                            { label: 'Bank Name', value: selectedPerson.bankName },
                                            { label: 'Account Number', value: selectedPerson.bankAccountNumber },
                                            { label: 'IFSC Code', value: selectedPerson.ifscCode },
                                            { label: 'UPI ID', value: selectedPerson.upiId }
                                        ].map(item => (
                                            <div key={item.label} className="glass-card" style={{ padding: 16 }}>
                                                <p style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--foreground-secondary)', marginBottom: 4, textTransform: 'uppercase' }}>{item.label}</p>
                                                <p style={{ fontWeight: 500, color: item.value ? 'var(--foreground)' : 'var(--foreground-secondary)' }}>{item.value || 'Not provided'}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="modal-footer">
                                <button onClick={() => setShowRejectModal(true)} className="btn btn-danger" disabled={processing}>
                                    <XCircle size={16} /> Reject
                                </button>
                                <button onClick={() => handleApprove(selectedPerson)} className="btn btn-success" disabled={processing}>
                                    <CheckCircle size={16} /> Approve
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Rejection Modal */}
            <AnimatePresence>
                {showRejectModal && selectedPerson && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setShowRejectModal(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Reject Partner</h2>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{selectedPerson.fullName}</p>
                                </div>
                                <button onClick={() => setShowRejectModal(false)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body" style={{ padding: 24 }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: 8 }}>Rejection Reason</label>
                                <textarea value={rejectionNotes} onChange={(e) => setRejectionNotes(e.target.value)} placeholder="Please provide a reason..." rows={4} className="input" style={{ resize: 'none' }} />
                            </div>
                            <div className="modal-footer">
                                <button onClick={() => setShowRejectModal(false)} className="btn btn-outline">Cancel</button>
                                <button onClick={handleReject} className="btn btn-danger" disabled={processing || !rejectionNotes.trim()}>Confirm Rejection</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
