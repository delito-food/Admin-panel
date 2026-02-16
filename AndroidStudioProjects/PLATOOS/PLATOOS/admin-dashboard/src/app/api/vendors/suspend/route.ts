import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Suspension reasons enum for consistency
export const SUSPENSION_REASONS = {
    POLICY_VIOLATION: 'Policy Violation',
    CUSTOMER_COMPLAINTS: 'Multiple Customer Complaints',
    FOOD_QUALITY: 'Food Quality Issues',
    HYGIENE_ISSUES: 'Hygiene Standards Not Met',
    DOCUMENT_EXPIRED: 'Documents Expired',
    FRAUDULENT_ACTIVITY: 'Fraudulent Activity',
    NON_COMPLIANCE: 'Non-compliance with Platform Rules',
    PAYMENT_ISSUES: 'Payment/Settlement Issues',
    INACTIVE: 'Extended Inactivity',
    OTHER: 'Other (See Notes)',
};

// POST - Suspend a vendor
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, reason, notes, adminId } = body;

        if (!vendorId || !reason) {
            return NextResponse.json(
                { success: false, error: 'Vendor ID and suspension reason are required' },
                { status: 400 }
            );
        }

        // Get vendor to verify it exists
        const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
        if (!vendorDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Vendor not found' },
                { status: 404 }
            );
        }

        const vendorData = vendorDoc.data();

        // Check if already suspended
        if (vendorData?.isSuspended) {
            return NextResponse.json(
                { success: false, error: 'Vendor is already suspended' },
                { status: 400 }
            );
        }

        // Suspend the vendor
        await db.collection(collections.vendors).doc(vendorId).update({
            isSuspended: true,
            isOnline: false, // Force offline
            suspensionReason: reason,
            suspensionNotes: notes || '',
            suspendedAt: Timestamp.now(),
            suspendedBy: adminId || 'admin',
            updatedAt: Timestamp.now(),
        });

        // Log the suspension action
        await db.collection('adminLogs').add({
            action: 'VENDOR_SUSPENDED',
            targetId: vendorId,
            targetType: 'vendor',
            targetName: vendorData?.shopName || '',
            reason: reason,
            notes: notes || '',
            adminId: adminId || 'admin',
            createdAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            message: `Vendor "${vendorData?.shopName}" has been suspended`,
            data: {
                vendorId,
                shopName: vendorData?.shopName,
                suspensionReason: reason,
                suspendedAt: new Date().toISOString(),
            }
        });
    } catch (error) {
        console.error('Vendor suspension error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to suspend vendor' },
            { status: 500 }
        );
    }
}

// DELETE - Unsuspend/Reinstate a vendor
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const vendorId = searchParams.get('vendorId');
        const adminId = searchParams.get('adminId') || 'admin';

        if (!vendorId) {
            return NextResponse.json(
                { success: false, error: 'Vendor ID is required' },
                { status: 400 }
            );
        }

        // Get vendor to verify it exists
        const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
        if (!vendorDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Vendor not found' },
                { status: 404 }
            );
        }

        const vendorData = vendorDoc.data();

        // Check if actually suspended
        if (!vendorData?.isSuspended) {
            return NextResponse.json(
                { success: false, error: 'Vendor is not suspended' },
                { status: 400 }
            );
        }

        // Reinstate the vendor
        await db.collection(collections.vendors).doc(vendorId).update({
            isSuspended: false,
            suspensionReason: '',
            suspensionNotes: '',
            suspendedAt: null,
            suspendedBy: '',
            reinstatedAt: Timestamp.now(),
            reinstatedBy: adminId,
            updatedAt: Timestamp.now(),
        });

        // Log the reinstatement action
        await db.collection('adminLogs').add({
            action: 'VENDOR_REINSTATED',
            targetId: vendorId,
            targetType: 'vendor',
            targetName: vendorData?.shopName || '',
            previousReason: vendorData?.suspensionReason || '',
            adminId: adminId,
            createdAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            message: `Vendor "${vendorData?.shopName}" has been reinstated`,
            data: {
                vendorId,
                shopName: vendorData?.shopName,
                reinstatedAt: new Date().toISOString(),
            }
        });
    } catch (error) {
        console.error('Vendor reinstatement error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to reinstate vendor' },
            { status: 500 }
        );
    }
}

// GET - Get all suspended vendors
export async function GET() {
    try {
        const snapshot = await db.collection(collections.vendors)
            .where('isSuspended', '==', true)
            .get();

        const suspendedVendors = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                vendorId: doc.id,
                shopName: data.shopName || '',
                fullName: data.fullName || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                suspensionReason: data.suspensionReason || '',
                suspensionNotes: data.suspensionNotes || '',
                suspendedAt: data.suspendedAt?.toDate ? data.suspendedAt.toDate().toISOString() : data.suspendedAt,
                suspendedBy: data.suspendedBy || '',
                totalOrders: data.totalOrders || 0,
                rating: data.rating || 0,
            };
        });

        return NextResponse.json({
            success: true,
            data: suspendedVendors,
            suspensionReasons: SUSPENSION_REASONS
        });
    } catch (error) {
        console.error('Fetch suspended vendors error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch suspended vendors' },
            { status: 500 }
        );
    }
}

