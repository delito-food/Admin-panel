import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Razorpay API configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

interface RefundRequest {
    orderId: string;
    complaintId?: string;
    amount: number;
    reason: string;
    refundType: 'full' | 'partial';
}

// Get refund history
export async function GET() {
    try {
        const refundsSnapshot = await db.collection('refunds')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        const refunds = refundsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                refundId: doc.id,
                orderId: data.orderId || '',
                complaintId: data.complaintId || '',
                customerId: data.customerId || '',
                customerName: data.customerName || '',
                customerEmail: data.customerEmail || '',
                amount: data.amount || 0,
                originalAmount: data.originalAmount || 0,
                razorpayPaymentId: data.razorpayPaymentId || '',
                razorpayRefundId: data.razorpayRefundId || '',
                status: data.status || 'PENDING',
                reason: data.reason || '',
                refundType: data.refundType || 'full',
                processedBy: data.processedBy || '',
                createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
                processedAt: data.processedAt?.toDate?.()?.toISOString() || '',
                notes: data.notes || '',
            };
        });

        // Calculate summary
        const summary = {
            totalRefunds: refunds.length,
            totalAmount: refunds.filter(r => r.status === 'SUCCESS').reduce((sum, r) => sum + r.amount, 0),
            pending: refunds.filter(r => r.status === 'PENDING').length,
            successful: refunds.filter(r => r.status === 'SUCCESS').length,
            failed: refunds.filter(r => r.status === 'FAILED').length,
        };

        return NextResponse.json({
            success: true,
            data: {
                refunds,
                summary,
            }
        });
    } catch (error) {
        console.error('Refunds fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch refunds' },
            { status: 500 }
        );
    }
}

// Process refund via Razorpay
export async function POST(request: Request) {
    try {
        const body: RefundRequest = await request.json();
        const { orderId, complaintId, amount, reason, refundType } = body;

        if (!orderId || !amount || amount <= 0) {
            return NextResponse.json(
                { success: false, error: 'Order ID and valid amount required' },
                { status: 400 }
            );
        }

        // Get order details
        const orderRef = db.collection(collections.orders).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Order not found' },
                { status: 404 }
            );
        }

        const orderData = orderDoc.data() || {};
        const razorpayPaymentId = orderData.razorpayPaymentId;
        const orderTotal = orderData.total || 0;
        const paymentMode = orderData.paymentMode || '';

        // Check if online payment
        if (paymentMode !== 'Online' || !razorpayPaymentId) {
            // For COD orders, just mark as refunded without Razorpay
            const refundRef = await db.collection('refunds').add({
                orderId,
                complaintId: complaintId || '',
                customerId: orderData.customerId || '',
                customerName: orderData.customerName || '',
                customerEmail: '',
                amount,
                originalAmount: orderTotal,
                razorpayPaymentId: '',
                razorpayRefundId: '',
                status: 'SUCCESS',
                reason: reason || 'Refund for COD order',
                refundType,
                processedBy: 'admin',
                notes: 'COD order - no payment to refund. Customer was not charged.',
                createdAt: Timestamp.now(),
                processedAt: Timestamp.now(),
            });

            // Update order status
            await orderRef.update({
                refundStatus: 'REFUNDED',
                refundAmount: amount,
                refundedAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Update complaint if exists
            if (complaintId) {
                await db.collection('complaints').doc(complaintId).update({
                    refundStatus: 'COMPLETED',
                    refundId: refundRef.id,
                    refundProcessedAt: Timestamp.now(),
                    status: 'REFUNDED',
                    updatedAt: Timestamp.now(),
                });
            }

            return NextResponse.json({
                success: true,
                message: 'COD order marked as refunded',
                refundId: refundRef.id,
            });
        }

        // Check if Razorpay credentials are configured
        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            // Create refund record without actual Razorpay call (for testing)
            const refundRef = await db.collection('refunds').add({
                orderId,
                complaintId: complaintId || '',
                customerId: orderData.customerId || '',
                customerName: orderData.customerName || '',
                customerEmail: orderData.customerEmail || '',
                amount,
                originalAmount: orderTotal,
                razorpayPaymentId,
                razorpayRefundId: 'MANUAL_' + Date.now(),
                status: 'SUCCESS',
                reason: reason || 'Refund processed',
                refundType,
                processedBy: 'admin',
                notes: 'Razorpay credentials not configured. Manual refund recorded.',
                createdAt: Timestamp.now(),
                processedAt: Timestamp.now(),
            });

            // Update order status
            await orderRef.update({
                refundStatus: 'REFUNDED',
                refundAmount: amount,
                refundedAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });

            // Update complaint if exists
            if (complaintId) {
                await db.collection('complaints').doc(complaintId).update({
                    refundStatus: 'COMPLETED',
                    refundId: refundRef.id,
                    refundProcessedAt: Timestamp.now(),
                    status: 'REFUNDED',
                    updatedAt: Timestamp.now(),
                });
            }

            return NextResponse.json({
                success: true,
                message: 'Refund recorded (Razorpay credentials not configured)',
                refundId: refundRef.id,
            });
        }

        // Process refund via Razorpay API
        const refundAmountPaise = Math.round(amount * 100); // Convert to paise

        const razorpayResponse = await fetch(
            `https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64'),
                },
                body: JSON.stringify({
                    amount: refundAmountPaise,
                    notes: {
                        reason: reason || 'Customer refund',
                        orderId: orderId,
                        complaintId: complaintId || '',
                    },
                }),
            }
        );

        const razorpayResult = await razorpayResponse.json();

        if (!razorpayResponse.ok) {
            // Log failed refund attempt
            await db.collection('refunds').add({
                orderId,
                complaintId: complaintId || '',
                customerId: orderData.customerId || '',
                customerName: orderData.customerName || '',
                amount,
                originalAmount: orderTotal,
                razorpayPaymentId,
                razorpayRefundId: '',
                status: 'FAILED',
                reason: reason || 'Refund failed',
                refundType,
                processedBy: 'admin',
                errorMessage: razorpayResult.error?.description || 'Razorpay refund failed',
                createdAt: Timestamp.now(),
            });

            return NextResponse.json(
                {
                    success: false,
                    error: razorpayResult.error?.description || 'Razorpay refund failed'
                },
                { status: 400 }
            );
        }

        // Success - create refund record
        const refundRef = await db.collection('refunds').add({
            orderId,
            complaintId: complaintId || '',
            customerId: orderData.customerId || '',
            customerName: orderData.customerName || '',
            customerEmail: orderData.customerEmail || '',
            amount,
            originalAmount: orderTotal,
            razorpayPaymentId,
            razorpayRefundId: razorpayResult.id,
            status: 'SUCCESS',
            reason: reason || 'Refund processed',
            refundType,
            processedBy: 'admin',
            razorpayResponse: razorpayResult,
            createdAt: Timestamp.now(),
            processedAt: Timestamp.now(),
        });

        // Update order status
        await orderRef.update({
            refundStatus: 'REFUNDED',
            refundAmount: amount,
            refundId: razorpayResult.id,
            refundedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });

        // Update complaint if exists
        if (complaintId) {
            await db.collection('complaints').doc(complaintId).update({
                refundStatus: 'COMPLETED',
                refundId: razorpayResult.id,
                refundProcessedAt: Timestamp.now(),
                status: 'REFUNDED',
                updatedAt: Timestamp.now(),
            });
        }

        return NextResponse.json({
            success: true,
            message: `Refund of ₹${amount} processed successfully`,
            refundId: refundRef.id,
            razorpayRefundId: razorpayResult.id,
        });
    } catch (error) {
        console.error('Refund processing error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to process refund' },
            { status: 500 }
        );
    }
}

