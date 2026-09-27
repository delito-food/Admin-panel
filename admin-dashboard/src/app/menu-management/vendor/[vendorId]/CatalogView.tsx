'use client';

import { useEffect, useMemo, useState, type DragEvent, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, LayoutGrid, List, Edit3, Trash2, ImageIcon, UtensilsCrossed, GripVertical, FolderInput,
    ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, Loader2, X, Layers, Eye, EyeOff, Clock, FolderOpen,
} from 'lucide-react';
import type { AdminMenuItem, VendorCategory } from '@/types';
import {
    UNCATEGORIZED, effectiveCategoryId, sortCategories, formatINR, postBulkUpdate, VegMark, TriCheckbox,
} from './menu-shared';

/**
 * Vendor menu catalog: category sidebar, filters, sorting, grid/list views,
 * pagination, bulk actions, and drag-and-drop of (multi-)selected items onto a
 * category to move them.
 */

type SortKey = 'category' | 'name' | 'price_asc' | 'price_desc' | 'recent';
type View = 'grid' | 'list';
type Toast = { tone: 'ok' | 'err'; text: string; undo?: () => void; ms: number } | null;

const PAGE_SIZES = [12, 24, 48, 96];
const DRAG_MIME = 'application/x-delito-menu-items';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
    approved: { label: 'Approved', color: '#059669', bg: 'rgba(16,185,129,0.12)' },
    pending: { label: 'Pending', color: '#B45309', bg: 'rgba(245,158,11,0.14)' },
    rejected: { label: 'Rejected', color: '#DC2626', bg: 'rgba(239,68,68,0.12)' },
    changes_requested: { label: 'Changes req.', color: '#4F46E5', bg: 'rgba(99,102,241,0.12)' },
};
const statusOf = (i: AdminMenuItem) => (i.verificationStatus || 'approved');

function readPref<T extends string | number>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        const val = (typeof fallback === 'number' ? Number(raw) : raw) as T;
        return allowed.includes(val) ? val : fallback;
    } catch { return fallback; }
}
function writePref(key: string, value: string | number) {
    try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
}

function pageList(current: number, total: number): (number | '…')[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const out: (number | '…')[] = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    if (start > 2) out.push('…');
    for (let i = start; i <= end; i++) out.push(i);
    if (end < total - 1) out.push('…');
    out.push(total);
    return out;
}

const timeOf = (v: unknown): number => {
    if (!v) return 0;
    const t = new Date(v as string).getTime();
    return Number.isFinite(t) ? t : 0;
};

export default function CatalogView({
    vendorId, items, categories, onEdit, onDelete, onChanged,
}: {
    vendorId: string;
    items: AdminMenuItem[];
    categories: VendorCategory[];
    onEdit: (item: AdminMenuItem) => void;
    onDelete: (itemId: string) => void;
    onChanged: () => void | Promise<void>;
}) {
    const [search, setSearch] = useState('');
    const [activeCat, setActiveCat] = useState<string>('all');
    const [vegFilter, setVegFilter] = useState<'all' | 'veg' | 'nonveg'>('all');
    const [availFilter, setAvailFilter] = useState<'all' | 'available' | 'unavailable'>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [missingImageOnly, setMissingImageOnly] = useState(false);
    const [sortBy, setSortBy] = useState<SortKey>('category');
    // This component only mounts client-side (the page shows a loader until
    // data arrives), so reading saved preferences in the initializer is safe.
    const [view, setView] = useState<View>(() => readPref<View>('admin.vendorMenu.view', ['grid', 'list'], 'grid'));
    const [pageSize, setPageSize] = useState<number>(() => readPref<number>('admin.vendorMenu.pageSize', PAGE_SIZES, 24));
    const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 });
    const [rawSelected, setSelected] = useState<Set<string>>(new Set());
    const [moveTarget, setMoveTarget] = useState('');
    const [busy, setBusy] = useState<string | null>(null); // label of running action
    const [toast, setToast] = useState<Toast>(null);
    const [dragIds, setDragIds] = useState<string[] | null>(null);
    const [dragOver, setDragOver] = useState<string | null>(null);
    const [pendingAvail, setPendingAvail] = useState<Set<string>>(new Set());

    // Auto-dismiss the toast.
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), toast.ms);
        return () => clearTimeout(t);
    }, [toast]);

    const showToast = (t: Omit<NonNullable<Toast>, 'ms'>, ms = 6000) => setToast({ ...t, ms });

    const orderedCategories = useMemo(() => sortCategories(categories), [categories]);
    const knownCatIds = useMemo(() => new Set(categories.map(c => c.categoryId)), [categories]);
    const catIndex = useMemo(() => new Map(orderedCategories.map((c, i) => [c.categoryId, i])), [orderedCategories]);
    const catName = (id: string) => id === UNCATEGORIZED ? 'Uncategorized' : (categories.find(c => c.categoryId === id)?.name || 'Unknown');

    // ── Counts for sidebar + stats ──
    const countsByCat = useMemo(() => {
        const m = new Map<string, number>();
        items.forEach(i => { const c = effectiveCategoryId(i, knownCatIds); m.set(c, (m.get(c) || 0) + 1); });
        return m;
    }, [items, knownCatIds]);

    const stats = useMemo(() => ({
        total: items.length,
        available: items.filter(i => i.isAvailable !== false).length,
        unavailable: items.filter(i => i.isAvailable === false).length,
        missingImage: items.filter(i => !i.imageUrl).length,
        pending: items.filter(i => ['pending', 'changes_requested'].includes(statusOf(i))).length,
    }), [items]);

    // ── Filter + sort ──
    const q = search.trim().toLowerCase();
    const filtered = useMemo(() => {
        const list = items.filter(i => {
            if (activeCat !== 'all' && effectiveCategoryId(i, knownCatIds) !== activeCat) return false;
            if (vegFilter === 'veg' && !i.isVeg) return false;
            if (vegFilter === 'nonveg' && i.isVeg) return false;
            if (availFilter === 'available' && i.isAvailable === false) return false;
            if (availFilter === 'unavailable' && i.isAvailable !== false) return false;
            if (statusFilter !== 'all' && statusOf(i) !== statusFilter) return false;
            if (missingImageOnly && i.imageUrl) return false;
            if (q) {
                const hay = `${i.name || ''} ${i.categoryName || ''} ${i.subCategoryName || ''} ${(i.tags || []).join(' ')}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
        const byName = (a: AdminMenuItem, b: AdminMenuItem) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
        const catPos = (i: AdminMenuItem) => {
            const c = effectiveCategoryId(i, knownCatIds);
            return c === UNCATEGORIZED ? Number.MAX_SAFE_INTEGER : (catIndex.get(c) ?? Number.MAX_SAFE_INTEGER);
        };
        list.sort((a, b) => {
            switch (sortBy) {
                case 'name': return byName(a, b);
                case 'price_asc': return (Number(a.price) || 0) - (Number(b.price) || 0) || byName(a, b);
                case 'price_desc': return (Number(b.price) || 0) - (Number(a.price) || 0) || byName(a, b);
                case 'recent': return timeOf(b.updatedAt || b.createdAt) - timeOf(a.updatedAt || a.createdAt) || byName(a, b);
                default: return catPos(a) - catPos(b) || byName(a, b);
            }
        });
        return list;
    }, [items, activeCat, vegFilter, availFilter, statusFilter, missingImageOnly, q, sortBy, knownCatIds, catIndex]);

    // Page number is tied to the current filter set: any filter/sort change
    // naturally lands back on page 1.
    const filterKey = JSON.stringify([activeCat, vegFilter, availFilter, statusFilter, missingImageOnly, q, sortBy, pageSize]);
    const page = pageState.key === filterKey ? pageState.page : 1;
    const setPage = (p: number) => setPageState({ key: filterKey, page: p });

    // Selection only ever covers items that match the current filters.
    const selected = useMemo(() => {
        const ids = new Set(filtered.map(i => i.itemId));
        return new Set(Array.from(rawSelected).filter(id => ids.has(id)));
    }, [rawSelected, filtered]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
    const pageIds = pageItems.map(i => i.itemId);
    const pageSelectedCount = pageIds.filter(id => selected.has(id)).length;
    const showGroupHeaders = sortBy === 'category' && activeCat === 'all';

    const toggleOne = (id: string) => setSelected(prev => {
        const n = new Set(Array.from(prev).filter(x => selected.has(x)));
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });
    const togglePage = () => setSelected(() => {
        const n = new Set(selected);
        const all = pageIds.every(id => n.has(id));
        pageIds.forEach(id => { if (all) n.delete(id); else n.add(id); });
        return n;
    });

    const anyFilter = activeCat !== 'all' || vegFilter !== 'all' || availFilter !== 'all' || statusFilter !== 'all' || missingImageOnly || !!q;
    const clearFilters = () => {
        setActiveCat('all'); setVegFilter('all'); setAvailFilter('all'); setStatusFilter('all'); setMissingImageOnly(false); setSearch('');
    };

    // ── Actions ──
    const itemById = useMemo(() => new Map(items.map(i => [i.itemId, i])), [items]);

    const moveItems = async (ids: string[], targetCatId: string) => {
        if (!knownCatIds.has(targetCatId)) return;
        const toMove = ids.map(id => itemById.get(id)).filter((i): i is AdminMenuItem => !!i && i.categoryId !== targetCatId);
        const target = catName(targetCatId);
        if (toMove.length === 0) {
            showToast({ tone: 'ok', text: `Already in “${target}”.` }, 3000);
            return;
        }
        const previous = toMove.map(i => ({ itemId: i.itemId, categoryId: i.categoryId }));
        setBusy(`Moving ${toMove.length} item${toMove.length === 1 ? '' : 's'}…`);
        const res = await postBulkUpdate(vendorId, toMove.map(i => ({ itemId: i.itemId, categoryId: targetCatId })), 'move_category');
        setBusy(null);
        if (!res.success) {
            showToast({ tone: 'err', text: res.error || 'Move failed' });
            return;
        }
        setSelected(new Set());
        const restorable = previous.filter(p => knownCatIds.has(p.categoryId));
        showToast({
            tone: res.skipped?.length ? 'err' : 'ok',
            text: `Moved ${res.updated} item${res.updated === 1 ? '' : 's'} to “${target}”` + (res.skipped?.length ? ` (${res.skipped.length} skipped)` : ''),
            undo: restorable.length ? async () => {
                setBusy('Undoing…');
                const r = await postBulkUpdate(vendorId, restorable, 'move_category_undo');
                setBusy(null);
                showToast(r.success ? { tone: 'ok', text: 'Move undone.' } : { tone: 'err', text: r.error || 'Undo failed' }, 3000);
                await onChanged();
            } : undefined,
        }, 8000);
        await onChanged();
    };

    const setAvailability = async (ids: string[], isAvailable: boolean) => {
        if (ids.length === 0) return;
        const single = ids.length === 1;
        if (single) setPendingAvail(prev => new Set(prev).add(ids[0]));
        else setBusy(`Updating ${ids.length} items…`);
        const res = await postBulkUpdate(vendorId, ids.map(itemId => ({ itemId, isAvailable })), 'availability');
        if (single) setPendingAvail(prev => { const n = new Set(prev); n.delete(ids[0]); return n; });
        else setBusy(null);
        if (!res.success) {
            showToast({ tone: 'err', text: res.error || 'Update failed' });
            return;
        }
        if (!single) {
            setSelected(new Set());
            showToast({ tone: 'ok', text: `${res.updated} item${res.updated === 1 ? '' : 's'} marked ${isAvailable ? 'available' : 'unavailable'}.` }, 3500);
        }
        await onChanged();
    };

    // ── Drag & drop ──
    const onDragStart = (e: DragEvent, item: AdminMenuItem) => {
        const ids = selected.has(item.itemId) ? Array.from(selected) : [item.itemId];
        setDragIds(ids);
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
            e.dataTransfer.setData('text/plain', `${ids.length} menu item(s)`);
        } catch { /* some browsers restrict custom types */ }
        // Compact drag ghost showing how many items are moving.
        try {
            const ghost = document.createElement('div');
            ghost.textContent = ids.length === 1 ? `Move “${item.name}”` : `Move ${ids.length} items`;
            Object.assign(ghost.style, {
                position: 'fixed', top: '-1000px', left: '-1000px', padding: '8px 14px', borderRadius: '10px',
                background: '#F4511E', color: 'white', font: '600 13px system-ui, sans-serif', whiteSpace: 'nowrap',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            });
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 16, 16);
            setTimeout(() => ghost.remove(), 0);
        } catch { /* fall back to default ghost */ }
    };
    const onDragEnd = () => { setDragIds(null); setDragOver(null); };

    const dropProps = (catId: string) => ({
        onDragOver: (e: DragEvent) => {
            if (!dragIds) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragOver !== catId) setDragOver(catId);
        },
        onDragLeave: (e: DragEvent) => {
            // Ignore leave events fired when moving between child elements.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragOver(prev => (prev === catId ? null : prev));
        },
        onDrop: (e: DragEvent) => {
            e.preventDefault();
            let ids = dragIds || [];
            try {
                const raw = e.dataTransfer.getData(DRAG_MIME);
                if (raw) ids = JSON.parse(raw);
            } catch { /* use state copy */ }
            setDragIds(null);
            setDragOver(null);
            if (Array.isArray(ids) && ids.length) moveItems(ids, catId);
        },
    });

    // ── Render helpers ──
    const selectStyle: CSSProperties = {
        padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)',
        color: 'var(--foreground)', fontSize: '0.8rem', fontWeight: 600, outline: 'none',
    };

    const statusPill = (item: AdminMenuItem) => {
        const s = statusOf(item);
        if (s === 'approved') return null;
        const m = STATUS_META[s] || { label: s, color: 'var(--foreground-secondary)', bg: 'var(--surface-hover)' };
        return <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, color: m.color, background: m.bg, whiteSpace: 'nowrap' }}>{m.label}</span>;
    };

    const availSwitch = (item: AdminMenuItem) => {
        const on = item.isAvailable !== false;
        const pending = pendingAvail.has(item.itemId);
        return (
            <button
                onClick={e => { e.stopPropagation(); if (!pending) setAvailability([item.itemId], !on); }}
                title={on ? 'Available — click to mark unavailable' : 'Unavailable — click to mark available'}
                style={{
                    position: 'relative', width: 36, height: 20, borderRadius: 999, border: 'none', cursor: pending ? 'wait' : 'pointer',
                    background: on ? '#10B981' : 'var(--border)', transition: 'background 0.2s', flexShrink: 0, opacity: pending ? 0.6 : 1,
                }}
            >
                <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {pending && <Loader2 size={10} className="animate-spin" color="#6B7280" />}
                </span>
            </button>
        );
    };

    const thumb = (item: AdminMenuItem, size?: number) => (
        <div style={{ width: size || '100%', height: size || '100%', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: size ? 10 : 0, flexShrink: 0 }}>
            {item.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={item.imageUrl} alt={item.name} loading="lazy" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: '#DC2626' }}>
                    <ImageIcon size={size ? 16 : 26} />
                    {!size && <span style={{ fontSize: '0.65rem', fontWeight: 700 }}>No image</span>}
                </div>}
        </div>
    );

    const priceTag = (item: AdminMenuItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--foreground)' }}>{formatINR(Number(item.price) || 0)}</span>
            {item.discount > 0 && <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#059669', background: 'rgba(16,185,129,0.12)', padding: '1px 5px', borderRadius: 4 }}>-{item.discount}%</span>}
            {(item.variants || []).length > 0 && (
                <span title={(item.variants || []).map(v => `${v.name}: ₹${v.price}`).join(' · ')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.62rem', color: 'var(--foreground-secondary)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 4 }}>
                    <Layers size={10} /> {(item.variants || []).length}
                </span>
            )}
        </div>
    );

    const iconBtn = (onClick: () => void, title: string, color: string, children: ReactNode) => (
        <button
            onClick={e => { e.stopPropagation(); onClick(); }}
            title={title}
            style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            className="hover:bg-[var(--surface-hover)]"
        >
            {children}
        </button>
    );

    const renderCard = (item: AdminMenuItem) => {
        const isSel = selected.has(item.itemId);
        const isDragging = !!dragIds?.includes(item.itemId);
        return (
            <div
                key={item.itemId}
                draggable
                onDragStart={e => onDragStart(e, item)}
                onDragEnd={onDragEnd}
                onClick={() => toggleOne(item.itemId)}
                className="glass-card"
                style={{
                    padding: 0, overflow: 'hidden', cursor: 'grab', display: 'flex', flexDirection: 'column',
                    outline: isSel ? '2px solid var(--primary)' : 'none', outlineOffset: -2,
                    opacity: isDragging ? 0.45 : item.isAvailable === false ? 0.75 : 1, transition: 'opacity 0.15s, outline 0.15s',
                }}
            >
                <div style={{ position: 'relative', aspectRatio: '4 / 3' }}>
                    {thumb(item)}
                    <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', opacity: 0.95, borderRadius: 8, padding: '4px 6px' }}>
                        <TriCheckbox checked={isSel} onChange={() => toggleOne(item.itemId)} />
                        <VegMark isVeg={!!item.isVeg} />
                    </div>
                    <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                        {item.isBestSeller && <span style={{ fontSize: '0.6rem', fontWeight: 800, background: '#F59E0B', color: 'white', padding: '2px 6px', borderRadius: 6 }}>BESTSELLER</span>}
                        {statusPill(item)}
                    </div>
                    <GripVertical size={16} style={{ position: 'absolute', bottom: 8, right: 8, color: 'white', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }} />
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    <div>
                        <p style={{ fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>{item.name}</p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {catName(effectiveCategoryId(item, knownCatIds))}{item.subCategoryName ? ` · ${item.subCategoryName}` : ''}
                        </p>
                    </div>
                    {priceTag(item)}
                    <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                            {availSwitch(item)}
                            <span style={{ fontSize: '0.68rem', fontWeight: 600, color: item.isAvailable !== false ? '#059669' : 'var(--foreground-secondary)' }}>
                                {item.isAvailable !== false ? 'In stock' : 'Off'}
                            </span>
                        </div>
                        <div style={{ display: 'flex' }}>
                            {iconBtn(() => onEdit(item), "Edit item", "#3B82F6", <Edit3 size={16} />)}
                            {iconBtn(() => onDelete(item.itemId), "Delete item", "#EF4444", <Trash2 size={16} />)}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderRow = (item: AdminMenuItem) => {
        const isSel = selected.has(item.itemId);
        const isDragging = !!dragIds?.includes(item.itemId);
        return (
            <div
                key={item.itemId}
                draggable
                onDragStart={e => onDragStart(e, item)}
                onDragEnd={onDragEnd}
                onClick={() => toggleOne(item.itemId)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'grab',
                    borderBottom: '1px solid var(--border)',
                    background: isSel ? 'rgba(244,81,30,0.06)' : undefined,
                    opacity: isDragging ? 0.45 : item.isAvailable === false ? 0.75 : 1,
                }}
            >
                <GripVertical size={16} style={{ color: 'var(--foreground-secondary)', flexShrink: 0 }} />
                <TriCheckbox checked={isSel} onChange={() => toggleOne(item.itemId)} />
                {thumb(item, 48)}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <VegMark isVeg={!!item.isVeg} />
                        <span style={{ fontWeight: 700, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                        {item.isBestSeller && <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#B45309', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: 4 }}>Bestseller</span>}
                        {statusPill(item)}
                    </div>
                    <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                        {catName(effectiveCategoryId(item, knownCatIds))}{item.subCategoryName ? ` · ${item.subCategoryName}` : ''}{item.preparationTime ? ` · ${item.preparationTime} min` : ''}
                    </p>
                </div>
                <div style={{ width: 130 }}>{priceTag(item)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 90 }} onClick={e => e.stopPropagation()}>
                    {availSwitch(item)}
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: item.isAvailable !== false ? '#059669' : 'var(--foreground-secondary)' }}>
                        {item.isAvailable !== false ? 'In stock' : 'Off'}
                    </span>
                </div>
                {iconBtn(() => onEdit(item), "Edit item", "#3B82F6", <Edit3 size={16} />)}
                {iconBtn(() => onDelete(item.itemId), "Delete item", "#EF4444", <Trash2 size={16} />)}
            </div>
        );
    };

    /** Render the current page, inserting category headers (also drop targets) when grouped. */
    const renderPage = () => {
        if (!showGroupHeaders) {
            return view === 'grid'
                ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>{pageItems.map(renderCard)}</div>
                : <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>{pageItems.map(renderRow)}</div>;
        }
        const sections: { catId: string; items: AdminMenuItem[] }[] = [];
        pageItems.forEach(i => {
            const c = effectiveCategoryId(i, knownCatIds);
            const last = sections[sections.length - 1];
            if (last && last.catId === c) last.items.push(i);
            else sections.push({ catId: c, items: [i] });
        });
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {sections.map((s, idx) => {
                    const droppable = s.catId !== UNCATEGORIZED;
                    const isOver = dragOver === `sec:${s.catId}`;
                    const dp = droppable ? dropProps(s.catId) : null;
                    return (
                        <div key={`${s.catId}-${idx}`}>
                            <div
                                {...(dp ? {
                                    onDragOver: (e: DragEvent) => { dp.onDragOver(e); if (dragIds) setDragOver(`sec:${s.catId}`); },
                                    onDragLeave: (e: DragEvent) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setDragOver(p => p === `sec:${s.catId}` ? null : p); },
                                    onDrop: dp.onDrop,
                                } : {})}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: 10, borderRadius: 10,
                                    border: `1.5px dashed ${isOver ? 'var(--primary)' : dragIds && droppable ? 'var(--border)' : 'transparent'}`,
                                    background: isOver ? 'rgba(244,81,30,0.08)' : 'transparent', transition: 'all 0.15s',
                                }}
                            >
                                <FolderOpen size={15} style={{ color: 'var(--primary)' }} />
                                <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{catName(s.catId)}</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>{countsByCat.get(s.catId) || 0} items</span>
                                {dragIds && droppable && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 700, color: 'var(--primary)' }}>Drop here to move</span>}
                            </div>
                            {view === 'grid'
                                ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>{s.items.map(renderCard)}</div>
                                : <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>{s.items.map(renderRow)}</div>}
                        </div>
                    );
                })}
            </div>
        );
    };

    const sidebarRow = (id: string, label: string, count: number, opts: { inactive?: boolean; droppable: boolean }) => {
        const active = activeCat === id;
        const isOver = dragOver === id;
        const dp = opts.droppable ? dropProps(id) : {};
        return (
            <button
                key={id}
                onClick={() => setActiveCat(id)}
                {...dp}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                    textAlign: 'left', fontSize: '0.84rem', fontWeight: active ? 800 : 600,
                    border: `1.5px ${isOver ? 'solid' : 'dashed'} ${isOver ? 'var(--primary)' : dragIds && opts.droppable ? 'var(--border)' : 'transparent'}`,
                    background: isOver ? 'rgba(244,81,30,0.12)' : active ? 'rgba(244,81,30,0.08)' : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--foreground)', transition: 'all 0.12s',
                    transform: isOver ? 'scale(1.02)' : 'none',
                }}
            >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: opts.inactive ? 0.55 : 1 }}>
                    {label}
                </span>
                {opts.inactive && <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--foreground-secondary)' }}>OFF</span>}
                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: active ? 'var(--primary)' : 'var(--surface-hover)', color: active ? 'white' : 'var(--foreground-secondary)' }}>
                    {count}
                </span>
            </button>
        );
    };

    const statCards: { key: string; label: string; value: number; icon: ReactNode; color: string; onClick: () => void; active: boolean }[] = [
        { key: 'total', label: 'Total items', value: stats.total, icon: <UtensilsCrossed size={16} />, color: '#F4511E', onClick: clearFilters, active: !anyFilter },
        { key: 'avail', label: 'Available', value: stats.available, icon: <Eye size={16} />, color: '#10B981', onClick: () => setAvailFilter(availFilter === 'available' ? 'all' : 'available'), active: availFilter === 'available' },
        { key: 'unavail', label: 'Unavailable', value: stats.unavailable, icon: <EyeOff size={16} />, color: '#6B7280', onClick: () => setAvailFilter(availFilter === 'unavailable' ? 'all' : 'unavailable'), active: availFilter === 'unavailable' },
        { key: 'img', label: 'Missing image', value: stats.missingImage, icon: <ImageIcon size={16} />, color: '#EF4444', onClick: () => setMissingImageOnly(!missingImageOnly), active: missingImageOnly },
        { key: 'pending', label: 'Awaiting review', value: stats.pending, icon: <Clock size={16} />, color: '#F59E0B', onClick: () => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending'), active: statusFilter === 'pending' },
    ];

    const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const to = Math.min(safePage * pageSize, filtered.length);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Stats strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                {statCards.map(s => (
                    <button
                        key={s.key}
                        onClick={s.onClick}
                        className="glass-card"
                        style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', outline: s.active ? `2px solid ${s.color}` : 'none', outlineOffset: -2 }}
                    >
                        <span style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${s.color}1A`, color: s.color }}>{s.icon}</span>
                        <span>
                            <span style={{ display: 'block', fontSize: '1.2rem', fontWeight: 800, lineHeight: 1.1 }}>{s.value}</span>
                            <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--foreground-secondary)', fontWeight: 600 }}>{s.label}</span>
                        </span>
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]" style={{ gap: 16, alignItems: 'start' }}>
                {/* Category sidebar */}
                <aside className="glass-card lg:sticky" style={{ padding: 10, top: 12, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
                    <p style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--foreground-secondary)', padding: '6px 10px' }}>Categories</p>
                    {sidebarRow('all', 'All items', items.length, { droppable: false })}
                    {orderedCategories.map(c => sidebarRow(c.categoryId, c.name, countsByCat.get(c.categoryId) || 0, { inactive: c.isActive === false, droppable: true }))}
                    {(countsByCat.get(UNCATEGORIZED) || 0) > 0 && sidebarRow(UNCATEGORIZED, 'Uncategorized', countsByCat.get(UNCATEGORIZED) || 0, { droppable: false })}
                    <p style={{ fontSize: '0.68rem', color: 'var(--foreground-secondary)', padding: '10px 10px 4px', lineHeight: 1.4 }}>
                        <FolderInput size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
                        Drag items (or a selection) onto a category to move them.
                    </p>
                </aside>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                    {/* Toolbar */}
                    <div className="glass-card" style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <div className="input-group" style={{ flex: '1 1 220px', minWidth: 200 }}>
                            <Search size={16} className="input-icon" />
                            <input className="input" style={{ paddingTop: 9, paddingBottom: 9, paddingLeft: 40 }} placeholder="Search name, tag, sub-category…" value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select value={vegFilter} onChange={e => setVegFilter(e.target.value as typeof vegFilter)} style={selectStyle} title="Food type">
                            <option value="all">Veg + Non-veg</option>
                            <option value="veg">Veg only</option>
                            <option value="nonveg">Non-veg only</option>
                        </select>
                        <select value={availFilter} onChange={e => setAvailFilter(e.target.value as typeof availFilter)} style={selectStyle} title="Availability">
                            <option value="all">Any availability</option>
                            <option value="available">Available</option>
                            <option value="unavailable">Unavailable</option>
                        </select>
                        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle} title="Review status">
                            <option value="all">Any status</option>
                            <option value="approved">Approved</option>
                            <option value="pending">Pending</option>
                            <option value="changes_requested">Changes requested</option>
                            <option value="rejected">Rejected</option>
                        </select>
                        <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} style={selectStyle} title="Sort">
                            <option value="category">Sort: Category order</option>
                            <option value="name">Sort: Name A–Z</option>
                            <option value="price_asc">Sort: Price low → high</option>
                            <option value="price_desc">Sort: Price high → low</option>
                            <option value="recent">Sort: Recently updated</option>
                        </select>
                        <div style={{ display: 'flex', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
                            {(['grid', 'list'] as View[]).map(v => (
                                <button
                                    key={v}
                                    onClick={() => { setView(v); writePref('admin.vendorMenu.view', v); }}
                                    title={v === 'grid' ? 'Grid view' : 'List view'}
                                    style={{ padding: '7px 10px', border: 'none', cursor: 'pointer', background: view === v ? 'var(--primary)' : 'var(--surface)', color: view === v ? 'white' : 'var(--foreground-secondary)', display: 'flex' }}
                                >
                                    {v === 'grid' ? <LayoutGrid size={16} /> : <List size={16} />}
                                </button>
                            ))}
                        </div>
                        {anyFilter && <button onClick={clearFilters} className="btn btn-ghost btn-sm" style={{ padding: '6px 10px' }}><X size={14} /> Clear filters</button>}
                    </div>

                    {/* Selection / bulk bar */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: selected.size ? 'rgba(244,81,30,0.07)' : 'transparent', border: `1px solid ${selected.size ? 'rgba(244,81,30,0.25)' : 'transparent'}` }}>
                        <TriCheckbox checked={pageIds.length > 0 && pageSelectedCount === pageIds.length} indeterminate={pageSelectedCount > 0} onChange={togglePage} title="Select this page" disabled={pageIds.length === 0} />
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: selected.size ? 'var(--primary)' : 'var(--foreground-secondary)' }}>
                            {selected.size ? `${selected.size} selected` : `Select page (${pageIds.length})`}
                        </span>
                        {selected.size > 0 && selected.size < filtered.length && pageSelectedCount === pageIds.length && (
                            <button onClick={() => setSelected(new Set(filtered.map(i => i.itemId)))} className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', color: 'var(--primary)' }}>
                                Select all {filtered.length} matching
                            </button>
                        )}
                        {selected.size > 0 && (
                            <>
                                <div style={{ flex: 1 }} />
                                <select value={moveTarget} onChange={e => setMoveTarget(e.target.value)} style={selectStyle}>
                                    <option value="">Move to category…</option>
                                    {orderedCategories.map(c => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
                                </select>
                                <button
                                    onClick={() => { if (moveTarget) { moveItems(Array.from(selected), moveTarget); setMoveTarget(''); } }}
                                    disabled={!moveTarget || !!busy}
                                    className="btn btn-primary btn-sm"
                                    style={{ opacity: moveTarget ? 1 : 0.5 }}
                                >
                                    <FolderInput size={14} /> Move
                                </button>
                                <button onClick={() => setAvailability(Array.from(selected), true)} disabled={!!busy} className="btn btn-outline btn-sm"><Eye size={14} /> Available</button>
                                <button onClick={() => setAvailability(Array.from(selected), false)} disabled={!!busy} className="btn btn-outline btn-sm"><EyeOff size={14} /> Unavailable</button>
                                <button onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm">Clear</button>
                            </>
                        )}
                    </div>

                    {/* Items */}
                    {filtered.length === 0 ? (
                        <div className="empty-state glass-card p-12 text-center">
                            <UtensilsCrossed size={32} className="mx-auto text-[var(--foreground-secondary)] mb-4" />
                            <h3 className="empty-state-title">No menu items found</h3>
                            {anyFilter && <button onClick={clearFilters} className="btn btn-outline btn-sm" style={{ marginTop: 12 }}>Clear filters</button>}
                        </div>
                    ) : renderPage()}

                    {/* Pagination */}
                    {filtered.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>
                                <span>Showing <b style={{ color: 'var(--foreground)' }}>{from}–{to}</b> of <b style={{ color: 'var(--foreground)' }}>{filtered.length}</b></span>
                                <select value={pageSize} onChange={e => { const n = Number(e.target.value); setPageSize(n); writePref('admin.vendorMenu.pageSize', n); }} style={{ ...selectStyle, padding: '5px 8px' }}>
                                    {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
                                </select>
                            </div>
                            {totalPages > 1 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} className="btn btn-outline btn-sm" style={{ padding: '6px 8px', opacity: safePage === 1 ? 0.4 : 1 }}><ChevronLeft size={16} /></button>
                                    {pageList(safePage, totalPages).map((p, i) => p === '…'
                                        ? <span key={`e${i}`} style={{ padding: '0 6px', color: 'var(--foreground-secondary)' }}>…</span>
                                        : (
                                            <button
                                                key={p}
                                                onClick={() => setPage(p)}
                                                style={{ minWidth: 34, height: 34, borderRadius: 8, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', border: `1px solid ${p === safePage ? 'var(--primary)' : 'var(--border)'}`, background: p === safePage ? 'var(--primary)' : 'var(--surface)', color: p === safePage ? 'white' : 'var(--foreground)' }}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} className="btn btn-outline btn-sm" style={{ padding: '6px 8px', opacity: safePage === totalPages ? 0.4 : 1 }}><ChevronRight size={16} /></button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Busy overlay + toast */}
            <AnimatePresence>
                {busy && (
                    <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]" style={{ background: 'var(--foreground)', color: 'var(--background)', padding: '10px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: '0.85rem', boxShadow: 'var(--shadow-lg)' }}>
                        <Loader2 size={16} className="animate-spin" /> {busy}
                    </motion.div>
                )}
                {toast && !busy && (
                    <motion.div key="catalog-toast" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]" style={{ background: toast.tone === 'ok' ? '#059669' : '#DC2626', color: 'white', padding: '10px 14px 10px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: '0.85rem', boxShadow: 'var(--shadow-lg)', maxWidth: 'calc(100vw - 32px)' }}>
                        {toast.tone === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                        <span>{toast.text}</span>
                        {toast.undo && (
                            <button onClick={() => { const u = toast.undo; setToast(null); u?.(); }} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontWeight: 800, padding: '4px 10px', borderRadius: 8, cursor: 'pointer' }}>
                                Undo
                            </button>
                        )}
                        <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex' }}><X size={14} /></button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
