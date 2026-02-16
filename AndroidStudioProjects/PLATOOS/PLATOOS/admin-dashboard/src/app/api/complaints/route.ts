import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

interface ComplaintData {
    complaintId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    type: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    orderId: string;
    vendorId: string;
    vendorName: string;
    deliveryPersonId: string;
    deliveryPersonName: string;
    orderTotal: number;
    paymentMode: string;
    razorpayPaymentId: string;
    refundRequested: boolean;
    refundAmount: number;
    refundStatus: string;
    refundId: string;
    resolution: string;
    adminNotes: string;
    createdAt: string;
    updatedAt: string;
}

// Get all complaints
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const priority = searchParams.get('priority');
        const type = searchParams.get('type');

        let query = db.collection('complaints').orderBy('createdAt', 'desc');

        // Note: Firestore requires composite indexes for multiple where clauses
        // For simplicity, we'll filter in-memory

        const snapshot = await query.limit(200).get();

        let complaints = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                complaintId: doc.id,
                customerId: data.customerId || '',
                customerName: data.customerName || 'Unknown',
                customerPhone: data.customerPhone || '',
                customerEmail: data.customerEmail || '',
                type: data.type || 'OTHER',
                subject: data.subject || '',
                description: data.description || '',
                status: data.status || 'OPEN',
                priority: data.priority || 'MEDIUM',
                orderId: data.orderId || '',
                vendorId: data.vendorId || '',
                vendorName: data.vendorName || '',
                deliveryPersonId: data.deliveryPersonId || '',
                deliveryPersonName: data.deliveryPersonName || '',
                orderTotal: data.orderTotal || 0,
                paymentMode: data.paymentMode || '',
                razorpayPaymentId: data.razorpayPaymentId || '',
                refundRequested: data.refundRequested || false,
                refundAmount: data.refundAmount || 0,
                refundStatus: data.refundStatus || '',
                refundId: data.refundId || '',
                resolution: data.resolution || '',
                adminNotes: data.adminNotes || '',
                createdAt: data.createdAt?.toDate?.()?.toISOString() || '',
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || '',
            };
        });

        // Apply filters in memory
        if (status) {
            complaints = complaints.filter(c => c.status === status);
        }
        if (priority) {
            complaints = complaints.filter(c => c.priority === priority);
        }
        if (type) {
            complaints = complaints.filter(c => c.type === type);
        }

        // Calculate summary
        const allComplaints = snapshot.docs.map(doc => doc.data());
        const summary = {
            total: allComplaints.length,
            open: allComplaints.filter(c => c.status === 'OPEN').length,
            inProgress: allComplaints.filter(c => c.status === 'IN_PROGRESS').length,
            resolved: allComplaints.filter(c => c.status === 'RESOLVED' || c.status === 'CLOSED').length,
            refundPending: allComplaints.filter(c => c.refundRequested && c.refundStatus === 'PENDING').length,
            highPriority: allComplaints.filter(c => c.priority === 'HIGH' || c.priority === 'URGENT').length,
        };

        return NextResponse.json({
            success: true,
            data: {
                complaints,
                summary,
            }
        });
    } catch (error) {
        console.error('Complaints fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch complaints' },
            { status: 500 }
        );
    }
}

// Update complaint status or add resolution
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { complaintId, status, resolution, adminNotes, priority } = body;

        if (!complaintId) {
            return NextResponse.json(
                { success: false, error: 'Complaint ID required' },
                { status: 400 }
            );
        }

        const complaintRef = db.collection('complaints').doc(complaintId);
        const complaintDoc = await complaintRef.get();

        if (!complaintDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Complaint not found' },
                { status: 404 }
            );
        }

        const updateData: Record<string, unknown> = {
            updatedAt: Timestamp.now(),
        };

        if (status) {
            updateData.status = status;
            if (status === 'RESOLVED' || status === 'CLOSED') {
                updateData.resolvedAt = Timestamp.now();
                updateData.resolvedBy = 'admin';
            }
        }
        if (resolution !== undefined) {
            updateData.resolution = resolution;
        }
        if (adminNotes !== undefined) {
            updateData.adminNotes = adminNotes;
        }
        if (priority) {
            updateData.priority = priority;
        }

        await complaintRef.update(updateData);

        return NextResponse.json({
            success: true,
            message: 'Complaint updated successfully',
        });
    } catch (error) {
        console.error('Complaint update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update complaint' },
            { status: 500 }
        );
    }
}

