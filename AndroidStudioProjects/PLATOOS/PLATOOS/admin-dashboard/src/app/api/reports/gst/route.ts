import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';

// GST Rate constants
const GST_RATE = 0.18; // 18% GST
const COMMISSION_RATE = 0.15; // 15% commission on item total

interface GSTEntry {
    orderId: string;
    vendorId: string;
    vendorName: string;
    orderDate: string;
    itemTotal: number;
    commission: number;
    gstOnCommission: number;
    totalPlatformEarning: number;
    paymentMode: string;
}

interface MonthlyGST {
    month: string;
    monthKey: string;
    ordersCount: number;
    totalItemSales: number;
    totalCommission: number;
    totalGst: number;
    totalPlatformEarning: number;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const vendorId = searchParams.get('vendorId');

        // Get all vendors for lookup
        const vendorsSnapshot = await db.collection(collections.vendors).get();
        const vendorMap: Record<string, string> = {};
        vendorsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            vendorMap[doc.id] = data.shopName || data.fullName || 'Unknown';
        });

        // Get all orders
        let ordersQuery = db.collection(collections.orders);

        // Apply filters if provided
        const ordersSnapshot = await ordersQuery.get();

        // Process orders into GST entries
        const gstEntries: GSTEntry[] = [];
        const monthlyGST: Record<string, MonthlyGST> = {};
        const vendorGST: Record<string, {
            vendorId: string;
            vendorName: string;
            ordersCount: number;
            totalItemSales: number;
            totalCommission: number;
            totalGst: number;
            totalPlatformEarning: number;
        }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const status = order.status?.toLowerCase() || '';

            // Only process delivered/completed orders
            if (status !== 'delivered' && status !== 'completed') return;

            // Get order date
            const orderDate = order.deliveredAt?.toDate?.() || order.createdAt?.toDate?.() || order.createdAt;
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

            // Apply vendor filter
            if (vendorId && order.vendorId !== vendorId) return;

            const orderVendorId = order.vendorId || '';
            const orderVendorName = vendorMap[orderVendorId] || order.vendorName || 'Unknown';

            // Calculate GST
            const itemTotal = order.itemTotal || order.subtotal || order.total || 0;
            const commission = itemTotal * COMMISSION_RATE;
            const gstOnCommission = commission * GST_RATE;
            const totalPlatformEarning = commission + gstOnCommission;

            // Add to entries
            const dateStr = dateObj.toISOString();
            gstEntries.push({
                orderId: doc.id,
                vendorId: orderVendorId,
                vendorName: orderVendorName,
                orderDate: dateStr,
                itemTotal: itemTotal,
                commission: commission,
                gstOnCommission: gstOnCommission,
                totalPlatformEarning: totalPlatformEarning,
                paymentMode: order.paymentMode || 'Unknown',
            });

            // Monthly aggregation
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

            if (!monthlyGST[monthKey]) {
                monthlyGST[monthKey] = {
                    month: monthName,
                    monthKey: monthKey,
                    ordersCount: 0,
                    totalItemSales: 0,
                    totalCommission: 0,
                    totalGst: 0,
                    totalPlatformEarning: 0,
                };
            }
            monthlyGST[monthKey].ordersCount++;
            monthlyGST[monthKey].totalItemSales += itemTotal;
            monthlyGST[monthKey].totalCommission += commission;
            monthlyGST[monthKey].totalGst += gstOnCommission;
            monthlyGST[monthKey].totalPlatformEarning += totalPlatformEarning;

            // Vendor aggregation
            if (!vendorGST[orderVendorId]) {
                vendorGST[orderVendorId] = {
                    vendorId: orderVendorId,
                    vendorName: orderVendorName,
                    ordersCount: 0,
                    totalItemSales: 0,
                    totalCommission: 0,
                    totalGst: 0,
                    totalPlatformEarning: 0,
                };
            }
            vendorGST[orderVendorId].ordersCount++;
            vendorGST[orderVendorId].totalItemSales += itemTotal;
            vendorGST[orderVendorId].totalCommission += commission;
            vendorGST[orderVendorId].totalGst += gstOnCommission;
            vendorGST[orderVendorId].totalPlatformEarning += totalPlatformEarning;
        });

        // Sort entries by date (newest first)
        gstEntries.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

        // Convert monthly data to array and sort
        const monthlyData = Object.values(monthlyGST).sort((a, b) => b.monthKey.localeCompare(a.monthKey));

        // Convert vendor data to array and sort by GST collected
        const vendorData = Object.values(vendorGST).sort((a, b) => b.totalGst - a.totalGst);

        // Calculate summary
        const summary = {
            totalOrders: gstEntries.length,
            totalItemSales: gstEntries.reduce((sum, e) => sum + e.itemTotal, 0),
            totalCommission: gstEntries.reduce((sum, e) => sum + e.commission, 0),
            totalGstCollected: gstEntries.reduce((sum, e) => sum + e.gstOnCommission, 0),
            totalPlatformEarning: gstEntries.reduce((sum, e) => sum + e.totalPlatformEarning, 0),
            commissionRate: COMMISSION_RATE * 100,
            gstRate: GST_RATE * 100,
            effectiveGstOnSales: gstEntries.length > 0 ?
                (gstEntries.reduce((sum, e) => sum + e.gstOnCommission, 0) / gstEntries.reduce((sum, e) => sum + e.itemTotal, 0)) * 100 : 0,
        };

        return NextResponse.json({
            success: true,
            data: {
                entries: gstEntries.slice(0, 100), // Limit to 100 recent entries
                monthlyData,
                vendorData,
                summary,
            }
        });
    } catch (error) {
        console.error('GST report fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch GST report' },
            { status: 500 }
        );
    }
}

