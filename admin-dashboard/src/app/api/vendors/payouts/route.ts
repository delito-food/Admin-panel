import { NextResponse, NextRequest } from 'next/server';
import { db, collections, cachedCollection, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET(request: NextRequest) {
    try {
        // Parse optional date range query params
        const { searchParams } = new URL(request.url);
        const startDateParam = searchParams.get('startDate'); // ISO string e.g. '2026-07-01'
        const endDateParam = searchParams.get('endDate');       // ISO string e.g. '2026-07-14'

        const startDate = startDateParam ? new Date(startDateParam) : null;
        const endDate = endDateParam ? new Date(endDateParam + 'T23:59:59.999Z') : null;

        // Use cached vendors (60s TTL) — vendor profiles change rarely
        const vendorDocs = await cachedCollection(collections.vendors);

        // Always fetch orders fresh — this is a financial calculation and must be accurate
        // Using cachedCollection here caused stale data and ₹0 pending when orders exist
        const ordersSnapshot = await db.collection(collections.orders).get();
        let orderDocs = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, unknown> & { id: string }));

        // Filter orders by date range if provided
        if (startDate || endDate) {
            orderDocs = orderDocs.filter(order => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawCreatedAt = order.createdAt as any;
                const orderDate = rawCreatedAt?.toDate?.() || (rawCreatedAt ? new Date(rawCreatedAt) : null);
                if (!orderDate) return false;
                const d = orderDate instanceof Date ? orderDate : new Date(orderDate);
                if (isNaN(d.getTime())) return false;
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            });
        }

        // Get payout history (small collection, fetch fresh)
        const payoutsSnapshot = await db.collection('vendorPayouts').orderBy('createdAt', 'desc').limit(200).get()
            .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

        // GST rate on commission (platform earnings)
        const GST_RATE = 0.18; // 18% GST
        const COMMISSION_RATE = 0.15; // 15% commission on item total

        // Calculate vendor payouts
        const vendorPayouts: Record<string, {
            totalRevenue: number;
            commissionAmount: number;
            gstOnCommission: number;
            smallOrderFees: number;
            deliveryFeeProfit: number;
            totalPlatformEarning: number;
            netPayable: number;
            paidAmount: number;
            pendingAmount: number;
            orderCount: number;
            lastOrderDate: string | null;
        }> = {};

        orderDocs.forEach(order => {
            const vendorId = order.vendorId as string;
            const status = ((order.status as string) || '').toLowerCase();

            if (!vendorId) return;
            if (status !== 'delivered' && status !== 'completed') return;

            if (!vendorPayouts[vendorId]) {
                vendorPayouts[vendorId] = {
                    totalRevenue: 0,
                    commissionAmount: 0,
                    gstOnCommission: 0,
                    smallOrderFees: 0,
                    deliveryFeeProfit: 0,
                    totalPlatformEarning: 0,
                    netPayable: 0,
                    paidAmount: 0,
                    pendingAmount: 0,
                    orderCount: 0,
                    lastOrderDate: null,
                };
            }

            // Item total (what customer pays for food — items only, no delivery)
            // Fallback chain matches vendor app: itemTotal → subtotal → (total - deliveryFee)
            // Without the total fallback, orders that only have `total` show as ₹0 here
            const deliveryFeeAmt = (order.deliveryFee as number) || 0;
            const itemTotal = (order.itemTotal as number) || (order.subtotal as number) ||
                Math.max(0, ((order.total as number) || 0) - deliveryFeeAmt);

            // Commission: use stored values when available (respects custom vendor rates)
            const commission = (order.vendorPlatformCut as number) > 0
                ? (order.vendorPlatformCut as number)
                : Math.round(itemTotal * COMMISSION_RATE * 10) / 10;
            const gstOnCommission = (order.vendorGstOnPlatformCut as number) > 0
                ? (order.vendorGstOnPlatformCut as number)
                : Math.round(commission * GST_RATE * 10) / 10;

            // Small order fee (₹10 if order < ₹99) - goes to platform
            const smallOrderFee = (order.smallOrderSupportFee as number) || 0;

            // Delivery fee profit = customer delivery fee - delivery person earnings
            const customerDeliveryFee = (order.deliveryFee as number) || 0;
            const deliveryPersonEarnings = (order.deliveryPersonEarnings as number) ||
                (order.distanceKm ? Math.max(15, Math.round((10 + ((order.distanceKm as number) * 6.5)) * 10) / 10) : Math.max(15, customerDeliveryFee));
            const deliveryFeeProfit = customerDeliveryFee - deliveryPersonEarnings;

            // Total platform earning
            const totalPlatformEarning = commission + gstOnCommission + smallOrderFee + deliveryFeeProfit;

            // Vendor earns: use stored value only if explicitly present and non-null
            // Avoid `> 0` check — stored 0 would incorrectly bypass calculation
            const storedVendorEarning = order.vendorEarning;
            const vendorEarning = (storedVendorEarning != null && storedVendorEarning !== undefined && (storedVendorEarning as number) > 0)
                ? (storedVendorEarning as number)
                : Math.max(0, itemTotal - commission - gstOnCommission);

            vendorPayouts[vendorId].totalRevenue += itemTotal;
            vendorPayouts[vendorId].commissionAmount += commission;
            vendorPayouts[vendorId].gstOnCommission += gstOnCommission;
            vendorPayouts[vendorId].smallOrderFees += smallOrderFee;
            vendorPayouts[vendorId].deliveryFeeProfit += deliveryFeeProfit;
            vendorPayouts[vendorId].totalPlatformEarning += totalPlatformEarning;
            vendorPayouts[vendorId].netPayable += vendorEarning;
            vendorPayouts[vendorId].orderCount += 1;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawCreatedAt = order.createdAt as any;
            const orderDate = rawCreatedAt?.toDate?.() || (rawCreatedAt ? new Date(rawCreatedAt) : null);
            if (orderDate) {
                const dateStr = orderDate instanceof Date 
                    ? orderDate.toISOString() 
                    : new Date(orderDate).toISOString();
                if (!vendorPayouts[vendorId].lastOrderDate || dateStr > vendorPayouts[vendorId].lastOrderDate!) {
                    vendorPayouts[vendorId].lastOrderDate = dateStr;
                }
            }
        });

        // Process payout history — track both confirmed paid amounts AND active issued payouts
        const payoutsByVendor: Record<string, number> = {};
        const issuedPayoutByVendor: Record<string, { payoutId: string; amount: number; method: string; issuedAt: string | null }> = {};
        const recentPayouts: Array<{
            payoutId: string;
            vendorId: string;
            vendorName: string;
            amount: number;
            method: string;
            status: string;
            createdAt: string;
            processedAt: string | null;
            issuedAt: string | null;
            confirmedAt: string | null;
            transactionId: string | null;
            notes: string | null;
            issuedBy: string | null;
            confirmedBy: string | null;
        }> = [];

        payoutsSnapshot.docs.forEach(doc => {
            const payout = doc.data();
            const vendorId = payout.vendorId;
            
            // Only count CONFIRMED (completed) payouts toward paidAmount
            if (payout.status === 'completed' || payout.status === 'processed') {
                payoutsByVendor[vendorId] = (payoutsByVendor[vendorId] || 0) + (payout.amount || 0);
            }

            // Track the most recent issued (awaiting confirmation) payout per vendor
            if (payout.status === 'issued' && vendorId && !issuedPayoutByVendor[vendorId]) {
                issuedPayoutByVendor[vendorId] = {
                    payoutId: doc.id,
                    amount: payout.amount || 0,
                    method: payout.method || 'Bank Transfer',
                    issuedAt: payout.issuedAt?.toDate?.()?.toISOString() || payout.createdAt?.toDate?.()?.toISOString() || null,
                };
            }

            recentPayouts.push({
                payoutId: doc.id,
                vendorId: payout.vendorId || '',
                vendorName: payout.vendorName || '',
                amount: payout.amount || 0,
                method: payout.method || 'Bank Transfer',
                status: payout.status || 'pending',
                createdAt: payout.createdAt?.toDate?.()?.toISOString() || '',
                processedAt: payout.processedAt?.toDate?.()?.toISOString() || null,
                issuedAt: payout.issuedAt?.toDate?.()?.toISOString() || null,
                confirmedAt: payout.confirmedAt?.toDate?.()?.toISOString() || null,
                transactionId: payout.transactionId || null,
                notes: payout.notes || null,
                issuedBy: payout.issuedBy || null,
                confirmedBy: payout.confirmedBy || null,
            });
        });

        // Filter recentPayouts by date range if provided
        const filteredRecentPayouts = (startDate || endDate)
            ? recentPayouts.filter(p => {
                if (!p.createdAt) return false;
                const d = new Date(p.createdAt);
                if (isNaN(d.getTime())) return false;
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            })
            : recentPayouts;

        // Build vendor list with payout data
        const vendors = vendorDocs.map(data => {
            const payout = vendorPayouts[data.id] || {
                totalRevenue: 0, commissionAmount: 0, gstOnCommission: 0,
                smallOrderFees: 0, deliveryFeeProfit: 0, totalPlatformEarning: 0,
                netPayable: 0, paidAmount: 0, pendingAmount: 0,
                orderCount: 0, lastOrderDate: null,
            };

            // paidAmount: take the HIGHER of (sum of completed payout records) vs (vendorDoc.paidAmount).
            const payoutsCollectionPaid = payoutsByVendor[data.id] || 0;
            const vendorDocPaid = (data.paidAmount as number) || 0;
            payout.paidAmount = Math.round(Math.max(payoutsCollectionPaid, vendorDocPaid) * 100) / 100;

            // netPayable: order-based calc may be lower than vendor app's figure (different itemTotal
            // fallback logic). Trust the higher value so pending is never understated.
            const vendorDocNet = ((data.totalEarnings as number) || 0) - ((data.totalCommission as number) || 0);
            if (vendorDocNet > payout.netPayable && vendorDocNet > 0) {
                payout.netPayable = Math.round(vendorDocNet * 100) / 100;
            }

            payout.pendingAmount = Math.round(Math.max(0, payout.netPayable - payout.paidAmount) * 100) / 100;

            return {
                vendorId: data.id,
                shopName: (data.shopName || data.fullName || 'Unknown') as string,
                fullName: (data.fullName || '') as string,
                shopImageUrl: (data.shopImageUrl || data.profileImageUrl || '') as string,
                email: (data.email || '') as string,
                phoneNumber: (data.phoneNumber || '') as string,
                city: (data.city || '') as string,
                isVerified: (data.isVerified || false) as boolean,
                commissionRate: (data.commissionRate || 15) as number,
                bankDetails: data.bankDetails || (data.bankAccountNumber ? {
                    accountNumber: data.bankAccountNumber,
                    ifsc: data.bankIfscCode || data.ifscCode || '',
                    bankName: data.bankName || '',
                    accountHolderName: data.bankAccountHolderName || data.accountHolderName || '',
                } : null),
                upiId: (data.upiId || null) as string | null,
                bankPassbookUrl: (data.bankPassbookUrl || data.bankProofUrl || '') as string,
                issuedPayout: issuedPayoutByVendor[data.id] || null,
                ...payout,
            };
        }).filter(v => v.totalRevenue > 0 || v.pendingAmount > 0 || v.paidAmount > 0 ||
            ((vendorDocs.find(d => d.id === v.vendorId)?.pendingPayout as number || 0) > 0) ||
            !!issuedPayoutByVendor[v.vendorId]
        );

        vendors.sort((a, b) => b.pendingAmount - a.pendingAmount);

        const summary = {
            totalPendingPayouts: Math.round(vendors.reduce((s, v) => s + v.pendingAmount, 0) * 100) / 100,
            totalPaidAmount: Math.round(vendors.reduce((s, v) => s + v.paidAmount, 0) * 100) / 100,
            totalCommissionEarned: Math.round(vendors.reduce((s, v) => s + v.commissionAmount, 0) * 100) / 100,
            totalGstCollected: Math.round(vendors.reduce((s, v) => s + v.gstOnCommission, 0) * 100) / 100,
            totalSmallOrderFees: Math.round(vendors.reduce((s, v) => s + v.smallOrderFees, 0) * 100) / 100,
            totalDeliveryFeeProfit: Math.round(vendors.reduce((s, v) => s + v.deliveryFeeProfit, 0) * 100) / 100,
            totalPlatformEarning: Math.round(vendors.reduce((s, v) => s + v.totalPlatformEarning, 0) * 100) / 100,
            vendorsWithPending: vendors.filter(v => v.pendingAmount > 0).length,
        };

        return NextResponse.json({ success: true, data: { vendors, recentPayouts: filteredRecentPayouts, summary } });
    } catch (error) {
        console.error('Vendor payouts fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch vendor payouts' }, { status: 500 });
    }
}

