import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { collections } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { invalidateCache } from '@/lib/firebase-admin';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    try {
        const { vendorId } = await params;
        if (!vendorId) {
            return NextResponse.json(
                { success: false, error: 'Vendor ID is required' },
                { status: 400 }
            );
        }

        const body = await request.json();
        const { items } = body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Valid items array is required' },
                { status: 400 }
            );
        }

        // Chunk into batches of 250 (max 500 writes per batch, 2 writes per item: global and vendor subcollection)
        const chunkSize = 250;
        let updatedCount = 0;

        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            const batch = db.batch();

            chunk.forEach(item => {
                if (!item.itemId || item.imageUrl === undefined) return;

                const globalRef = db.collection(collections.menuItems).doc(item.itemId);
                const vendorRef = db
                    .collection(collections.vendors)
                    .doc(vendorId)
                    .collection(collections.menuItems)
                    .doc(item.itemId);

                const updateData = {
                    imageUrl: item.imageUrl,
                    updatedAt: FieldValue.serverTimestamp()
                };

                batch.update(globalRef, updateData);
                batch.update(vendorRef, updateData);
                updatedCount++;
            });

            await batch.commit();
        }

        // Invalidate caches
        invalidateCache(collections.menuItems);

        return NextResponse.json({
            success: true,
            updated: updatedCount,
            message: `Successfully updated ${updatedCount} item images`
        });

    } catch (error: any) {
        console.error('Bulk image API error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
