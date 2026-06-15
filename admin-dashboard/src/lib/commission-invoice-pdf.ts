/* eslint-disable @typescript-eslint/no-explicit-any */
import { CommissionInvoiceData, COMMISSION_PLATFORM } from './invoice-constants';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── GREEN COLOR SCHEME ───
const darkGreen: [number, number, number] = [46, 125, 50];     // #2E7D32
const medGreen: [number, number, number] = [76, 175, 80];      // #4CAF50
const lightGreen: [number, number, number] = [232, 245, 233];  // #E8F5E9
const white: [number, number, number] = [255, 255, 255];
const black: [number, number, number] = [33, 33, 33];
const gray: [number, number, number] = [117, 117, 117];

// ─── HELPERS ───

/** Format number with 2 decimals and Indian-style comma grouping */
function fmtC(n: number): string {
    const fixed = n.toFixed(2);
    const [intPart, decPart] = fixed.split('.');
    // Indian number format: last 3 digits, then groups of 2
    let formatted = intPart;
    if (intPart.length > 3) {
        const last3 = intPart.slice(-3);
        let remaining = intPart.slice(0, -3);
        const groups: string[] = [];
        while (remaining.length > 2) {
            groups.unshift(remaining.slice(-2));
            remaining = remaining.slice(0, -2);
        }
        if (remaining.length > 0) {
            groups.unshift(remaining);
        }
        formatted = groups.join(',') + ',' + last3;
    }
    return formatted + '.' + decPart;
}

/** Convert number to words for Indian currency */
function numberToWords(num: number): string {
    if (num === 0) return 'Zero';
    const ones = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
        'Seventeen', 'Eighteen', 'Nineteen',
    ];
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

// ─── MAIN PDF GENERATOR ───

export function generateCommissionInvoicePDF(data: CommissionInvoiceData): Uint8Array {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // ═══════════════════════════════════════════════════
    // === 1. HEADER SECTION ===
    // ═══════════════════════════════════════════════════

    // Logo area — green filled rectangle with white "D"
    doc.setFillColor(...darkGreen);
    doc.roundedRect(margin, y, 40, 25, 3, 3, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('D', margin + 16, y + 16);

    // Top-right: DELITO branding
    doc.setTextColor(...darkGreen);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('DELITO', pageWidth - margin, y + 10, { align: 'right' });
    doc.setTextColor(...gray);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Powered by Delito', pageWidth - margin, y + 16, { align: 'right' });

    y += 30;

    // "COMMISSION TAX INVOICE" — centered
    doc.setTextColor(...darkGreen);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('COMMISSION TAX INVOICE', pageWidth / 2, y, { align: 'center' });
    y += 6;

    // Billing Period — right-aligned, italic
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...darkGreen);
    doc.text(`Billing Period: ${data.billingPeriod}`, pageWidth - margin, y, { align: 'right' });
    y += 8;

    // ═══════════════════════════════════════════════════
    // === 2. ISSUER & RECIPIENT DETAILS (side by side) ===
    // ═══════════════════════════════════════════════════
    const halfW = (contentWidth - 6) / 2;
    const boxStartY = y;
    const boxH = 48;

    // ── Left box: ISSUER (DELITO) ──
    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, boxStartY, halfW, boxH, 2, 2, 'S');

    // Header label
    doc.setFillColor(...darkGreen);
    doc.roundedRect(margin, boxStartY, halfW, 7, 2, 2, 'F');
    // Fill the bottom corners of the header so they appear square
    doc.rect(margin, boxStartY + 4, halfW, 3, 'F');

    doc.setTextColor(...white);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE ISSUED BY', margin + 3, boxStartY + 5);

    let ly = boxStartY + 13;
    doc.setTextColor(...black);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('DELITO', margin + 3, ly);
    ly += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    doc.text(`GSTIN: ${data.platform.gstin}`, margin + 3, ly); ly += 3.5;
    doc.text(`FSSAI LICENSE: ${data.platform.fssaiLicense}`, margin + 3, ly); ly += 4;

    doc.setTextColor(...black);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('ADDRESS:', margin + 3, ly); ly += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray);
    const issuerAddrLines = doc.splitTextToSize(data.platform.address.replace(/\\n/g, '\n'), halfW - 8);
    issuerAddrLines.forEach((line: string) => { doc.text(line, margin + 3, ly); ly += 3; });
    ly += 1;

    doc.text(`EMAIL: ${data.platform.email}`, margin + 3, ly); ly += 3.5;
    doc.text(`WEBSITE: ${data.platform.website}`, margin + 3, ly);

    // ── Right box: RECIPIENT (Vendor) ──
    const rx = margin + halfW + 6;
    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(rx, boxStartY, halfW, boxH, 2, 2, 'S');

    // Header label
    doc.setFillColor(...darkGreen);
    doc.roundedRect(rx, boxStartY, halfW, 7, 2, 2, 'F');
    doc.rect(rx, boxStartY + 4, halfW, 3, 'F');

    doc.setTextColor(...white);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE ISSUED TO', rx + 3, boxStartY + 5);

    let ry = boxStartY + 13;
    doc.setTextColor(...black);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(data.vendor.name, rx + 3, ry);
    ry += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    doc.text(`GSTIN: ${data.vendor.gstin}`, rx + 3, ry); ry += 3.5;
    doc.text(`FSSAI LICENSE: ${data.vendor.fssaiLicense}`, rx + 3, ry); ry += 4;

    doc.setTextColor(...black);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('ADDRESS:', rx + 3, ry); ry += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray);
    const vendorAddrLines = doc.splitTextToSize(data.vendor.address.replace(/\\n/g, '\n'), halfW - 8);
    vendorAddrLines.forEach((line: string) => { doc.text(line, rx + 3, ry); ry += 3; });
    ry += 1;

    doc.text(`STATE: ${data.vendor.state}`, rx + 3, ry);

    y = boxStartY + boxH + 6;

    // ═══════════════════════════════════════════════════
    // === 3. INVOICE METADATA BAR ===
    // ═══════════════════════════════════════════════════
    autoTable(doc, {
        startY: y,
        head: [[
            'INVOICE NO', 'DATE', 'DOCUMENT', 'HSN CODE',
            'PLACE OF SUPPLY', 'SERVICE TYPE', 'CATEGORY', 'REV. CHARGES',
        ]],
        body: [[
            data.invoiceNumber,
            data.invoiceDate,
            'INV',
            data.hsnCode,
            data.placeOfSupply,
            data.serviceType,
            data.category,
            data.reverseCharges ? 'Yes' : 'No',
        ]],
        margin: { left: margin, right: margin },
        tableWidth: contentWidth,
        styles: {
            fontSize: 6,
            cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
            lineColor: [200, 200, 200] as any,
            lineWidth: 0.15,
            textColor: black as any,
            overflow: 'linebreak',
            halign: 'center',
        },
        headStyles: {
            fillColor: darkGreen as any,
            textColor: white as any,
            fontStyle: 'bold',
            fontSize: 5.5,
            halign: 'center',
        },
        bodyStyles: {
            fillColor: white as any,
        },
        theme: 'grid',
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    // ═══════════════════════════════════════════════════
    // === 4. WEEKLY SALES & COMMISSION BREAKDOWN ===
    // ═══════════════════════════════════════════════════
    doc.setTextColor(...darkGreen);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('WEEKLY SALES & COMMISSION BREAKDOWN', margin, y);
    y += 3;

    const weeklyRows = data.weeklyBreakdown.map(w => [
        w.weekLabel,
        String(w.orders),
        `\u20B9${fmtC(w.grossSales)}`,
        `\u20B9${fmtC(w.commission)}`,
        `\u20B9${fmtC(w.gstOnCommission)}`,
        `\u20B9${fmtC(w.totalDeduction)}`,
        `\u20B9${fmtC(w.netPayout)}`,
    ]);

    // Monthly total row
    const mt = data.monthlyTotals;
    const monthlyTotalRow = [
        'MONTHLY TOTAL',
        String(mt.orders),
        `\u20B9${fmtC(mt.grossSales)}`,
        `\u20B9${fmtC(mt.commission)}`,
        `\u20B9${fmtC(mt.gstOnCommission)}`,
        `\u20B9${fmtC(mt.totalDeduction)}`,
        `\u20B9${fmtC(mt.netPayout)}`,
    ];

    weeklyRows.push(monthlyTotalRow);

    const totalRowIndex = weeklyRows.length - 1;

    autoTable(doc, {
        startY: y,
        head: [[
            'WEEK / PERIOD', 'ORDERS', 'GROSS SALES (\u20B9)',
            'COMMISSION \u20B9', 'GST ON COMM 18% (\u20B9)',
            'TOTAL DEDUCTION (\u20B9)', 'NET PAYOUT TO YOU (\u20B9)',
        ]],
        body: weeklyRows,
        margin: { left: margin, right: margin },
        tableWidth: contentWidth,
        styles: {
            fontSize: 6,
            cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
            lineColor: [200, 200, 200] as any,
            lineWidth: 0.15,
            textColor: black as any,
            overflow: 'linebreak',
            halign: 'center',
        },
        headStyles: {
            fillColor: darkGreen as any,
            textColor: white as any,
            fontStyle: 'bold',
            fontSize: 5.5,
            halign: 'center',
        },
        columnStyles: {
            0: { halign: 'left', cellWidth: contentWidth * 0.16 },
            1: { halign: 'center', cellWidth: contentWidth * 0.08 },
            2: { halign: 'right', cellWidth: contentWidth * 0.14 },
            3: { halign: 'right', cellWidth: contentWidth * 0.13 },
            4: { halign: 'right', cellWidth: contentWidth * 0.15 },
            5: { halign: 'right', cellWidth: contentWidth * 0.16 },
            6: { halign: 'right', cellWidth: contentWidth * 0.18 },
        },
        didParseCell: (hookData: any) => {
            // Highlight the monthly total row
            if (hookData.section === 'body' && hookData.row.index === totalRowIndex) {
                hookData.cell.styles.fillColor = lightGreen;
                hookData.cell.styles.fontStyle = 'bold';
                hookData.cell.styles.textColor = darkGreen;
            }
        },
        theme: 'grid',
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    // ═══════════════════════════════════════════════════
    // === 5. PAYOUT SUMMARY & GST BREAKUP (side by side) ===
    // ═══════════════════════════════════════════════════

    const leftBoxW = halfW;
    const rightBoxW = halfW;
    const section5StartY = y;

    // ── Left: PAYOUT SUMMARY ──
    const payoutBoxH = 48;
    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, section5StartY, leftBoxW, payoutBoxH, 2, 2, 'S');

    // Header
    doc.setFillColor(...darkGreen);
    doc.roundedRect(margin, section5StartY, leftBoxW, 7, 2, 2, 'F');
    doc.rect(margin, section5StartY + 4, leftBoxW, 3, 'F');

    doc.setTextColor(...white);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('PAYOUT SUMMARY', margin + 3, section5StartY + 5);

    let py = section5StartY + 14;
    doc.setTextColor(...black);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');

    doc.text('Total Gross Sales (Month):', margin + 3, py);
    doc.text(`\u20B9${fmtC(mt.grossSales)}`, margin + leftBoxW - 4, py, { align: 'right' });
    py += 5;

    doc.text('(\u2212) Commission:', margin + 3, py);
    doc.setTextColor(200, 50, 50);
    doc.text(`\u20B9${fmtC(mt.commission)}`, margin + leftBoxW - 4, py, { align: 'right' });
    doc.setTextColor(...black);
    py += 5;

    doc.text('(\u2212) GST on Commission @ 18%:', margin + 3, py);
    doc.setTextColor(200, 50, 50);
    doc.text(`\u20B9${fmtC(mt.gstOnCommission)}`, margin + leftBoxW - 4, py, { align: 'right' });
    doc.setTextColor(...black);
    py += 5;

    // Separator line
    doc.setDrawColor(...medGreen);
    doc.setLineWidth(0.5);
    doc.line(margin + 3, py, margin + leftBoxW - 3, py);
    py += 6;

    // NET PAYOUT highlighted
    doc.setFillColor(...lightGreen);
    doc.rect(margin + 2, py - 4, leftBoxW - 4, 8, 'F');
    doc.setTextColor(...darkGreen);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('NET PAYOUT TO RESTAURANT:', margin + 4, py);
    doc.text(`\u20B9${fmtC(mt.netPayout)}`, margin + leftBoxW - 4, py, { align: 'right' });

    // ── Right: GST BREAKUP ON COMMISSION ──
    const gstTableX = margin + halfW + 6;

    autoTable(doc, {
        startY: section5StartY,
        head: [['GST BREAKUP ON COMMISSION', 'RATE', 'AMOUNT (\u20B9)']],
        body: [
            ['IGST', `${data.gstBreakup.igstRate}%`, `\u20B9${fmtC(data.gstBreakup.igstAmount)}`],
            ['CGST', `${data.gstBreakup.cgstRate}%`, `\u20B9${fmtC(data.gstBreakup.cgstAmount)}`],
            ['SGST / UTGST', `${data.gstBreakup.sgstRate}%`, `\u20B9${fmtC(data.gstBreakup.sgstAmount)}`],
            ['TOTAL GST', '', `\u20B9${fmtC(data.gstBreakup.totalGst)}`],
            ['TOTAL COMMISSION + GST', '', `\u20B9${fmtC(data.gstBreakup.totalCommissionPlusGst)}`],
        ],
        margin: { left: gstTableX, right: margin },
        tableWidth: rightBoxW,
        styles: {
            fontSize: 6.5,
            cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
            lineColor: [200, 200, 200] as any,
            lineWidth: 0.15,
            textColor: black as any,
            overflow: 'linebreak',
        },
        headStyles: {
            fillColor: darkGreen as any,
            textColor: white as any,
            fontStyle: 'bold',
            fontSize: 6,
            halign: 'center',
        },
        columnStyles: {
            0: { halign: 'left', cellWidth: rightBoxW * 0.50 },
            1: { halign: 'center', cellWidth: rightBoxW * 0.20 },
            2: { halign: 'right', cellWidth: rightBoxW * 0.30 },
        },
        didParseCell: (hookData: any) => {
            if (hookData.section === 'body') {
                // TOTAL GST row (index 3)
                if (hookData.row.index === 3) {
                    hookData.cell.styles.fontStyle = 'bold';
                }
                // TOTAL COMMISSION + GST row (index 4) — green highlight
                if (hookData.row.index === 4) {
                    hookData.cell.styles.fillColor = lightGreen;
                    hookData.cell.styles.fontStyle = 'bold';
                    hookData.cell.styles.textColor = darkGreen;
                }
            }
        },
        theme: 'grid',
    });

    const gstTableEndY = (doc as any).lastAutoTable.finalY;
    y = Math.max(section5StartY + payoutBoxH, gstTableEndY) + 8;

    // ═══════════════════════════════════════════════════
    // === 6. COMMISSION AMOUNT IN WORDS ===
    // ═══════════════════════════════════════════════════
    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, y, contentWidth, 16, 2, 2, 'S');

    doc.setTextColor(...darkGreen);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('COMMISSION AMOUNT DUE (DEDUCTED FROM PAYOUT):', margin + 3, y + 5);

    const totalDeduction = mt.totalDeduction;
    const wholeAmount = Math.floor(totalDeduction);
    const paiseAmount = Math.round((totalDeduction - wholeAmount) * 100);
    const amountWords = `${numberToWords(wholeAmount)} Rupees and ${paiseAmount > 0 ? (paiseAmount < 20 ? numberToWords(paiseAmount) : numberToWords(paiseAmount)) : 'Zero'} Paise Only`;

    doc.setTextColor(...black);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const wordLines = doc.splitTextToSize(amountWords, contentWidth - 8);
    doc.text(wordLines, margin + 3, y + 11);

    y += 21;

    // ═══════════════════════════════════════════════════
    // === 7. TERMS & CONDITIONS ===
    // ═══════════════════════════════════════════════════
    doc.setTextColor(...darkGreen);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('TERMS & CONDITIONS', margin, y);

    // Underline
    const tcWidth = doc.getTextWidth('TERMS & CONDITIONS');
    doc.setDrawColor(...medGreen);
    doc.setLineWidth(0.3);
    doc.line(margin, y + 1, margin + tcWidth, y + 1);
    y += 5;

    doc.setTextColor(...gray);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');

    const terms = [
        '1. Commission is calculated on the gross sales value (inclusive of food price + packing charges).',
        '2. GST @ 18% (CGST 9% + SGST 9%) is applicable on the commission amount as per applicable tax laws.',
        '3. The net payout will be transferred to the restaurant\'s registered bank account after deducting the above amounts.',
        '4. Weekly payouts are processed every wednesday for the preceding week\'s sales.',
        '5. Any disputes regarding this invoice must be raised within 7 days of receipt.',
        '6. DELITO reserves the right to adjust future payouts in case of refunds or cancellations.',
    ];

    terms.forEach(term => {
        const termLines = doc.splitTextToSize(term, contentWidth - 4);
        termLines.forEach((line: string) => {
            doc.text(line, margin + 2, y);
            y += 3.2;
        });
    });

    y += 4;

    // ═══════════════════════════════════════════════════
    // === 8. CHECK IF NEW PAGE NEEDED ===
    // ═══════════════════════════════════════════════════
    if (y > 230) {
        doc.addPage();
        y = margin;
    }

    // ═══════════════════════════════════════════════════
    // === 9. PLATFORM FOOTER BLOCK ===
    // ═══════════════════════════════════════════════════
    const footerBlockH = 28;
    doc.setDrawColor(...medGreen);
    doc.setLineWidth(0.4);
    doc.setFillColor(...lightGreen);
    doc.roundedRect(margin, y, contentWidth, footerBlockH, 2, 2, 'FD');

    // Header bar
    doc.setFillColor(...darkGreen);
    doc.roundedRect(margin, y, contentWidth, 7, 2, 2, 'F');
    doc.rect(margin, y + 4, contentWidth, 3, 'F');

    doc.setTextColor(...white);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE ISSUED ON BEHALF OF DELITO PLATFORM', pageWidth / 2, y + 5, { align: 'center' });

    let fy = y + 13;
    doc.setTextColor(...black);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(
        `Delito | GSTIN: ${data.platform.gstin} | FSSAI: ${data.platform.fssaiLicense}`,
        pageWidth / 2, fy, { align: 'center' }
    );
    fy += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    const footerAddr = data.platform.address.replace(/\\n/g, ', ');
    doc.text(footerAddr, pageWidth / 2, fy, { align: 'center' });
    fy += 3.5;
    doc.text(
        `Email: ${data.platform.email} | Web: ${data.platform.website}`,
        pageWidth / 2, fy, { align: 'center' }
    );

    y += footerBlockH + 6;

    // ═══════════════════════════════════════════════════
    // === 10. AUTHORIZED SIGNATORY ===
    // ═══════════════════════════════════════════════════
    const sigBoxH = 18;
    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, y, contentWidth, sigBoxH, 2, 2, 'S');

    // Left side
    doc.setTextColor(...black);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bolditalic');
    doc.text('AUTHORIZED SIGNATORY', margin + 4, y + 8);

    // Right side
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...gray);
    doc.text('Digitally Signed by DELITO', pageWidth - margin - 4, y + 7, { align: 'right' });
    doc.text(`Date: ${data.invoiceDate}`, pageWidth - margin - 4, y + 12, { align: 'right' });

    y += sigBoxH + 6;

    // ═══════════════════════════════════════════════════
    // === 11. FOOTER ===
    // ═══════════════════════════════════════════════════

    // Green separator line
    doc.setDrawColor(...medGreen);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    doc.setTextColor(...gray);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6);

    const footerTexts = [
        'Thank you for choosing DELITO.',
        'This is a computer-generated invoice and does not require a physical signature.',
        'Generated by DELITO on behalf of the Platform. All amounts are in Indian Rupees (\u20B9).',
    ];

    footerTexts.forEach(text => {
        doc.text(text, pageWidth / 2, y, { align: 'center' });
        y += 3.5;
    });

    // ─── OUTPUT ───
    const arrayBuffer = doc.output('arraybuffer');
    return new Uint8Array(arrayBuffer);
}

// ─── CLIENT-SIDE DOWNLOAD HELPER ───

export function downloadCommissionInvoice(data: CommissionInvoiceData): void {
    const pdfBytes = generateCommissionInvoicePDF(data);
    const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const vendorSlug = data.vendor.name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
    const periodSlug = data.billingPeriod.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
    const filename = `Commission-Invoice-${vendorSlug}-${periodSlug}.pdf`;

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();

    // Cleanup
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
