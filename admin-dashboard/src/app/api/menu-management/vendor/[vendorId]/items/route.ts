import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const snapshot = await db.collection(collections.menuItems).where('vendorId', '==', vendorId).get();
        const items = snapshot.docs.map(doc => ({
            itemId: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
            updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null,
            verifiedAt: doc.data().verifiedAt?.toDate?.()?.toISOString() || null,
        }));
        
        return NextResponse.json({ success: true, data: items });
    } catch (error) {
        console.error('Fetch vendor menu items error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch items' }, { status: 500 });
    }
}

export async function POST(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const body = await request.json();
        
        // Auto-approve since admin is creating it
        const newItem = {
            ...body,
            vendorId,
            verificationStatus: 'approved',
            isVerified: true,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            verifiedAt: Timestamp.now(),
            verifiedBy: 'admin',
        };

        const batch = db.batch();
        
        // 1. Top-level collection
        const topLevelRef = db.collection(collections.menuItems).doc();
        const itemId = topLevelRef.id;
        newItem.itemId = itemId;
        batch.set(topLevelRef, newItem);
        
        // 2. Vendor subcollection
        const subLevelRef = db.collection(collections.vendors).doc(vendorId).collection('menuItems').doc(itemId);
        batch.set(subLevelRef, newItem);
        
        await batch.commit();
        invalidateCache(collections.menuItems);
        
        return NextResponse.json({ success: true, data: newItem });
    } catch (error) {
        console.error('Create vendor menu item error:', error);
        return NextResponse.json({ success: false, error: 'Failed to create item' }, { status: 500 });
    }
}

export async function PATCH(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const body = await request.json();
        const { itemId, ...updateData } = body;
        
        if (!itemId) {
            return NextResponse.json({ success: false, error: 'itemId is required' }, { status: 400 });
        }
        
        // Clean up date strings if they were passed back from the client
        delete updateData.createdAt;
        delete updateData.verifiedAt;
        delete updateData.updatedAt;
        delete updateData.approvedAt;
        delete updateData.submittedAt;
        
        updateData.updatedAt = Timestamp.now();
        
        const batch = db.batch();
        
        // 1. Top-level collection
        const topLevelRef = db.collection(collections.menuItems).doc(itemId);
        batch.set(topLevelRef, updateData, { merge: true });
        
        // 2. Vendor subcollection
        const subLevelRef = db.collection(collections.vendors).doc(vendorId).collection('menuItems').doc(itemId);
        batch.set(subLevelRef, updateData, { merge: true });
        
        await batch.commit();
        invalidateCache(collections.menuItems);
        
        return NextResponse.json({ success: true, message: 'Item updated successfully' });
    } catch (error) {
        console.error('Update vendor menu item error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update item' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const { searchParams } = new URL(request.url);
        const itemId = searchParams.get('itemId');
        
        if (!itemId) {
            return NextResponse.json({ success: false, error: 'itemId is required' }, { status: 400 });
        }
        
        const batch = db.batch();
        
        // 1. Top-level collection
        const topLevelRef = db.collection(collections.menuItems).doc(itemId);
        batch.delete(topLevelRef);
        
        // 2. Vendor subcollection
        const subLevelRef = db.collection(collections.vendors).doc(vendorId).collection('menuItems').doc(itemId);
        batch.delete(subLevelRef);
        
        await batch.commit();
        invalidateCache(collections.menuItems);
        
        return NextResponse.json({ success: true, message: 'Item deleted successfully' });
    } catch (error) {
        console.error('Delete vendor menu item error:', error);
        return NextResponse.json({ success: false, error: 'Failed to delete item' }, { status: 500 });
    }
}
