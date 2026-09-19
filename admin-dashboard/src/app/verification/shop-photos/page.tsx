'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Store, CheckCircle, XCircle, Clock, RefreshCw, X, MapPin, Phone, User,
    Camera, ExternalLink, Loader2, Search,
} from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';

/**
 * Outlet (shop-front) photo review.
 *
 * Vendors take these with the camera from the vendor app's Profile completion
 * screen. The check here is simple and visual: is this the OUTSIDE of the shop,
 * with the signboard visible? Interior, kitchen, menu or selfie photos get
 * rejected with a reason the vendor sees in the app.
 *
 * Uses /api/verification/shop-photos, which only ever touches the shopImage*
 * fields - approving here never changes a vendor's verification or online state.
 */

interface ShopPhotoVendor {
    vendorId: string;
    shopName: string;
    fullName: string;
    phoneNumber: string;
    address: string;
    city: string;
    latitude: number;
    longitude: number;
    locationSource: string;
    isVerified: boolean;
    isOnline: boolean;
    profileImageUrl: string;
    shopImageUrl: string;
    shopImageStatus: string;
    shopImageReviewNote: string;
    shopImageSubmittedAt: string;
    shopImageReviewedAt: string;
}

type Tab = 'pending' | 'approved' | 'rejected';

const REJECTION_REASONS = [
    'Photo shows the inside of the shop, not the front',
    'Shop name / signboard not visible',
    'Photo is too dark or blurry',
    'Not a photo of a shop (menu, food or selfie)',
    'Photo does not match this shop',
];

const formatDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function ShopPhotoReviewPage() {
    const [tab, setTab] = useState<Tab>('pending');
    const { data, loading, error, refetch } = useApi<ShopPhotoVendor[]>(`/api/verification/shop-photos?status=${tab}`);
    const [search, setSearch] = useState('');
    const [preview, setPreview] = useState<string | null>(null);
    const [rejecting, setRejecting] = useState<ShopPhotoVendor | null>(null);
    const [reasons, setReasons] = useState<string[]>([]);
    const [customReason, setCustomReason] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [toast, setToast] = useState('');

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2600);
    };

    const vendors = (data || []).filter(v => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return v.shopName.toLowerCase().includes(q) || v.fullName.toLowerCase().includes(q) || v.phoneNumber.includes(q);
    });

    const approve = async (v: ShopPhotoVendor) => {
        setBusyId(v.vendorId);
        const res = await apiPatch('/api/verification/shop-photos', { vendorId: v.vendorId, action: 'approve' });
        setBusyId(null);
        if (res.success) { showToast(`Approved - ${v.shopName}`); await refetch(); }
        else showToast(res.error || 'Could not approve');
    };

    const confirmReject = async () => {
        if (!rejecting) return;
        const note = [...reasons, customReason.trim()].filter(Boolean).join('; ');
        if (!note) return;
        setBusyId(rejecting.vendorId);
        const res = await apiPatch('/api/verification/shop-photos', { vendorId: rejecting.vendorId, action: 'reject', note });
        setBusyId(null);
        if (res.success) {
            showToast(`Rejected - ${rejecting.shopName}`);
            setRejecting(null); setReasons([]); setCustomReason('');
            await refetch();
        } else showToast(res.error || 'Could not reject');
    };

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #F4511E, #D84315)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Camera size={20} style={{ color: 'white' }} />
                        </div>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--foreground)', margin: 0 }}>Outlet Photos</h1>
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--foreground-secondary)', marginLeft: 52, marginTop: 2 }}>
                        Approve only photos of the shop front with the signboard visible
                    </p>
                </div>
                <button onClick={() => refetch()} className="btn btn-outline" style={{ marginTop: 12 }}>
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {/* Tabs + search */}
            <div className="glass-card" style={{ padding: 16, marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                {(['pending', 'approved', 'rejected'] as Tab[]).map(t => (
                    <button key={t} onClick={() => setTab(t)} className={tab === t ? 'btn btn-primary' : 'btn btn-outline'} style={{ textTransform: 'capitalize' }}>
                        {t === 'pending' ? <Clock size={15} /> : t === 'approved' ? <CheckCircle size={15} /> : <XCircle size={15} />} {t}
                    </button>
                ))}
                <div className="input-group" style={{ flex: '1 1 260px', marginLeft: 'auto' }}>
                    <Search size={18} className="input-icon" />
                    <input className="input" placeholder="Search shop, owner or phone..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            </div>

            {loading && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
                    <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
                </div>
            )}
            {!loading && error && (
                <div className="glass-card" style={{ padding: 24, color: '#EF4444' }}>{error}</div>
            )}
            {!loading && !error && vendors.length === 0 && (
                <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                    <Store size={36} style={{ marginBottom: 12, opacity: 0.5 }} />
                    <p>No {tab} outlet photos.</p>
                </div>
            )}

            {/* Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {!loading && vendors.map(v => (
                    <motion.div key={v.vendorId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <button onClick={() => setPreview(v.shopImageUrl)} style={{ border: 'none', padding: 0, cursor: 'zoom-in', background: '#111', aspectRatio: '4 / 3', display: 'block' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={v.shopImageUrl} alt={`Outlet photo of ${v.shopName}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </button>
                        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{v.shopName || 'Unnamed shop'}</h3>
                                <span className={`badge ${v.isVerified ? 'badge-approved' : 'badge-pending'}`} style={{ flexShrink: 0 }}>
                                    {v.isVerified ? 'Verified' : 'Unverified'}
                                </span>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--foreground-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}><User size={13} /> {v.fullName}</p>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--foreground-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}><Phone size={13} /> {v.phoneNumber}</p>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--foreground-secondary)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                <MapPin size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                                <span>{v.address || v.city || 'No address'}{v.locationSource === 'gps' ? ' (GPS)' : ''}</span>
                            </p>
                            {v.latitude !== 0 && v.longitude !== 0 && (
                                <a href={`https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`} target="_blank" rel="noreferrer"
                                    style={{ fontSize: '0.8rem', color: 'var(--primary)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                    <ExternalLink size={12} /> Compare with map / street view
                                </a>
                            )}
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                Submitted {formatDate(v.shopImageSubmittedAt) || '-'}
                                {v.shopImageReviewedAt ? ` · Reviewed ${formatDate(v.shopImageReviewedAt)}` : ''}
                            </p>
                            {tab === 'rejected' && v.shopImageReviewNote && (
                                <p style={{ margin: 0, fontSize: '0.8rem', color: '#EF4444' }}>Reason: {v.shopImageReviewNote}</p>
                            )}

                            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 10 }}>
                                {tab !== 'approved' && (
                                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={busyId === v.vendorId} onClick={() => approve(v)}>
                                        <CheckCircle size={15} /> Approve
                                    </button>
                                )}
                                {tab !== 'rejected' && (
                                    <button className="btn btn-danger" style={{ flex: 1 }} disabled={busyId === v.vendorId} onClick={() => { setRejecting(v); setReasons([]); setCustomReason(''); }}>
                                        <XCircle size={15} /> Reject
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Reject modal */}
            <AnimatePresence>
                {rejecting && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setRejecting(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 460 }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Reject outlet photo</h2>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{rejecting.shopName}</p>
                                </div>
                                <button onClick={() => setRejecting(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--foreground-secondary)' }}>The vendor sees this reason in the app and is asked to retake the photo.</p>
                                {REJECTION_REASONS.map(r => (
                                    <label key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.875rem', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={reasons.includes(r)}
                                            onChange={() => setReasons(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])} />
                                        {r}
                                    </label>
                                ))}
                                <textarea className="input" rows={3} style={{ resize: 'none' }} placeholder="Other reason (optional)"
                                    value={customReason} onChange={e => setCustomReason(e.target.value)} />
                            </div>
                            <div className="modal-footer">
                                <button onClick={() => setRejecting(null)} className="btn btn-outline">Cancel</button>
                                <button onClick={confirmReject} className="btn btn-danger"
                                    disabled={busyId === rejecting.vendorId || (reasons.length === 0 && !customReason.trim())}>
                                    {busyId === rejecting.vendorId ? 'Saving...' : 'Reject photo'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Preview */}
            <AnimatePresence>
                {preview && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setPreview(null)} style={{ zIndex: 70 }}>
                        <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} style={{ position: 'relative', borderRadius: 16, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => setPreview(null)} style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 9999, background: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={20} style={{ color: 'white' }} />
                            </button>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={preview} alt="Outlet photo" style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {toast && (
                <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--foreground)', color: 'var(--background)', padding: '10px 16px', borderRadius: 10, fontSize: '0.875rem', zIndex: 80 }}>
                    {toast}
                </div>
            )}
        </div>
    );
}
