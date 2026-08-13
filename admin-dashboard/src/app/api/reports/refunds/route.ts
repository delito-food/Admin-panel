import { NextResponse } from 'next/server';
import { collections, cachedCollection } from '@/lib/firebase-admin';
import { getInvoiceNumberMap, invoiceNumberFor } from '@/lib/invoice-lookup';
import { reportResponse, platformMeta, formatDay } from '@/lib/report-export';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const statusFilter = searchParams.get('status'); // 'all' | 'refunded' | 'cancelled'

        // Get all vendors for lookup
        const vendorDocs = await cachedCollection(collections.vendors);
        const vendorMap: Record<string, string> = {};
        vendorDocs.forEach(data => {
            vendorMap[data.id] = (data.shopName || data.fullName || 'Unknown') as string;
        });

        // Get all customers for lookup
        const customerDocs = await cachedCollection(collections.customers);
        const customerMap: Record<string, string> = {};
        customerDocs.forEach(data => {
            customerMap[data.id] = (data.fullName || data.name || data.email || 'Unknown') as string;
        });

        // Get all orders
        const orderDocs = await cachedCollection(collections.orders);

        // Invoice numbers so every credit note row can be traced to its invoice
        const invoiceNumbers = await getInvoiceNumberMap();

        interface RefundEntry {
            invoiceNumber: string;
            orderId: string;
            vendorId: string;
            vendorName: string;
            customerId: string;
            customerName: string;
            orderDate: string;
            refundDate: string | null;
            orderTotal: number;
            refundAmount: number;
            refundReason: string;
            refundStatus: string;
            paymentMode: string;
            cancellationReason: string;
            cancelledBy: string;
        }

        const refundEntries: RefundEntry[] = [];
        const monthlyRefunds: Record<string, {
            month: string;
            monthKey: string;
            count: number;
            totalRefundAmount: number;
            cancelledByCustomer: number;
            cancelledByVendor: number;
            cancelledBySystem: number;
        }> = {};

        const summary = {
            totalRefunds: 0,
            totalRefundAmount: 0,
            pendingRefunds: 0,
            completedRefunds: 0,
            cancelledByCustomer: 0,
            cancelledByVendor: 0,
            cancelledBySystem: 0,
            onlineRefunds: 0,
            codCancellations: 0,
        };

        orderDocs.forEach(order => {
            const status = ((order.status as string) || '').toLowerCase();

            // Only process cancelled/refunded orders
            const isCancelled = status === 'cancelled' || status === 'canceled';
            const isRefunded = status === 'refunded';

            if (!isCancelled && !isRefunded) return;

            // Apply status filter
            if (statusFilter && statusFilter !== 'all') {
                if (statusFilter === 'refunded' && !isRefunded) return;
                if (statusFilter === 'cancelled' && !isCancelled) return;
            }

            const orderDate = order.createdAt?.toDate?.() || order.createdAt;
            if (!orderDate) return;

            const dateObj = orderDate instanceof Date ? orderDate : new Date(orderDate);

            // Apply date filters
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                if (dateObj < start) return;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                if (dateObj > end) return;
            }

            const vendorId = (order.vendorId as string) || '';
            const vendorName = vendorMap[vendorId] || (order.vendorName as string) || 'Unknown';
            const customerId = (order.customerId as string) || (order.userId as string) || '';
            const customerName = customerMap[customerId] || (order.customerName as string) || 'Unknown';

            const orderTotal = (order.totalAmount as number) || (order.total as number) || (order.grandTotal as number) || 0;
            const refundAmount = (order.refundAmount as number) || (isRefunded ? orderTotal : 0);
            const refundDate = order.refundedAt?.toDate?.()?.toISOString?.() || order.refundDate || null;
            const refundStatus = isRefunded ? 'Refunded' : (order.refundStatus as string) || 'Pending';
            const cancellationReason = (order.cancellationReason as string) || (order.cancelReason as string) || '';
            const cancelledBy = (order.cancelledBy as string) || (order.canceledBy as string) || 'customer';
            const paymentMode = (order.paymentMode as string) || 'Unknown';

            refundEntries.push({
                invoiceNumber: invoiceNumberFor(invoiceNumbers, order.id),
                orderId: order.id,
                vendorId,
                vendorName,
                customerId,
                customerName,
                orderDate: dateObj.toISOString(),
                refundDate,
                orderTotal,
                refundAmount,
                refundReason: cancellationReason,
                refundStatus,
                paymentMode,
                cancellationReason,
                cancelledBy,
            });

            // Monthly aggregation
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

            if (!monthlyRefunds[monthKey]) {
                monthlyRefunds[monthKey] = {
                    month: monthName,
                    monthKey,
                    count: 0,
                    totalRefundAmount: 0,
                    cancelledByCustomer: 0,
                    cancelledByVendor: 0,
                    cancelledBySystem: 0,
                };
            }
            monthlyRefunds[monthKey].count++;
            monthlyRefunds[monthKey].totalRefundAmount += refundAmount;
            const cb = cancelledBy.toLowerCase();
            if (cb.includes('vendor')) monthlyRefunds[monthKey].cancelledByVendor++;
            else if (cb.includes('system') || cb.includes('auto')) monthlyRefunds[monthKey].cancelledBySystem++;
            else monthlyRefunds[monthKey].cancelledByCustomer++;

            // Summary
            summary.totalRefunds++;
            summary.totalRefundAmount += refundAmount;
            if (refundStatus.toLowerCase() === 'refunded') summary.completedRefunds++;
            else summary.pendingRefunds++;
            const cbL = cancelledBy.toLowerCase();
            if (cbL.includes('vendor')) summary.cancelledByVendor++;
            else if (cbL.includes('system') || cbL.includes('auto')) summary.cancelledBySystem++;
            else summary.cancelledByCustomer++;
            if (paymentMode.toUpperCase() === 'COD') summary.codCancellations++;
            else summary.onlineRefunds++;
        });

        // Sort entries by date (newest first)
        refundEntries.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        const monthlyData = Object.values(monthlyRefunds).sort((a, b) => b.monthKey.localeCompare(a.monthKey));

        // ── File export (styled .xlsx by default, CSV on request) ──
        const format = searchParams.get('format');
        if (format === 'csv' || format === 'xlsx') {
            const spec: XlsxSheetSpec = {
                sheetName: 'Refunds',
                title: 'Cancellation & Refund Register',
                subtitle: 'Cancelled orders and the refunds raised against them',
                meta: platformMeta([
                    {
                        label: 'Period',
                        value: startDate || endDate
                            ? `${startDate ? formatDay(startDate) : 'Beginning'} to ${endDate ? formatDay(endDate) : 'Date'}`
                            : 'All time',
                    },
                    { label: 'Status filter', value: statusFilter || 'All' },
                    { label: 'Cancellations', value: String(summary.totalRefunds) },
                ]),
                columns: [
                    { header: 'Invoice No.', key: 'invoiceNumber', width: 20 },
                    { header: 'Order ID', key: 'orderId', width: 24 },
                    { header: 'Customer', key: 'customerName', width: 22 },
                    { header: 'Restaurant', key: 'vendorName', width: 24 },
                    { header: 'Order Date', key: 'orderDateLabel', width: 14 },
                    { header: 'Refund Date', key: 'refundDateLabel', width: 14 },
                    { header: 'Order Total', key: 'orderTotal', width: 14, type: 'currency' },
                    { header: 'Refund Amount', key: 'refundAmount', width: 15, type: 'currency' },
                    { header: 'Payment Mode', key: 'paymentMode', width: 14 },
                    { header: 'Cancelled By', key: 'cancelledBy', width: 14 },
                    { header: 'Reason', key: 'refundReason', width: 34 },
                    { header: 'Refund Status', key: 'refundStatus', width: 14 },
                ],
                rows: refundEntries.map(e => ({
                    ...e,
                    orderDateLabel: formatDay(e.orderDate),
                    refundDateLabel: formatDay(e.refundDate),
                })) as unknown as Array<Record<string, unknown>>,
                totals: {
                    invoiceNumber: 'TOTAL',
                    orderTotal: Math.round(refundEntries.reduce((s, e) => s + (e.orderTotal || 0), 0) * 100) / 100,
                    refundAmount: Math.round(summary.totalRefundAmount * 100) / 100,
                },
                notes: [
                    'A credit note should be issued against the original tax invoice for every completed refund.',
                    'COD cancellations carry no refund outflow — they are listed for completeness.',
                ],
            };
            return reportResponse(spec, `Refunds_${new Date().toISOString().slice(0, 10)}`, format);
        }

        return NextResponse.json({
            success: true,
            data: {
                entries: refundEntries.slice(0, 200),
                monthlyData,
                summary,
            }
        });
    } catch (error) {
        console.error('Refund report fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch refund report' },
            { status: 500 }
        );
    }
}

