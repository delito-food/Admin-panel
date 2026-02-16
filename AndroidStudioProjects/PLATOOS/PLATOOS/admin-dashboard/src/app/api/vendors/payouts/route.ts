import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Get all vendors
        const vendorsSnapshot = await db.collection(collections.vendors).get();
        
        // Get all orders
        const ordersSnapshot = await db.collection(collections.orders).get();
        
        // Get payout history
        const payoutsSnapshot = await db.collection('vendorPayouts').orderBy('createdAt', 'desc').limit(100).get();
        
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

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const vendorId = order.vendorId;
            const status = order.status?.toLowerCase() || '';
            
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

            // Item total (what customer pays for food)
            const itemTotal = order.itemTotal || order.subtotal || 0;

            // Commission is 15% of item total (goes to platform)
            const commission = itemTotal * COMMISSION_RATE;
            const gstOnCommission = commission * GST_RATE;

            // Small order fee (₹10 if order < ₹99) - goes to platform
            const smallOrderFee = order.smallOrderSupportFee || 0;

            // Delivery fee profit = customer delivery fee - delivery person earnings
            // Customer pays: Base ₹10 + ₹4.5/km
            // Delivery person gets: Base ₹10 + ₹6.5/km
            // This means delivery has negative margin (platform subsidizes ~₹2/km)
            const customerDeliveryFee = order.deliveryFee || 0;
            const deliveryPersonEarnings = order.deliveryPersonEarnings ||
                (order.distanceKm ? Math.round(10 + (order.distanceKm * 6.5)) : customerDeliveryFee);
            const deliveryFeeProfit = customerDeliveryFee - deliveryPersonEarnings;

            // Total platform earning = commission + GST on commission + small order fee + delivery fee profit
            // Note: delivery fee profit may be negative (platform subsidizes delivery)
            const totalPlatformEarning = commission + gstOnCommission + smallOrderFee + deliveryFeeProfit;

            // Vendor earns: item total - commission - GST on commission
            const vendorEarning = itemTotal - commission - gstOnCommission;

            vendorPayouts[vendorId].totalRevenue += itemTotal;
            vendorPayouts[vendorId].commissionAmount += commission;
            vendorPayouts[vendorId].gstOnCommission += gstOnCommission;
            vendorPayouts[vendorId].smallOrderFees += smallOrderFee;
            vendorPayouts[vendorId].deliveryFeeProfit += deliveryFeeProfit;
            vendorPayouts[vendorId].totalPlatformEarning += totalPlatformEarning;
            vendorPayouts[vendorId].netPayable += vendorEarning;
            vendorPayouts[vendorId].orderCount += 1;

            const orderDate = order.createdAt?.toDate?.() || order.createdAt;
            if (orderDate) {
                const dateStr = orderDate instanceof Date 
                    ? orderDate.toISOString() 
                    : new Date(orderDate).toISOString();
                if (!vendorPayouts[vendorId].lastOrderDate || dateStr > vendorPayouts[vendorId].lastOrderDate!) {
                    vendorPayouts[vendorId].lastOrderDate = dateStr;
                }
            }
        });

        // Process payout history
        const payoutsByVendor: Record<string, number> = {};
        const recentPayouts: Array<{
            payoutId: string;
            vendorId: string;
            vendorName: string;
            amount: number;
            method: string;
            status: string;
            createdAt: string;
            processedAt: string | null;
            transactionId: string | null;
            notes: string | null;
        }> = [];

        payoutsSnapshot.docs.forEach(doc => {
            const payout = doc.data();
            const vendorId = payout.vendorId;
            
            if (payout.status === 'completed' || payout.status === 'processed') {
                payoutsByVendor[vendorId] = (payoutsByVendor[vendorId] || 0) + (payout.amount || 0);
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
                transactionId: payout.transactionId || null,
                notes: payout.notes || null,
            });
        });

        // Update paid amounts
        Object.keys(payoutsByVendor).forEach(vendorId => {
            if (vendorPayouts[vendorId]) {
                vendorPayouts[vendorId].paidAmount = payoutsByVendor[vendorId];
                vendorPayouts[vendorId].pendingAmount = 
                    vendorPayouts[vendorId].netPayable - payoutsByVendor[vendorId];
            }
        });

        // Build vendor list with payout data
        const vendors = vendorsSnapshot.docs.map(doc => {
            const data = doc.data();
            const payout = vendorPayouts[doc.id] || {
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

            // Calculate pending amount
            payout.pendingAmount = Math.max(0, payout.netPayable - payout.paidAmount);

            return {
                vendorId: doc.id,
                shopName: data.shopName || data.fullName || 'Unknown',
                fullName: data.fullName || '',
                shopImageUrl: data.shopImageUrl || data.profileImageUrl || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                city: data.city || '',
                isVerified: data.isVerified || false,
                commissionRate: data.commissionRate || 15,
                bankDetails: data.bankDetails || null,
                upiId: data.upiId || null,
                // Payout info
                ...payout,
            };
        }).filter(v => v.totalRevenue > 0 || v.pendingAmount > 0);

        // Sort by pending amount (highest first)
        vendors.sort((a, b) => b.pendingAmount - a.pendingAmount);

        // Calculate summary
        const summary = {
            totalPendingPayouts: vendors.reduce((sum, v) => sum + v.pendingAmount, 0),
            totalPaidAmount: vendors.reduce((sum, v) => sum + v.paidAmount, 0),
            totalCommissionEarned: vendors.reduce((sum, v) => sum + v.commissionAmount, 0),
            totalGstCollected: vendors.reduce((sum, v) => sum + v.gstOnCommission, 0),
            totalSmallOrderFees: vendors.reduce((sum, v) => sum + v.smallOrderFees, 0),
            totalDeliveryFeeProfit: vendors.reduce((sum, v) => sum + v.deliveryFeeProfit, 0),
            totalPlatformEarning: vendors.reduce((sum, v) => sum + v.totalPlatformEarning, 0),
            vendorsWithPending: vendors.filter(v => v.pendingAmount > 0).length,
        };

        return NextResponse.json({
            success: true,
            data: {
                vendors,
                recentPayouts,
                summary,
            }
        });
    } catch (error) {
        console.error('Vendor payouts fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch vendor payouts' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, vendorName, amount, method, transactionId, notes } = body;

        if (!vendorId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Vendor ID and valid amount required' },
                { status: 400 }
            );
        }

        // Create payout record
        const payoutRef = await db.collection('vendorPayouts').add({
            vendorId,
            vendorName: vendorName || '',
            amount,
            method: method || 'Bank Transfer',
            status: 'completed',
            transactionId: transactionId || null,
            notes: notes || null,
            createdAt: Timestamp.now(),
            processedAt: Timestamp.now(),
        });

        // Update vendor's paidAmount field
        const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
        const currentData = vendorDoc.data() || {};

        // Calculate earnings if not set (sync from orders)
        let updateData: Record<string, unknown> = {
            paidAmount: (currentData.paidAmount || 0) + amount,
            lastPayoutAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        // If totalEarnings is 0, calculate from orders
        if (!currentData.totalEarnings || currentData.totalEarnings <= 0) {
            const ordersSnapshot = await db.collection(collections.orders)
                .where('vendorId', '==', vendorId)
                .get();

            let calculatedEarnings = 0;
            let calculatedCommission = 0;
            let orderCount = 0;

            ordersSnapshot.docs.forEach(doc => {
                const order = doc.data();
                const status = order.status?.toLowerCase() || '';

                if (status === 'delivered' || status === 'completed') {
                    const itemTotal = order.itemTotal || order.subtotal || order.total || 0;
                    const commission = itemTotal * 0.15;
                    const gstOnCommission = commission * 0.18;

                    calculatedEarnings += itemTotal;
                    calculatedCommission += (commission + gstOnCommission);
                    orderCount++;
                }
            });

            if (calculatedEarnings > 0) {
                updateData.totalEarnings = calculatedEarnings;
                updateData.totalCommission = calculatedCommission;
                updateData.totalOrders = orderCount;
            }
        }

        await db.collection(collections.vendors).doc(vendorId).update(updateData);

        return NextResponse.json({
            success: true,
            message: `Payout of ₹${amount} processed successfully`,
            payoutId: payoutRef.id,
        });
    } catch (error) {
        console.error('Payout processing error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process payout' },
            { status: 500 }
        );
    }
}
