import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { collections } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { invalidateCache } from '@/lib/firebase-admin';

export async function POST(
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

        // Fetch categories for validation
        const categoriesSnapshot = await db
            .collection(collections.categories)
            .where('vendorId', '==', vendorId)
            .get();

        const categoriesMap = new Map<string, string>(); // name to ID
        categoriesSnapshot.docs.forEach(doc => {
            categoriesMap.set(doc.data().name.toLowerCase(), doc.id);
        });

        // Identify and create missing categories
        const newCategoriesMap = new Map<string, { id: string, ref: any, originalName: string }>();
        
        items.forEach((item: any) => {
            if (item.categoryName) {
                const nameKey = item.categoryName.toLowerCase().trim();
                if (!categoriesMap.has(nameKey) && !newCategoriesMap.has(nameKey)) {
                    const newCatRef = db.collection(collections.categories).doc();
                    newCategoriesMap.set(nameKey, { id: newCatRef.id, ref: newCatRef, originalName: item.categoryName.trim() });
                }
            }
        });

        if (newCategoriesMap.size > 0) {
            const catBatch = db.batch();
            let currentSortOrder = categoriesSnapshot.size;
            
            newCategoriesMap.forEach((data, nameKey) => {
                catBatch.set(data.ref, {
                    categoryId: data.id,
                    vendorId,
                    name: data.originalName,
                    isActive: true,
                    sortOrder: currentSortOrder++,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
                // Add to our main map so items can find it
                categoriesMap.set(nameKey, data.id);
            });
            await catBatch.commit();
            invalidateCache(collections.categories);
        }

        const errors: { row: number; error: string }[] = [];
        const validItems: any[] = [];

        // Validate items
        items.forEach((item, index) => {
            const row = index + 1;
            
            if (!item.name || typeof item.name !== 'string') {
                errors.push({ row, error: 'Item name is required' });
                return;
            }
            
            if (item.price === undefined || item.price === null || isNaN(Number(item.price)) || Number(item.price) < 0) {
                errors.push({ row, error: 'Valid positive price is required' });
                return;
            }

            if (!item.categoryName) {
                errors.push({ row, error: 'Category name is required' });
                return;
            }

            const categoryId = categoriesMap.get(item.categoryName.toLowerCase().trim());
            if (!categoryId) {
                errors.push({ row, error: `Category '${item.categoryName}' could not be created.` });
                return;
            }

            const newItem = {
                ...item,
                price: Number(item.price),
                discount: item.discount ? Number(item.discount) : 0,
                preparationTime: item.preparationTime ? Number(item.preparationTime) : 15,
                isVeg: item.isVeg === true || item.isVeg === 'true' || item.isVeg === 'yes' || item.isVeg === 'veg',
                isAvailable: item.isAvailable !== undefined ? Boolean(item.isAvailable) : true,
                isBestSeller: item.isBestSeller !== undefined ? Boolean(item.isBestSeller) : false,
                imageUrl: '', // Explicitly empty for bulk uploads, as requested
                categoryId, // Matched category ID
                vendorId,
                verificationStatus: 'approved',
                isVerified: true,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                verifiedAt: FieldValue.serverTimestamp(),
                verifiedBy: 'admin',
                rating: 0,
                totalOrders: 0,
                variants: Array.isArray(item.variants) ? item.variants : [],
                addOns: Array.isArray(item.addOns) ? item.addOns : [],
                mealCombos: Array.isArray(item.mealCombos) ? item.mealCombos : [],
                tags: Array.isArray(item.tags) ? item.tags : []
            };

            validItems.push(newItem);
        });

        if (errors.length > 0) {
            return NextResponse.json(
                { success: false, errors },
                { status: 400 }
            );
        }

        // Chunk into batches of 250 (max 500 writes per batch, 2 writes per item)
        const chunkSize = 250;
        let createdCount = 0;

        for (let i = 0; i < validItems.length; i += chunkSize) {
            const chunk = validItems.slice(i, i + chunkSize);
            const batch = db.batch();

            chunk.forEach(item => {
                const globalRef = db.collection(collections.menuItems).doc();
                const vendorRef = db
                    .collection(collections.vendors)
                    .doc(vendorId)
                    .collection(collections.menuItems)
                    .doc(globalRef.id);

                const finalItem = { ...item, itemId: globalRef.id };

                batch.set(globalRef, finalItem);
                batch.set(vendorRef, finalItem);
                createdCount++;
            });

            await batch.commit();
        }

        // Invalidate caches
        invalidateCache(collections.menuItems);

        return NextResponse.json({
            success: true,
            created: createdCount,
            message: `Successfully created ${createdCount} items`
        });

    } catch (error: any) {
        console.error('Bulk API error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
