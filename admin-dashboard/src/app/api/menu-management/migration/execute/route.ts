import { NextResponse } from 'next/server';
import { db, collections, invalidateCache } from '@/lib/firebase-admin';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { oldVendorId, newVendorId, action } = body;
        
        if (!oldVendorId || !newVendorId || !action) {
            return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
        }
        
        if (action === 'copy') {
            // Temporary Migration: Copy from old to new
            const [itemsSnapshot, categoriesSnapshot] = await Promise.all([
                db.collection(collections.menuItems).where('vendorId', '==', oldVendorId).get(),
                db.collection(collections.categories).where('vendorId', '==', oldVendorId).get(),
            ]);
            
            const batch = db.batch();
            
            // Clone Menu Items
            itemsSnapshot.docs.forEach(doc => {
                const data = doc.data();
                const newId = db.collection(collections.menuItems).doc().id; // generate new ID
                const clonedData = {
                    ...data,
                    itemId: newId,
                    vendorId: newVendorId,
                    migratedFrom: oldVendorId,
                    originalItemId: doc.id
                };
                
                // Save to new top-level
                batch.set(db.collection(collections.menuItems).doc(newId), clonedData);
                // Save to new subcollection
                batch.set(db.collection(collections.vendors).doc(newVendorId).collection('menuItems').doc(newId), clonedData);
            });
            
            // Clone Categories
            categoriesSnapshot.docs.forEach(doc => {
                const data = doc.data();
                const newId = db.collection(collections.categories).doc().id;
                const clonedData = {
                    ...data,
                    categoryId: newId,
                    vendorId: newVendorId,
                    migratedFrom: oldVendorId,
                    originalCategoryId: doc.id
                };
                
                // Save to new top-level
                batch.set(db.collection(collections.categories).doc(newId), clonedData);
                // Save to new subcollection
                batch.set(db.collection(collections.vendors).doc(newVendorId).collection('categories').doc(newId), clonedData);
            });
            
            await batch.commit();
            invalidateCache(collections.menuItems);
            invalidateCache(collections.categories);
            
            return NextResponse.json({ success: true, message: 'Temporary copy complete. Please verify in the app.' });
        } 
        
        else if (action === 'confirm') {
            // Permanent: Delete the old orphaned data
            const [itemsSnapshot, categoriesSnapshot] = await Promise.all([
                db.collection(collections.menuItems).where('vendorId', '==', oldVendorId).get(),
                db.collection(collections.categories).where('vendorId', '==', oldVendorId).get(),
            ]);
            
            const batch = db.batch();
            
            // Delete old items
            itemsSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
                batch.delete(db.collection(collections.vendors).doc(oldVendorId).collection('menuItems').doc(doc.id));
            });
            
            // Delete old categories
            categoriesSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
                batch.delete(db.collection(collections.vendors).doc(oldVendorId).collection('categories').doc(doc.id));
            });
            
            // Also, remove the 'migratedFrom' fields from the newly copied data if needed,
            // or just leave them. We will just leave them for audit trailing.
            
            await batch.commit();
            invalidateCache(collections.menuItems);
            invalidateCache(collections.categories);
            
            return NextResponse.json({ success: true, message: 'Migration confirmed and orphaned data erased.' });
        }
        
        else if (action === 'revert') {
            // Revert: Delete the cloned data from newVendorId
            const [itemsSnapshot, categoriesSnapshot] = await Promise.all([
                db.collection(collections.menuItems).where('vendorId', '==', newVendorId).where('migratedFrom', '==', oldVendorId).get(),
                db.collection(collections.categories).where('vendorId', '==', newVendorId).where('migratedFrom', '==', oldVendorId).get(),
            ]);
            
            const batch = db.batch();
            
            itemsSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
                batch.delete(db.collection(collections.vendors).doc(newVendorId).collection('menuItems').doc(doc.id));
            });
            
            categoriesSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
                batch.delete(db.collection(collections.vendors).doc(newVendorId).collection('categories').doc(doc.id));
            });
            
            await batch.commit();
            invalidateCache(collections.menuItems);
            invalidateCache(collections.categories);
            
            return NextResponse.json({ success: true, message: 'Migration reverted successfully.' });
        }
        
        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
        
    } catch (error) {
        console.error('Migration execute error:', error);
        return NextResponse.json({ success: false, error: 'Failed to execute migration' }, { status: 500 });
    }
}
