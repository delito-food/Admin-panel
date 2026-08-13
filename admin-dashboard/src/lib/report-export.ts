import { buildXlsx, xlsxHeaders, type XlsxSheetSpec } from './xlsx-writer';
import { PLATFORM } from './invoice-constants';

/**
 * One report definition, two file formats.
 *
 * Report routes describe their output once as an XlsxSheetSpec; this module
 * renders it either as a styled .xlsx workbook or as a CSV carrying the same
 * title block, metadata, columns, totals and notes. That way the two exports
 * can never drift apart.
 */

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return `"${String(value).replace(/"/g, '""')}"`;
}

/** Render the spec as CSV, mirroring the workbook layout. */
export function specToCsv(spec: XlsxSheetSpec): string {
    const lines: string[] = [];
    const width = spec.columns.length;
    const pad = (cells: string[]) => {
        const row = cells.slice(0, width);
        while (row.length < width) row.push('');
        return row.join(',');
    };

    lines.push(pad([csvCell(spec.title)]));
    if (spec.subtitle) lines.push(pad([csvCell(spec.subtitle)]));
    lines.push(pad([]));

    for (const item of spec.meta || []) {
        lines.push(pad([csvCell(item.label), csvCell(item.value)]));
    }
    if ((spec.meta || []).length) lines.push(pad([]));

    lines.push(pad(spec.columns.map(c => csvCell(c.header))));

    for (const row of spec.rows) {
        lines.push(pad(spec.columns.map(c => csvCell(row[c.key]))));
    }

    if (spec.totals) {
        const totals = spec.totals;
        lines.push(pad(spec.columns.map((c, i) => {
            const value = i === 0 && spec.totalsLabel !== undefined && totals[c.key] === undefined
                ? spec.totalsLabel
                : totals[c.key];
            return csvCell(value);
        })));
    }

    if (spec.notes?.length) {
        lines.push(pad([]));
        for (const note of spec.notes) lines.push(pad([csvCell(note)]));
    }

    return lines.join('\r\n');
}

/**
 * Build the HTTP response for a report in the requested format.
 * `format` accepts 'xlsx' (default for anything unrecognised) or 'csv'.
 */
export function reportResponse(
    spec: XlsxSheetSpec,
    baseFilename: string,
    format: string | null
): Response {
    const safeName = baseFilename.replace(/[^\w.-]+/g, '_');

    if (format === 'csv') {
        // The BOM makes Excel honour UTF-8 (₹, en dashes) on a double-click
        return new Response('﻿' + specToCsv(spec), {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="${safeName}.csv"`,
                'Cache-Control': 'no-store',
            },
        });
    }

    const bytes = buildXlsx(spec);
    // Copy into a plain ArrayBuffer so the body type is unambiguous
    const body = new Uint8Array(bytes).buffer as ArrayBuffer;
    return new Response(body, xlsxHeaders(`${safeName}.xlsx`));
}

/** Standard identification block shared by every exported report. */
export function platformMeta(extra: Array<{ label: string; value: string }> = []) {
    return [
        { label: 'Legal name', value: PLATFORM.legalName },
        { label: 'GSTIN', value: PLATFORM.gstin },
        { label: 'Registered address', value: PLATFORM.address },
        ...extra,
        { label: 'Generated on', value: formatStamp(new Date()) },
        { label: 'Currency', value: 'INR (₹)' },
    ];
}

export function formatStamp(date: Date): string {
    return date.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

export function formatDay(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
