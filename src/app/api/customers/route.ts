import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Convert Firestore Timestamp or various date formats to ISO string
function toISOString(val: unknown): string {
    if (!val) return '';
    if (val instanceof Timestamp) return val.toDate().toISOString();
    if (typeof val === 'object' && val !== null && '_seconds' in val) {
        return new Date((val as { _seconds: number })._seconds * 1000).toISOString();
    }
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return new Date(val).toISOString();
    return '';
}

export async function GET() {
    try {
        // Get all customers
        const customersSnapshot = await db.collection(collections.customers).get();

        // Get all orders to calculate spending per customer
        const ordersSnapshot = await db.collection(collections.orders).get();

        // Build a map of customer spending from orders
        const customerSpending: Record<string, { totalSpent: number; totalOrders: number; lastOrderAt: string }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const customerId = order.customerId;
            if (!customerId) return;

            if (!customerSpending[customerId]) {
                customerSpending[customerId] = { totalSpent: 0, totalOrders: 0, lastOrderAt: '' };
            }

            // Only count completed/delivered orders for spending
            if (order.status === 'Delivered' || order.status === 'Completed') {
                customerSpending[customerId].totalSpent += (order.total || order.grandTotal || 0);
            }

            customerSpending[customerId].totalOrders += 1;

            // Track latest order
            const orderDate = toISOString(order.createdAt);
            if (orderDate > customerSpending[customerId].lastOrderAt) {
                customerSpending[customerId].lastOrderAt = orderDate;
            }
        });

        const customers = customersSnapshot.docs.map(doc => {
            const data = doc.data();
            const spending = customerSpending[doc.id] || { totalSpent: 0, totalOrders: 0, lastOrderAt: '' };

            return {
                customerId: doc.id,
                fullName: data.fullName || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                profileImageUrl: data.profileImageUrl || '',
                address: data.addresses?.[0]?.fullAddress || '',
                city: data.addresses?.[0]?.city || '',
                pincode: data.addresses?.[0]?.pincode || '',
                addresses: data.addresses || [],
                totalOrders: spending.totalOrders || data.totalOrders || 0,
                totalSpent: spending.totalSpent || 0,
                lastOrderAt: spending.lastOrderAt || toISOString(data.lastOrderAt) || '',
                registeredAt: toISOString(data.createdAt) || new Date().toISOString(),
                createdAt: toISOString(data.createdAt) || new Date().toISOString(),
                status: data.status || 'active',
            };
        });

        return NextResponse.json({ success: true, data: customers });
    } catch (error) {
        console.error('Customers fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch customers' },
            { status: 500 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { customerId, updates } = body;

        if (!customerId) {
            return NextResponse.json(
                { success: false, error: 'Customer ID required' },
                { status: 400 }
            );
        }

        await db.collection(collections.customers).doc(customerId).update({
            ...updates,
            updatedAt: Timestamp.now(),
        });

        return NextResponse.json({ success: true, message: 'Customer updated' });
    } catch (error) {
        console.error('Customer update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update customer' },
            { status: 500 }
        );
    }
}
