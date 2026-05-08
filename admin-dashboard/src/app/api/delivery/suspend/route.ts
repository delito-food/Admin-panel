import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Suspension reasons for delivery partners
export const DELIVERY_SUSPENSION_REASONS = {
    POLICY_VIOLATION: 'Policy Violation',
    CUSTOMER_COMPLAINTS: 'Multiple Customer Complaints',
    LATE_DELIVERIES: 'Consistent Late Deliveries',
    DOCUMENT_EXPIRED: 'Documents Expired (License/RC)',
    FRAUDULENT_ACTIVITY: 'Fraudulent Activity',
    COD_MISAPPROPRIATION: 'COD Amount Not Settled',
    RUDE_BEHAVIOR: 'Rude Behavior with Customers',
    TRAFFIC_VIOLATIONS: 'Traffic Violations Reported',
    UNAUTHORIZED_VEHICLE: 'Using Unauthorized Vehicle',
    INACTIVE: 'Extended Inactivity',
    OTHER: 'Other (See Notes)',
};

// POST - Suspend a delivery partner
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { deliveryPersonId, reason, notes, adminId } = body;

        if (!deliveryPersonId || !reason) {
            return NextResponse.json(
                { success: false, error: 'Delivery person ID and suspension reason are required' },
                { status: 400 }
            );
        }

        // Get delivery person to verify it exists
        const dpDoc = await db.collection(collections.deliveryPersons).doc(deliveryPersonId).get();
        if (!dpDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Delivery partner not found' },
                { status: 404 }
            );
        }

        const dpData = dpDoc.data();

        // Check if already suspended
        if (dpData?.isSuspended) {
            return NextResponse.json(
                { success: false, error: 'Delivery partner is already suspended' },
                { status: 400 }
            );
        }

        // Suspend the delivery partner
        await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update({
            isSuspended: true,
            isOnline: false, // Force offline
            isAvailable: false,
            suspensionReason: reason,
            suspensionNotes: notes || '',
            suspendedAt: Timestamp.now(),
            suspendedBy: adminId || 'admin',
            updatedAt: Timestamp.now(),
        });

        // Log the suspension action
        await db.collection('adminLogs').add({
            action: 'DELIVERY_PARTNER_SUSPENDED',
            targetId: deliveryPersonId,
            targetType: 'deliveryPerson',
            targetName: dpData?.fullName || '',
            reason: reason,
            notes: notes || '',
            adminId: adminId || 'admin',
            createdAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            message: `Delivery partner "${dpData?.fullName}" has been suspended`,
            data: {
                deliveryPersonId,
                fullName: dpData?.fullName,
                suspensionReason: reason,
                suspendedAt: new Date().toISOString(),
            }
        });
    } catch (error) {
        console.error('Delivery partner suspension error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to suspend delivery partner' },
            { status: 500 }
        );
    }
}

// DELETE - Unsuspend/Reinstate a delivery partner
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const deliveryPersonId = searchParams.get('deliveryPersonId');
        const adminId = searchParams.get('adminId') || 'admin';

        if (!deliveryPersonId) {
            return NextResponse.json(
                { success: false, error: 'Delivery person ID is required' },
                { status: 400 }
            );
        }

        // Get delivery partner to verify it exists
        const dpDoc = await db.collection(collections.deliveryPersons).doc(deliveryPersonId).get();
        if (!dpDoc.exists) {
            return NextResponse.json(
                { success: false, error: 'Delivery partner not found' },
                { status: 404 }
            );
        }

        const dpData = dpDoc.data();

        // Check if actually suspended
        if (!dpData?.isSuspended) {
            return NextResponse.json(
                { success: false, error: 'Delivery partner is not suspended' },
                { status: 400 }
            );
        }

        // Reinstate the delivery partner
        await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update({
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
            action: 'DELIVERY_PARTNER_REINSTATED',
            targetId: deliveryPersonId,
            targetType: 'deliveryPerson',
            targetName: dpData?.fullName || '',
            previousReason: dpData?.suspensionReason || '',
            adminId: adminId,
            createdAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            message: `Delivery partner "${dpData?.fullName}" has been reinstated`,
            data: {
                deliveryPersonId,
                fullName: dpData?.fullName,
                reinstatedAt: new Date().toISOString(),
            }
        });
    } catch (error) {
        console.error('Delivery partner reinstatement error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to reinstate delivery partner' },
            { status: 500 }
        );
    }
}

// GET - Get all suspended delivery partners
export async function GET() {
    try {
        const snapshot = await db.collection(collections.deliveryPersons)
            .where('isSuspended', '==', true)
            .get();

        const suspendedPartners = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                deliveryPersonId: doc.id,
                fullName: data.fullName || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                vehicleType: data.vehicleType || '',
                vehicleNumber: data.vehicleNumber || '',
                suspensionReason: data.suspensionReason || '',
                suspensionNotes: data.suspensionNotes || '',
                suspendedAt: data.suspendedAt?.toDate ? data.suspendedAt.toDate().toISOString() : data.suspendedAt,
                suspendedBy: data.suspendedBy || '',
                totalDeliveries: data.totalDeliveries || 0,
                rating: data.rating || 0,
                codCollected: data.codCollected || 0,
            };
        });

        return NextResponse.json({
            success: true,
            data: suspendedPartners,
            suspensionReasons: DELIVERY_SUSPENSION_REASONS
        });
    } catch (error) {
        console.error('Fetch suspended delivery partners error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch suspended delivery partners' },
            { status: 500 }
        );
    }
}

