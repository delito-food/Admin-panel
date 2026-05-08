'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, RefreshCw, Sparkles, Store, X, Edit3, Trash2,
    ImageIcon, Loader2, Save, Eye, ToggleLeft, ToggleRight,
    Calendar, Percent, DollarSign, Tag,
} from 'lucide-react';

interface SpecialOffer {
    offerId: string;
    vendorId: string;
    vendorName: string;
    title: string;
    description: string;
    imageUrl: string;
    bannerImageUrl: string;
    discount: number;
    discountType: string;
    minOrderAmount: number;
    maxDiscount: number;
    promoCode: string;
    isActive: boolean;
    startDate: string;
    endDate: string;
    createdAt: string;
    updatedAt: string;
}

export default function SpecialOffersPage() {
    const [offers, setOffers] = useState<SpecialOffer[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [editModal, setEditModal] = useState<SpecialOffer | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Edit form state
    const [editForm, setEditForm] = useState({
        title: '',
        description: '',
        imageUrl: '',
        bannerImageUrl: '',
        discount: 0,
        discountType: 'percentage',
        minOrderAmount: 0,
        maxDiscount: 0,
        promoCode: '',
        isActive: true,
    });

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/special-offers');
            const result = await res.json();
            if (result.success) {
                setOffers(result.data);
            }
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchData();
        setRefreshing(false);
    };

    const openEditModal = (offer: SpecialOffer) => {
        setEditModal(offer);
        setEditForm({
            title: offer.title,
            description: offer.description,
            imageUrl: offer.imageUrl,
            bannerImageUrl: offer.bannerImageUrl || offer.imageUrl,
            discount: offer.discount,
            discountType: offer.discountType,
            minOrderAmount: offer.minOrderAmount,
            maxDiscount: offer.maxDiscount,
            promoCode: offer.promoCode,
            isActive: offer.isActive,
        });
    };

    const handleSave = async () => {
        if (!editModal) return;
        setSaving(true);

        try {
            const res = await fetch('/api/special-offers', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    offerId: editModal.offerId,
                    updates: editForm,
                }),
            });

            const result = await res.json();
            if (result.success) {
                setEditModal(null);
                fetchData();
            } else {
                alert(result.error || 'Failed to save');
            }
        } catch {
            alert('Network error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (offerId: string) => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/special-offers?offerId=${offerId}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                setDeleteConfirm(null);
                fetchData();
            } else {
                alert(result.error || 'Failed to delete');
            }
        } catch {
            alert('Network error');
        } finally {
            setDeleting(false);
        }
    };

    const handleToggleActive = async (offer: SpecialOffer) => {
        try {
            const res = await fetch('/api/special-offers', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    offerId: offer.offerId,
                    updates: { isActive: !offer.isActive },
                }),
            });

            const result = await res.json();
            if (result.success) {
                fetchData();
            }
        } catch {
            alert('Network error');
        }
    };

    const filteredOffers = offers.filter(offer =>
        offer.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        offer.vendorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        offer.promoCode.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const fld: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none' };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center animate-pulse">
                        <RefreshCw className="w-8 h-8 animate-spin text-[var(--primary)]" />
                    </div>
                    <p className="text-[var(--foreground-secondary)] font-medium">Loading special offers...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8" style={{ padding: 20 }}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="page-title">Special Offers</h1>
                    <p className="page-description">Manage vendor promotional banners and offers</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn btn-outline" style={{ opacity: refreshing ? 0.6 : 1 }}>
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3" style={{ gap: '1.5rem' }}>
                {[
                    { label: 'Total Offers', value: offers.length, icon: Sparkles, color: '#F4511E', bg: 'rgba(244,81,30,0.1)' },
                    { label: 'Active', value: offers.filter(o => o.isActive).length, icon: ToggleRight, color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
                    { label: 'Inactive', value: offers.filter(o => !o.isActive).length, icon: ToggleLeft, color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
                ].map((stat, i) => (
                    <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass-card" style={{ padding: '20px 24px' }}>
                        <div className="flex items-start justify-between">
                            <div>
                                <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', fontWeight: 500 }}>{stat.label}</p>
                                <p style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4 }}>{stat.value}</p>
                            </div>
                            <div style={{ width: 44, height: 44, borderRadius: 12, background: stat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <stat.icon size={22} color={stat.color} />
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Search */}
            <div className="glass-card p-6">
                <div className="input-group flex-1">
                    <Search size={18} className="input-icon" />
                    <input
                        type="text"
                        placeholder="Search by title, vendor, or promo code..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input"
                    />
                </div>
            </div>

            {/* Offers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3" style={{ gap: '1.5rem' }}>
                <AnimatePresence mode="popLayout">
                    {filteredOffers.length === 0 ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="empty-state glass-card" style={{ gridColumn: '1 / -1' }}>
                            <div className="empty-state-icon"><Sparkles size={32} /></div>
                            <h3 className="empty-state-title">No special offers found</h3>
                            <p className="empty-state-description">Vendors can create offers from their app.</p>
                        </motion.div>
                    ) : (
                        filteredOffers.map((offer, index) => (
                            <motion.div
                                key={offer.offerId}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ delay: index * 0.03 }}
                                className="glass-card"
                                style={{ overflow: 'hidden' }}
                            >
                                {/* Banner Image */}
                                <div style={{ position: 'relative', width: '100%', height: 160, background: 'var(--surface-hover)' }}>
                                    {(offer.bannerImageUrl || offer.imageUrl) ? (
                                        <img src={offer.bannerImageUrl || offer.imageUrl} alt={offer.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <ImageIcon size={32} color="var(--foreground-secondary)" />
                                        </div>
                                    )}
                                    {/* Active/Inactive badge */}
                                    <div style={{ position: 'absolute', top: 10, right: 10 }}>
                                        <span style={{
                                            fontSize: '0.68rem', fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                                            background: offer.isActive ? 'rgba(16,185,129,0.9)' : 'rgba(156,163,175,0.9)',
                                            color: 'white', backdropFilter: 'blur(4px)',
                                        }}>
                                            {offer.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    {/* Discount badge */}
                                    {offer.discount > 0 && (
                                        <div style={{ position: 'absolute', top: 10, left: 10 }}>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'rgba(239,68,68,0.9)', color: 'white', backdropFilter: 'blur(4px)' }}>
                                                {offer.discount}{offer.discountType === 'percentage' ? '%' : '₹'} OFF
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Content */}
                                <div style={{ padding: 16 }}>
                                    <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>{offer.title || 'Untitled Offer'}</h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                        <Store size={12} color="var(--foreground-secondary)" />
                                        <span style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>{offer.vendorName || 'Unknown'}</span>
                                    </div>
                                    {offer.description && (
                                        <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)', lineHeight: 1.4, marginBottom: 10 }}>
                                            {offer.description.length > 80 ? offer.description.slice(0, 80) + '...' : offer.description}
                                        </p>
                                    )}

                                    {/* Meta */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                                        {offer.promoCode && (
                                            <span style={{ fontSize: '0.68rem', fontWeight: 600, background: 'rgba(99,102,241,0.1)', color: '#6366F1', padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.2)' }}>
                                                🎟️ {offer.promoCode}
                                            </span>
                                        )}
                                        {offer.minOrderAmount > 0 && (
                                            <span style={{ fontSize: '0.68rem', fontWeight: 500, background: 'var(--surface-hover)', color: 'var(--foreground-secondary)', padding: '2px 8px', borderRadius: 6 }}>
                                                Min ₹{offer.minOrderAmount}
                                            </span>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            onClick={() => openEditModal(offer)}
                                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--foreground)', fontSize: '0.82rem', fontWeight: 600, transition: 'all 0.2s' }}
                                        >
                                            <Edit3 size={14} /> Edit
                                        </button>
                                        <button
                                            onClick={() => handleToggleActive(offer)}
                                            style={{ padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: offer.isActive ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', color: offer.isActive ? '#F59E0B' : '#10B981', fontSize: '0.82rem', fontWeight: 600 }}
                                        >
                                            {offer.isActive ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
                                        </button>
                                        <button
                                            onClick={() => setDeleteConfirm(offer.offerId)}
                                            style={{ padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: '0.82rem', fontWeight: 600 }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>

            {/* ─── Edit Modal ─── */}
            <AnimatePresence>
                {editModal && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setEditModal(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="modal-content w-full max-w-lg" style={{ maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2 className="modal-title">Edit Special Offer</h2>
                                <button onClick={() => setEditModal(null)} className="btn btn-ghost btn-icon-sm"><X size={20} /></button>
                            </div>
                            <div className="modal-body space-y-4">
                                {/* Banner Preview */}
                                <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                        <ImageIcon size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                        Banner Image
                                    </label>
                                    {editForm.bannerImageUrl && (
                                        <div style={{ width: '100%', height: 160, borderRadius: 12, overflow: 'hidden', marginBottom: 8, background: 'var(--surface-hover)' }}>
                                            <img src={editForm.bannerImageUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        </div>
                                    )}
                                    <input
                                        type="text"
                                        value={editForm.bannerImageUrl}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, bannerImageUrl: e.target.value, imageUrl: e.target.value }))}
                                        placeholder="Enter banner image URL..."
                                        style={fld}
                                    />
                                    <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', marginTop: 4 }}>
                                        Paste a Cloudinary or direct image URL. Changes reflect immediately on customer app.
                                    </p>
                                </div>

                                {/* Title */}
                                <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>Title</label>
                                    <input type="text" value={editForm.title} onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Offer title..." style={fld} />
                                </div>

                                {/* Description */}
                                <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>Description</label>
                                    <textarea value={editForm.description} onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Offer description..." rows={3} style={{ ...fld, resize: 'vertical' }} />
                                </div>

                                {/* Discount */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div>
                                        <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                            <Percent size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                            Discount
                                        </label>
                                        <input type="number" value={editForm.discount} onChange={(e) => setEditForm(prev => ({ ...prev, discount: Number(e.target.value) }))} style={fld} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>Discount Type</label>
                                        <select value={editForm.discountType} onChange={(e) => setEditForm(prev => ({ ...prev, discountType: e.target.value }))} style={fld}>
                                            <option value="percentage">Percentage (%)</option>
                                            <option value="flat">Flat (₹)</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Min Order & Max Discount */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div>
                                        <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                            <DollarSign size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                            Min Order (₹)
                                        </label>
                                        <input type="number" value={editForm.minOrderAmount} onChange={(e) => setEditForm(prev => ({ ...prev, minOrderAmount: Number(e.target.value) }))} style={fld} />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>Max Discount (₹)</label>
                                        <input type="number" value={editForm.maxDiscount} onChange={(e) => setEditForm(prev => ({ ...prev, maxDiscount: Number(e.target.value) }))} style={fld} />
                                    </div>
                                </div>

                                {/* Promo Code */}
                                <div>
                                    <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                        <Tag size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                                        Promo Code
                                    </label>
                                    <input type="text" value={editForm.promoCode} onChange={(e) => setEditForm(prev => ({ ...prev, promoCode: e.target.value.toUpperCase() }))} placeholder="e.g. SAVE20" style={fld} />
                                </div>

                                {/* Active Toggle */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                                    <div>
                                        <p style={{ fontWeight: 600, fontSize: '0.85rem' }}>Active Status</p>
                                        <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>Active offers are visible to customers</p>
                                    </div>
                                    <button
                                        onClick={() => setEditForm(prev => ({ ...prev, isActive: !prev.isActive }))}
                                        style={{ width: 46, height: 26, borderRadius: 100, border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.25s', background: editForm.isActive ? 'var(--primary)' : 'var(--border)' }}
                                    >
                                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', left: editForm.isActive ? 23 : 3 }} />
                                    </button>
                                </div>

                                {/* Save Button */}
                                <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
                                    <button onClick={() => setEditModal(null)} style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--foreground)', fontWeight: 600, fontSize: '0.85rem' }}>
                                        Cancel
                                    </button>
                                    <button onClick={handleSave} disabled={saving} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: 'var(--primary)', color: 'white', fontWeight: 600, fontSize: '0.85rem', opacity: saving ? 0.6 : 1 }}>
                                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        {saving ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ─── Delete Confirmation ─── */}
            <AnimatePresence>
                {deleteConfirm && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="modal-content w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                            <div style={{ padding: 24, textAlign: 'center' }}>
                                <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                                    <Trash2 size={24} color="#EF4444" />
                                </div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>Delete Offer?</h3>
                                <p style={{ fontSize: '0.85rem', color: 'var(--foreground-secondary)', marginBottom: 20 }}>
                                    This action cannot be undone. The offer will be permanently removed.
                                </p>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                                        Cancel
                                    </button>
                                    <button onClick={() => handleDelete(deleteConfirm)} disabled={deleting} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: deleting ? 'not-allowed' : 'pointer', background: '#EF4444', color: 'white', fontWeight: 600, fontSize: '0.85rem', opacity: deleting ? 0.6 : 1 }}>
                                        {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={14} />}
                                        {deleting ? 'Deleting...' : 'Delete'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

