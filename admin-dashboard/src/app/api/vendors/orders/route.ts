import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { getInvoiceNumberMap, invoiceNumberFor } from '@/lib/invoice-lookup';

/**
 * GET /api/vendors/orders?vendorId=xxx&limit=500&status=Delivered
 *
 * Order history for a single vendor, plus lifetime performance stats.
 * Backs the "Orders" tab on the vendor detail page.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tsToIso = (v: any): string | null => {
    if (!v) return null;
    if (v?.toDate) return v.toDate().toISOString();
    if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tsToMillis = (v: any): number => {
    const iso = tsToIso(v);
    return iso ? new Date(iso).getTime() : 0;
};

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const vendorId = searchParams.get('vendorId');
        const statusFilter = searchParams.get('status');
        const rawLimit = parseInt(searchParams.get('limit') || '1000', 10);
        const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1000, 5000);

        if (!vendorId) {
            return NextResponse.json(
                { success: false, error: 'vendorId is required' },
                { status: 400 }
            );
        }

        // ── Fetch this vendor's orders ──
        // Preferred path is an indexed query (vendorId + createdAt desc). If the
        // composite index has not been deployed yet we fall back to the cached
        // full-collection read used elsewhere in the dashboard, so the tab keeps
        // working either way.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let vendorOrders: Array<{ id: string;[key: string]: any }> = [];
        try {
            const snapshot = await db.collection(collections.orders)
                .where('vendorId', '==', vendorId)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
            vendorOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (indexError) {
            console.warn('Vendor orders indexed query unavailable, falling back to cached scan:', indexError);
            const allOrders = await cachedCollection(collections.orders, 30_000);
            vendorOrders = allOrders
                .filter(o => o.vendorId === vendorId)
                .sort((a, b) => tsToMillis(b.createdAt) - tsToMillis(a.createdAt))
                .slice(0, limit);
        }

        // Invoice numbers issued for these orders
        const invoiceNumbers = await getInvoiceNumberMap();

        const orders = vendorOrders.map(data => {
            const itemTotal = (data.itemTotal as number) || (data.subtotal as number) || 0;
            const commBase = (data.originalItemTotal as number) || itemTotal;

            // Commission + GST: prefer what was stored on the order at placement
            // time; fall back to the platform default only when absent.
            const commission = (data.vendorPlatformCut as number) > 0
                ? (data.vendorPlatformCut as number)
                : round2(commBase * 0.15);
            const gstOnCommission = (data.vendorGstOnPlatformCut as number) > 0
                ? (data.vendorGstOnPlatformCut as number)
                : round2(commission * 0.18);
            const vendorEarning = (data.vendorEarning as number) > 0
                ? (data.vendorEarning as number)
                : round2(itemTotal - commission - gstOnCommission);

            const items = (data.items || []) as Array<{ name?: string; quantity?: number }>;

            return {
                orderId: data.id,
                invoiceNumber: invoiceNumberFor(invoiceNumbers, data.id),
                createdAt: tsToIso(data.createdAt) || '',
                deliveredAt: tsToIso(data.deliveredAt) || tsToIso(data.completedAt) || null,
                customerName: (data.customerName || '') as string,
                customerPhone: (data.customerPhone || '') as string,
                status: (data.status || 'Pending') as string,
                paymentMode: (data.paymentMode || '') as string,
                paymentStatus: (data.paymentStatus || '') as string,
                itemCount: items.reduce((s, it) => s + (it.quantity || 1), 0),
                itemNames: (data.itemNames as string[]) || items.map(i => i.name || '').filter(Boolean),
                itemTotal: round2(itemTotal),
                deliveryFee: round2((data.deliveryFee as number) || 0),
                taxes: round2((data.taxes as number) || 0),
                total: round2((data.total as number) || 0),
                commission: round2(commission),
                gstOnCommission: round2(gstOnCommission),
                totalDeduction: round2(commission + gstOnCommission),
                vendorEarning: round2(vendorEarning),
                refundStatus: (data.refundStatus || '') as string,
                refundAmount: round2((data.refundAmount as number) || 0),
            };
        });

        // ── Lifetime stats (computed over everything fetched, before filtering) ──
        const isDelivered = (s: string) => {
            const v = s.toLowerCase();
            return v === 'delivered' || v === 'completed';
        };
        const isCancelled = (s: string) => {
            const v = s.toLowerCase();
            return v.includes('cancel') || v === 'expired' || v === 'not responded';
        };

        const deliveredOrders = orders.filter(o => isDelivered(o.status));
        const cancelledOrders = orders.filter(o => isCancelled(o.status));
        const activeOrders = orders.filter(o => !isDelivered(o.status) && !isCancelled(o.status));

        const grossSales = deliveredOrders.reduce((s, o) => s + o.itemTotal, 0);
        const netEarnings = deliveredOrders.reduce((s, o) => s + o.vendorEarning, 0);
        const commissionPaid = deliveredOrders.reduce((s, o) => s + o.commission, 0);
        const gstPaid = deliveredOrders.reduce((s, o) => s + o.gstOnCommission, 0);

        const sortedDates = orders
            .map(o => o.createdAt)
            .filter(Boolean)
            .sort();

        const stats = {
            totalOrders: orders.length,
            deliveredOrders: deliveredOrders.length,
            cancelledOrders: cancelledOrders.length,
            activeOrders: activeOrders.length,
            grossSales: round2(grossSales),
            netEarnings: round2(netEarnings),
            commissionPaid: round2(commissionPaid),
            gstPaid: round2(gstPaid),
            averageOrderValue: deliveredOrders.length > 0
                ? round2(grossSales / deliveredOrders.length)
                : 0,
            fulfilmentRate: orders.length > 0
                ? round2((deliveredOrders.length / orders.length) * 100)
                : 0,
            firstOrderAt: sortedDates[0] || null,
            lastOrderAt: sortedDates[sortedDates.length - 1] || null,
            /** True when the limit was hit — stats cover the newest `limit` orders only. */
            truncated: orders.length >= limit,
        };

        const filtered = statusFilter && statusFilter !== 'All'
            ? orders.filter(o => o.status === statusFilter)
            : orders;

        return NextResponse.json({
            success: true,
            data: { vendorId, orders: filtered, stats },
        });
    } catch (error) {
        console.error('Vendor orders fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch vendor orders' },
            { status: 500 }
        );
    }
}
