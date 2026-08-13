/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { collections, cachedCollection } from '@/lib/firebase-admin';
import { PLATFORM } from '@/lib/invoice-constants';
import { reportResponse, platformMeta, formatDay } from '@/lib/report-export';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * TDS Report API — supports Section 194O and 194C
 *
 * Query params:
 *   ?section=194O | 194C | vendor-1pct
 *   &from=2026-01-01 &to=2026-03-31
 *   &format=json (default) | csv | pdf
 */

function tsToIso(v: any): string | null {
    if (!v) return null;
    if (v?.toDate) return v.toDate().toISOString();
    if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

function roundTo2(n: number): number {
    return Math.round(n * 100) / 100;
}

function getCurrentFYQuarter(): { from: Date; to: Date; quarter: string } {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    if (month >= 3 && month <= 5) {
        return { from: new Date(year, 3, 1), to: new Date(year, 5, 30, 23, 59, 59), quarter: `Q1 FY${year}-${year + 1}` };
    } else if (month >= 6 && month <= 8) {
        return { from: new Date(year, 6, 1), to: new Date(year, 8, 30, 23, 59, 59), quarter: `Q2 FY${year}-${year + 1}` };
    } else if (month >= 9 && month <= 11) {
        return { from: new Date(year, 9, 1), to: new Date(year, 11, 31, 23, 59, 59), quarter: `Q3 FY${year}-${year + 1}` };
    } else {
        return { from: new Date(year, 0, 1), to: new Date(year, 2, 31, 23, 59, 59), quarter: `Q4 FY${year - 1}-${year}` };
    }
}

export interface TDSVendorRow {
    vendorId: string;
    vendorName: string;
    pan: string;
    gstin: string;
    totalGrossSales: number;
    totalOrders: number;
    commission: number;
    gstOnCommission: number;
    netPayable: number;
    tdsRate: number;
    tdsAmount: number;
    netAfterTDS: number;
}

export interface TDSDeliveryRow {
    deliveryPersonId: string;
    name: string;
    pan: string;
    phone: string;
    totalDeliveries: number;
    totalEarnings: number;
    tdsRate: number;
    tdsAmount: number;
    netAfterTDS: number;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const section = searchParams.get('section') || '194O';
        const format = searchParams.get('format') || 'json';

        const defaultDates = getCurrentFYQuarter();
        const fromStr = searchParams.get('from');
        const toStr = searchParams.get('to');
        const fromDate = fromStr ? new Date(fromStr) : defaultDates.from;
        const toDate = toStr ? new Date(toStr) : defaultDates.to;
        toDate.setHours(23, 59, 59, 999);
        const quarter = defaultDates.quarter;

        if (section === '194O' || section === 'vendor-1pct') {
            const allOrders = await cachedCollection(collections.orders, 30000);
            const allVendors = await cachedCollection(collections.vendors, 60000);

            const vendorMap: Record<string, any> = {};
            allVendors.forEach(v => { vendorMap[v.id] = v; });

            const vendorAgg: Record<string, { grossSales: number; orders: number; commission: number; gstOnComm: number }> = {};

            allOrders.forEach(order => {
                const dateStr = tsToIso(order.createdAt);
                if (!dateStr) return;
                const orderDate = new Date(dateStr);
                if (orderDate < fromDate || orderDate > toDate) return;
                if (order.status !== 'Delivered') return;
                const vid = order.vendorId as string;
                if (!vid) return;
                const itemTotal = (order.itemTotal || order.subtotal || 0) as number;
                const commission = (order.vendorPlatformCut || roundTo2(itemTotal * 0.15)) as number;
                const gstOnComm = (order.vendorGstOnPlatformCut || roundTo2(commission * 0.18)) as number;
                if (!vendorAgg[vid]) vendorAgg[vid] = { grossSales: 0, orders: 0, commission: 0, gstOnComm: 0 };
                vendorAgg[vid].grossSales += itemTotal;
                vendorAgg[vid].orders += 1;
                vendorAgg[vid].commission += commission;
                vendorAgg[vid].gstOnComm += gstOnComm;
            });

            const TDS_RATE = 0.1;
            const rows: TDSVendorRow[] = Object.entries(vendorAgg).map(([vid, agg]) => {
                const vendor = vendorMap[vid] || {};
                const netPayable = roundTo2(agg.grossSales - agg.commission - agg.gstOnComm);
                const tdsAmount = roundTo2(agg.grossSales * TDS_RATE / 100);
                return {
                    vendorId: vid, vendorName: (vendor.shopName || vendor.fullName || 'Unknown') as string,
                    pan: (vendor.pan || '') as string, gstin: (vendor.gstNumber || '') as string,
                    totalGrossSales: roundTo2(agg.grossSales), totalOrders: agg.orders,
                    commission: roundTo2(agg.commission), gstOnCommission: roundTo2(agg.gstOnComm),
                    netPayable, tdsRate: TDS_RATE, tdsAmount, netAfterTDS: roundTo2(netPayable - tdsAmount),
                };
            }).sort((a, b) => b.totalGrossSales - a.totalGrossSales);

            const totals = {
                totalGrossSales: roundTo2(rows.reduce((s, r) => s + r.totalGrossSales, 0)),
                totalOrders: rows.reduce((s, r) => s + r.totalOrders, 0),
                totalCommission: roundTo2(rows.reduce((s, r) => s + r.commission, 0)),
                totalGstOnCommission: roundTo2(rows.reduce((s, r) => s + r.gstOnCommission, 0)),
                totalNetPayable: roundTo2(rows.reduce((s, r) => s + r.netPayable, 0)),
                totalTDS: roundTo2(rows.reduce((s, r) => s + r.tdsAmount, 0)),
                totalNetAfterTDS: roundTo2(rows.reduce((s, r) => s + r.netAfterTDS, 0)),
            };

            if (format === 'csv' || format === 'xlsx') {
                const spec: XlsxSheetSpec = {
                    sheetName: `TDS ${section}`,
                    title: `TDS Statement — Section ${section}`,
                    subtitle: section === '194O'
                        ? 'TDS on e-commerce participant payments (0.1% of gross sales)'
                        : 'TDS on commission and brokerage',
                    meta: platformMeta([
                        { label: 'Deductor', value: PLATFORM.legalName },
                        { label: 'Quarter', value: quarter || 'Custom range' },
                        { label: 'Period', value: `${formatDay(fromDate)} to ${formatDay(toDate)}` },
                        { label: 'TDS rate', value: `${TDS_RATE}%` },
                    ]),
                    columns: [
                        { header: 'Restaurant', key: 'vendorName', width: 28 },
                        { header: 'PAN', key: 'pan', width: 14 },
                        { header: 'GSTIN', key: 'gstin', width: 20 },
                        { header: 'Orders', key: 'totalOrders', width: 10, type: 'number' },
                        { header: 'Gross Sales', key: 'totalGrossSales', width: 15, type: 'currency' },
                        { header: 'Commission', key: 'commission', width: 14, type: 'currency' },
                        { header: 'GST on Commission', key: 'gstOnCommission', width: 17, type: 'currency' },
                        { header: 'Net Payable', key: 'netPayable', width: 14, type: 'currency' },
                        { header: 'TDS Rate', key: 'tdsRate', width: 10, type: 'percent' },
                        { header: 'TDS Deducted', key: 'tdsAmount', width: 14, type: 'currency' },
                        { header: 'Net After TDS', key: 'netAfterTDS', width: 15, type: 'currency' },
                    ],
                    rows: rows as unknown as Array<Record<string, unknown>>,
                    totals: {
                        vendorName: 'TOTAL',
                        totalOrders: totals.totalOrders,
                        totalGrossSales: totals.totalGrossSales,
                        commission: totals.totalCommission,
                        gstOnCommission: totals.totalGstOnCommission,
                        netPayable: totals.totalNetPayable,
                        tdsAmount: totals.totalTDS,
                        netAfterTDS: totals.totalNetAfterTDS,
                    },
                    notes: [
                        'Rows without a PAN attract a higher deduction rate — collect the PAN before filing.',
                        'System-generated statement. Verify against the challans actually deposited.',
                    ],
                };
                return reportResponse(spec, `TDS_${section}_${quarter || 'custom'}`, format);
            }
            if (format === 'pdf') return respondPDF(generateVendorTDSPDF(rows, totals, section, quarter, fromDate, toDate), `TDS_${section}`);

            return NextResponse.json({ success: true, data: { section, quarter, from: fromDate.toISOString(), to: toDate.toISOString(), tdsRate: TDS_RATE, vendors: rows, totals } });

        } else if (section === '194C') {
            const allOrders = await cachedCollection(collections.orders, 30000);
            const allDP = await cachedCollection(collections.deliveryPersons, 60000);

            const dpMap: Record<string, any> = {};
            allDP.forEach(d => { dpMap[d.id] = d; });

            const dpAgg: Record<string, { deliveries: number; earnings: number }> = {};

            allOrders.forEach(order => {
                const dateStr = tsToIso(order.createdAt);
                if (!dateStr) return;
                const orderDate = new Date(dateStr);
                if (orderDate < fromDate || orderDate > toDate) return;
                if (order.status !== 'Delivered') return;
                const dpId = order.deliveryPersonId as string;
                if (!dpId) return;
                const distKm = (order.distanceKm || 0) as number;
                const payout = Math.max(15, roundTo2(10 + distKm * 6.5));
                if (!dpAgg[dpId]) dpAgg[dpId] = { deliveries: 0, earnings: 0 };
                dpAgg[dpId].deliveries += 1;
                dpAgg[dpId].earnings += payout;
            });

            const TDS_RATE = 1;
            const rows: TDSDeliveryRow[] = Object.entries(dpAgg).map(([dpId, agg]) => {
                const dp = dpMap[dpId] || {};
                const tdsAmount = roundTo2(agg.earnings * TDS_RATE / 100);
                return {
                    deliveryPersonId: dpId, name: (dp.fullName || dp.name || 'Unknown') as string,
                    pan: (dp.pan || '') as string, phone: (dp.phoneNumber || dp.phone || '') as string,
                    totalDeliveries: agg.deliveries, totalEarnings: roundTo2(agg.earnings),
                    tdsRate: TDS_RATE, tdsAmount, netAfterTDS: roundTo2(agg.earnings - tdsAmount),
                };
            }).sort((a, b) => b.totalEarnings - a.totalEarnings);

            const totals = {
                totalDeliveries: rows.reduce((s, r) => s + r.totalDeliveries, 0),
                totalEarnings: roundTo2(rows.reduce((s, r) => s + r.totalEarnings, 0)),
                totalTDS: roundTo2(rows.reduce((s, r) => s + r.tdsAmount, 0)),
                totalNetAfterTDS: roundTo2(rows.reduce((s, r) => s + r.netAfterTDS, 0)),
            };

            if (format === 'csv' || format === 'xlsx') {
                const spec: XlsxSheetSpec = {
                    sheetName: 'TDS 194C',
                    title: 'TDS Statement — Section 194C',
                    subtitle: 'TDS on payments to delivery partners (contractors)',
                    meta: platformMeta([
                        { label: 'Deductor', value: PLATFORM.legalName },
                        { label: 'Quarter', value: quarter || 'Custom range' },
                        { label: 'Period', value: `${formatDay(fromDate)} to ${formatDay(toDate)}` },
                        { label: 'TDS rate', value: `${TDS_RATE}%` },
                    ]),
                    columns: [
                        { header: 'Delivery Partner', key: 'name', width: 26 },
                        { header: 'PAN', key: 'pan', width: 14 },
                        { header: 'Phone', key: 'phone', width: 15 },
                        { header: 'Deliveries', key: 'totalDeliveries', width: 12, type: 'number' },
                        { header: 'Total Earnings', key: 'totalEarnings', width: 15, type: 'currency' },
                        { header: 'TDS Rate', key: 'tdsRate', width: 10, type: 'percent' },
                        { header: 'TDS Deducted', key: 'tdsAmount', width: 14, type: 'currency' },
                        { header: 'Net After TDS', key: 'netAfterTDS', width: 15, type: 'currency' },
                    ],
                    rows: rows as unknown as Array<Record<string, unknown>>,
                    totals: {
                        name: 'TOTAL',
                        totalDeliveries: totals.totalDeliveries,
                        totalEarnings: totals.totalEarnings,
                        tdsAmount: totals.totalTDS,
                        netAfterTDS: totals.totalNetAfterTDS,
                    },
                    notes: [
                        'Rows without a PAN attract a higher deduction rate — collect the PAN before filing.',
                        'System-generated statement. Verify against the challans actually deposited.',
                    ],
                };
                return reportResponse(spec, `TDS_194C_${quarter || 'custom'}`, format);
            }
            if (format === 'pdf') return respondPDF(generateDeliveryTDSPDF(rows, totals, quarter, fromDate, toDate), 'TDS_194C');

            return NextResponse.json({ success: true, data: { section: '194C', quarter, from: fromDate.toISOString(), to: toDate.toISOString(), tdsRate: TDS_RATE, deliveryPartners: rows, totals } });
        }

        return NextResponse.json({ success: false, error: 'Invalid section' }, { status: 400 });
    } catch (error: any) {
        console.error('TDS report error:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Failed to generate TDS report' }, { status: 500 });
    }
}

// ── Response helpers ──

function respondPDF(buf: Buffer, name: string) {
    return new Response(new Uint8Array(buf), {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${name}_${new Date().toISOString().slice(0, 10)}.pdf"`,
            'Content-Length': buf.length.toString(),
        },
    });
}

// ── PDF helpers ──

function fmtDate(d: Date) { return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }

function generateVendorTDSPDF(rows: TDSVendorRow[], totals: any, section: string, quarter: string, from: Date, to: Date): Buffer {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const m = 12;

    // Header
    doc.setFillColor(244, 81, 30);
    doc.rect(0, 0, pw, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`TDS Report — Section ${section}`, m, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Period: ${fmtDate(from)} to ${fmtDate(to)} (${quarter})  |  Generated: ${fmtDate(new Date())}`, m, 17);
    doc.text('Delito', pw - m, 10, { align: 'right' });

    // Summary
    doc.setTextColor(33, 33, 33);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    let sy = 28;
    doc.text(`Vendors: ${rows.length}  |  Orders: ${totals.totalOrders}  |  Gross Sales: Rs.${totals.totalGrossSales.toFixed(2)}  |  Total TDS (${section === 'vendor-1pct' ? '1%' : '1%'}): Rs.${totals.totalTDS.toFixed(2)}  |  Net Payable: Rs.${totals.totalNetAfterTDS.toFixed(2)}`, m, sy);
    sy += 4;

    // Table
    const head = [['#', 'Vendor Name', 'PAN', 'GSTIN', 'Gross Sales', 'Orders', 'Commission', 'GST/Comm', 'Net Payable', 'TDS%', 'TDS Amt', 'Net After TDS']];
    const body = rows.map((r, i) => [i + 1, r.vendorName, r.pan || 'N/A', r.gstin || 'N/A', r.totalGrossSales.toFixed(2), r.totalOrders, r.commission.toFixed(2), r.gstOnCommission.toFixed(2), r.netPayable.toFixed(2), `${r.tdsRate}%`, r.tdsAmount.toFixed(2), r.netAfterTDS.toFixed(2)]);
    body.push(['', 'TOTALS', '', '', totals.totalGrossSales.toFixed(2), totals.totalOrders, totals.totalCommission.toFixed(2), totals.totalGstOnCommission.toFixed(2), totals.totalNetPayable.toFixed(2), '', totals.totalTDS.toFixed(2), totals.totalNetAfterTDS.toFixed(2)]);

    autoTable(doc, {
        startY: sy, head, body, margin: { left: m, right: m },
        styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak', lineColor: [220, 220, 220] as any, lineWidth: 0.15 },
        headStyles: { fillColor: [244, 81, 30] as any, textColor: [255, 255, 255] as any, fontStyle: 'bold', fontSize: 6, halign: 'center' },
        columnStyles: { 0: { halign: 'center', cellWidth: 8 }, 1: { cellWidth: 38 }, 4: { halign: 'right' }, 5: { halign: 'center' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' } },
        foot: [],
        theme: 'grid',
    });

    // Footer
    const ph = doc.internal.pageSize.getHeight();
    doc.setFillColor(244, 81, 30);
    doc.rect(0, ph - 8, pw, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6);
    doc.text('Delito | Computer-generated report — no signature required', pw / 2, ph - 3, { align: 'center' });

    return Buffer.from(doc.output('arraybuffer'));
}

function generateDeliveryTDSPDF(rows: TDSDeliveryRow[], totals: any, quarter: string, from: Date, to: Date): Buffer {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const m = 12;

    doc.setFillColor(139, 92, 246);
    doc.rect(0, 0, pw, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('TDS Report — Section 194C (Delivery Partners)', m, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Period: ${fmtDate(from)} to ${fmtDate(to)} (${quarter})  |  Generated: ${fmtDate(new Date())}`, m, 17);
    doc.text('Delito', pw - m, 10, { align: 'right' });

    doc.setTextColor(33, 33, 33);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    let sy = 28;
    doc.text(`Partners: ${rows.length}  |  Deliveries: ${totals.totalDeliveries}  |  Earnings: Rs.${totals.totalEarnings.toFixed(2)}  |  TDS (1%): Rs.${totals.totalTDS.toFixed(2)}  |  Net: Rs.${totals.totalNetAfterTDS.toFixed(2)}`, m, sy);
    sy += 4;

    const head = [['#', 'Name', 'PAN', 'Phone', 'Deliveries', 'Earnings (₹)', 'TDS Rate', 'TDS Amt (₹)', 'Net After TDS (₹)']];
    const body = rows.map((r, i) => [i + 1, r.name, r.pan || 'N/A', r.phone, r.totalDeliveries, r.totalEarnings.toFixed(2), `${r.tdsRate}%`, r.tdsAmount.toFixed(2), r.netAfterTDS.toFixed(2)]);
    body.push(['', 'TOTALS', '', '', totals.totalDeliveries, totals.totalEarnings.toFixed(2), '', totals.totalTDS.toFixed(2), totals.totalNetAfterTDS.toFixed(2)]);

    autoTable(doc, {
        startY: sy, head, body, margin: { left: m, right: m },
        styles: { fontSize: 7, cellPadding: 2.5, overflow: 'linebreak', lineColor: [220, 220, 220] as any, lineWidth: 0.15 },
        headStyles: { fillColor: [139, 92, 246] as any, textColor: [255, 255, 255] as any, fontStyle: 'bold', fontSize: 7, halign: 'center' },
        columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 1: { cellWidth: 45 }, 4: { halign: 'center' }, 5: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
        theme: 'grid',
    });

    const ph = doc.internal.pageSize.getHeight();
    doc.setFillColor(139, 92, 246);
    doc.rect(0, ph - 8, pw, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6);
    doc.text('Delito | Computer-generated report — no signature required', pw / 2, ph - 3, { align: 'center' });

    return Buffer.from(doc.output('arraybuffer'));
}
