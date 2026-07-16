import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const oldVendorId = searchParams.get('oldVendorId');
        
        if (!oldVendorId) {
            return NextResponse.json({ success: false, error: 'oldVendorId is required' }, { status: 400 });
        }
        
        // Query top-level collections
        const [itemsSnapshot, categoriesSnapshot] = await Promise.all([
            db.collection(collections.menuItems).where('vendorId', '==', oldVendorId).get(),
            db.collection(collections.categories).where('vendorId', '==', oldVendorId).get(),
        ]);
        
        return NextResponse.json({
            success: true,
            data: {
                itemCount: itemsSnapshot.size,
                categoryCount: categoriesSnapshot.size,
            }
        });
    } catch (error) {
        console.error('Migration search error:', error);
        return NextResponse.json({ success: false, error: 'Failed to search data' }, { status: 500 });
    }
}
