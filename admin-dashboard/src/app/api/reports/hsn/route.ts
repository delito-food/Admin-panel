/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { collections, cachedCollection } from '@/lib/firebase-admin';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * HSN Summary API — for GSTR-1 filing
 * Query: &from=&to=  &format=json|csv|pdf
 */

function tsToIso(v: any): string | null {
    if (!v) return null;
    if (v?.toDate) return v.toDate().toISOString();
    if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

function roundTo2(n: number): number { return Math.round(n * 100) / 100; }
function fmtDate(d: Date) { return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }

export interface HSNRow {
    hsnCode: string;
    description: string;
    uqc: string;
    totalQuantity: number;
    totalValue: number;
    taxableValue: number;
    cgstRate: number;
    cgstAmount: number;
    sgstRate: number;
    sgstAmount: number;
    igstRate: number;
    igstAmount: number;
    totalTax: number;
    cessAmount: number;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const format = searchParams.get('format') || 'json';

        const now = new Date();
        const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        const fromStr = searchParams.get('from');
        const toStr = searchParams.get('to');
        const fromDate = fromStr ? new Date(fromStr) : defaultFrom;
        const toDate = toStr ? new Date(toStr) : defaultTo;
        toDate.setHours(23, 59, 59, 999);

        const allOrders = await cachedCollection(collections.orders, 30000);

        let foodTotalValue = 0, foodTotalQuantity = 0;
        let deliveryTotalValue = 0, deliveryCount = 0;
        let platformFeeTotalValue = 0, platformFeeCount = 0;

        allOrders.forEach(order => {
            const dateStr = tsToIso(order.createdAt);
            if (!dateStr) return;
            const orderDate = new Date(dateStr);
            if (orderDate < fromDate || orderDate > toDate) return;
            if (order.status !== 'Delivered') return;

            const itemTotal = (order.itemTotal || order.subtotal || 0) as number;
            const items = (order.items || []) as any[];
            const totalQty = items.reduce((s: number, i: any) => s + (i.quantity || 1), 0);
            foodTotalValue += itemTotal;
            foodTotalQuantity += totalQty;

            const deliveryFee = (order.deliveryFee || 0) as number;
            if (deliveryFee > 0) { deliveryTotalValue += deliveryFee; deliveryCount += 1; }

            const platformFee = (order.smallOrderSupportFee || 0) as number;
            if (platformFee > 0) { platformFeeTotalValue += platformFee; platformFeeCount += 1; }
        });

        const hsnRows: HSNRow[] = [];

        if (foodTotalValue > 0) {
            const taxable = roundTo2(foodTotalValue / 1.05);
            const cgst = roundTo2(taxable * 0.025);
            const sgst = roundTo2(taxable * 0.025);
            hsnRows.push({ hsnCode: '9963', description: 'Restaurant & Food Services', uqc: 'NOS', totalQuantity: foodTotalQuantity, totalValue: roundTo2(foodTotalValue), taxableValue: taxable, cgstRate: 2.5, cgstAmount: cgst, sgstRate: 2.5, sgstAmount: sgst, igstRate: 0, igstAmount: 0, totalTax: roundTo2(cgst + sgst), cessAmount: 0 });
        }
        if (deliveryTotalValue > 0) {
            const taxable = roundTo2(deliveryTotalValue / 1.18);
            const cgst = roundTo2(taxable * 0.09);
            const sgst = roundTo2(taxable * 0.09);
            hsnRows.push({ hsnCode: '996812', description: 'Courier & Delivery Services', uqc: 'NOS', totalQuantity: deliveryCount, totalValue: roundTo2(deliveryTotalValue), taxableValue: taxable, cgstRate: 9, cgstAmount: cgst, sgstRate: 9, sgstAmount: sgst, igstRate: 0, igstAmount: 0, totalTax: roundTo2(cgst + sgst), cessAmount: 0 });
        }
        if (platformFeeTotalValue > 0) {
            const taxable = roundTo2(platformFeeTotalValue / 1.18);
            const cgst = roundTo2(taxable * 0.09);
            const sgst = roundTo2(taxable * 0.09);
            hsnRows.push({ hsnCode: '998599', description: 'Platform / Packing Fee', uqc: 'NOS', totalQuantity: platformFeeCount, totalValue: roundTo2(platformFeeTotalValue), taxableValue: taxable, cgstRate: 9, cgstAmount: cgst, sgstRate: 9, sgstAmount: sgst, igstRate: 0, igstAmount: 0, totalTax: roundTo2(cgst + sgst), cessAmount: 0 });
        }

        const totals = {
            totalValue: roundTo2(hsnRows.reduce((s, r) => s + r.totalValue, 0)),
            taxableValue: roundTo2(hsnRows.reduce((s, r) => s + r.taxableValue, 0)),
            totalCGST: roundTo2(hsnRows.reduce((s, r) => s + r.cgstAmount, 0)),
            totalSGST: roundTo2(hsnRows.reduce((s, r) => s + r.sgstAmount, 0)),
            totalIGST: 0,
            totalTax: roundTo2(hsnRows.reduce((s, r) => s + r.totalTax, 0)),
            totalCess: 0,
        };

        if (format === 'csv') {
            const bom = '\uFEFF';
            const csv = generateHSNCSV(hsnRows, totals, fromDate, toDate);
            return new Response(bom + csv, {
                headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="HSN_Summary_${fromDate.toISOString().slice(0, 10)}_${toDate.toISOString().slice(0, 10)}.csv"` },
            });
        }

        if (format === 'pdf') {
            const buf = generateHSNPDF(hsnRows, totals, fromDate, toDate);
            return new Response(new Uint8Array(buf), {
                headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="HSN_Summary_${fromDate.toISOString().slice(0, 10)}.pdf"`, 'Content-Length': buf.length.toString() },
            });
        }

        return NextResponse.json({ success: true, data: { from: fromDate.toISOString(), to: toDate.toISOString(), hsnRows, totals } });
    } catch (error: any) {
        console.error('HSN summary error:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Failed to generate HSN summary' }, { status: 500 });
    }
}

function generateHSNCSV(rows: HSNRow[], totals: any, from: Date, to: Date): string {
    const lines: string[] = [];
    lines.push(`"HSN Summary Report (for GSTR-1 Filing)"`);
    lines.push(`"Period: ${fmtDate(from)} to ${fmtDate(to)}"`);
    lines.push(`"Generated: ${fmtDate(new Date())}"`);
    lines.push('');
    lines.push('"HSN Code","Description","UQC","Total Qty","Total Value (₹)","Taxable Value (₹)","CGST Rate","CGST Amount (₹)","SGST Rate","SGST Amount (₹)","IGST Rate","IGST Amount (₹)","Total Tax (₹)","Cess (₹)"');
    rows.forEach(r => {
        lines.push(`"${r.hsnCode}","${r.description}","${r.uqc}",${r.totalQuantity},${r.totalValue.toFixed(2)},${r.taxableValue.toFixed(2)},"${r.cgstRate}%",${r.cgstAmount.toFixed(2)},"${r.sgstRate}%",${r.sgstAmount.toFixed(2)},"${r.igstRate}%",${r.igstAmount.toFixed(2)},${r.totalTax.toFixed(2)},${r.cessAmount.toFixed(2)}`);
    });
    lines.push('');
    lines.push(`"TOTALS","","","",${totals.totalValue.toFixed(2)},${totals.taxableValue.toFixed(2)},"",${totals.totalCGST.toFixed(2)},"",${totals.totalSGST.toFixed(2)},"",${totals.totalIGST.toFixed(2)},${totals.totalTax.toFixed(2)},${totals.totalCess.toFixed(2)}`);
    return lines.join('\n');
}

function generateHSNPDF(rows: HSNRow[], totals: any, from: Date, to: Date): Buffer {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const m = 12;

    doc.setFillColor(244, 81, 30);
    doc.rect(0, 0, pw, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('HSN Summary Report — GSTR-1', m, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Period: ${fmtDate(from)} to ${fmtDate(to)}  |  Generated: ${fmtDate(new Date())}`, m, 17);
    doc.text('Delito', pw - m, 10, { align: 'right' });

    doc.setTextColor(33, 33, 33);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Value: Rs.${totals.totalValue.toFixed(2)}  |  Taxable: Rs.${totals.taxableValue.toFixed(2)}  |  CGST: Rs.${totals.totalCGST.toFixed(2)}  |  SGST: Rs.${totals.totalSGST.toFixed(2)}  |  Total Tax: Rs.${totals.totalTax.toFixed(2)}`, m, 28);

    const head = [['HSN Code', 'Description', 'UQC', 'Qty', 'Total Value', 'Taxable Value', 'CGST%', 'CGST', 'SGST%', 'SGST', 'Total Tax']];
    const body = rows.map(r => [r.hsnCode, r.description, r.uqc, r.totalQuantity, r.totalValue.toFixed(2), r.taxableValue.toFixed(2), `${r.cgstRate}%`, r.cgstAmount.toFixed(2), `${r.sgstRate}%`, r.sgstAmount.toFixed(2), r.totalTax.toFixed(2)]);
    body.push(['TOTALS', '', '', '', totals.totalValue.toFixed(2), totals.taxableValue.toFixed(2), '', totals.totalCGST.toFixed(2), '', totals.totalSGST.toFixed(2), totals.totalTax.toFixed(2)]);

    autoTable(doc, {
        startY: 32, head, body, margin: { left: m, right: m },
        styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', lineColor: [220, 220, 220] as any, lineWidth: 0.15 },
        headStyles: { fillColor: [244, 81, 30] as any, textColor: [255, 255, 255] as any, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 22 }, 1: { cellWidth: 55 }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'center' }, 7: { halign: 'right' }, 8: { halign: 'center' }, 9: { halign: 'right' }, 10: { halign: 'right' } },
        theme: 'grid',
    });

    const ph = doc.internal.pageSize.getHeight();
    doc.setFillColor(244, 81, 30);
    doc.rect(0, ph - 8, pw, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6);
    doc.text('Delito | HSN Summary for GSTR-1 Filing | Computer-generated', pw / 2, ph - 3, { align: 'center' });

    return Buffer.from(doc.output('arraybuffer'));
}
