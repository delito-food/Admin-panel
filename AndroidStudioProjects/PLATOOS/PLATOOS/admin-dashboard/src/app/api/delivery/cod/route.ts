import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Get all delivery partners
        const deliverySnapshot = await db.collection(collections.deliveryPersons).get();
        
        // Get all orders with COD
        const ordersSnapshot = await db.collection(collections.orders)
            .where('paymentMode', 'in', ['COD', 'cod', 'Cash', 'cash'])
            .get();
        
        // Get COD settlement history
        const settlementsSnapshot = await db.collection('codSettlements')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        // Calculate COD by delivery partner
        const codByPartner: Record<string, {
            collected: number;
            orders: number;
            pendingOrderIds: string[];
        }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const deliveryPersonId = order.deliveryPersonId;
            const status = order.status?.toLowerCase() || '';
            
            if (!deliveryPersonId) return;
            if (status !== 'delivered' && status !== 'completed') return;

            if (!codByPartner[deliveryPersonId]) {
                codByPartner[deliveryPersonId] = {
                    collected: 0,
                    orders: 0,
                    pendingOrderIds: [],
                };
            }

            codByPartner[deliveryPersonId].collected += (order.total || 0);
            codByPartner[deliveryPersonId].orders += 1;
            
            // Track pending orders (not yet settled)
            if (!order.codSettled) {
                codByPartner[deliveryPersonId].pendingOrderIds.push(doc.id);
            }
        });

        // Get settled amounts
        const settledByPartner: Record<string, number> = {};
        const recentSettlements: Array<{
            settlementId: string;
            deliveryPersonId: string;
            deliveryPersonName: string;
            amount: number;
            ordersCount: number;
            method: string;
            status: string;
            createdAt: string;
            notes: string | null;
        }> = [];

        settlementsSnapshot.docs.forEach(doc => {
            const settlement = doc.data();
            const deliveryPersonId = settlement.deliveryPersonId;
            
            if (settlement.status === 'completed') {
                settledByPartner[deliveryPersonId] = 
                    (settledByPartner[deliveryPersonId] || 0) + (settlement.amount || 0);
            }

            recentSettlements.push({
                settlementId: doc.id,
                deliveryPersonId: settlement.deliveryPersonId || '',
                deliveryPersonName: settlement.deliveryPersonName || '',
                amount: settlement.amount || 0,
                ordersCount: settlement.ordersCount || 0,
                method: settlement.method || 'Cash',
                status: settlement.status || 'pending',
                createdAt: settlement.createdAt?.toDate?.()?.toISOString() || '',
                processedAt: settlement.processedAt?.toDate?.()?.toISOString() || null,
                notes: settlement.notes || null,
                receiptId: settlement.receiptId || null,
            });
        });

        // Build delivery partner COD data
        const deliveryPartners = deliverySnapshot.docs.map(doc => {
            const data = doc.data();
            const cod = codByPartner[doc.id] || { collected: 0, orders: 0, pendingOrderIds: [] };
            const settled = settledByPartner[doc.id] || data.codSettled || 0;

            // Use Firestore values if available, otherwise calculated
            const codCollected = data.codCollected ?? cod.collected;
            const codSettled = data.codSettled ?? settled;
            const codPending = codCollected - codSettled;

            return {
                deliveryPersonId: doc.id,
                fullName: data.fullName || 'Unknown',
                profilePhotoUrl: data.profilePhotoUrl || '',
                phoneNumber: data.phoneNumber || '',
                city: data.city || '',
                isOnline: data.isOnline || false,
                isVerified: data.isVerified || false,
                // COD tracking
                codCollected: codCollected,
                codSettled: codSettled,
                codPending: codPending,
                pendingOrders: cod.pendingOrderIds.length,
                pendingOrderIds: cod.pendingOrderIds, // Include order IDs for settlement
                totalCodOrders: cod.orders,
            };
        }).filter(d => d.codCollected > 0 || d.codPending > 0);

        // Sort by pending COD (highest first)
        deliveryPartners.sort((a, b) => b.codPending - a.codPending);

        // Calculate summary
        const summary = {
            totalCodCollected: deliveryPartners.reduce((sum, d) => sum + d.codCollected, 0),
            totalCodSettled: deliveryPartners.reduce((sum, d) => sum + d.codSettled, 0),
            totalCodPending: deliveryPartners.reduce((sum, d) => sum + d.codPending, 0),
            partnersWithPending: deliveryPartners.filter(d => d.codPending > 0).length,
        };

        return NextResponse.json({
            success: true,
            data: {
                deliveryPartners,
                recentSettlements,
                summary,
            }
        });
    } catch (error) {
        console.error('COD tracking fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch COD data' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { deliveryPersonId, deliveryPersonName, amount, method, notes, orderIds } = body;

        if (!deliveryPersonId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Delivery person ID and valid amount required' },
                { status: 400 }
            );
        }

        // Generate a human-readable receipt ID
        const receiptId = `COD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        // Create settlement record
        const settlementRef = await db.collection('codSettlements').add({
            deliveryPersonId,
            deliveryPersonName: deliveryPersonName || '',
            amount,
            method: method || 'Cash',
            status: 'completed',
            notes: notes || null,
            orderIds: orderIds || [],
            ordersCount: orderIds?.length || 0,
            receiptId,
            createdAt: Timestamp.now(),
            processedAt: Timestamp.now(),
            processedBy: 'admin', // Can be enhanced to track admin user ID
        });

        // Update delivery person's amounts
        const deliveryPersonRef = db.collection(collections.deliveryPersons).doc(deliveryPersonId);
        const deliveryPersonDoc = await deliveryPersonRef.get();
        const currentData = deliveryPersonDoc.data() || {};
        
        // Reduce codCollected and increase codSettled
        const currentCodCollected = currentData.codCollected || 0;
        const currentCodSettled = currentData.codSettled || 0;
        const newCodCollected = Math.max(0, currentCodCollected - amount);
        const newCodSettled = currentCodSettled + amount;

        await deliveryPersonRef.update({
            codCollected: newCodCollected,
            codSettled: newCodSettled,
            lastCodSettlementAt: Timestamp.now(),
            lastCodSettlementId: settlementRef.id,
            updatedAt: Timestamp.now(),
        });

        // Mark individual orders as COD settled (if orderIds provided)
        if (orderIds && orderIds.length > 0) {
            const batch = db.batch();
            for (const orderId of orderIds) {
                const orderRef = db.collection(collections.orders).doc(orderId);
                batch.update(orderRef, {
                    codSettled: true,
                    codSettledAt: Timestamp.now(),
                    codSettlementId: settlementRef.id,
                    codReceiptId: receiptId,
                });
            }
            await batch.commit();
        }

        return NextResponse.json({
            success: true,
            message: `COD settlement of ₹${amount} recorded successfully`,
            settlementId: settlementRef.id,
            receiptId,
            ordersSettled: orderIds?.length || 0,
        });
    } catch (error) {
        console.error('COD settlement error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to record settlement' },
            { status: 500 }
        );
    }
}
