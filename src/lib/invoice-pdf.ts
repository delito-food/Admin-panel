/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoiceData } from './invoice-constants';

/**
 * Generate a professional Swiggy/Zomato style invoice PDF.
 * Returns a Buffer that can be streamed as a response.
 */
export function generateInvoicePDF(invoice: InvoiceData): Buffer {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // Colors — Delito brand palette (professional, distinct from Swiggy orange)
    const primaryColor: [number, number, number] = [28, 27, 31];     // #1C1B1F — Deep charcoal (TextPrimary)
    const accentColor: [number, number, number] = [216, 67, 21];     // #D84315 — Warm deep red (HomePrimaryDark)
    const darkColor: [number, number, number] = [33, 33, 33];
    const grayColor: [number, number, number] = [117, 117, 117];     // #757575 — TextSecondary
    const lightGray: [number, number, number] = [249, 249, 249];     // #F9F9F9 — HomeBackground
    const greenColor: [number, number, number] = [76, 175, 80];      // #4CAF50 — SuccessGreen

    // ─── HEADER SECTION ───
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 30, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(invoice.platform.name, margin, 13);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.platform.legalName, margin, 19);
    if (invoice.platform.gstin) {
        doc.text(`GSTIN: ${invoice.platform.gstin}`, margin, 24);
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(invoice.invoiceType, pageWidth - margin, 13, { align: 'right' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Invoice #: ${invoice.invoiceNumber}`, pageWidth - margin, 19, { align: 'right' });
    doc.text(`Date: ${invoice.invoiceDate}`, pageWidth - margin, 24, { align: 'right' });

    y = 36;

    // "On behalf of" line if present
    if (invoice.onBehalfOf) {
        doc.setTextColor(...accentColor);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(invoice.onBehalfOf, margin, y - 2);
        y += 3;
    }

    // ─── ORDER INFO BAR ───
    doc.setFillColor(...lightGray);
    doc.roundedRect(margin, y, contentWidth, 14, 2, 2, 'F');

    doc.setTextColor(...darkColor);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');

    const colW = contentWidth / 4;
    doc.text(`Order: ${invoice.orderId}`, margin + 3, y + 5);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${invoice.orderDate}`, margin + 3, y + 10);
    doc.text(`Time: ${invoice.orderTime}`, margin + colW, y + 5);
    doc.text(`Payment: ${invoice.paymentMode}`, margin + colW, y + 10);

    const statusClr = invoice.orderStatus === 'Delivered' ? greenColor : accentColor;
    doc.setTextColor(...statusClr);
    doc.setFont('helvetica', 'bold');
    doc.text(`Status: ${invoice.orderStatus}`, pageWidth - margin - 3, y + 5, { align: 'right' });
    doc.setTextColor(...darkColor);
    doc.setFont('helvetica', 'normal');
    doc.text(`Pay: ${invoice.paymentStatus}`, pageWidth - margin - 3, y + 10, { align: 'right' });

    y += 19;

    // ─── CUSTOMER & VENDOR DETAILS (side by side) ───
    const halfW = (contentWidth - 5) / 2;

    // Customer box
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(margin, y, halfW, 28, 2, 2, 'S');
    doc.setFontSize(6);
    doc.setTextColor(...accentColor);
    doc.setFont('helvetica', 'bold');
    doc.text('BILL TO (Customer)', margin + 3, y + 5);
    doc.setTextColor(...darkColor);
    doc.setFontSize(8);
    const custName = doc.splitTextToSize(invoice.customer.name || 'Customer', halfW - 6);
    doc.text(custName[0], margin + 3, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...grayColor);
    if (invoice.customer.phone) doc.text(`Ph: ${invoice.customer.phone}`, margin + 3, y + 15);
    const custAddr = invoice.customer.deliveryAddress || '';
    if (custAddr) {
        const addrLines = doc.splitTextToSize(custAddr, halfW - 6);
        doc.text(addrLines.slice(0, 3), margin + 3, y + 19);
    }

    // Vendor box
    const vx = margin + halfW + 5;
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(vx, y, halfW, 28, 2, 2, 'S');
    doc.setFontSize(6);
    doc.setTextColor(...accentColor);
    doc.setFont('helvetica', 'bold');
    const suppliedByLabel = invoice.invoiceSubType === 'delivery' ? 'SUPPLIED BY (Delivery Partner)'
        : invoice.invoiceSubType === 'platform' ? 'SUPPLIED BY (Platform)'
        : 'SUPPLIED BY (Restaurant)';
    doc.text(suppliedByLabel, vx + 3, y + 5);
    doc.setTextColor(...darkColor);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const vendName = doc.splitTextToSize(invoice.vendor.name || 'Restaurant', halfW - 6);
    doc.text(vendName[0], vx + 3, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...grayColor);
    let vendorInfoY = y + 15;
    if (invoice.vendor.address) {
        const va = doc.splitTextToSize(`${invoice.vendor.address}${invoice.vendor.city ? ', ' + invoice.vendor.city : ''}`, halfW - 6);
        doc.text(va.slice(0, 1), vx + 3, vendorInfoY); vendorInfoY += 3.5;
    }
    if (invoice.vendor.gstin) { doc.text(`GSTIN: ${invoice.vendor.gstin}`, vx + 3, vendorInfoY); vendorInfoY += 3.5; }
    else { doc.text('GSTIN: Unregistered', vx + 3, vendorInfoY); vendorInfoY += 3.5; }
    if (invoice.vendor.fssaiLicense) { doc.text(`FSSAI: ${invoice.vendor.fssaiLicense}`, vx + 3, vendorInfoY); }

    y += 33;

    // ─── ITEMS TABLE (fixed overflow with proper widths) ───
    doc.setTextColor(...accentColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Item Details', margin, y);
    y += 2;

    const tableRows = invoice.items.map(item => [
        String(item.slNo),
        item.name,
        item.hsnCode || '',
        String(item.quantity),
        fmtC(item.unitPrice),
        fmtC(item.discount),
        fmtC(item.taxableValue),
        `${fmtC(item.cgstAmount)} (${item.cgstRate}%)`,
        `${fmtC(item.sgstAmount)} (${item.sgstRate}%)`,
        fmtC(item.totalAmount),
    ]);

    autoTable(doc, {
        startY: y,
        head: [['#', 'Item', 'HSN', 'Qty', 'Rate', 'Disc', 'Taxable', 'CGST', 'SGST', 'Total']],
        body: tableRows,
        margin: { left: margin, right: margin },
        tableWidth: contentWidth,
        styles: {
            fontSize: 6,
            cellPadding: { top: 2, right: 1.5, bottom: 2, left: 1.5 },
            lineColor: [220, 220, 220] as any,
            lineWidth: 0.15,
            textColor: darkColor,
            overflow: 'linebreak',
            minCellHeight: 6,
        },
        headStyles: {
            fillColor: primaryColor,
            textColor: [255, 255, 255] as any,
            fontStyle: 'bold',
            fontSize: 6,
            halign: 'center',
            cellPadding: { top: 2, right: 1, bottom: 2, left: 1 },
        },
        columnStyles: {
            0: { halign: 'center', cellWidth: 7 },
            1: { cellWidth: contentWidth * 0.19, overflow: 'linebreak' },
            2: { halign: 'center', cellWidth: contentWidth * 0.08 },
            3: { halign: 'center', cellWidth: 10 },
            4: { halign: 'right', cellWidth: contentWidth * 0.09 },
            5: { halign: 'right', cellWidth: contentWidth * 0.08 },
            6: { halign: 'right', cellWidth: contentWidth * 0.10 },
            7: { halign: 'right', cellWidth: contentWidth * 0.12 },
            8: { halign: 'right', cellWidth: contentWidth * 0.12 },
            9: { halign: 'right', cellWidth: contentWidth * 0.10 },
        },
        alternateRowStyles: { fillColor: [250, 250, 250] as any },
        theme: 'grid',
    });

    y = (doc as any).lastAutoTable.finalY + 5;

    // ─── TAX SUMMARY TABLE ───
    if (invoice.taxSummary.length > 0) {
        doc.setTextColor(...accentColor);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Tax Summary', margin, y);
        y += 2;

        const taxRows = invoice.taxSummary.map(row => [
            row.description,
            row.hsnCode || '',
            fmtC(row.taxableAmount),
            `${row.cgstRate}%`,
            fmtC(row.cgstAmount),
            `${row.sgstRate}%`,
            fmtC(row.sgstAmount),
            fmtC(row.totalTax),
        ]);

        autoTable(doc, {
            startY: y,
            head: [['Description', 'HSN', 'Taxable Amt', 'CGST%', 'CGST', 'SGST%', 'SGST', 'Total Tax']],
            body: taxRows,
            margin: { left: margin, right: margin },
            tableWidth: contentWidth,
            styles: {
                fontSize: 6,
                cellPadding: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
                lineColor: [220, 220, 220] as any,
                lineWidth: 0.15,
                textColor: darkColor,
                overflow: 'linebreak',
            },
            headStyles: {
                fillColor: [80, 80, 80] as any,
                textColor: [255, 255, 255] as any,
                fontStyle: 'bold',
                fontSize: 6,
                halign: 'center',
            },
            columnStyles: {
                0: { cellWidth: contentWidth * 0.22, overflow: 'linebreak' },
                1: { halign: 'center', cellWidth: contentWidth * 0.08 },
                2: { halign: 'right', cellWidth: contentWidth * 0.12 },
                3: { halign: 'center', cellWidth: contentWidth * 0.08 },
                4: { halign: 'right', cellWidth: contentWidth * 0.11 },
                5: { halign: 'center', cellWidth: contentWidth * 0.08 },
                6: { halign: 'right', cellWidth: contentWidth * 0.11 },
                7: { halign: 'right', cellWidth: contentWidth * 0.12 },
            },
            theme: 'grid',
        });

        y = (doc as any).lastAutoTable.finalY + 5;
    }

    // ─── BILL SUMMARY (right-aligned box, dynamic height) ───
    const summaryWidth = 72;
    const summaryX = pageWidth - margin - summaryWidth;

    const bill = invoice.billSummary;
    // Count only non-zero lines
    let lineCount = 0;
    if (bill.itemTotal > 0) lineCount++;
    if (bill.discount > 0) lineCount++;
    if (bill.deliveryFee > 0) lineCount++;
    if (bill.packagingFee > 0) lineCount++;
    if (bill.tip > 0) lineCount++;
    if (bill.coinDiscount > 0) lineCount++;
    if (bill.promoDiscount > 0) lineCount++;
    lineCount += 2; // CGST + SGST always shown
    if (bill.roundOff !== 0) lineCount++; // Round off line
    const boxH = 16 + lineCount * 4.5 + 10;

    doc.setFillColor(...lightGray);
    doc.roundedRect(summaryX, y, summaryWidth, boxH, 2, 2, 'F');
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(summaryX, y, summaryWidth, boxH, 2, 2, 'S');

    doc.setTextColor(...accentColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('BILL SUMMARY', summaryX + 3, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...darkColor);

    let sy = y + 10;
    const addLine = (label: string, amount: number, isNeg = false, isBold = false) => {
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setFontSize(isBold ? 7 : 6);
        const maxLabelW = summaryWidth - 28;
        const truncLabel = doc.splitTextToSize(label, maxLabelW)[0];
        doc.text(truncLabel, summaryX + 3, sy);
        const pfx = isNeg && amount > 0 ? '-' : '';
        const clr = isNeg ? greenColor : darkColor;
        doc.setTextColor(...clr);
        doc.text(`${pfx}Rs.${fmtC(amount)}`, summaryX + summaryWidth - 3, sy, { align: 'right' });
        doc.setTextColor(...darkColor);
        sy += 4.5;
    };

    if (bill.itemTotal > 0) addLine('Item Total', bill.itemTotal);
    if (bill.discount > 0) addLine('Discount', bill.discount, true);
    if (bill.deliveryFee > 0) addLine('Delivery Fee', bill.deliveryFee);
    if (bill.packagingFee > 0) addLine('Platform Fee', bill.packagingFee);
    if (bill.tip > 0) addLine('Tip', bill.tip);
    if (bill.coinDiscount > 0) addLine('Coin Disc.', bill.coinDiscount, true);
    if (bill.promoDiscount > 0) addLine('Promo Disc.', bill.promoDiscount, true);
    addLine('CGST', bill.cgst);
    addLine('SGST', bill.sgst);
    if (bill.roundOff !== 0) {
        // Show round off as a line: positive = add, negative = subtract
        if (bill.roundOff > 0) {
            addLine('Round Off', bill.roundOff);
        } else {
            addLine('Round Off', Math.abs(bill.roundOff), true);
        }
    }

    // Separator
    doc.setDrawColor(...accentColor);
    doc.setLineWidth(0.4);
    doc.line(summaryX + 3, sy, summaryX + summaryWidth - 3, sy);
    sy += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...accentColor);
    doc.text('TOTAL', summaryX + 3, sy);
    doc.text(`Rs.${fmtC(bill.grandTotal)}`, summaryX + summaryWidth - 3, sy, { align: 'right' });

    // ─── AMOUNT IN WORDS + PAYMENT (left side) ───
    const wordsY = y;
    const wordsW = summaryX - margin - 4;

    doc.setTextColor(...darkColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('Amount in Words:', margin, wordsY + 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...grayColor);
    const words = numberToWords(Math.round(bill.grandTotal));
    const wordLines = doc.splitTextToSize(`Indian Rupees ${words} Only`, wordsW);
    doc.text(wordLines.slice(0, 2), margin, wordsY + 10);

    doc.setTextColor(...darkColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('Payment:', margin, wordsY + 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...grayColor);
    doc.text(`Mode: ${invoice.paymentMode}  |  Status: ${invoice.paymentStatus}`, margin, wordsY + 27);
    if (invoice.transactionId) {
        doc.text(`Txn ID: ${invoice.transactionId}`, margin, wordsY + 32);
    }

    y = Math.max(sy + 8, wordsY + 38);

    // ─── FOOTER ───
    if (y > 255) { doc.addPage(); y = margin; }

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;

    doc.setTextColor(...grayColor);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.5);
    const decl = [
        'This is a computer-generated invoice and does not require a physical signature.',
        invoice.onBehalfOf || `Generated by ${invoice.platform.name}. Disputes subject to Hathras, UP courts.`,
        `Queries: ${invoice.platform.email}`,
    ];
    decl.forEach(l => { doc.text(l, margin, y); y += 3; });

    // Footer bar
    doc.setFillColor(...primaryColor);
    doc.rect(0, doc.internal.pageSize.getHeight() - 10, pageWidth, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.text(
        `${invoice.platform.name} | ${invoice.platform.legalName} | ${invoice.platform.email}`,
        pageWidth / 2, doc.internal.pageSize.getHeight() - 4, { align: 'center' }
    );

    const arrayBuffer = doc.output('arraybuffer');
    return Buffer.from(arrayBuffer);
}

/** Plain currency format */
function fmtC(n: number): string { return n.toFixed(2); }

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

















