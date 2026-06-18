/* eslint-disable @typescript-eslint/no-explicit-any */
import { CommissionInvoiceData, COMMISSION_PLATFORM } from './invoice-constants';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DELITO_LOGO_BASE64 } from './delito-logo';

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

/** Helper: draw a rounded box with a green header label */
function drawBoxWithHeader(
    doc: jsPDF,
    x: number, y: number, w: number, h: number,
    headerLabel: string,
) {
    const headerH = 7;
    // Outer border
    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, w, h, 2, 2, 'S');
    // Header fill
    doc.setFillColor(...darkGreen);
    doc.roundedRect(x, y, w, headerH, 2, 2, 'F');
    doc.rect(x, y + 4, w, 3, 'F'); // Square off bottom corners
    // Header text
    doc.setTextColor(...white);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(headerLabel, x + 4, y + 5);
}

/** Helper: check if we need a new page */
function ensureSpace(doc: jsPDF, y: number, needed: number, margin: number): number {
    const pageH = doc.internal.pageSize.getHeight();
    if (y + needed > pageH - margin) {
        doc.addPage();
        return margin;
    }
    return y;
}

// ─── MAIN PDF GENERATOR ───

export function generateCommissionInvoicePDF(data: CommissionInvoiceData): Uint8Array {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // ═══════════════════════════════════════════════════
    // === 1. HEADER SECTION ===
    // ═══════════════════════════════════════════════════

    // Logo — actual Delito icon
    try {
        doc.addImage(DELITO_LOGO_BASE64, 'PNG', margin, y, 22, 22);
    } catch {
        // Fallback: green rect with D
        doc.setFillColor(...darkGreen);
        doc.roundedRect(margin, y, 22, 22, 3, 3, 'F');
        doc.setTextColor(...white);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('D', margin + 8, y + 15);
    }

    // Top-right: DELITO branding
    doc.setTextColor(...darkGreen);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('DELITO', pageWidth - margin, y + 8, { align: 'right' });
    doc.setTextColor(...gray);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Powered by Delito', pageWidth - margin, y + 14, { align: 'right' });

    y += 27;

    // "COMMISSION TAX INVOICE" — centered
    doc.setTextColor(...darkGreen);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('COMMISSION TAX INVOICE', pageWidth / 2, y, { align: 'center' });
    y += 5;

    // Billing Period — right-aligned, italic
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...darkGreen);
    doc.text(`Billing Period: ${data.billingPeriod}`, pageWidth - margin, y, { align: 'right' });
    y += 7;

    // ═══════════════════════════════════════════════════
    // === 2. ISSUER & RECIPIENT DETAILS (side by side) ===
    // ═══════════════════════════════════════════════════
    const halfW = (contentWidth - 6) / 2;
    const pad = 4; // inner padding
    const headerH = 7;
    const lineH = 3.5; // line height for detail text

    // Pre-calculate content heights for both boxes
    const issuerAddrLines = doc.splitTextToSize(
        data.platform.address.replace(/\\n/g, '\n'), halfW - pad * 2
    );
    const issuerContentH = headerH + 5 + // header + gap
        5 +  // "DELITO" name
        lineH + // GSTIN
        lineH + // FSSAI
        4 +    // ADDRESS label
        (issuerAddrLines.length * 3) + 1 + // address lines
        lineH + // email
        lineH + // website
        3;     // bottom padding

    const vendorAddrLines = doc.splitTextToSize(
        data.vendor.address.replace(/\\n/g, '\n'), halfW - pad * 2
    );
    const vendorContentH = headerH + 5 + // header + gap
        5 +  // vendor name
        lineH + // GSTIN
        lineH + // FSSAI
        4 +    // ADDRESS label
        (vendorAddrLines.length * 3) + 1 + // address lines
        lineH + // state
        3;     // bottom padding

    const boxH = Math.max(issuerContentH, vendorContentH);
    const boxStartY = y;

    y = ensureSpace(doc, y, boxH + 6, margin);

    // ── Left box: ISSUER (DELITO) ──
    drawBoxWithHeader(doc, margin, boxStartY, halfW, boxH, 'INVOICE ISSUED BY');

    let ly = boxStartY + headerH + 5;
    doc.setTextColor(...black);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('DELITO', margin + pad, ly);
    ly += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    doc.text(`GSTIN: ${data.platform.gstin}`, margin + pad, ly); ly += lineH;
    doc.text(`FSSAI: ${data.platform.fssaiLicense}`, margin + pad, ly); ly += lineH + 0.5;

    doc.setTextColor(...black);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('ADDRESS:', margin + pad, ly); ly += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray);
    issuerAddrLines.forEach((line: string) => { doc.text(line, margin + pad, ly); ly += 3; });
    ly += 1;

    doc.text(`EMAIL: ${data.platform.email}`, margin + pad, ly); ly += lineH;
    doc.text(`WEBSITE: ${data.platform.website}`, margin + pad, ly);

    // ── Right box: RECIPIENT (Vendor) ──
    const rx = margin + halfW + 6;
    drawBoxWithHeader(doc, rx, boxStartY, halfW, boxH, 'INVOICE ISSUED TO');

    let ry = boxStartY + headerH + 5;
    doc.setTextColor(...black);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    // Truncate long vendor names
    const vendorNameLines = doc.splitTextToSize(data.vendor.name, halfW - pad * 2);
    doc.text(vendorNameLines[0], rx + pad, ry);
    ry += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    doc.text(`GSTIN: ${data.vendor.gstin || 'Unregistered'}`, rx + pad, ry); ry += lineH;
    doc.text(`FSSAI: ${data.vendor.fssaiLicense || 'N/A'}`, rx + pad, ry); ry += lineH + 0.5;

    doc.setTextColor(...black);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text('ADDRESS:', rx + pad, ry); ry += 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray);
    vendorAddrLines.forEach((line: string) => { doc.text(line, rx + pad, ry); ry += 3; });
    ry += 1;

    doc.text(`STATE: ${data.vendor.state}`, rx + pad, ry);

    y = boxStartY + boxH + 6;

    // ═══════════════════════════════════════════════════
    // === 3. INVOICE METADATA BAR ===
    // ═══════════════════════════════════════════════════
    y = ensureSpace(doc, y, 20, margin);

    autoTable(doc, {
        startY: y,
        head: [[
            'INVOICE NO', 'DATE', 'HSN CODE',
            'PLACE OF SUPPLY', 'SERVICE TYPE', 'REV. CHARGES',
        ]],
        body: [[
            data.invoiceNumber,
            data.invoiceDate,
            data.hsnCode,
            data.placeOfSupply,
            data.serviceType,
            data.reverseCharges ? 'Yes' : 'No',
        ]],
        margin: { left: margin, right: margin },
        tableWidth: contentWidth,
        styles: {
            fontSize: 6,
            cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
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

    y = (doc as any).lastAutoTable.finalY + 7;

    // ═══════════════════════════════════════════════════
    // === 4. WEEKLY SALES & COMMISSION BREAKDOWN ===
    // ═══════════════════════════════════════════════════
    y = ensureSpace(doc, y, 40, margin);

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
            'TOTAL DEDUCTION (\u20B9)', 'NET PAYOUT (\u20B9)',
        ]],
        body: weeklyRows,
        margin: { left: margin, right: margin },
        tableWidth: contentWidth,
        styles: {
            fontSize: 5.5,
            cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
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
            fontSize: 5,
            halign: 'center',
        },
        columnStyles: {
            0: { halign: 'left', cellWidth: contentWidth * 0.17 },
            1: { halign: 'center', cellWidth: contentWidth * 0.08 },
            2: { halign: 'right', cellWidth: contentWidth * 0.14 },
            3: { halign: 'right', cellWidth: contentWidth * 0.12 },
            4: { halign: 'right', cellWidth: contentWidth * 0.15 },
            5: { halign: 'right', cellWidth: contentWidth * 0.16 },
            6: { halign: 'right', cellWidth: contentWidth * 0.18 },
        },
        didParseCell: (hookData: any) => {
            if (hookData.section === 'body' && hookData.row.index === totalRowIndex) {
                hookData.cell.styles.fillColor = lightGreen;
                hookData.cell.styles.fontStyle = 'bold';
                hookData.cell.styles.textColor = darkGreen;
            }
        },
        theme: 'grid',
    });

    y = (doc as any).lastAutoTable.finalY + 7;

    // ═══════════════════════════════════════════════════
    // === 5. PAYOUT SUMMARY & GST BREAKUP (side by side) ===
    // ═══════════════════════════════════════════════════
    y = ensureSpace(doc, y, 55, margin);

    const leftBoxW = halfW;
    const rightBoxW = halfW;
    const section5StartY = y;

    // ── Left: PAYOUT SUMMARY ──
    // Calculate dynamic height: header(7) + gap(6) + 3 lines(15) + separator(6) + highlight(8) + padding(4) = ~46
    const payoutBoxH = 46;

    drawBoxWithHeader(doc, margin, section5StartY, leftBoxW, payoutBoxH, 'PAYOUT SUMMARY');

    let py = section5StartY + 14;
    doc.setTextColor(...black);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');

    doc.text('Total Gross Sales (Month):', margin + pad, py);
    doc.text(`\u20B9${fmtC(mt.grossSales)}`, margin + leftBoxW - pad, py, { align: 'right' });
    py += 5;

    doc.text('(\u2212) Commission:', margin + pad, py);
    doc.setTextColor(200, 50, 50);
    doc.text(`\u20B9${fmtC(mt.commission)}`, margin + leftBoxW - pad, py, { align: 'right' });
    doc.setTextColor(...black);
    py += 5;

    doc.text('(\u2212) GST on Commission @ 18%:', margin + pad, py);
    doc.setTextColor(200, 50, 50);
    doc.text(`\u20B9${fmtC(mt.gstOnCommission)}`, margin + leftBoxW - pad, py, { align: 'right' });
    doc.setTextColor(...black);
    py += 5;

    // Separator line
    doc.setDrawColor(...medGreen);
    doc.setLineWidth(0.5);
    doc.line(margin + pad, py, margin + leftBoxW - pad, py);
    py += 5;

    // NET PAYOUT highlighted
    doc.setFillColor(...lightGreen);
    doc.rect(margin + 2, py - 3.5, leftBoxW - 4, 7, 'F');
    doc.setTextColor(...darkGreen);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('NET PAYOUT TO RESTAURANT:', margin + pad, py);
    doc.text(`\u20B9${fmtC(mt.netPayout)}`, margin + leftBoxW - pad, py, { align: 'right' });

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
            fontSize: 6,
            cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
            lineColor: [200, 200, 200] as any,
            lineWidth: 0.15,
            textColor: black as any,
            overflow: 'linebreak',
        },
        headStyles: {
            fillColor: darkGreen as any,
            textColor: white as any,
            fontStyle: 'bold',
            fontSize: 5.5,
            halign: 'center',
        },
        columnStyles: {
            0: { halign: 'left', cellWidth: rightBoxW * 0.50 },
            1: { halign: 'center', cellWidth: rightBoxW * 0.20 },
            2: { halign: 'right', cellWidth: rightBoxW * 0.30 },
        },
        didParseCell: (hookData: any) => {
            if (hookData.section === 'body') {
                if (hookData.row.index === 3) {
                    hookData.cell.styles.fontStyle = 'bold';
                }
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
    y = Math.max(section5StartY + payoutBoxH, gstTableEndY) + 7;

    // ═══════════════════════════════════════════════════
    // === 6. COMMISSION AMOUNT IN WORDS ===
    // ═══════════════════════════════════════════════════
    const totalDeduction = mt.totalDeduction;
    const wholeAmount = Math.floor(totalDeduction);
    const paiseAmount = Math.round((totalDeduction - wholeAmount) * 100);
    const amountWords = `${numberToWords(wholeAmount)} Rupees and ${paiseAmount > 0 ? numberToWords(paiseAmount) : 'Zero'} Paise Only`;
    const wordLines = doc.splitTextToSize(amountWords, contentWidth - pad * 2);

    // Dynamic height: label(5) + gap(2) + text lines + bottom padding
    const wordsBoxH = 7 + (wordLines.length * 4) + 3;

    y = ensureSpace(doc, y, wordsBoxH + 5, margin);

    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, y, contentWidth, wordsBoxH, 2, 2, 'S');

    doc.setTextColor(...darkGreen);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text('COMMISSION AMOUNT DUE (DEDUCTED FROM PAYOUT):', margin + pad, y + 5);

    doc.setTextColor(...black);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text(wordLines, margin + pad, y + 10);

    y += wordsBoxH + 5;

    // ═══════════════════════════════════════════════════
    // === 7. TERMS & CONDITIONS ===
    // ═══════════════════════════════════════════════════
    y = ensureSpace(doc, y, 30, margin);

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
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');

    const terms = [
        '1. Commission is calculated on the gross sales value (inclusive of food price + packing charges).',
        '2. GST @ 18% (CGST 9% + SGST 9%) is applicable on the commission amount as per applicable tax laws.',
        '3. The net payout will be transferred to the restaurant\'s registered bank account after deducting the above amounts.',
        '4. Weekly payouts are processed every Wednesday for the preceding week\'s sales.',
        '5. Any disputes regarding this invoice must be raised within 7 days of receipt.',
        '6. DELITO reserves the right to adjust future payouts in case of refunds or cancellations.',
    ];

    terms.forEach(term => {
        const termLines = doc.splitTextToSize(term, contentWidth - pad);
        termLines.forEach((line: string) => {
            doc.text(line, margin + 2, y);
            y += 3;
        });
    });

    y += 4;

    // ═══════════════════════════════════════════════════
    // === 8. PLATFORM FOOTER BLOCK ===
    // ═══════════════════════════════════════════════════
    const footerAddr = data.platform.address.replace(/\\n/g, ', ');
    const footerAddrLines = doc.splitTextToSize(footerAddr, contentWidth - pad * 2);
    const footerBlockH = 7 + 5 + (footerAddrLines.length * 3.5) + 3.5 + 4; // header + info + addr + email + padding

    y = ensureSpace(doc, y, footerBlockH + 6, margin);

    doc.setDrawColor(...medGreen);
    doc.setLineWidth(0.4);
    doc.setFillColor(...lightGreen);
    doc.roundedRect(margin, y, contentWidth, footerBlockH, 2, 2, 'FD');

    // Header bar
    doc.setFillColor(...darkGreen);
    doc.roundedRect(margin, y, contentWidth, 7, 2, 2, 'F');
    doc.rect(margin, y + 4, contentWidth, 3, 'F');

    doc.setTextColor(...white);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE ISSUED ON BEHALF OF DELITO PLATFORM', pageWidth / 2, y + 5, { align: 'center' });

    let fy = y + 12;
    doc.setTextColor(...black);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text(
        `Delito | GSTIN: ${data.platform.gstin} | FSSAI: ${data.platform.fssaiLicense}`,
        pageWidth / 2, fy, { align: 'center' }
    );
    fy += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...gray);
    footerAddrLines.forEach((line: string) => {
        doc.text(line, pageWidth / 2, fy, { align: 'center' });
        fy += 3.5;
    });
    doc.text(
        `Email: ${data.platform.email} | Web: ${data.platform.website}`,
        pageWidth / 2, fy, { align: 'center' }
    );

    y += footerBlockH + 6;

    // ═══════════════════════════════════════════════════
    // === 9. AUTHORIZED SIGNATORY ===
    // ═══════════════════════════════════════════════════
    const sigBoxH = 16;
    y = ensureSpace(doc, y, sigBoxH + 6, margin);

    doc.setDrawColor(...darkGreen);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, y, contentWidth, sigBoxH, 2, 2, 'S');

    // Left side
    doc.setTextColor(...black);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bolditalic');
    doc.text('AUTHORIZED SIGNATORY', margin + pad, y + 7);

    // Right side
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...gray);
    doc.text('Digitally Signed by DELITO', pageWidth - margin - pad, y + 6, { align: 'right' });
    doc.text(`Date: ${data.invoiceDate}`, pageWidth - margin - pad, y + 11, { align: 'right' });

    y += sigBoxH + 5;

    // ═══════════════════════════════════════════════════
    // === 10. FOOTER ===
    // ═══════════════════════════════════════════════════
    y = ensureSpace(doc, y, 18, margin);

    // Green separator line
    doc.setDrawColor(...medGreen);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    doc.setTextColor(...gray);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.5);

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
