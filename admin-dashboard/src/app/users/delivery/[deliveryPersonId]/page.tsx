'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Bike, Car, Phone, Mail, MapPin, Star, Power,
    Package, Loader2, AlertTriangle, Shield, Wallet,
    IndianRupee, FileText, Calendar, CheckCircle, Ban, RefreshCw
} from 'lucide-react';
import { apiPatch } from '@/hooks/useApi';

interface DeliveryPersonDetail {
    deliveryPersonId: string;
    fullName: string;
    email: string;
    phoneNumber: string;
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
    rating: number;
    totalDeliveries: number;
    totalEarnings: number;
    incentives: number;
    codCollected: number;
    codSettled: number;
    codPending: number;
    isOnline: boolean;
    isOnDelivery: boolean;
    isVerified: boolean;
    isSuspended?: boolean;
    suspensionReason?: string;
    currentLocation: string;
    registeredAt: string;
    createdAt: string;
    status: string;
}

const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 1 }).format(amount || 0);
};

function StatCard({ title, value, icon: Icon, color = 'primary' }: {
    title: string; value: string | number; icon: React.ElementType;
    color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
}) {
    const colorMap = {
        primary: { bg: 'rgba(244, 81, 30, 0.15)', text: '#F4511E' },
        success: { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981' },
        warning: { bg: 'rgba(245, 158, 11, 0.15)', text: '#F59E0B' },
        error: { bg: 'rgba(239, 68, 68, 0.15)', text: '#EF4444' },
        info: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366F1' },
    };
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{title}</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--foreground)' }}>{value}</p>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: colorMap[color].bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={colorMap[color].text} />
                </div>
            </div>
        </motion.div>
    );
}

export default function DeliveryPersonDetailPage() {
    const params = useParams();
    const router = useRouter();
    const deliveryPersonId = params.deliveryPersonId as string;

    const [person, setPerson] = useState<DeliveryPersonDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState(false);
    const [suspending, setSuspending] = useState(false);
    const [photoError, setPhotoError] = useState(false);
    
    // Migration state
    const [showMigrationModal, setShowMigrationModal] = useState(false);
    const [oldDeliveryPersonId, setOldDeliveryPersonId] = useState('');
    const [migrating, setMigrating] = useState(false);

    useEffect(() => {
        const fetchPerson = async () => {
            try {
                const response = await fetch('/api/delivery');
                const result = await response.json();
                if (result.success) {
                    const found = result.data.find((d: DeliveryPersonDetail) => d.deliveryPersonId === deliveryPersonId);
                    if (found) setPerson(found);
                    else setError('Delivery person not found');
                } else {
                    setError('Failed to fetch delivery person');
                }
            } catch {
                setError('Network error');
            } finally {
                setLoading(false);
            }
        };
        fetchPerson();
    }, [deliveryPersonId]);

    const toggleOnline = async () => {
        if (!person || updating) return;
        setUpdating(true);
        const result = await apiPatch('/api/delivery', { deliveryPersonId: person.deliveryPersonId, updates: { isOnline: !person.isOnline } });
        if (result.success) {
            setPerson({ ...person, isOnline: !person.isOnline });
        }
        setUpdating(false);
    };

    const toggleSuspend = async () => {
        if (!person || suspending) return;
        const isSuspended = person.isSuspended || person.status === 'suspended';
        if (isSuspended) {
            if (!confirm(`Unsuspend ${person.fullName}? They will be able to accept deliveries again.`)) return;
            setSuspending(true);
            try {
                const res = await fetch(`/api/delivery/suspend?deliveryPersonId=${person.deliveryPersonId}&adminId=admin`, { method: 'DELETE' });
                const result = await res.json();
                if (result.success) setPerson({ ...person, isSuspended: false, status: 'active' });
                else alert(result.error || 'Failed to unsuspend');
            } catch { alert('Network error'); }
            setSuspending(false);
        } else {
            const reason = prompt(`Reason for suspending ${person.fullName}:`);
            if (!reason) return;
            setSuspending(true);
            try {
                const res = await fetch('/api/delivery/suspend', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deliveryPersonId: person.deliveryPersonId, reason, notes: '', adminId: 'admin' }),
                });
                const result = await res.json();
                if (result.success) setPerson({ ...person, isSuspended: true, status: 'suspended', suspensionReason: reason });
                else alert(result.error || 'Failed to suspend');
            } catch { alert('Network error'); }
            setSuspending(false);
        }
    };

    const handleMigrate = async () => {
        if (!oldDeliveryPersonId.trim()) {
            alert('Please enter the old Delivery Person ID.');
            return;
        }
        if (!confirm('Are you sure you want to migrate data from this old ID? This cannot be undone.')) return;
        
        setMigrating(true);
        try {
            const res = await fetch('/api/users/delivery/migration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    oldDeliveryPersonId: oldDeliveryPersonId.trim(), 
                    newDeliveryPersonId: person?.deliveryPersonId 
                }),
            });
            const result = await res.json();
            if (result.success) {
                alert(`✅ ${result.message}`);
                setShowMigrationModal(false);
                setOldDeliveryPersonId('');
                window.location.reload();
            } else {
                alert(result.error || 'Migration failed');
            }
        } catch (err) {
            alert('Network error');
        }
        setMigrating(false);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Delivery Partner</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>Loading partner details...</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 80 }}>
                    <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--primary)' }} />
                </div>
            </div>
        );
    }

    if (error || !person) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20 }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={32} color="#EF4444" />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 4 }}>{error || 'Not found'}</h2>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)' }}>We couldn&apos;t find the delivery partner you&apos;re looking for</p>
                </div>
                <button onClick={() => router.back()} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Go Back
                </button>
            </div>
        );
    }

    const VehicleIcon = person.vehicleType === 'Car' ? Car : Bike;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        >
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 0.2s'
                    }}
                >
                    <ArrowLeft size={18} style={{ color: 'var(--foreground)' }} />
                </button>
                <div style={{ flex: 1 }}>
                    <h1 style={{ fontSize: 'clamp(1.25rem, 4vw, 1.75rem)', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>{person.fullName}</h1>
                    <p style={{ fontSize: '0.875rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>Delivery Partner Profile</p>
                </div>
            </div>

            {/* Profile Card */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card"
                style={{ overflow: 'hidden' }}
            >
                {/* Cover gradient */}
                <div style={{
                    position: 'relative', height: 120,
                    background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
                }}>
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)' }} />

                    {/* Status badges */}
                    <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6 }}>
                        {(person.isSuspended || person.status === 'suspended') && (
                            <span style={{
                                padding: '4px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                                backdropFilter: 'blur(8px)',
                                background: 'rgba(239,68,68,0.25)', color: '#FCA5A5',
                                border: '1px solid rgba(239,68,68,0.4)',
                            }}>
                                🚫 Suspended
                            </span>
                        )}
                        <span style={{
                            padding: '4px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                            backdropFilter: 'blur(8px)',
                            background: person.isOnline ? 'rgba(16,185,129,0.2)' : 'rgba(156,163,175,0.2)',
                            color: person.isOnline ? '#6EE7B7' : '#D1D5DB',
                            border: `1px solid ${person.isOnline ? 'rgba(16,185,129,0.3)' : 'rgba(156,163,175,0.3)'}`,
                        }}>
                            {person.isOnline ? '● Online' : '● Offline'}
                        </span>
                        {person.isOnDelivery && (
                            <span style={{
                                padding: '4px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                                backdropFilter: 'blur(8px)',
                                background: 'rgba(245,158,11,0.2)', color: '#FCD34D',
                                border: '1px solid rgba(245,158,11,0.3)',
                            }}>
                                On Delivery
                            </span>
                        )}
                    </div>

                    {person.isVerified && (
                        <div style={{ position: 'absolute', top: 12, left: 12 }}>
                            <span style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 600,
                                backdropFilter: 'blur(8px)',
                                background: 'rgba(16,185,129,0.2)', color: '#6EE7B7',
                                border: '1px solid rgba(16,185,129,0.3)',
                            }}>
                                <Shield size={12} /> Verified
                            </span>
                        </div>
                    )}
                </div>

                {/* Profile info */}
                <div style={{ position: 'relative', padding: '0 20px 20px' }}>
                    {/* Avatar */}
                    <div style={{
                        position: 'absolute', top: -36, left: 20,
                        width: 72, height: 72, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden',
                        border: '4px solid var(--glass-bg)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    }}>
                        {person.profilePhotoUrl && !photoError ? (
                            <img src={person.profilePhotoUrl} alt={person.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={() => setPhotoError(true)} />
                        ) : (
                            <Bike size={28} color="white" />
                        )}
                    </div>

                    <div style={{ paddingTop: 44, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16 }}>
                        {/* Left: info */}
                        <div style={{ flex: '1 1 300px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--foreground)', margin: 0, wordBreak: 'break-word' }}>{person.fullName}</h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 8, background: 'rgba(245,158,11,0.1)' }}>
                                    <Star size={13} color="#F59E0B" fill="#F59E0B" />
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#D97706' }}>{(person.rating || 0).toFixed(1)}</span>
                                </div>
                            </div>

                            {/* Vehicle info */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                                <span style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem',
                                    background: 'rgba(99,102,241,0.1)', color: '#6366F1', fontWeight: 500
                                }}>
                                    <VehicleIcon size={12} /> {person.vehicleType}
                                </span>
                                {person.vehicleNumber && (
                                    <span style={{
                                        padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem',
                                        background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--foreground-secondary)', fontWeight: 500, fontFamily: 'monospace'
                                    }}>{person.vehicleNumber}</span>
                                )}
                            </div>

                            {/* Contact */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px 16px', fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                <a href={`tel:${person.phoneNumber}`} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'inherit', textDecoration: 'none' }}>
                                    <Phone size={14} /> {person.phoneNumber}
                                </a>
                                {person.email && (
                                    <a href={`mailto:${person.email}`} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <Mail size={14} /> {person.email}
                                    </a>
                                )}
                                {person.address && (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, gridColumn: '1 / -1' }}>
                                        <MapPin size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                                        <span>{person.address}{person.city ? `, ${person.city}` : ''}{person.pincode ? ` - ${person.pincode}` : ''}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right: action button */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => setShowMigrationModal(true)}
                                className="btn btn-outline"
                                style={{ fontSize: '0.8rem', padding: '6px 14px', gap: 6, borderColor: '#6366F1', color: '#6366F1' }}
                            >
                                <RefreshCw size={14} />
                                Migrate Data
                            </button>
                            <button
                                onClick={toggleOnline}
                                disabled={updating}
                                className={`btn ${person.isOnline ? 'btn-outline' : 'btn-primary'}`}
                                style={{ fontSize: '0.8rem', padding: '6px 14px', gap: 6 }}
                            >
                                {updating ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                                {person.isOnline ? 'Set Offline' : 'Set Online'}
                            </button>
                            <button
                                onClick={toggleSuspend}
                                disabled={suspending}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    fontSize: '0.8rem', padding: '6px 14px', borderRadius: 10,
                                    fontWeight: 600, cursor: suspending ? 'not-allowed' : 'pointer',
                                    border: (person.isSuspended || person.status === 'suspended')
                                        ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(239,68,68,0.4)',
                                    background: (person.isSuspended || person.status === 'suspended')
                                        ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                                    color: (person.isSuspended || person.status === 'suspended') ? '#10B981' : '#EF4444',
                                    opacity: suspending ? 0.6 : 1,
                                    transition: 'all 0.2s',
                                }}
                            >
                                {suspending ? <Loader2 size={14} className="animate-spin" /> :
                                    (person.isSuspended || person.status === 'suspended') ? <CheckCircle size={14} /> : <Ban size={14} />}
                                {(person.isSuspended || person.status === 'suspended') ? 'Unsuspend' : 'Suspend'}
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                <StatCard title="Deliveries" value={person.totalDeliveries || 0} icon={Package} color="primary" />
                <StatCard title="Earnings" value={formatCurrency(person.totalEarnings)} icon={IndianRupee} color="success" />
                <StatCard title="Incentives" value={formatCurrency(person.incentives)} icon={Star} color="warning" />
                <StatCard title="COD Collected" value={formatCurrency(person.codCollected)} icon={Wallet} color="info" />
                <StatCard title="COD Settled" value={formatCurrency(person.codSettled)} icon={CheckCircle} color="success" />
                <StatCard title="COD Pending" value={formatCurrency(person.codPending)} icon={Wallet} color="error" />
            </div>

            {/* Documents & Bank Details */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
                {/* Documents */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={16} style={{ color: '#6366F1' }} /> Documents
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>Driver License</span>
                                {person.driverLicenseNumber && <CheckCircle size={14} color="#10B981" />}
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', fontFamily: 'monospace' }}>{person.driverLicenseNumber || 'Not provided'}</p>
                        </div>
                        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>Vehicle Number</span>
                                {person.vehicleNumber && <CheckCircle size={14} color="#10B981" />}
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', fontFamily: 'monospace' }}>{person.vehicleNumber || 'Not provided'}</p>
                        </div>
                        <div style={{
                            padding: 14, borderRadius: 12,
                            background: 'var(--surface)', border: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', gap: 8,
                            fontSize: '0.8rem', color: 'var(--foreground-secondary)',
                        }}>
                            <Calendar size={14} />
                            <span>Registered on {formatDate(person.registeredAt || person.createdAt)}</span>
                        </div>
                    </div>
                </motion.div>

                {/* Bank Details */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ padding: 20 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Wallet size={16} style={{ color: '#10B981' }} /> Payment Details
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>Bank Account</span>
                                {person.bankAccountNumber && <CheckCircle size={14} color="#10B981" />}
                            </div>
                            {person.bankAccountNumber ? (
                                <div style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                    <p style={{ fontFamily: 'monospace' }}>{person.bankAccountNumber}</p>
                                    {person.bankName && <p style={{ marginTop: 2 }}>{person.bankName}</p>}
                                    {person.ifscCode && <p style={{ marginTop: 2, fontFamily: 'monospace' }}>IFSC: {person.ifscCode}</p>}
                                </div>
                            ) : (
                                <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>Not provided</p>
                            )}
                        </div>
                        <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--foreground)' }}>UPI ID</span>
                                {person.upiId && <CheckCircle size={14} color="#10B981" />}
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)', fontFamily: 'monospace' }}>{person.upiId || 'Not provided'}</p>
                        </div>
                    </div>
                </motion.div>
            </div>
            
            {/* Migration Modal */}
            <AnimatePresence>
                {showMigrationModal && (
                    <div style={{
                        position: 'fixed', inset: 0, zIndex: 100,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
                        padding: 20,
                    }}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            style={{
                                width: '100%', maxWidth: 450,
                                background: 'var(--surface)', borderRadius: 20,
                                border: '1px solid var(--border)',
                                overflow: 'hidden',
                                boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
                            }}
                        >
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>Migrate Historical Data</h3>
                            </div>
                            
                            <div style={{ padding: 24 }}>
                                <div style={{ 
                                    padding: 12, borderRadius: 12, background: 'rgba(99,102,241,0.1)', 
                                    color: 'var(--foreground)', fontSize: '0.85rem', marginBottom: 20,
                                    border: '1px solid rgba(99,102,241,0.2)'
                                }}>
                                    <p style={{ margin: '0 0 8px 0' }}>If this partner previously logged in with a password and recently switched to OTP, their old deliveries and earnings are tied to their old Account ID.</p>
                                    <p style={{ margin: 0, fontWeight: 500 }}>Enter their old ID below to migrate all past data to this current account.</p>
                                </div>
                                
                                <div className="form-group" style={{ marginBottom: 24 }}>
                                    <label className="form-label" style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Old Delivery Person ID (Firebase UID)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="e.g. 7abc123..."
                                        value={oldDeliveryPersonId}
                                        onChange={e => setOldDeliveryPersonId(e.target.value)}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--foreground)' }}
                                    />
                                </div>
                            </div>
                            
                            <div style={{ padding: '16px 24px', background: 'var(--background)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                                <button 
                                    className="btn btn-outline" 
                                    onClick={() => { setShowMigrationModal(false); setOldDeliveryPersonId(''); }}
                                    disabled={migrating}
                                >
                                    Cancel
                                </button>
                                <button 
                                    className="btn btn-primary"
                                    onClick={handleMigrate}
                                    disabled={migrating || !oldDeliveryPersonId.trim()}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#6366F1', borderColor: '#6366F1', color: '#fff' }}
                                >
                                    {migrating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                    {migrating ? 'Migrating...' : 'Run Migration'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
