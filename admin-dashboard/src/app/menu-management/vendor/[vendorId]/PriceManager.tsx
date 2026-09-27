'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, ChevronDown, ChevronRight, RotateCcw, Save, Loader2, X, AlertTriangle,
    TrendingUp, TrendingDown, Percent, IndianRupee, Equal, Layers, ImageIcon, CheckCircle,
} from 'lucide-react';
import type { AdminMenuItem, VendorCategory } from '@/types';
import {
    UNCATEGORIZED, effectiveCategoryId, sortCategories, roundPrice, formatPriceInput, formatINR,
    percentChange, postBulkUpdate, VegMark, TriCheckbox, type RoundingStep, type BulkUpdate,
} from './menu-shared';

/**
 * Category-wise price manager.
 *
 * All edits are staged in a local draft (nothing is written while you work).
 * "Review & save" shows every change before one bulk request writes them.
 * Quick adjustments (+5% … −20%, custom %, ±₹, set ₹) apply to the selected
 * items on top of their current draft price, so +10% twice = +21%.
 */

type Draft = { price: string; variantPrices: string[] };

const PRESETS = [5, 10, 20, -10, -20];
const BIG_CHANGE_PCT = 30;

function parsePrice(s: string): number {
    if (s === undefined || s === null || String(s).trim() === '') return NaN;
    return Number(s);
}

export default function PriceManager({
    vendorId, items, categories, onSaved, onDirtyChange,
}: {
    vendorId: string;
    items: AdminMenuItem[];
    categories: VendorCategory[];
    onSaved: () => void | Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [rounding, setRounding] = useState<RoundingStep>(1);
    const [includeVariants, setIncludeVariants] = useState(true);
    const [customPct, setCustomPct] = useState('');
    const [customAmt, setCustomAmt] = useState('');
    const [setAmt, setSetAmt] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [reviewOpen, setReviewOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

    const itemById = useMemo(() => new Map(items.map(i => [i.itemId, i])), [items]);
    const orderedCategories = useMemo(() => sortCategories(categories), [categories]);
    const knownCatIds = useMemo(() => new Set(categories.map(c => c.categoryId)), [categories]);

    const baseDraft = (item: AdminMenuItem): Draft => ({
        price: formatPriceInput(Number(item.price) || 0),
        variantPrices: (item.variants || []).map(v => formatPriceInput(Number(v.price) || 0)),
    });
    /** Draft for an item; a stale variant draft (variant list changed since) falls back to saved values. */
    const draftOf = (item: AdminMenuItem): Draft => {
        const d = drafts[item.itemId];
        if (!d) return baseDraft(item);
        const vLen = (item.variants || []).length;
        return d.variantPrices.length === vLen ? d : { price: d.price, variantPrices: baseDraft(item).variantPrices };
    };
    const hasDraft = (item: AdminMenuItem) => !!drafts[item.itemId] && isChanged(item, draftOf(item));

    const isChanged = (item: AdminMenuItem, d: Draft) => {
        if (parsePrice(d.price) !== (Number(item.price) || 0)) return true;
        return (item.variants || []).some((v, i) => parsePrice(d.variantPrices[i]) !== (Number(v.price) || 0));
    };
    const isInvalid = (d: Draft) => {
        const p = parsePrice(d.price);
        if (!Number.isFinite(p) || p <= 0 || p > 100000) return true;
        return d.variantPrices.some(s => { const n = parsePrice(s); return !Number.isFinite(n) || n < 0 || n > 100000; });
    };

    /** Write a draft; if it equals the saved values, drop it so "dirty" stays accurate. */
    const writeDraft = (item: AdminMenuItem, d: Draft, into: Record<string, Draft>) => {
        if (isChanged(item, d)) into[item.itemId] = d;
        else delete into[item.itemId];
    };

    const changedItems = items.filter(hasDraft);
    const invalidCount = changedItems.filter(i => isInvalid(draftOf(i))).length;
    const dirty = changedItems.length > 0;

    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

    // Warn before closing the tab with unsaved prices.
    useEffect(() => {
        if (!dirty) return;
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', h);
        return () => window.removeEventListener('beforeunload', h);
    }, [dirty]);

    // ── Visible groups ──
    const q = search.trim().toLowerCase();
    const groups = useMemo(() => {
        const visible = items.filter(i =>
            !q || (i.name || '').toLowerCase().includes(q) || (i.subCategoryName || '').toLowerCase().includes(q)
        );
        const byCat = new Map<string, AdminMenuItem[]>();
        visible.forEach(i => {
            const cid = effectiveCategoryId(i, knownCatIds);
            if (!byCat.has(cid)) byCat.set(cid, []);
            byCat.get(cid)!.push(i);
        });
        const list: { id: string; name: string; isActive: boolean; items: AdminMenuItem[] }[] = orderedCategories
            .map(c => ({ id: c.categoryId, name: c.name, isActive: c.isActive !== false, items: byCat.get(c.categoryId) || [] }));
        if (byCat.has(UNCATEGORIZED)) list.push({ id: UNCATEGORIZED, name: 'Uncategorized', isActive: true, items: byCat.get(UNCATEGORIZED)! });
        list.forEach(g => g.items.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })));
        return list.filter(g => (categoryFilter === 'all' || g.id === categoryFilter) && g.items.length > 0);
    }, [items, q, knownCatIds, orderedCategories, categoryFilter]);

    const selectedIds = Array.from(selected).filter(id => itemById.has(id));
    const visibleIds = useMemo(() => groups.flatMap(g => g.items.map(i => i.itemId)), [groups]);
    const selectedVisible = visibleIds.filter(id => selected.has(id));

    // ── Selection ──
    const toggleOne = (id: string) => setSelected(prev => {
        const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
    });
    const toggleMany = (ids: string[]) => setSelected(prev => {
        const n = new Set(prev);
        const all = ids.every(id => n.has(id));
        ids.forEach(id => { if (all) n.delete(id); else n.add(id); });
        return n;
    });

    // ── Adjustments ──
    const adjustSelected = (fn: (old: number) => number, label: string) => {
        const targets = selectedIds.map(id => itemById.get(id)!);
        if (targets.length === 0) {
            setBanner({ tone: 'err', text: 'Select items first — tick a category header to select the whole category.' });
            return;
        }
        const next = { ...drafts };
        let applied = 0;
        for (const item of targets) {
            const d = draftOf(item);
            const cur = parsePrice(d.price);
            if (!Number.isFinite(cur) || cur <= 0) continue; // fix the typed value first
            const newPrice = Math.max(1, roundPrice(fn(cur), rounding));
            const newVariants = includeVariants
                ? d.variantPrices.map(s => {
                    const v = parsePrice(s);
                    if (!Number.isFinite(v) || v <= 0) return s; // leave 0/blank variants alone
                    return formatPriceInput(Math.max(1, roundPrice(fn(v), rounding)));
                })
                : d.variantPrices;
            writeDraft(item, { price: formatPriceInput(newPrice), variantPrices: newVariants }, next);
            applied++;
        }
        setDrafts(next);
        const skippedNote = applied < targets.length ? ` ${targets.length - applied} skipped (empty/invalid price).` : '';
        setBanner({
            tone: 'ok',
            text: `${label} applied to ${applied} item${applied === 1 ? '' : 's'} — draft only, click “Review & save” to publish.${skippedNote}`,
        });
    };

    const applyPct = (pct: number) => adjustSelected(p => p * (1 + pct / 100), `${pct > 0 ? '+' : ''}${pct}%`);
    const applyCustomPct = () => {
        const n = Number(customPct);
        if (!customPct.trim() || !Number.isFinite(n) || n === 0 || n <= -100 || n > 500) {
            setBanner({ tone: 'err', text: 'Enter a % between −99 and 500 (e.g. 15 or -7.5).' });
            return;
        }
        applyPct(n);
    };
    const applyAmount = (sign: 1 | -1) => {
        const n = Number(customAmt);
        if (!customAmt.trim() || !Number.isFinite(n) || n <= 0) {
            setBanner({ tone: 'err', text: 'Enter a ₹ amount greater than 0.' });
            return;
        }
        adjustSelected(p => p + sign * n, `${sign > 0 ? '+' : '−'}₹${n}`);
    };
    const applySet = () => {
        const n = Number(setAmt);
        if (!setAmt.trim() || !Number.isFinite(n) || n <= 0) {
            setBanner({ tone: 'err', text: 'Enter the exact price to set (greater than 0).' });
            return;
        }
        // "Set" is about the base price only; variants keep their own prices.
        const targets = selectedIds.map(id => itemById.get(id)!);
        if (targets.length === 0) { setBanner({ tone: 'err', text: 'Select items first.' }); return; }
        const next = { ...drafts };
        const target = roundPrice(n, rounding) || n;
        targets.forEach(item => {
            writeDraft(item, { ...draftOf(item), price: formatPriceInput(target) }, next);
        });
        setDrafts(next);
        setBanner({ tone: 'ok', text: `Base price set to ${formatINR(roundPrice(n, rounding) || n)} on ${targets.length} item(s) (draft).` });
    };

    const editPrice = (item: AdminMenuItem, value: string) => {
        const next = { ...drafts };
        writeDraft(item, { ...draftOf(item), price: value }, next);
        setDrafts(next);
    };
    const editVariant = (item: AdminMenuItem, idx: number, value: string) => {
        const d = draftOf(item);
        const vp = [...d.variantPrices]; vp[idx] = value;
        const next = { ...drafts };
        writeDraft(item, { ...d, variantPrices: vp }, next);
        setDrafts(next);
    };
    const resetItem = (id: string) => setDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
    const resetSelected = () => setDrafts(prev => {
        const n = { ...prev }; selected.forEach(id => delete n[id]); return n;
    });
    const discardAll = () => { setDrafts({}); setBanner(null); };

    // ── Save ──
    const save = async () => {
        if (invalidCount > 0 || changedItems.length === 0) return;
        setSaving(true);
        const updates: BulkUpdate[] = changedItems.map(item => {
            const d = draftOf(item);
            const u: BulkUpdate = { itemId: item.itemId };
            const p = parsePrice(d.price);
            if (p !== (Number(item.price) || 0)) u.price = p;
            const variantsChanged = (item.variants || []).some((v, i) => parsePrice(d.variantPrices[i]) !== (Number(v.price) || 0));
            if (variantsChanged) u.variantPrices = d.variantPrices.map(parsePrice);
            return u;
        });
        const res = await postBulkUpdate(vendorId, updates, 'price_manager');
        setSaving(false);
        if (!res.success) {
            setBanner({ tone: 'err', text: res.error || 'Failed to save prices' });
            return;
        }
        const skipped = res.skipped || [];
        setReviewOpen(false);
        // Keep drafts only for items the server skipped, so nothing is silently lost.
        const skippedIds = new Set(skipped.map(s => s.itemId));
        setDrafts(prev => {
            const n: Record<string, Draft> = {};
            Object.entries(prev).forEach(([id, d]) => { if (skippedIds.has(id)) n[id] = d; });
            return n;
        });
        setSelected(new Set());
        setBanner({
            tone: skipped.length ? 'err' : 'ok',
            text: skipped.length
                ? `${res.updated} updated, ${skipped.length} skipped: ${skipped.slice(0, 3).map(s => `${itemById.get(s.itemId)?.name || s.itemId} (${s.reason})`).join('; ')}${skipped.length > 3 ? '…' : ''}`
                : `${res.updated} price${res.updated === 1 ? '' : 's'} updated successfully.`,
        });
        await onSaved();
    };

    // ── Review summary ──
    const reviewRows = changedItems.map(item => {
        const d = draftOf(item);
        const oldP = Number(item.price) || 0;
        const newP = parsePrice(d.price);
        return { item, d, oldP, newP, pct: percentChange(oldP, newP) };
    });
    const ups = reviewRows.filter(r => r.newP > r.oldP).length;
    const downs = reviewRows.filter(r => r.newP < r.oldP).length;
    const bigChanges = reviewRows.filter(r => Math.abs(r.pct) >= BIG_CHANGE_PCT).length;

    const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

    const chip = (active: boolean): CSSProperties => ({
        padding: '6px 12px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        background: active ? 'var(--primary)' : 'var(--surface)', color: active ? 'white' : 'var(--foreground-secondary)',
        whiteSpace: 'nowrap',
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* ── Adjustment toolbar ── */}
            <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 8, zIndex: 20, background: 'var(--surface)', backdropFilter: 'none', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
                        <TriCheckbox
                            checked={allVisibleSelected}
                            indeterminate={selectedVisible.length > 0}
                            onChange={() => toggleMany(visibleIds)}
                            title="Select all visible items"
                        />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: selectedIds.length ? 'var(--primary)' : 'var(--foreground-secondary)' }}>
                            {selectedIds.length ? `${selectedIds.length} selected` : 'Select items'}
                        </span>
                        {selectedIds.length > 0 && (
                            <button onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}>Clear</button>
                        )}
                    </div>

                    <div style={{ width: 1, height: 28, background: 'var(--border)' }} />

                    {PRESETS.map(p => (
                        <button
                            key={p}
                            onClick={() => applyPct(p)}
                            disabled={selectedIds.length === 0}
                            title={`${p > 0 ? 'Increase' : 'Decrease'} selected prices by ${Math.abs(p)}%`}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 14px', borderRadius: 10,
                                fontWeight: 800, fontSize: '0.85rem', cursor: selectedIds.length ? 'pointer' : 'not-allowed',
                                opacity: selectedIds.length ? 1 : 0.45,
                                border: `1px solid ${p > 0 ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
                                background: p > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                color: p > 0 ? '#059669' : '#DC2626',
                            }}
                        >
                            {p > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                            {p > 0 ? `+${p}%` : `${p}%`}
                        </button>
                    ))}

                    <div style={{ flex: 1 }} />

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--foreground-secondary)', fontWeight: 600 }}>
                        Round to
                        <select
                            value={rounding}
                            onChange={e => setRounding(Number(e.target.value) as RoundingStep)}
                            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.8rem' }}
                        >
                            <option value={1}>₹1</option>
                            <option value={5}>₹5</option>
                            <option value={10}>₹10</option>
                            <option value={0}>No rounding</option>
                        </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--foreground-secondary)', fontWeight: 600, cursor: 'pointer' }}>
                        <input type="checkbox" checked={includeVariants} onChange={e => setIncludeVariants(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
                        Also adjust variant prices
                    </label>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ position: 'relative' }}>
                            <Percent size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input
                                type="number" value={customPct} onChange={e => setCustomPct(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') applyCustomPct(); }}
                                placeholder="Custom %, e.g. 15 or -7.5"
                                style={{ width: 190, padding: '7px 10px 7px 28px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.8rem' }}
                            />
                        </div>
                        <button onClick={applyCustomPct} disabled={selectedIds.length === 0} className="btn btn-outline btn-sm">Apply %</button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ position: 'relative' }}>
                            <IndianRupee size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input
                                type="number" min="0" value={customAmt} onChange={e => setCustomAmt(e.target.value)}
                                placeholder="Amount"
                                style={{ width: 100, padding: '7px 10px 7px 26px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.8rem' }}
                            />
                        </div>
                        <button onClick={() => applyAmount(1)} disabled={selectedIds.length === 0} className="btn btn-outline btn-sm">+ ₹</button>
                        <button onClick={() => applyAmount(-1)} disabled={selectedIds.length === 0} className="btn btn-outline btn-sm">− ₹</button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ position: 'relative' }}>
                            <Equal size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--foreground-secondary)' }} />
                            <input
                                type="number" min="0" value={setAmt} onChange={e => setSetAmt(e.target.value)}
                                placeholder="Exact ₹"
                                style={{ width: 100, padding: '7px 10px 7px 26px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.8rem' }}
                            />
                        </div>
                        <button onClick={applySet} disabled={selectedIds.length === 0} className="btn btn-outline btn-sm">Set price</button>
                    </div>

                    <div style={{ flex: 1 }} />

                    {selectedIds.length > 0 && (
                        <button onClick={resetSelected} className="btn btn-ghost btn-sm" title="Undo draft changes on selected items">
                            <RotateCcw size={14} /> Reset selected
                        </button>
                    )}
                    <button onClick={discardAll} disabled={!dirty} className="btn btn-ghost btn-sm" style={{ opacity: dirty ? 1 : 0.4 }}>
                        Discard all
                    </button>
                    <button
                        onClick={() => setReviewOpen(true)}
                        disabled={!dirty}
                        className="btn btn-primary btn-sm"
                        style={{ opacity: dirty ? 1 : 0.45, cursor: dirty ? 'pointer' : 'not-allowed' }}
                    >
                        <Save size={14} /> Review & save{dirty ? ` (${changedItems.length})` : ''}
                    </button>
                </div>

                {banner && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600,
                        background: banner.tone === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                        color: banner.tone === 'ok' ? '#059669' : '#DC2626',
                        border: `1px solid ${banner.tone === 'ok' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    }}>
                        {banner.tone === 'ok' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                        <span style={{ flex: 1 }}>{banner.text}</span>
                        <button onClick={() => setBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex' }}><X size={14} /></button>
                    </div>
                )}
            </div>

            {/* ── Filters ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <div className="input-group" style={{ minWidth: 240, flex: '0 1 320px' }}>
                    <Search size={16} className="input-icon" />
                    <input className="input" style={{ paddingTop: 9, paddingBottom: 9, paddingLeft: 40 }} placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, flex: 1 }}>
                    <button style={chip(categoryFilter === 'all')} onClick={() => setCategoryFilter('all')}>All categories</button>
                    {orderedCategories.map(c => (
                        <button key={c.categoryId} style={chip(categoryFilter === c.categoryId)} onClick={() => setCategoryFilter(c.categoryId)}>{c.name}</button>
                    ))}
                    {items.some(i => effectiveCategoryId(i, knownCatIds) === UNCATEGORIZED) && (
                        <button style={chip(categoryFilter === UNCATEGORIZED)} onClick={() => setCategoryFilter(UNCATEGORIZED)}>Uncategorized</button>
                    )}
                </div>
            </div>

            {/* ── Category groups ── */}
            {groups.length === 0 ? (
                <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--foreground-secondary)' }}>No items match.</div>
            ) : groups.map(group => {
                const ids = group.items.map(i => i.itemId);
                const selCount = ids.filter(id => selected.has(id)).length;
                const changedCount = group.items.filter(hasDraft).length;
                const isCollapsed = collapsed.has(group.id);
                const prices = group.items.map(i => Number(i.price) || 0);
                return (
                    <div key={group.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--surface-hover)', borderBottom: isCollapsed ? 'none' : '1px solid var(--border)', cursor: 'pointer' }}
                            onClick={() => setCollapsed(prev => { const n = new Set(prev); if (n.has(group.id)) n.delete(group.id); else n.add(group.id); return n; })}
                        >
                            <TriCheckbox
                                checked={selCount === ids.length}
                                indeterminate={selCount > 0}
                                onChange={() => toggleMany(ids)}
                                title={`Select all in ${group.name}`}
                            />
                            {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{group.name}</span>
                                    {!group.isActive && <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--border)', color: 'var(--foreground-secondary)' }}>INACTIVE</span>}
                                </div>
                                <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                    {group.items.length} item{group.items.length === 1 ? '' : 's'} · {formatINR(Math.min(...prices))} – {formatINR(Math.max(...prices))}
                                </span>
                            </div>
                            {selCount > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)' }}>{selCount} selected</span>}
                            {changedCount > 0 && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: '#B45309' }}>
                                    {changedCount} edited
                                </span>
                            )}
                        </div>

                        {!isCollapsed && (
                            <div>
                                {group.items.map(item => {
                                    const d = draftOf(item);
                                    const changed = hasDraft(item);
                                    const invalid = changed && isInvalid(d);
                                    const oldP = Number(item.price) || 0;
                                    const newP = parsePrice(d.price);
                                    const pct = Number.isFinite(newP) ? percentChange(oldP, newP) : 0;
                                    const variants = item.variants || [];
                                    const isExpanded = expanded.has(item.itemId);
                                    return (
                                        <div key={item.itemId} style={{ borderBottom: '1px solid var(--border)', background: changed ? 'rgba(245,158,11,0.05)' : undefined }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                                                <TriCheckbox checked={selected.has(item.itemId)} onChange={() => toggleOne(item.itemId)} />
                                                <div style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', background: 'var(--surface-hover)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {item.imageUrl
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        ? <img src={item.imageUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        : <ImageIcon size={16} color="var(--foreground-secondary)" />}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggleOne(item.itemId)}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <VegMark isVeg={!!item.isVeg} />
                                                        <span style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                                        {item.isAvailable === false && <span style={{ fontSize: '0.62rem', color: 'var(--foreground-secondary)', border: '1px solid var(--border)', padding: '0 5px', borderRadius: 4 }}>Unavailable</span>}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 8, fontSize: '0.72rem', color: 'var(--foreground-secondary)', marginTop: 2 }}>
                                                        {item.subCategoryName && <span>{item.subCategoryName}</span>}
                                                        {item.discount > 0 && <span style={{ color: '#059669', fontWeight: 600 }}>{item.discount}% off</span>}
                                                        {item.priceChangedByAdmin && Number(item.originalPrice) > 0 && Number(item.originalPrice) !== oldP && (
                                                            <span title="Vendor's own price before admin override">Vendor price {formatINR(Number(item.originalPrice))}</span>
                                                        )}
                                                    </div>
                                                </div>

                                                {variants.length > 0 && (
                                                    <button
                                                        onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(item.itemId)) n.delete(item.itemId); else n.add(item.itemId); return n; })}
                                                        className="btn btn-ghost btn-sm"
                                                        style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                                                        title="Show variant prices"
                                                    >
                                                        <Layers size={13} /> {variants.length} variant{variants.length === 1 ? '' : 's'}
                                                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                    </button>
                                                )}

                                                <div style={{ width: 80, textAlign: 'right', fontSize: '0.85rem', color: 'var(--foreground-secondary)', textDecoration: changed && newP !== oldP ? 'line-through' : 'none' }}>
                                                    {formatINR(oldP)}
                                                </div>
                                                <div style={{ position: 'relative', width: 110 }}>
                                                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--foreground-secondary)' }}>₹</span>
                                                    <input
                                                        type="number" min="0" step="any" value={d.price}
                                                        onChange={e => editPrice(item, e.target.value)}
                                                        style={{
                                                            width: '100%', padding: '7px 8px 7px 24px', borderRadius: 8, fontWeight: 800, fontSize: '0.9rem',
                                                            border: `1.5px solid ${invalid ? '#EF4444' : changed ? '#F59E0B' : 'var(--border)'}`,
                                                            background: 'var(--surface)', color: 'var(--foreground)',
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ width: 72, textAlign: 'right' }}>
                                                    {changed && Number.isFinite(newP) && newP !== oldP ? (
                                                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: newP > oldP ? '#059669' : '#DC2626' }}>
                                                            {newP > oldP ? '+' : ''}{pct.toFixed(1)}%
                                                        </span>
                                                    ) : changed ? (
                                                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#B45309' }}>variants</span>
                                                    ) : null}
                                                </div>
                                                <button
                                                    onClick={() => resetItem(item.itemId)}
                                                    title="Reset this item"
                                                    style={{ visibility: changed ? 'visible' : 'hidden', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground-secondary)', display: 'flex' }}
                                                >
                                                    <RotateCcw size={14} />
                                                </button>
                                            </div>

                                            {isExpanded && variants.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '0 16px 12px 120px' }}>
                                                    {variants.map((v, idx) => {
                                                        const vOld = Number(v.price) || 0;
                                                        const vNew = parsePrice(d.variantPrices[idx]);
                                                        const vChanged = vNew !== vOld;
                                                        return (
                                                            <div key={v.variantId || idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                                                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{v.name || `Variant ${idx + 1}`}{v.isDefault ? ' ★' : ''}</span>
                                                                {vChanged && <span style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)', textDecoration: 'line-through' }}>{formatINR(vOld)}</span>}
                                                                <input
                                                                    type="number" min="0" step="any" value={d.variantPrices[idx] ?? ''}
                                                                    onChange={e => editVariant(item, idx, e.target.value)}
                                                                    style={{ width: 80, padding: '4px 6px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, border: `1.5px solid ${vChanged ? '#F59E0B' : 'var(--border)'}`, background: 'var(--surface)', color: 'var(--foreground)' }}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* ── Review modal ── */}
            <AnimatePresence>
                {reviewOpen && (
                    <motion.div key="price-review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4" onClick={() => !saving && setReviewOpen(false)}>
                        <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} onClick={e => e.stopPropagation()} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-xl" style={{ maxHeight: '85vh' }}>
                            <div className="border-b border-[var(--border)] flex justify-between items-center bg-[var(--surface-hover)]" style={{ padding: '16px 20px' }}>
                                <div>
                                    <h2 className="text-lg font-bold">Review price changes</h2>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--foreground-secondary)' }}>
                                        {changedItems.length} item{changedItems.length === 1 ? '' : 's'} · {ups} up · {downs} down
                                    </p>
                                </div>
                                <button onClick={() => setReviewOpen(false)} disabled={saving} className="p-1 hover:bg-[var(--surface)] rounded-md"><X size={20} /></button>
                            </div>
                            <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {invalidCount > 0 && (
                                    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', color: '#DC2626', fontSize: '0.8rem', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <AlertTriangle size={14} /> {invalidCount} item(s) have an empty or invalid price. Fix them before saving.
                                    </div>
                                )}
                                {bigChanges > 0 && (
                                    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#B45309', fontSize: '0.8rem', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <AlertTriangle size={14} /> {bigChanges} item(s) change by {BIG_CHANGE_PCT}% or more — double-check them.
                                    </div>
                                )}
                                {reviewRows.map(({ item, d, oldP, newP, pct }) => {
                                    const bad = isInvalid(d);
                                    const variantDiffs = (item.variants || [])
                                        .map((v, i) => ({ name: v.name || `Variant ${i + 1}`, o: Number(v.price) || 0, n: parsePrice(d.variantPrices[i]) }))
                                        .filter(x => x.o !== x.n);
                                    return (
                                        <div key={item.itemId} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${bad ? 'rgba(239,68,68,0.4)' : 'var(--border)'}` }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <VegMark isVeg={!!item.isVeg} />
                                                <span style={{ flex: 1, fontWeight: 600, fontSize: '0.85rem' }}>{item.name}</span>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--foreground-secondary)' }}>{formatINR(oldP)}</span>
                                                <span style={{ fontSize: '0.8rem' }}>→</span>
                                                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: bad ? '#DC2626' : 'var(--foreground)' }}>{Number.isFinite(newP) ? formatINR(newP) : '—'}</span>
                                                {newP !== oldP && Number.isFinite(newP) && (
                                                    <span style={{ width: 60, textAlign: 'right', fontSize: '0.72rem', fontWeight: 800, color: newP > oldP ? '#059669' : '#DC2626' }}>
                                                        {newP > oldP ? '+' : ''}{pct.toFixed(1)}%
                                                    </span>
                                                )}
                                            </div>
                                            {variantDiffs.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, paddingLeft: 22 }}>
                                                    {variantDiffs.map(v => (
                                                        <span key={v.name} style={{ fontSize: '0.7rem', color: 'var(--foreground-secondary)' }}>
                                                            {v.name}: {formatINR(v.o)} → <b style={{ color: 'var(--foreground)' }}>{Number.isFinite(v.n) ? formatINR(v.n) : '—'}</b>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="border-t border-[var(--border)] bg-[var(--surface-hover)] flex items-center justify-between gap-3" style={{ padding: '14px 20px' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)' }}>
                                    Changes go live in the customer app right away. The vendor’s own price is kept for reference.
                                </span>
                                <div className="flex gap-3">
                                    <button onClick={() => setReviewOpen(false)} disabled={saving} className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }}>Back</button>
                                    <button onClick={save} disabled={saving || invalidCount > 0} className="btn btn-primary btn-sm" style={{ minWidth: 140, whiteSpace: 'nowrap', opacity: invalidCount > 0 ? 0.5 : 1 }}>
                                        {saving ? <Loader2 size={16} className="animate-spin" /> : <>Save {changedItems.length} change{changedItems.length === 1 ? '' : 's'}</>}
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
