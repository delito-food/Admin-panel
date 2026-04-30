/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
    PLATFORM,
    GST_RATES,
    HSN_CODES,
    generateInvoiceNumber,
    type InvoiceData,
    type InvoiceItem,
    type TaxSummaryRow,
} from '@/lib/invoice-constants';
import { generateInvoicePDF } from '@/lib/invoice-pdf';
import { verifyApiAuth, unauthorizedResponse, checkRateLimit, rateLimitedResponse } from '@/lib/api-auth';

// Helper: parse Firestore timestamp to ISO string
function tsToIso(v: any): string | null {
    if (!v) return null;
    if (v?.toDate) return v.toDate().toISOString();
    if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Build InvoiceData from an order document
 */
async function buildInvoiceData(orderId: string): Promise<InvoiceData> {
    // 1. Fetch order
    const orderDoc = await db.collection(collections.orders).doc(orderId).get();
    if (!orderDoc.exists) {
        throw new Error('Order not found');
    }
    const order = orderDoc.data()!;

    // 2. Fetch vendor details
    let vendor: any = {};
    if (order.vendorId) {
        const allVendors = await cachedCollection(collections.vendors);
        const v = allVendors.find(vd => vd.id === order.vendorId);
        if (v) vendor = v;
    }

    // 3. Get or create invoice number
    let invoiceNumber: string;
    const invoiceMetaRef = db.collection('invoices').doc(orderId);
    const invoiceMeta = await invoiceMetaRef.get();

    if (invoiceMeta.exists && invoiceMeta.data()?.invoiceNumber) {
        invoiceNumber = invoiceMeta.data()!.invoiceNumber as string;
    } else {
        // Atomic counter increment
        const counterRef = db.collection('counters').doc('invoices');
        const counterDoc = await counterRef.get();

        if (!counterDoc.exists) {
            await counterRef.set({ lastNumber: 1 });
            invoiceNumber = generateInvoiceNumber(1);
        } else {
            await counterRef.update({ lastNumber: FieldValue.increment(1) });
            const updated = await counterRef.get();
            const counter = updated.data()?.lastNumber || 1;
            invoiceNumber = generateInvoiceNumber(counter as number);
        }

        // Save invoice metadata
        await invoiceMetaRef.set({
            invoiceNumber,
            orderId,
            vendorId: order.vendorId || '',
            customerId: order.customerId || '',
            total: order.total || 0,
            createdAt: new Date().toISOString(),
        });
    }

    // 4. Build item-wise tax breakdown
    //
    // IMPORTANT: In this system, item prices from the vendor are TAX-EXCLUSIVE.
    // The mobile app (PricingCalculator.kt) computes GST separately and adds it on top:
    //   gstOnFood = itemTotal × 5%
    //   total = itemTotal + deliveryFee + totalGst
    // So item.price IS the taxable value — do NOT divide by 1.05.
    //
    const items: InvoiceItem[] = (order.items || []).map((item: any, index: number) => {
        const unitPrice = item.price || 0;
        const quantity = item.quantity || 1;
        const originalPrice = item.originalPrice || unitPrice;
        const effectivePrice = (item.discountedPrice != null && item.discountedPrice < originalPrice)
            ? item.discountedPrice : unitPrice;

        const lineTotal = effectivePrice * quantity;
        const itemDiscount = (originalPrice - effectivePrice) * quantity;

        // Price is already tax-exclusive — taxableValue = lineTotal directly
        const taxableValue = roundTo2(lineTotal);
        const cgstAmount = roundTo2(taxableValue * GST_RATES.CGST / 100);
        const sgstAmount = roundTo2(taxableValue * GST_RATES.SGST / 100);

        return {
            slNo: index + 1,
            name: item.name || 'Item',
            hsnCode: HSN_CODES.FOOD,
            quantity,
            unitPrice: effectivePrice,
            discount: roundTo2(itemDiscount),
            taxableValue,
            cgstRate: GST_RATES.CGST,
            cgstAmount,
            sgstRate: GST_RATES.SGST,
            sgstAmount,
            totalAmount: roundTo2(taxableValue + cgstAmount + sgstAmount),
        };
    });

    // 5. Bill summary — extract order-level amounts
    const discount = order.discount || 0;
    const deliveryFee = order.deliveryFee || 0;     // tax-exclusive
    const packagingFee = order.smallOrderSupportFee || 0;  // tax-exclusive
    const tip = order.tip || 0;
    const coinDiscount = order.coinDiscount || 0;
    const promoDiscount = order.promoDiscount || 0;
    const total = order.total || 0;

    // Tax breakdown — prices are already tax-exclusive, compute tax on top
    const foodTaxableAmount = roundTo2(items.reduce((sum, i) => sum + i.taxableValue, 0));
    const foodCgst = roundTo2(items.reduce((sum, i) => sum + i.cgstAmount, 0));
    const foodSgst = roundTo2(items.reduce((sum, i) => sum + i.sgstAmount, 0));

    // Delivery fee is tax-exclusive; GST (18%) is added on top
    const deliveryTaxable = roundTo2(deliveryFee);
    const deliveryCgst = deliveryFee > 0 ? roundTo2(deliveryTaxable * 0.09) : 0;
    const deliverySgst = deliveryFee > 0 ? roundTo2(deliveryTaxable * 0.09) : 0;

    // Tax summary rows
    const taxSummary: TaxSummaryRow[] = [
        {
            description: 'Food Items (Restaurant Service)',
            hsnCode: HSN_CODES.FOOD,
            taxableAmount: foodTaxableAmount,
            cgstRate: GST_RATES.CGST,
            cgstAmount: foodCgst,
            sgstRate: GST_RATES.SGST,
            sgstAmount: foodSgst,
            totalTax: roundTo2(foodCgst + foodSgst),
        },
    ];

    if (deliveryFee > 0) {
        taxSummary.push({
            description: 'Delivery Charges',
            hsnCode: HSN_CODES.DELIVERY,
            taxableAmount: deliveryTaxable,
            cgstRate: 9,
            cgstAmount: deliveryCgst,
            sgstRate: 9,
            sgstAmount: deliverySgst,
            totalTax: roundTo2(deliveryCgst + deliverySgst),
        });
    }

    // Platform fee is tax-exclusive; GST (18%) is added on top
    const platformTaxable = roundTo2(packagingFee);
    const platformCgst = packagingFee > 0 ? roundTo2(platformTaxable * 0.09) : 0;
    const platformSgst = packagingFee > 0 ? roundTo2(platformTaxable * 0.09) : 0;

    if (packagingFee > 0) {
        taxSummary.push({
            description: 'Platform / Convenience Fee',
            hsnCode: HSN_CODES.PLATFORM,
            taxableAmount: platformTaxable,
            cgstRate: 9,
            cgstAmount: platformCgst,
            sgstRate: 9,
            sgstAmount: platformSgst,
            totalTax: roundTo2(platformCgst + platformSgst),
        });
    }

    // Aggregate all taxes
    const allCgst = roundTo2(foodCgst + deliveryCgst + platformCgst);
    const allSgst = roundTo2(foodSgst + deliverySgst + platformSgst);
    const allTax = roundTo2(allCgst + allSgst);
    const allTaxable = roundTo2(foodTaxableAmount + deliveryTaxable + platformTaxable);

    // Use stored GST values from the order when available so the invoice matches
    // the exact amounts the customer was charged by the app (PricingCalculator uses
    // 1-decimal rounding; per-item breakdown above uses 2-decimal for tax tables).
    // order.gstOnFood = 5% of itemTotal, order.gstOnServices = 18% of (delivery + platform)
    const storedGstOnFood = order.gstOnFood || 0;
    const storedGstOnServices = order.gstOnServices || 0;
    const storedTotalGst = order.taxes || roundTo2(storedGstOnFood + storedGstOnServices);

    // For bill summary, split stored GST evenly into CGST/SGST
    const billCgst = roundTo2(storedTotalGst / 2);
    const billSgst = roundTo2(storedTotalGst - billCgst); // ensures no rounding loss

    const roundOff = 0;

    // 6. Format dates
    const orderCreatedAt = tsToIso(order.createdAt) || new Date().toISOString();
    const orderDateObj = new Date(orderCreatedAt);

    const vendorName = order.vendorName || vendor.shopName || vendor.fullName || 'Restaurant';

    const invoiceData: InvoiceData = {
        invoiceNumber,
        invoiceDate: formatDate(new Date()),
        invoiceType: (vendor.gstin || PLATFORM.gstin) ? 'Tax Invoice' : 'Bill of Supply',
        invoiceSubType: 'food',
        onBehalfOf: `Raised by ${PLATFORM.name} on behalf of ${vendorName}`,

        orderId: orderId.length > 12 ? orderId.slice(-12).toUpperCase() : orderId.toUpperCase(),
        orderDate: formatDate(orderDateObj),
        orderTime: formatTime(orderDateObj),
        paymentMode: order.paymentMode || 'Cash on Delivery',
        paymentStatus: order.paymentStatus || 'Pending',
        transactionId: order.transactionId || order.paymentId || undefined,

        customer: {
            name: order.customerName || 'Customer',
            phone: order.customerPhone || '',
            deliveryAddress: order.deliveryAddress || '',
        },

        vendor: {
            name: order.vendorName || vendor.shopName || vendor.fullName || 'Restaurant',
            address: vendor.address || vendor.shopAddress || '',
            city: vendor.city || '',
            gstin: vendor.gstNumber || '',
            fssaiLicense: vendor.fssaiLicense || '',
            phone: vendor.phoneNumber || vendor.phone || '',
        },

        items,

        billSummary: {
            itemTotal: roundTo2(foodTaxableAmount),
            discount: roundTo2(discount),
            deliveryFee: roundTo2(deliveryTaxable),
            packagingFee: roundTo2(platformTaxable),
            tip: roundTo2(tip),
            coinDiscount: roundTo2(coinDiscount),
            promoDiscount: roundTo2(promoDiscount),
            taxableAmount: allTaxable,
            cgst: billCgst,
            sgst: billSgst,
            totalTax: roundTo2(billCgst + billSgst),
            roundOff,
            grandTotal: roundTo2(total),
        },

        taxSummary,
        platform: PLATFORM,
        orderStatus: order.status || 'Unknown',
    };

    return invoiceData;
}

/**
 * Build a specific type of invoice from order data.
 * type: 'food' (on behalf of vendor), 'delivery' (on behalf of delivery person), 'platform' (by Delito)
 */
async function buildTypedInvoice(orderId: string, type: 'food' | 'delivery' | 'platform'): Promise<InvoiceData> {
    const base = await buildInvoiceData(orderId);

    // Fetch order once for stored GST values + delivery person name
    const orderDoc = await db.collection(collections.orders).doc(orderId).get();
    const order = orderDoc.data() || {};

    let dpName = 'Delivery Partner';
    let dpGstin = '';
    let dpPhone = '';
    if (type === 'delivery' && order.deliveryPersonId) {
        const allDPs = await cachedCollection(collections.deliveryPersons);
        const dp = allDPs.find(d => d.id === order.deliveryPersonId);
        if (dp) {
            dpName = (dp.fullName as string) || 'Delivery Partner';
            dpGstin = (dp.gstNumber as string) || (dp.gstin as string) || '';
            dpPhone = (dp.phoneNumber as string) || (dp.phone as string) || '';
        }
    }

    // Stored GST values from the app (PricingCalculator uses 1-decimal rounding)
    const storedGstOnFood = order.gstOnFood || 0;
    const storedGstOnServices = order.gstOnServices || 0;

    const suffixMap = { food: 'F', delivery: 'D', platform: 'P' };
    const invoiceNum = `${base.invoiceNumber}-${suffixMap[type]}`;

    if (type === 'food') {
        // Food invoice: only food items, on behalf of vendor
        const foodItemTotal = roundTo2(base.items.reduce((s, i) => s + i.taxableValue, 0));
        // Use per-item 2-decimal breakdown for tax summary table
        const foodCgstDetailed = roundTo2(base.items.reduce((s, i) => s + i.cgstAmount, 0));
        const foodSgstDetailed = roundTo2(base.items.reduce((s, i) => s + i.sgstAmount, 0));
        // For bill summary, use the stored gstOnFood from the order (matches app's 1-decimal)
        // This is stored on the base.billSummary through the parent buildInvoiceData
        // base already has billCgst/billSgst from stored values, but those include services GST too.
        // We need just the food GST portion. Fetch from order.
        const orderDoc = await db.collection(collections.orders).doc(orderId).get();
        const orderData = orderDoc.data() || {};
        const storedFoodGst = orderData.gstOnFood || roundTo2(foodCgstDetailed + foodSgstDetailed);
        const foodBillCgst = roundTo2(storedFoodGst / 2);
        const foodBillSgst = roundTo2(storedFoodGst - foodBillCgst);
        const foodTotalTax = roundTo2(foodBillCgst + foodBillSgst);
        const foodGross = roundTo2(foodItemTotal + foodTotalTax);
        const foodDiscount = base.billSummary.discount + base.billSummary.coinDiscount + base.billSummary.promoDiscount;
        const foodGrand = Math.max(0, roundTo2(foodGross - foodDiscount));

        return {
            ...base,
            invoiceNumber: invoiceNum,
            invoiceSubType: 'food',
            onBehalfOf: `Raised by ${PLATFORM.name} on behalf of ${base.vendor.name}`,
            items: base.items,
            taxSummary: base.taxSummary.filter(t => t.hsnCode === HSN_CODES.FOOD),
            billSummary: {
                itemTotal: foodItemTotal,
                discount: roundTo2(base.billSummary.discount),
                deliveryFee: 0,
                packagingFee: 0,
                tip: 0,
                coinDiscount: roundTo2(base.billSummary.coinDiscount),
                promoDiscount: roundTo2(base.billSummary.promoDiscount),
                taxableAmount: foodItemTotal,
                cgst: foodBillCgst,
                sgst: foodBillSgst,
                totalTax: foodTotalTax,
                roundOff: 0,
                grandTotal: foodGrand,
            },
        };
    }

    if (type === 'delivery') {
        // Delivery invoice: delivery fee only, on behalf of delivery person
        // base.billSummary.deliveryFee is the tax-exclusive delivery fee from the order
        const deliveryTaxable = base.billSummary.deliveryFee;
        // Use stored gstOnServices for the delivery portion
        // gstOnServices = 18% of (deliveryFee + platformFee)
        // Delivery's share = gstOnServices × deliveryFee / (deliveryFee + platformFee)
        const orderDoc2 = await db.collection(collections.orders).doc(orderId).get();
        const orderData2 = orderDoc2.data() || {};
        const storedGstOnServices = orderData2.gstOnServices || 0;
        const totalServiceBase = deliveryTaxable + base.billSummary.packagingFee;
        const deliveryGstShare = totalServiceBase > 0
            ? roundTo2(storedGstOnServices * deliveryTaxable / totalServiceBase)
            : roundTo2(deliveryTaxable * 0.18);
        const dCgst = roundTo2(deliveryGstShare / 2);
        const dSgst = roundTo2(deliveryGstShare - dCgst);
        const dTotalTax = roundTo2(dCgst + dSgst);
        const tipAmount = base.billSummary.tip;
        // Grand total = delivery fee + delivery GST + tip
        const dGrand = roundTo2(deliveryTaxable + dTotalTax + tipAmount);

        return {
            ...base,
            invoiceNumber: invoiceNum,
            invoiceSubType: 'delivery',
            onBehalfOf: `Raised by ${PLATFORM.name} on behalf of ${dpName}`,
            vendor: {
                name: dpName,
                address: '',
                city: '',
                gstin: dpGstin, // empty string means Unregistered — shown in UI
                fssaiLicense: '',
                phone: dpPhone,
            },
            items: deliveryTaxable > 0 ? [{
                slNo: 1,
                name: 'Delivery Charges',
                hsnCode: HSN_CODES.DELIVERY,
                quantity: 1,
                unitPrice: deliveryTaxable,
                discount: 0,
                taxableValue: deliveryTaxable,
                cgstRate: 9,
                cgstAmount: dCgst,
                sgstRate: 9,
                sgstAmount: dSgst,
                totalAmount: roundTo2(deliveryTaxable + dCgst + dSgst),
            }] : [],
            taxSummary: deliveryTaxable > 0 ? [{
                description: 'Delivery Charges',
                hsnCode: HSN_CODES.DELIVERY,
                taxableAmount: deliveryTaxable,
                cgstRate: 9,
                cgstAmount: dCgst,
                sgstRate: 9,
                sgstAmount: dSgst,
                totalTax: dTotalTax,
            }] : [],
            billSummary: {
                itemTotal: deliveryTaxable,
                discount: 0,
                deliveryFee: 0,
                packagingFee: 0,
                tip: tipAmount,
                coinDiscount: 0,
                promoDiscount: 0,
                taxableAmount: deliveryTaxable,
                cgst: dCgst,
                sgst: dSgst,
                totalTax: dTotalTax,
                roundOff: 0,
                grandTotal: dGrand,
            },
        };
    }

    // Platform fee invoice: by Delito itself
    // base.billSummary.packagingFee is the tax-exclusive platform fee from the order
    const pfTaxable = base.billSummary.packagingFee;
    // Use stored gstOnServices for the platform portion
    const orderDoc3 = await db.collection(collections.orders).doc(orderId).get();
    const orderData3 = orderDoc3.data() || {};
    const storedGstOnServices3 = orderData3.gstOnServices || 0;
    const totalServiceBase3 = base.billSummary.deliveryFee + pfTaxable;
    const platformGstShare = totalServiceBase3 > 0
        ? roundTo2(storedGstOnServices3 * pfTaxable / totalServiceBase3)
        : roundTo2(pfTaxable * 0.18);
    const pfCgst = roundTo2(platformGstShare / 2);
    const pfSgst = roundTo2(platformGstShare - pfCgst);
    const pfTotalTax = roundTo2(pfCgst + pfSgst);
    const pfGrand = roundTo2(pfTaxable + pfTotalTax);

    return {
        ...base,
        invoiceNumber: invoiceNum,
        invoiceSubType: 'platform',
        onBehalfOf: `Raised by ${PLATFORM.name} (${PLATFORM.legalName})`,
        items: pfTaxable > 0 ? [{
            slNo: 1,
            name: 'Platform / Convenience Fee',
            hsnCode: HSN_CODES.PLATFORM,
            quantity: 1,
            unitPrice: pfTaxable,
            discount: 0,
            taxableValue: pfTaxable,
            cgstRate: 9,
            cgstAmount: pfCgst,
            sgstRate: 9,
            sgstAmount: pfSgst,
            totalAmount: roundTo2(pfTaxable + pfCgst + pfSgst),
        }] : [],
        taxSummary: pfTaxable > 0 ? [{
            description: 'Platform / Convenience Fee',
            hsnCode: HSN_CODES.PLATFORM,
            taxableAmount: pfTaxable,
            cgstRate: 9,
            cgstAmount: pfCgst,
            sgstRate: 9,
            sgstAmount: pfSgst,
            totalTax: pfTotalTax,
        }] : [],
        billSummary: {
            itemTotal: pfTaxable,
            discount: 0,
            deliveryFee: 0,
            packagingFee: 0,
            tip: 0,
            coinDiscount: 0,
            promoDiscount: 0,
            taxableAmount: pfTaxable,
            cgst: pfCgst,
            sgst: pfSgst,
            totalTax: pfTotalTax,
            roundOff: 0,
            grandTotal: pfGrand,
        },
    };
}

/**
 * GET /api/invoices/[orderId]
 * Query params:
 *   format=pdf|json (default json)
 *   type=food|delivery|platform (specific invoice type; omit for combined)
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ orderId: string }> }
) {
    try {
        // Auth check
        const authResult = await verifyApiAuth(request);
        if (!authResult.authenticated) {
            return unauthorizedResponse(authResult.error);
        }

        // Rate limit
        const rl = checkRateLimit(`invoices:${authResult.uid}`, 30, 60_000);
        if (!rl.allowed) return rateLimitedResponse();

        const { orderId } = await params;
        const { searchParams } = new URL(request.url);
        const format = searchParams.get('format');
        const type = searchParams.get('type') as 'food' | 'delivery' | 'platform' | null;

        if (!orderId) {
            return NextResponse.json(
                { success: false, error: 'Order ID is required' },
                { status: 400 }
            );
        }

        // If a specific type is requested, build that specific invoice
        if (type && ['food', 'delivery', 'platform'].includes(type)) {
            const invoiceData = await buildTypedInvoice(orderId, type);

            // Guard: don't generate a blank invoice when the respective fee is 0
            if (invoiceData.items.length === 0 && invoiceData.billSummary.grandTotal === 0) {
                const typeLabels: Record<string, string> = {
                    food: 'food items',
                    delivery: 'delivery fee',
                    platform: 'platform/convenience fee',
                };
                return NextResponse.json(
                    {
                        success: false,
                        error: `No ${typeLabels[type] || type} was charged for this order. ${type.charAt(0).toUpperCase() + type.slice(1)} invoice is not applicable.`,
                    },
                    { status: 400 }
                );
            }

            if (format === 'pdf') {
                const pdfBuffer = generateInvoicePDF(invoiceData);
                const typeLabels = { food: 'Food', delivery: 'Delivery', platform: 'Platform' };
                return new Response(new Uint8Array(pdfBuffer), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/pdf',
                        'Content-Disposition': `attachment; filename="Invoice-${invoiceData.invoiceNumber}-${typeLabels[type]}.pdf"`,
                        'Content-Length': pdfBuffer.length.toString(),
                    },
                });
            }

            return NextResponse.json({ success: true, data: invoiceData });
        }

        // No type specified: return the combined invoice (legacy behavior)
        const invoiceData = await buildInvoiceData(orderId);

        if (format === 'pdf') {
            const pdfBuffer = generateInvoicePDF(invoiceData);

            return new Response(new Uint8Array(pdfBuffer), {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="Invoice-${invoiceData.invoiceNumber}.pdf"`,
                    'Content-Length': pdfBuffer.length.toString(),
                },
            });
        }

        return NextResponse.json({
            success: true,
            data: invoiceData,
        });
    } catch (error: any) {
        console.error('Invoice generation error:', error);
        const message = error?.message || 'Failed to generate invoice';
        const status = message === 'Order not found' ? 404 : 500;
        return NextResponse.json(
            { success: false, error: message },
            { status }
        );
    }
}

// ── Helpers ──

function roundTo2(n: number): number {
    return Math.round(n * 100) / 100;
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}












