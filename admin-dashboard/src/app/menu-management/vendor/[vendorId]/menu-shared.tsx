'use client';

/**
 * Small shared helpers for the vendor menu screen (catalog, price manager,
 * category ordering). Kept free of page state so each piece stays testable.
 */

import type { AdminMenuItem, VendorCategory } from '@/types';

export const UNCATEGORIZED = '__uncategorized__';

/** Category id an item effectively belongs to (unknown ids → Uncategorized). */
export function effectiveCategoryId(item: Pick<AdminMenuItem, 'categoryId'>, known: Set<string>): string {
    return item.categoryId && known.has(item.categoryId) ? item.categoryId : UNCATEGORIZED;
}

/** Categories in display order (sortOrder, then name) — never mutates the input. */
export function sortCategories(categories: VendorCategory[]): VendorCategory[] {
    return [...categories].sort((a, b) =>
        (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
    );
}

export type RoundingStep = 0 | 1 | 5 | 10;

/** Round a price to the chosen step. 0 = keep paise (2 decimals). */
export function roundPrice(value: number, step: RoundingStep): number {
    if (!Number.isFinite(value)) return 0;
    if (step === 0) return Math.round(value * 100) / 100;
    return Math.round(value / step) * step;
}

/** Format a number for a price input: no trailing zeros, max 2 decimals. */
export function formatPriceInput(n: number): string {
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n * 100) / 100);
}

export function formatINR(n: number): string {
    if (!Number.isFinite(n)) return '₹—';
    const r = Math.round(n * 100) / 100;
    return `₹${r % 1 === 0 ? r.toFixed(0) : r.toFixed(2)}`;
}

export function percentChange(from: number, to: number): number {
    if (!from) return 0;
    return ((to - from) / from) * 100;
}

export type BulkUpdate = {
    itemId: string;
    price?: number;
    variantPrices?: number[];
    categoryId?: string;
    isAvailable?: boolean;
};

export type BulkUpdateResult = {
    success: boolean;
    updated?: number;
    unchanged?: number;
    skipped?: { itemId: string; reason: string }[];
    message?: string;
    error?: string;
};

/** POST to the admin bulk-update endpoint. Never throws — errors come back as { success:false }. */
export async function postBulkUpdate(vendorId: string, updates: BulkUpdate[], source: string): Promise<BulkUpdateResult> {
    try {
        const res = await fetch(`/api/menu-management/vendor/${vendorId}/items/bulk-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates, source }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
            return { success: false, error: json.error || `Request failed (${res.status})` };
        }
        return json as BulkUpdateResult;
    } catch {
        return { success: false, error: 'Network error' };
    }
}

export function VegMark({ isVeg, size = 12 }: { isVeg: boolean; size?: number }) {
    const color = isVeg ? '#10B981' : '#EF4444';
    return (
        <span
            title={isVeg ? 'Veg' : 'Non-veg'}
            style={{
                width: size, height: size, borderRadius: 3, border: `1.5px solid ${color}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
        >
            <span style={{ width: size / 2.4, height: size / 2.4, borderRadius: '50%', background: color }} />
        </span>
    );
}

/** Tri-state checkbox (supports the "some selected" dash). */
export function TriCheckbox({
    checked, indeterminate, onChange, title, disabled,
}: { checked: boolean; indeterminate?: boolean; onChange: () => void; title?: string; disabled?: boolean }) {
    return (
        <input
            type="checkbox"
            title={title}
            disabled={disabled}
            checked={checked}
            ref={el => { if (el) el.indeterminate = !!indeterminate && !checked; }}
            onChange={onChange}
            onClick={e => e.stopPropagation()}
            style={{ width: 16, height: 16, cursor: disabled ? 'not-allowed' : 'pointer', accentColor: 'var(--primary)', flexShrink: 0 }}
        />
    );
}
