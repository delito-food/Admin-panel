'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { GripVertical, Edit3, Trash2, ArrowUp, ArrowDown, Save, RotateCcw, Loader2, CheckCircle, AlertTriangle, X } from 'lucide-react';
import type { AdminMenuItem, VendorCategory } from '@/types';
import { sortCategories } from './menu-shared';

/**
 * Categories tab: drag rows (or use the arrows) to reorder, then "Save order".
 * The new order is written as sortOrder = position, the same convention the
 * vendor app uses, so both apps show the same sequence.
 */
export default function CategoryManager({
    vendorId, categories, items, onEdit, onDelete, onChanged, onDirtyChange,
}: {
    vendorId: string;
    categories: VendorCategory[];
    items: AdminMenuItem[];
    onEdit: (c: VendorCategory) => void;
    onDelete: (categoryId: string) => void;
    onChanged: () => void | Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const serverOrder = useMemo(() => sortCategories(categories).map(c => c.categoryId), [categories]);
    // Local edits are tied to the server order they started from; when the
    // server list changes (add/delete/refresh) the edits are dropped.
    const [local, setLocal] = useState<{ base: string[]; order: string[] } | null>(null);
    const order = local && local.base.join('|') === serverOrder.join('|') ? local.order : serverOrder;
    const setOrder = (fn: string[] | ((prev: string[]) => string[])) =>
        setLocal({ base: serverOrder, order: typeof fn === 'function' ? fn(order) : fn });
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

    const byId = useMemo(() => new Map(categories.map(c => [c.categoryId, c])), [categories]);
    const counts = useMemo(() => {
        const m = new Map<string, number>();
        items.forEach(i => { if (i.categoryId) m.set(i.categoryId, (m.get(i.categoryId) || 0) + 1); });
        return m;
    }, [items]);

    const dirty = order.length === serverOrder.length && order.some((id, i) => id !== serverOrder[i]);
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

    const move = (from: number, to: number) => {
        if (to < 0 || to >= order.length || from === to) return;
        setOrder(prev => {
            const next = [...prev];
            const [x] = next.splice(from, 1);
            next.splice(to, 0, x);
            return next;
        });
    };

    const onDragStart = (e: DragEvent, id: string) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', id); } catch { /* ignore */ }
    };
    const onDragOver = (e: DragEvent, id: string) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (id !== overId) setOverId(id);
        // Live reorder while hovering gives immediate feedback.
        if (id !== dragId) {
            const from = order.indexOf(dragId);
            const to = order.indexOf(id);
            if (from !== -1 && to !== -1) move(from, to);
        }
    };
    const endDrag = () => { setDragId(null); setOverId(null); };

    const save = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch(`/api/menu-management/vendor/${vendorId}/categories/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderedCategoryIds: order }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                setMsg({ tone: 'err', text: json.error || 'Failed to save order' });
            } else {
                setMsg({ tone: 'ok', text: 'Category order saved — the apps will show this order.' });
                await onChanged();
            }
        } catch {
            setMsg({ tone: 'err', text: 'Network error' });
        } finally {
            setSaving(false);
        }
    };

    if (categories.length === 0) {
        return (
            <div className="empty-state glass-card p-12 text-center">
                <h3 className="empty-state-title">No categories found</h3>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, border: `1px solid ${dirty ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`, background: dirty ? 'rgba(245,158,11,0.08)' : 'var(--surface)' }}>
                <GripVertical size={16} style={{ color: 'var(--foreground-secondary)' }} />
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: dirty ? '#B45309' : 'var(--foreground-secondary)', flex: 1 }}>
                    {dirty ? 'Order changed — save to apply it in the customer & vendor apps.' : 'Drag categories (or use the arrows) to change the order customers see.'}
                </span>
                {dirty && (
                    <>
                        <button onClick={() => { setOrder(serverOrder); setMsg(null); }} disabled={saving} className="btn btn-ghost btn-sm"><RotateCcw size={14} /> Reset</button>
                        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm" style={{ minWidth: 120 }}>
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Save order</>}
                        </button>
                    </>
                )}
            </div>

            {msg && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600, background: msg.tone === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)', color: msg.tone === 'ok' ? '#059669' : '#DC2626' }}>
                    {msg.tone === 'ok' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                    <span style={{ flex: 1 }}>{msg.text}</span>
                    <button onClick={() => setMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex' }}><X size={14} /></button>
                </div>
            )}

            <div className="grid gap-2">
                {order.map((id, index) => {
                    const cat = byId.get(id);
                    if (!cat) return null;
                    const isDragging = dragId === id;
                    return (
                        <div
                            key={id}
                            draggable={!saving}
                            onDragStart={e => onDragStart(e, id)}
                            onDragOver={e => onDragOver(e, id)}
                            onDrop={e => { e.preventDefault(); endDrag(); }}
                            onDragEnd={endDrag}
                            className="glass-card"
                            style={{
                                padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: saving ? 'default' : 'grab',
                                opacity: isDragging ? 0.5 : 1,
                                outline: overId === id && !isDragging ? '2px dashed var(--primary)' : 'none', outlineOffset: -2,
                                transition: 'opacity 0.12s',
                            }}
                        >
                            <GripVertical size={18} style={{ color: 'var(--foreground-secondary)', flexShrink: 0 }} />
                            <div className="hidden sm:flex" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface-hover)', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'var(--foreground-secondary)', flexShrink: 0 }}>
                                {index + 1}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h4 style={{ fontWeight: 700 }}>{cat.name}</h4>
                                <p style={{ fontSize: '0.72rem', color: 'var(--foreground-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {cat.description || 'No description'}
                                </p>
                            </div>
                            <span className="hidden sm:inline" style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{counts.get(id) || 0} item(s)</span>
                            <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: cat.isActive !== false ? 'rgba(16,185,129,0.12)' : 'var(--surface-hover)', color: cat.isActive !== false ? '#059669' : 'var(--foreground-secondary)' }}>
                                {cat.isActive !== false ? 'Active' : 'Inactive'}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <button onClick={() => move(index, index - 1)} disabled={index === 0 || saving} title="Move up" style={{ background: 'none', border: 'none', cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.3 : 1, color: 'var(--foreground-secondary)', display: 'flex' }}><ArrowUp size={14} /></button>
                                <button onClick={() => move(index, index + 1)} disabled={index === order.length - 1 || saving} title="Move down" style={{ background: 'none', border: 'none', cursor: index === order.length - 1 ? 'default' : 'pointer', opacity: index === order.length - 1 ? 0.3 : 1, color: 'var(--foreground-secondary)', display: 'flex' }}><ArrowDown size={14} /></button>
                            </div>
                            <button onClick={() => onEdit(cat)} className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors text-blue-500" title="Edit category">
                                <Edit3 size={18} />
                            </button>
                            <button onClick={() => onDelete(id)} className="p-2 hover:bg-[var(--surface-hover)] rounded-lg transition-colors text-red-500" title="Delete category">
                                <Trash2 size={18} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
