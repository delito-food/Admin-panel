/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Data structure for generating a payout slip PDF.
 */
export interface PayoutSlipData {
    // Recipient
    recipientType: 'vendor' | 'delivery';
    recipientName: string;
    recipientPhone?: string;
    recipientCity?: string;
    recipientEmail?: string;
    bankDetails?: {
        accountNumber?: string;
        ifsc?: string;
        bankName?: string;
        accountHolderName?: string;
    } | null;
    upiId?: string | null;

    // Payout details
    payoutId: string;
    amount: number;
    method: string;
    transactionId: string | null;
    status: string;
    notes?: string | null;
    issuedAt?: string | null;
    confirmedAt?: string | null;
    createdAt?: string | null;

    // Earnings context
    totalEarnings?: number;
    totalPaid?: number;
    pendingAfter?: number;

    // Platform
    platformName?: string;
    platformLegalName?: string;
    platformEmail?: string;
    
    // Period filter
    periodLabel?: string;
}

/**
 * Generate a professional, beautifully formatted payout slip PDF.
 * Styled similar to the invoice PDF with Delito branding.
 */
export function generatePayoutSlipPDF(data: PayoutSlipData): Uint8Array {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 16;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // Brand colors
    const primary: [number, number, number] = [28, 27, 31];       // Deep charcoal
    const accent: [number, number, number] = [216, 67, 21];       // Delito warm red
    const dark: [number, number, number] = [33, 33, 33];
    const gray: [number, number, number] = [117, 117, 117];
    const lightGray: [number, number, number] = [249, 249, 249];
    const green: [number, number, number] = [76, 175, 80];
    const white: [number, number, number] = [255, 255, 255];

    const platformName = data.platformName || 'Delito';
    const platformLegal = data.platformLegalName || 'Delito';
    const platformEmail = data.platformEmail || 'support@delito.in';

    // Helper
    const fmtCurrency = (n: number) =>
        '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = (s?: string | null) => {
        if (!s) return '—';
        const d = new Date(s);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
            ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    };

    // ─── HEADER BANNER ───
    doc.setFillColor(...primary);
    doc.rect(0, 0, pageWidth, 34, 'F');

    // Accent stripe
    doc.setFillColor(...accent);
    doc.rect(0, 34, pageWidth, 2, 'F');

    doc.setTextColor(...white);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(platformName, margin, 15);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(platformLegal, margin, 22);
    doc.text(platformEmail, margin, 27);

    // Right side header
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PAYOUT SLIP', pageWidth - margin, 15, { align: 'right' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    let hdrY = 22;
    if (data.periodLabel) {
        doc.text(data.periodLabel, pageWidth - margin, hdrY, { align: 'right' });
        hdrY += 5;
    }
    const slipDate = data.confirmedAt || data.createdAt || new Date().toISOString();
    doc.text(`Date: ${fmtDate(slipDate)}`, pageWidth - margin, hdrY, { align: 'right' });
    doc.text(`Slip #: ${data.payoutId.slice(0, 12).toUpperCase()}`, pageWidth - margin, hdrY + 5, { align: 'right' });

    y = 42;

    // ─── STATUS BADGE ───
    const statusColor = data.status === 'completed' ? green : data.status === 'issued' ? [245, 158, 11] as [number, number, number] : [239, 68, 68] as [number, number, number];
    const statusLabel = data.status === 'completed' ? '✓ COMPLETED' : data.status === 'issued' ? '⏳ ISSUED (PENDING)' : data.status.toUpperCase();

    doc.setFillColor(...statusColor);
    const statusWidth = doc.getTextWidth(statusLabel) * 1.1 + 12;
    doc.roundedRect(margin, y, statusWidth, 8, 2, 2, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(statusLabel, margin + 4, y + 5.5);

    y += 14;

    // ─── RECIPIENT & PAYOUT INFO (side by side) ───
    const halfW = (contentWidth - 6) / 2;

    // Recipient box
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(...lightGray);
    doc.roundedRect(margin, y, halfW, 36, 3, 3, 'FD');
    doc.setTextColor(...accent);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    const recipLabel = data.recipientType === 'vendor' ? 'PAID TO (VENDOR / RESTAURANT)' : 'PAID TO (DELIVERY PARTNER)';
    doc.text(recipLabel, margin + 4, y + 6);
    doc.setTextColor(...dark);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const recipName = doc.splitTextToSize(data.recipientName, halfW - 8);
    doc.text(recipName[0], margin + 4, y + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    let ry = y + 17;
    if (data.recipientPhone) { doc.text(`Phone: ${data.recipientPhone}`, margin + 4, ry); ry += 4; }
    if (data.recipientCity) { doc.text(`City: ${data.recipientCity}`, margin + 4, ry); ry += 4; }
    if (data.recipientEmail) { doc.text(`Email: ${data.recipientEmail}`, margin + 4, ry); ry += 4; }

    // Payout details box
    const px = margin + halfW + 6;
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(...lightGray);
    doc.roundedRect(px, y, halfW, 36, 3, 3, 'FD');
    doc.setTextColor(...accent);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('PAYOUT DETAILS', px + 4, y + 6);
    doc.setTextColor(...dark);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    let py = y + 12;
    const addDetailLine = (label: string, value: string) => {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...gray);
        doc.text(label, px + 4, py);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...dark);
        doc.text(value, px + halfW - 4, py, { align: 'right' });
        py += 4.5;
    };
    addDetailLine('Method:', data.method);
    addDetailLine('Payout ID:', data.payoutId.slice(0, 14));
    if (data.transactionId) addDetailLine('TXN ID:', data.transactionId.slice(0, 18));
    if (data.issuedAt) addDetailLine('Issued:', fmtDate(data.issuedAt).split(' ').slice(0, 3).join(' '));
    if (data.confirmedAt) addDetailLine('Confirmed:', fmtDate(data.confirmedAt).split(' ').slice(0, 3).join(' '));

    y += 42;

    // ─── PAYOUT AMOUNT — Large highlight ───
    doc.setFillColor(...accent);
    doc.roundedRect(margin, y, contentWidth, 22, 3, 3, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('PAYOUT AMOUNT', margin + 6, y + 8);
    doc.setFontSize(16);
    doc.text(fmtCurrency(data.amount), pageWidth - margin - 6, y + 15, { align: 'right' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`via ${data.method}`, margin + 6, y + 15);

    y += 28;

    // ─── BANK DETAILS (if available) ───
    if (data.bankDetails?.accountNumber || data.upiId) {
        doc.setTextColor(...accent);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Payment Details', margin, y);
        y += 3;

        const bankRows: string[][] = [];
        if (data.bankDetails?.accountHolderName) bankRows.push(['Account Holder', data.bankDetails.accountHolderName]);
        if (data.bankDetails?.accountNumber) bankRows.push(['Account Number', '••••' + data.bankDetails.accountNumber.slice(-4)]);
        if (data.bankDetails?.ifsc) bankRows.push(['IFSC Code', data.bankDetails.ifsc]);
        if (data.bankDetails?.bankName) bankRows.push(['Bank', data.bankDetails.bankName]);
        if (data.upiId) bankRows.push(['UPI ID', data.upiId]);

        autoTable(doc, {
            startY: y,
            body: bankRows,
            margin: { left: margin, right: margin },
            tableWidth: contentWidth * 0.55,
            styles: {
                fontSize: 6.5,
                cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
                lineColor: [230, 230, 230] as any,
                lineWidth: 0.1,
                textColor: dark,
            },
            columnStyles: {
                0: { fontStyle: 'normal', textColor: gray as any, cellWidth: 32 },
                1: { fontStyle: 'bold' },
            },
            theme: 'plain',
            alternateRowStyles: { fillColor: [252, 252, 252] as any },
        });

        y = (doc as any).lastAutoTable.finalY + 6;
    }

    // ─── EARNINGS SUMMARY TABLE ───
    if (data.totalEarnings !== undefined || data.totalPaid !== undefined) {
        doc.setTextColor(...accent);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Earnings Summary', margin, y);
        y += 3;

        const summaryRows: string[][] = [];
        if (data.totalEarnings !== undefined) summaryRows.push(['Total Earnings (All Time)', fmtCurrency(data.totalEarnings)]);
        if (data.totalPaid !== undefined) summaryRows.push(['Total Paid (All Time)', fmtCurrency(data.totalPaid)]);
        summaryRows.push(['This Payout', fmtCurrency(data.amount)]);
        if (data.pendingAfter !== undefined) summaryRows.push(['Pending After This Payout', fmtCurrency(data.pendingAfter)]);

        autoTable(doc, {
            startY: y,
            body: summaryRows,
            margin: { left: margin, right: margin },
            tableWidth: contentWidth,
            styles: {
                fontSize: 7,
                cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
                lineColor: [230, 230, 230] as any,
                lineWidth: 0.15,
                textColor: dark,
            },
            columnStyles: {
                0: { fontStyle: 'normal', cellWidth: contentWidth * 0.6 },
                1: { fontStyle: 'bold', halign: 'right' },
            },
            theme: 'grid',
            alternateRowStyles: { fillColor: [252, 252, 252] as any },
            didParseCell: (hookData: any) => {
                // Highlight "This Payout" row
                if (hookData.row.index === summaryRows.length - (data.pendingAfter !== undefined ? 2 : 1)) {
                    hookData.cell.styles.fillColor = [255, 243, 235];
                    hookData.cell.styles.textColor = accent;
                    hookData.cell.styles.fontStyle = 'bold';
                }
            },
        });

        y = (doc as any).lastAutoTable.finalY + 6;
    }

    // ─── NOTES ───
    if (data.notes) {
        doc.setTextColor(...accent);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.text('Notes:', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...gray);
        doc.setFontSize(6.5);
        const noteLines = doc.splitTextToSize(data.notes, contentWidth - 10);
        doc.text(noteLines.slice(0, 3), margin + 2, y + 4);
        y += 4 + noteLines.slice(0, 3).length * 3.5;
    }

    // ─── AMOUNT IN WORDS ───
    y += 4;
    doc.setTextColor(...dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('Amount in Words:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    const words = numberToWords(Math.round(data.amount));
    const wordLines = doc.splitTextToSize(`Indian Rupees ${words} Only`, contentWidth);
    doc.text(wordLines.slice(0, 2), margin, y + 4);

    y += 12;

    // ─── DISCLAIMER ───
    if (y > 245) { doc.addPage(); y = margin; }
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    doc.setTextColor(...gray);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.5);
    const disclaimer = [
        'This is a computer-generated payout slip and does not require a physical signature.',
        `Generated by ${platformName}. This document serves as a record of payment made to the recipient.`,
        `For queries, contact: ${platformEmail}`,
    ];
    disclaimer.forEach(l => { doc.text(l, margin, y); y += 3; });

    // ─── FOOTER BAR ───
    doc.setFillColor(...primary);
    doc.rect(0, pageHeight - 10, pageWidth, 10, 'F');
    doc.setTextColor(...white);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text(
        `${platformName} | ${platformLegal} | ${platformEmail}`,
        pageWidth / 2, pageHeight - 4, { align: 'center' }
    );

    const arrayBuffer = doc.output('arraybuffer');
    return new Uint8Array(arrayBuffer);
}

/**
 * Client-side helper: triggers a browser download of the payout slip PDF.
 */
export function downloadPayoutSlip(data: PayoutSlipData): void {
    const pdfBytes = generatePayoutSlipPDF(data);
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const recipientSlug = data.recipientName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    const dateSlug = new Date().toISOString().split('T')[0];
    a.download = `payout-slip-${recipientSlug}-${dateSlug}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Convert number to words for Indian currency
 */
function numberToWords(num: number): string {
    if (num === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function convertChunk(n: number): string {
        if (n === 0) return '';
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convertChunk(n % 100) : '');
    }
    const parts: string[] = [];
    if (num >= 10000000) { parts.push(convertChunk(Math.floor(num / 10000000)) + ' Crore'); num %= 10000000; }
    if (num >= 100000) { parts.push(convertChunk(Math.floor(num / 100000)) + ' Lakh'); num %= 100000; }
    if (num >= 1000) { parts.push(convertChunk(Math.floor(num / 1000)) + ' Thousand'); num %= 1000; }
    if (num > 0) { parts.push(convertChunk(num)); }
    return parts.join(' ') || 'Zero';
}
