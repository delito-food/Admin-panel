'use client';

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Store, CheckCircle, XCircle, Clock, RefreshCw, X, MapPin, Phone, User,
    Camera, ExternalLink, Loader2, Search, EyeOff, AlertTriangle, Upload, ShieldCheck,
} from 'lucide-react';
import { useApi, apiPatch } from '@/hooks/useApi';
import { authenticatedFetch } from '@/lib/api-client';

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
 *
 * IMPORTANT, and the reason for the "Live to customers" badges below: the
 * customer app shows a vendor's cover photo without checking whether it was
 * approved, so a submission is on customer screens from the moment it is
 * uploaded. Reviewing here is therefore catch-up, not a gate. Reject and
 * "Take down" both remove the photo from the customer app; approve puts a
 * removed one back.
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
    /** The photo to review — the live one, or the one taken down. */
    reviewImageUrl: string;
    shopImageStatus: string;
    shopImageReviewNote: string;
    shopImageSubmittedAt: string;
    shopImageReviewedAt: string;
    /** Whether customers can see this photo right now. */
    liveOnCustomerApp: boolean;
    shopImageSource: string;
    shopImageOverriddenBy: string;
    shopImageOverriddenAt: string;
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
    const [overriding, setOverriding] = useState<ShopPhotoVendor | null>(null);
    const [overrideFile, setOverrideFile] = useState<File | null>(null);
    const [overrideError, setOverrideError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 2600);
    };

    const liveCount = (data || []).filter(v => v.liveOnCustomerApp).length;

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
            showToast(`Rejected and removed - ${rejecting.shopName}`);
            setRejecting(null); setReasons([]); setCustomReason('');
            await refetch();
        } else showToast(res.error || 'Could not reject');
    };

    // Take a photo off customer screens immediately, without deciding on it.
    // The submission stays in this queue and approving restores it.
    const takeDown = async (v: ShopPhotoVendor) => {
        setBusyId(v.vendorId);
        const res = await apiPatch('/api/verification/shop-photos', { vendorId: v.vendorId, action: 'pull' });
        setBusyId(null);
        if (res.success) { showToast(`Removed from customer app - ${v.shopName}`); await refetch(); }
        else showToast(res.error || 'Could not remove');
    };

    const submitOverride = async () => {
        if (!overriding || !overrideFile) return;
        setOverrideError('');
        setBusyId(overriding.vendorId);

        const form = new FormData();
        form.append('vendorId', overriding.vendorId);
        form.append('file', overrideFile);

        try {
            // No Content-Type header — the browser sets the multipart boundary.
            const response = await authenticatedFetch('/api/verification/shop-photos', {
                method: 'POST',
                body: form,
            });
            const result = await response.json();
            if (result.success) {
                showToast(`Photo replaced - ${overriding.shopName}`);
                setOverriding(null);
                setOverrideFile(null);
                await refetch();
            } else {
                setOverrideError(result.error || 'Could not replace the photo');
            }
        } catch {
            setOverrideError('Network error. Please try again.');
        } finally {
            setBusyId(null);
        }
    };

    const pickOverrideFile = (file: File | null) => {
        setOverrideError('');
        if (!file) { setOverrideFile(null); return; }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setOverrideError('Photo must be a JPEG, PNG or WebP image');
            setOverrideFile(null);
            return;
        }
        if (file.size > 4 * 1024 * 1024) {
            setOverrideError('Photo must be under 4 MB');
            setOverrideFile(null);
            return;
        }
        setOverrideFile(file);
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

            {/* The gap this screen cannot close on its own — say so plainly,
                so nobody assumes an unreviewed photo is being held back. */}
            {!loading && tab === 'pending' && liveCount > 0 && (
                <div className="glass-card" style={{ padding: 16, marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start', borderLeft: '3px solid #F59E0B' }}>
                    <AlertTriangle size={18} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                        <strong>{liveCount} unreviewed {liveCount === 1 ? 'photo is' : 'photos are'} already visible to customers.</strong>
                        <div style={{ color: 'var(--foreground-secondary)', marginTop: 2 }}>
                            The customer app shows a vendor&apos;s photo as soon as it is uploaded, without waiting for approval.
                            Use <em>Take down</em> to remove one from customer screens right now, or reject it with a reason — both
                            take it off the app immediately.
                        </div>
                    </div>
                </div>
            )}

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
                        <button onClick={() => setPreview(v.reviewImageUrl)} style={{ border: 'none', padding: 0, cursor: 'zoom-in', background: '#111', aspectRatio: '4 / 3', display: 'block', position: 'relative' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={v.reviewImageUrl} alt={`Outlet photo of ${v.shopName}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: v.liveOnCustomerApp ? 1 : 0.45 }} />
                            {/* What customers can see, stated on the photo itself. */}
                            <span style={{
                                position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
                                padding: '4px 9px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600, color: 'white',
                                background: v.liveOnCustomerApp ? 'rgba(239, 68, 68, 0.92)' : 'rgba(17, 17, 17, 0.75)',
                            }}>
                                {v.liveOnCustomerApp ? <><Camera size={12} /> Live to customers</> : <><EyeOff size={12} /> Off customer app</>}
                            </span>
                            {v.shopImageSource === 'admin' && (
                                <span style={{
                                    position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
                                    padding: '4px 9px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600, color: 'white',
                                    background: 'rgba(59, 130, 246, 0.92)',
                                }}>
                                    <ShieldCheck size={12} /> Set by admin
                                </span>
                            )}
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
                            {v.shopImageSource === 'admin' && v.shopImageOverriddenBy && (
                                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                    Replaced by {v.shopImageOverriddenBy}{v.shopImageOverriddenAt ? ` · ${formatDate(v.shopImageOverriddenAt)}` : ''}
                                </p>
                            )}

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 'auto', paddingTop: 10 }}>
                                {tab !== 'approved' && (
                                    <button className="btn btn-primary" style={{ flex: '1 1 120px' }} disabled={busyId === v.vendorId} onClick={() => approve(v)}>
                                        <CheckCircle size={15} /> {v.liveOnCustomerApp ? 'Approve' : 'Approve & restore'}
                                    </button>
                                )}
                                {tab !== 'rejected' && (
                                    <button className="btn btn-danger" style={{ flex: '1 1 120px' }} disabled={busyId === v.vendorId} onClick={() => { setRejecting(v); setReasons([]); setCustomReason(''); }}>
                                        <XCircle size={15} /> Reject
                                    </button>
                                )}
                                {v.liveOnCustomerApp && (
                                    <button className="btn btn-outline" style={{ flex: '1 1 120px' }} disabled={busyId === v.vendorId} onClick={() => takeDown(v)}
                                        title="Remove from the customer app now, without deciding. Approving later puts it back.">
                                        <EyeOff size={15} /> Take down
                                    </button>
                                )}
                                <button className="btn btn-outline" style={{ flex: '1 1 120px' }} disabled={busyId === v.vendorId}
                                    onClick={() => { setOverriding(v); setOverrideFile(null); setOverrideError(''); }}
                                    title="Upload a replacement photo yourself. It goes live immediately.">
                                    <Upload size={15} /> Replace
                                </button>
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

            {/* Manual override — admin supplies the photo customers will see */}
            <AnimatePresence>
                {overriding && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setOverriding(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="modal-content" style={{ width: '100%', maxWidth: 460 }} onClick={e => e.stopPropagation()}>
                            <div className="modal-header">
                                <div>
                                    <h2 className="modal-title">Replace outlet photo</h2>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>{overriding.shopName}</p>
                                </div>
                                <button onClick={() => setOverriding(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--foreground-secondary)' }}>
                                    This photo goes live on the customer app straight away and is marked as approved and
                                    admin-set. Use it when the vendor cannot supply a usable shop front photo.
                                </p>

                                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                                    onChange={e => pickOverrideFile(e.target.files?.[0] ?? null)} />

                                <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()} style={{ justifyContent: 'center' }}>
                                    <Upload size={16} /> {overrideFile ? 'Choose a different photo' : 'Choose a photo'}
                                </button>

                                {overrideFile && (
                                    <div style={{ borderRadius: 12, overflow: 'hidden', background: '#111' }}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={URL.createObjectURL(overrideFile)} alt="Replacement preview"
                                            style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
                                    </div>
                                )}
                                {overrideFile && (
                                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                        {overrideFile.name} · {(overrideFile.size / 1024 / 1024).toFixed(2)} MB
                                    </p>
                                )}
                                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--foreground-secondary)' }}>
                                    JPEG, PNG or WebP, up to 4 MB.
                                </p>
                                {overrideError && (
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#EF4444' }}>{overrideError}</p>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button onClick={() => setOverriding(null)} className="btn btn-outline">Cancel</button>
                                <button onClick={submitOverride} className="btn btn-primary" disabled={!overrideFile || busyId === overriding.vendorId}>
                                    {busyId === overriding.vendorId ? 'Uploading...' : 'Replace and publish'}
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
