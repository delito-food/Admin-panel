'use client';

import { useMemo, useState } from 'react';
import { Search, Store, X, Loader2, AlertCircle } from 'lucide-react';

/**
 * Searchable vendor picker for a hero banner's "On tap → Open a vendor".
 * Stores the vendor's ID, which the app opens directly (HeroBannerActions.kt);
 * older banners that hold a shop name are recognised and shown as such.
 */

export interface VendorOption {
    vendorId: string;
    shopName: string;
    shopImageUrl: string;
    city: string;
    isOnline: boolean;
    isVerified: boolean;
}

/** Resolve a banner's linkValue (an ID, or a legacy exact shop name) to a vendor. */
export function findVendor(vendors: VendorOption[] | null, value: string): VendorOption | null {
    if (!vendors || !value.trim()) return null;
    const v = value.trim();
    return vendors.find((x) => x.vendorId === v)
        || vendors.find((x) => x.shopName === v)
        || null;
}

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px 9px 32px', borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.85rem', outline: 'none',
};

function Thumb({ v, size = 34 }: { v: VendorOption; size?: number }) {
    return v.shopImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.shopImageUrl} alt="" style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
    ) : (
        <span style={{ width: size, height: size, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--foreground-secondary)' }}>
            <Store size={size * 0.45} />
        </span>
    );
}

function Status({ v }: { v: VendorOption }) {
    const [txt, color] = !v.isVerified ? ['Not verified', '#D97706'] : v.isOnline ? ['Online', '#10B981'] : ['Offline', 'var(--foreground-secondary)'];
    return <span style={{ fontSize: '0.68rem', fontWeight: 700, color }}>{txt}</span>;
}

export default function VendorPicker({
    vendors,
    error,
    value,
    onChange,
}: {
    vendors: VendorOption[] | null;   // null while loading
    error: string;
    value: string;
    onChange: (vendorId: string) => void;
}) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const selected = findVendor(vendors, value);
    const legacyName = selected && selected.vendorId !== value.trim();

    const matches = useMemo(() => {
        if (!vendors) return [];
        const q = query.trim().toLowerCase();
        const list = q
            ? vendors.filter((v) =>
                v.shopName.toLowerCase().includes(q) || v.city.toLowerCase().includes(q) || v.vendorId.toLowerCase() === q)
            : vendors;
        // Verified + online first, then by name
        return [...list]
            .sort((a, b) => Number(b.isVerified) - Number(a.isVerified) || Number(b.isOnline) - Number(a.isOnline)
                || a.shopName.localeCompare(b.shopName))
            .slice(0, 30);
    }, [vendors, query]);

    if (error) {
        return (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.75rem', color: '#EF4444' }}>
                <AlertCircle size={14} /> Couldn&apos;t load vendors: {error}
            </span>
        );
    }
    if (!vendors) {
        return (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                <Loader2 size={14} className="animate-spin" /> Loading vendors…
            </span>
        );
    }

    if (selected && !open) {
        return (
            <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                    <Thumb v={selected} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.shopName || 'Unnamed vendor'}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {selected.city && <span>{selected.city}</span>}
                            <Status v={selected} />
                        </div>
                    </div>
                    <button type="button" onClick={() => { setOpen(true); setQuery(''); }}
                        style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
                        Change
                    </button>
                </div>
                {legacyName && (
                    <span style={{ fontSize: '0.7rem', color: '#D97706' }}>
                        This banner was linked by shop name. <button type="button" onClick={() => onChange(selected.vendorId)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', fontWeight: 700, cursor: 'pointer', fontSize: '0.7rem' }}>Link by ID instead</button> so renaming the shop can&apos;t break it.
                    </span>
                )}
                {!selected.isVerified && (
                    <span style={{ fontSize: '0.7rem', color: '#D97706' }}>This vendor isn&apos;t verified yet — customers may not be able to order from them.</span>
                )}
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search restaurant name or city…" style={inputStyle} />
                {selected && (
                    <button type="button" title="Cancel" onClick={() => setOpen(false)}
                        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)', padding: 4 }}>
                        <X size={14} />
                    </button>
                )}
            </div>
            {value.trim() && !selected && (
                <span style={{ fontSize: '0.7rem', color: '#D97706' }}>
                    Currently set to “{value}”, which doesn&apos;t match any vendor — pick one below.
                </span>
            )}
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                {matches.length === 0 ? (
                    <div style={{ padding: 12, fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>No vendor matches “{query}”.</div>
                ) : matches.map((v) => (
                    <button key={v.vendorId} type="button"
                        onClick={() => { onChange(v.vendorId); setOpen(false); setQuery(''); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: v.vendorId === selected?.vendorId ? 'rgba(34,197,94,0.08)' : 'var(--surface)', color: 'var(--foreground)', cursor: 'pointer' }}>
                        <Thumb v={v} size={30} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.shopName || 'Unnamed vendor'}</span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>{v.city || '—'}</span>
                        </span>
                        <Status v={v} />
                    </button>
                ))}
            </div>
            {vendors.length > 30 && !query && (
                <span style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)' }}>Showing 30 of {vendors.length} — type to search.</span>
            )}
        </div>
    );
}
