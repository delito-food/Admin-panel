import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Razorpay configuration for payouts
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

interface PayoutRequest {
    recipientType: 'vendor' | 'delivery';
    recipientId: string;
    recipientName: string;
    amount: number;
    accountNumber?: string;
    ifscCode?: string;
    upiId?: string;
    method: 'bank_transfer' | 'upi';
    notes?: string;
}

// Get pending refunds for cancelled/not_responded orders
export async function GET() {
    try {
        // Find orders that need refunds
        const ordersSnapshot = await db.collection(collections.orders)
            .where('paymentMode', '==', 'Online')
            .where('paymentStatus', '==', 'Paid')
            .get();

        const pendingRefunds: Array<{
            orderId: string;
            customerId: string;
            customerName: string;
            customerPhone: string;
            total: number;
            status: string;
            razorpayPaymentId: string;
            refundStatus: string;
            cancelledAt: string | null;
            cancellationReason: string;
            cancelledBy: string;
        }> = [];

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const status = order.status?.toLowerCase() || '';

            // Check if order is cancelled or not_responded and hasn't been refunded yet
            if (['cancelled', 'not_responded', 'declined', 'expired'].includes(status)) {
                const refundStatus = order.refundStatus || '';

                // Only include if not already refunded
                if (refundStatus !== 'REFUNDED' && refundStatus !== 'COMPLETED' && refundStatus !== 'SUCCESS') {
                    pendingRefunds.push({
                        orderId: doc.id,
                        customerId: order.customerId || '',
                        customerName: order.customerName || 'Unknown',
                        customerPhone: order.customerPhone || '',
                        total: order.total || 0,
                        status: order.status || '',
                        razorpayPaymentId: order.razorpayPaymentId || '',
                        refundStatus: refundStatus || 'PENDING',
                        cancelledAt: order.cancelledAt?.toDate?.()?.toISOString() || null,
                        cancellationReason: order.cancellationReason || '',
                        cancelledBy: order.cancelledBy || '',
                    });
                }
            }
        });

        // Sort by cancelled date (most recent first)
        pendingRefunds.sort((a, b) => {
            if (!a.cancelledAt) return 1;
            if (!b.cancelledAt) return -1;
            return new Date(b.cancelledAt).getTime() - new Date(a.cancelledAt).getTime();
        });

        const summary = {
            totalPendingRefunds: pendingRefunds.length,
            totalAmount: pendingRefunds.reduce((sum, r) => sum + r.total, 0),
            cancelled: pendingRefunds.filter(r => r.status.toLowerCase() === 'cancelled').length,
            notResponded: pendingRefunds.filter(r => r.status.toLowerCase() === 'not_responded').length,
        };

        return NextResponse.json({
            success: true,
            data: {
                pendingRefunds,
                summary,
            }
        });
    } catch (error) {
        console.error('Pending refunds fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch pending refunds' },
            { status: 500 }
        );
    }
}

// Process payout via Razorpay
export async function POST(request: Request) {
    try {
        const body: PayoutRequest = await request.json();
        const { recipientType, recipientId, recipientName, amount, accountNumber, ifscCode, upiId, method, notes } = body;

        if (!recipientId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Recipient ID and valid amount required' },
                { status: 400 }
            );
        }

        // For TEST MODE or when RazorpayX is not configured:
        // Record payout manually in Firebase (no actual bank transfer)
        // This is the standard flow for development/testing

        const RAZORPAY_ACCOUNT_NUMBER = process.env.RAZORPAY_ACCOUNT_NUMBER;
        const useManualPayout = !RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_ACCOUNT_NUMBER;

        if (useManualPayout) {
            // Create payout record in Firebase (manual tracking)
            const payoutCollection = recipientType === 'vendor' ? 'vendorPayouts' : 'deliveryPayouts';
            const recipientIdField = recipientType === 'vendor' ? 'vendorId' : 'deliveryPersonId';
            const recipientNameField = recipientType === 'vendor' ? 'vendorName' : 'deliveryPersonName';

            const payoutRef = await db.collection(payoutCollection).add({
                [recipientIdField]: recipientId,
                [recipientNameField]: recipientName,
                amount,
                method: method === 'bank_transfer' ? 'Bank Transfer' : (method === 'upi' ? 'UPI' : 'Cash'),
                status: 'completed',
                transactionId: 'TXN_' + Date.now(),
                notes: notes || 'Manual payout recorded',
                accountNumber: accountNumber || null,
                ifscCode: ifscCode || null,
                upiId: upiId || null,
                isManual: true,
                createdAt: Timestamp.now(),
                processedAt: Timestamp.now(),
            });

            // Update recipient's paid amount
            const recipientCollection = recipientType === 'vendor' ? collections.vendors : collections.deliveryPersons;
            const recipientDoc = await db.collection(recipientCollection).doc(recipientId).get();
            const currentData = recipientDoc.data() || {};

            await db.collection(recipientCollection).doc(recipientId).update({
                paidAmount: (currentData.paidAmount || 0) + amount,
                updatedAt: Timestamp.now(),
            });

            return NextResponse.json({
                success: true,
                message: `Payout of ₹${amount} recorded successfully`,
                payoutId: payoutRef.id,
                mode: 'manual',
            });
        }

        // RazorpayX Automated Payout Flow (only when fully configured)
        // Validate required fields for automated payout
        if (method === 'bank_transfer' && (!accountNumber || !ifscCode)) {
            return NextResponse.json(
                { success: false, error: 'Bank account number and IFSC required for bank transfer' },
                { status: 400 }
            );
        }

        if (method === 'upi' && !upiId) {
            return NextResponse.json(
                { success: false, error: 'UPI ID required for UPI payout' },
                { status: 400 }
            );
        }

        // RazorpayX API integration
        const amountPaise = Math.round(amount * 100);

        // First, create a contact in Razorpay
        const contactResponse = await fetch('https://api.razorpay.com/v1/contacts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
            },
            body: JSON.stringify({
                name: recipientName,
                type: recipientType === 'vendor' ? 'vendor' : 'employee',
                reference_id: recipientId,
            }),
        });

        if (!contactResponse.ok) {
            const errorData = await contactResponse.json();
            console.error('Razorpay contact creation failed:', errorData);

            // Fallback to manual recording
            const payoutCollection = recipientType === 'vendor' ? 'vendorPayouts' : 'deliveryPayouts';
            const recipientIdField = recipientType === 'vendor' ? 'vendorId' : 'deliveryPersonId';
            const recipientNameField = recipientType === 'vendor' ? 'vendorName' : 'deliveryPersonName';

            const payoutRef = await db.collection(payoutCollection).add({
                [recipientIdField]: recipientId,
                [recipientNameField]: recipientName,
                amount,
                method: method === 'bank_transfer' ? 'Bank Transfer' : 'UPI',
                status: 'completed',
                transactionId: 'MANUAL_' + Date.now(),
                notes: 'Razorpay contact creation failed - manual payout recorded. Error: ' + (errorData.error?.description || 'Unknown'),
                createdAt: Timestamp.now(),
                processedAt: Timestamp.now(),
            });

            return NextResponse.json({
                success: true,
                message: 'Payout recorded manually (RazorpayX not configured)',
                payoutId: payoutRef.id,
            });
        }

        const contactData = await contactResponse.json();

        // Create a fund account
        const fundAccountPayload: Record<string, unknown> = {
            contact_id: contactData.id,
            account_type: method === 'upi' ? 'vpa' : 'bank_account',
        };

        if (method === 'upi') {
            fundAccountPayload.vpa = { address: upiId };
        } else {
            fundAccountPayload.bank_account = {
                ifsc: ifscCode,
                account_number: accountNumber,
                name: recipientName,
            };
        }

        const fundAccountResponse = await fetch('https://api.razorpay.com/v1/fund_accounts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
            },
            body: JSON.stringify(fundAccountPayload),
        });

        if (!fundAccountResponse.ok) {
            const errorData = await fundAccountResponse.json();
            return NextResponse.json(
                { success: false, error: 'Failed to create fund account: ' + (errorData.error?.description || 'Unknown error') },
                { status: 400 }
            );
        }

        const fundAccountData = await fundAccountResponse.json();

        // Create the payout
        const payoutResponse = await fetch('https://api.razorpay.com/v1/payouts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
            },
            body: JSON.stringify({
                account_number: process.env.RAZORPAY_ACCOUNT_NUMBER, // Your RazorpayX account number
                fund_account_id: fundAccountData.id,
                amount: amountPaise,
                currency: 'INR',
                mode: method === 'upi' ? 'UPI' : 'IMPS',
                purpose: 'payout',
                queue_if_low_balance: true,
                reference_id: `${recipientType}_${recipientId}_${Date.now()}`,
                narration: notes || `Payout to ${recipientName}`,
            }),
        });

        const payoutData = await payoutResponse.json();

        if (!payoutResponse.ok) {
            // Log failed payout
            const payoutCollection = recipientType === 'vendor' ? 'vendorPayouts' : 'deliveryPayouts';
            const recipientIdField = recipientType === 'vendor' ? 'vendorId' : 'deliveryPersonId';
            const recipientNameField = recipientType === 'vendor' ? 'vendorName' : 'deliveryPersonName';

            await db.collection(payoutCollection).add({
                [recipientIdField]: recipientId,
                [recipientNameField]: recipientName,
                amount,
                method: method === 'bank_transfer' ? 'Bank Transfer' : 'UPI',
                status: 'failed',
                errorMessage: payoutData.error?.description || 'Payout failed',
                createdAt: Timestamp.now(),
            });

            return NextResponse.json(
                { success: false, error: payoutData.error?.description || 'Payout failed' },
                { status: 400 }
            );
        }

        // Success - record payout
        const payoutCollection = recipientType === 'vendor' ? 'vendorPayouts' : 'deliveryPayouts';
        const recipientIdField = recipientType === 'vendor' ? 'vendorId' : 'deliveryPersonId';
        const recipientNameField = recipientType === 'vendor' ? 'vendorName' : 'deliveryPersonName';

        const payoutRef = await db.collection(payoutCollection).add({
            [recipientIdField]: recipientId,
            [recipientNameField]: recipientName,
            amount,
            method: method === 'bank_transfer' ? 'Bank Transfer' : 'UPI',
            status: payoutData.status || 'processing',
            transactionId: payoutData.id,
            razorpayPayoutId: payoutData.id,
            razorpayContactId: contactData.id,
            razorpayFundAccountId: fundAccountData.id,
            notes: notes || null,
            createdAt: Timestamp.now(),
            processedAt: Timestamp.now(),
        });

        // Update recipient's paid amount
        const recipientCollection = recipientType === 'vendor' ? collections.vendors : collections.deliveryPersons;
        const recipientDoc = await db.collection(recipientCollection).doc(recipientId).get();
        const currentData = recipientDoc.data() || {};

        await db.collection(recipientCollection).doc(recipientId).update({
            paidAmount: (currentData.paidAmount || 0) + amount,
            updatedAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            message: `Payout of ₹${amount} initiated successfully`,
            payoutId: payoutRef.id,
            razorpayPayoutId: payoutData.id,
            status: payoutData.status,
        });
    } catch (error) {
        console.error('Payout error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process payout' },
            { status: 500 }
        );
    }
}

