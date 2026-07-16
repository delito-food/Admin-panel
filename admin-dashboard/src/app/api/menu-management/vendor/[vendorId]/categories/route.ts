import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const snapshot = await db.collection(collections.categories).where('vendorId', '==', vendorId).get();
        const categories = snapshot.docs.map(doc => ({
            categoryId: doc.id,
            ...doc.data(),
        }));
        
        // Sort by sortOrder
        categories.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
        
        return NextResponse.json({ success: true, data: categories });
    } catch (error) {
        console.error('Fetch vendor categories error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch categories' }, { status: 500 });
    }
}

export async function POST(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const body = await request.json();
        
        const newCategory = {
            ...body,
            vendorId,
        };

        const batch = db.batch();
        
        // 1. Top-level collection
        const topLevelRef = db.collection(collections.categories).doc();
        const categoryId = topLevelRef.id;
        newCategory.categoryId = categoryId;
        batch.set(topLevelRef, newCategory);
        
        // 2. Vendor subcollection
        const subLevelRef = db.collection(collections.vendors).doc(vendorId).collection('categories').doc(categoryId);
        batch.set(subLevelRef, newCategory);
        
        await batch.commit();
        invalidateCache(collections.categories);
        
        return NextResponse.json({ success: true, data: newCategory });
    } catch (error) {
        console.error('Create vendor category error:', error);
        return NextResponse.json({ success: false, error: 'Failed to create category' }, { status: 500 });
    }
}

export async function PATCH(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const body = await request.json();
        const { categoryId, ...updateData } = body;
        
        if (!categoryId) {
            return NextResponse.json({ success: false, error: 'categoryId is required' }, { status: 400 });
        }
        
        const batch = db.batch();
        
        // 1. Top-level collection
        const topLevelRef = db.collection(collections.categories).doc(categoryId);
        batch.update(topLevelRef, updateData);
        
        // 2. Vendor subcollection
        const subLevelRef = db.collection(collections.vendors).doc(vendorId).collection('categories').doc(categoryId);
        batch.update(subLevelRef, updateData);
        
        await batch.commit();
        invalidateCache(collections.categories);
        
        return NextResponse.json({ success: true, message: 'Category updated successfully' });
    } catch (error) {
        console.error('Update vendor category error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update category' }, { status: 500 });
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ vendorId: string }> }) {
    try {
        const vendorId = (await context.params).vendorId;
        const { searchParams } = new URL(request.url);
        const categoryId = searchParams.get('categoryId');
        
        if (!categoryId) {
            return NextResponse.json({ success: false, error: 'categoryId is required' }, { status: 400 });
        }
        
        const batch = db.batch();
        
        // 1. Top-level collection
        const topLevelRef = db.collection(collections.categories).doc(categoryId);
        batch.delete(topLevelRef);
        
        // 2. Vendor subcollection
        const subLevelRef = db.collection(collections.vendors).doc(vendorId).collection('categories').doc(categoryId);
        batch.delete(subLevelRef);
        
        await batch.commit();
        invalidateCache(collections.categories);
        
        return NextResponse.json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Delete vendor category error:', error);
        return NextResponse.json({ success: false, error: 'Failed to delete category' }, { status: 500 });
    }
}
