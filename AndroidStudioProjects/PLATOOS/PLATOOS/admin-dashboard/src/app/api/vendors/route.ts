import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Get all vendors
        const vendorsSnapshot = await db.collection(collections.vendors).get();

        // Get all menu items to calculate counts, discounts, and get images per vendor
        const menuItemsSnapshot = await db.collection(collections.menuItems).get();

        // Get all orders to calculate earnings per vendor
        const ordersSnapshot = await db.collection(collections.orders).get();

        // Build menu items map per vendor
        const vendorMenuData: Record<string, {
            menuItems: Array<{
                itemId: string;
                name: string;
                price: number;
                imageUrl: string;
                discount: number;
                isAvailable: boolean;
                isBestSeller: boolean;
                isVeg: boolean;
                categoryName: string;
            }>;
            menuItemsCount: number;
            specialOffers: Array<{
                itemId: string;
                name: string;
                price: number;
                discount: number;
                imageUrl: string;
            }>;
        }> = {};

        menuItemsSnapshot.docs.forEach(doc => {
            const item = doc.data();
            const vendorId = item.vendorId;
            if (!vendorId) return;

            if (!vendorMenuData[vendorId]) {
                vendorMenuData[vendorId] = { menuItems: [], menuItemsCount: 0, specialOffers: [] };
            }

            const menuItem = {
                itemId: doc.id,
                name: item.name || '',
                price: item.price || 0,
                imageUrl: item.imageUrl || '',
                discount: item.discount || 0,
                isAvailable: item.isAvailable !== false,
                isBestSeller: item.isBestSeller || false,
                isVeg: item.isVeg || false,
                categoryName: item.categoryName || '',
            };

            vendorMenuData[vendorId].menuItems.push(menuItem);
            vendorMenuData[vendorId].menuItemsCount += 1;

            // Track items with discounts as special offers
            if (item.discount && item.discount > 0) {
                vendorMenuData[vendorId].specialOffers.push({
                    itemId: doc.id,
                    name: item.name || '',
                    price: item.price || 0,
                    discount: item.discount,
                    imageUrl: item.imageUrl || '',
                });
            }
        });

        // Build vendor earnings from orders
        const vendorEarnings: Record<string, { totalEarnings: number; totalOrders: number }> = {};

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const vendorId = order.vendorId;
            if (!vendorId) return;

            if (!vendorEarnings[vendorId]) {
                vendorEarnings[vendorId] = { totalEarnings: 0, totalOrders: 0 };
            }

            vendorEarnings[vendorId].totalOrders += 1;

            if (order.status === 'Delivered' || order.status === 'Completed') {
                // Vendor gets subtotal (before delivery fee and platform commission)
                vendorEarnings[vendorId].totalEarnings += (order.subtotal || order.total || 0);
            }
        });

        const vendors = vendorsSnapshot.docs.map(doc => {
            const data = doc.data();
            const menuData = vendorMenuData[doc.id] || { menuItems: [], menuItemsCount: 0, specialOffers: [] };
            const earnings = vendorEarnings[doc.id] || { totalEarnings: 0, totalOrders: 0 };

            return {
                vendorId: doc.id,
                fullName: data.fullName || '',
                shopName: data.shopName || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                profileImageUrl: data.profileImageUrl || '',
                shopImageUrl: data.shopImageUrl || data.profileImageUrl || '',
                address: data.address || '',
                city: data.city || '',
                pincode: data.pincode || '',
                gstNumber: data.gstNumber || '',
                fssaiLicense: data.fssaiLicense || '',
                rating: data.rating || 0,
                totalOrders: earnings.totalOrders || data.totalOrders || 0,
                totalEarnings: earnings.totalEarnings || data.totalEarnings || 0,
                menuItemsCount: menuData.menuItemsCount,
                menuItems: menuData.menuItems.slice(0, 10), // Top 10 items for preview
                specialOffers: menuData.specialOffers, // Items with discounts
                isOnline: data.isOnline || false,
                isVerified: data.isVerified || false,
                cuisineTypes: data.cuisineTypes || [],
                minimumOrderAmount: data.minimumOrderAmount || 0,
                averageDeliveryTime: data.averageDeliveryTime || 30,
                registeredAt: (data.createdAt?.toDate?.() || data.createdAt || new Date()).toISOString(),
                createdAt: (data.createdAt?.toDate?.() || data.createdAt || new Date()).toISOString(),
                status: data.isVerified ? 'active' : 'pending',
            };
        });

        return NextResponse.json({ success: true, data: vendors });
    } catch (error) {
        console.error('Vendors fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch vendors' },
            { status: 500 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, updates } = body;

        if (!vendorId) {
            return NextResponse.json(
                { success: false, error: 'Vendor ID required' },
                { status: 400 }
            );
        }

        await db.collection(collections.vendors).doc(vendorId).update({
            ...updates,
            updatedAt: Timestamp.now(),
        });

        return NextResponse.json({ success: true, message: 'Vendor updated' });
    } catch (error) {
        console.error('Vendor update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update vendor' },
            { status: 500 }
        );
    }
}
