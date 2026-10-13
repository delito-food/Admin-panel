/**
 * Export a vendor's menu as CSV (opens cleanly in Excel / Google Sheets).
 *
 * The first six columns are exactly the Import CSV template
 * (name, description, price, category, isVeg, prepTime), so an exported file
 * can be edited and fed back through "Import CSV". Everything after that is
 * extra detail for reading/auditing and is ignored by the importer.
 */

import Papa from 'papaparse';
import type { AdminMenuItem, VendorCategory } from '@/types';
import { sortCategories } from './menu-shared';

const yesNo = (v: unknown) => (v ? 'yes' : 'no');
const money = (n: unknown) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : '';
};

function slug(s: string) {
    return (s || 'vendor').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'vendor';
}

export function exportMenuCsv(
    items: AdminMenuItem[],
    categories: VendorCategory[],
    vendorName: string
): number {
    // Items follow the menu's category order, then name.
    const ordered = sortCategories(categories);
    const catRank = new Map(ordered.map((c, i) => [c.categoryId, i]));
    const catName = new Map(categories.map((c) => [c.categoryId, c.name]));

    const rows = [...items]
        .sort((a, b) =>
            (catRank.get(a.categoryId) ?? 9999) - (catRank.get(b.categoryId) ?? 9999) ||
            (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
        )
        .map((item) => {
            const price = Number(item.price) || 0;
            const discount = Number(item.discount) || 0;
            return {
                // ── Import-compatible columns ──
                name: item.name || '',
                description: item.description || '',
                price: money(price),
                category: catName.get(item.categoryId) || item.categoryName || 'Uncategorized',
                isVeg: yesNo(item.isVeg),
                prepTime: item.preparationTime ?? '',
                // ── Extra detail ──
                subCategory: item.subCategoryName || '',
                discountPercent: discount || 0,
                priceAfterDiscount: money(discount > 0 ? price * (1 - discount / 100) : price),
                variants: (item.variants || [])
                    .map((v) => `${v.name}: ${money(v.price)}${v.isDefault ? ' (default)' : ''}`)
                    .join(' | '),
                addOns: (item.addOns || [])
                    .map((a) => `${a.name}: ${money(a.price)}`)
                    .join(' | '),
                available: yesNo(item.isAvailable),
                bestSeller: yesNo(item.isBestSeller),
                tags: (item.tags || []).join(', '),
                verificationStatus: item.verificationStatus || '',
                rating: item.rating ?? '',
                totalOrders: item.totalOrders ?? '',
                imageUrl: item.imageUrl || '',
                itemId: item.itemId,
                categoryId: item.categoryId || '',
            };
        });

    const csv = Papa.unparse(rows, {
        // Block spreadsheet formula injection from item names/descriptions.
        escapeFormulae: true,
    });

    // BOM so Excel reads ₹ / Hindi text as UTF-8.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(vendorName)}_menu_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return rows.length;
}
