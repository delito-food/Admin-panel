import { NextResponse } from 'next/server';
import { db, collections, cachedCollection, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        // Use cached collections (60s TTL)
        const vendorDocs = await cachedCollection(collections.vendors);

        // Get all menu items (cached)
        const menuItemDocs = await cachedCollection(collections.menuItems);

        // Get all orders (cached)
        const orderDocs = await cachedCollection(collections.orders);

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

        menuItemDocs.forEach(item => {
            const vendorId = item.vendorId as string;
            if (!vendorId) return;

            if (!vendorMenuData[vendorId]) {
                vendorMenuData[vendorId] = { menuItems: [], menuItemsCount: 0, specialOffers: [] };
            }

            const menuItem = {
                itemId: item.id,
                name: (item.name || '') as string,
                price: (item.price || 0) as number,
                imageUrl: (item.imageUrl || '') as string,
                discount: (item.discount || 0) as number,
                isAvailable: item.isAvailable !== false,
                isBestSeller: (item.isBestSeller || false) as boolean,
                isVeg: (item.isVeg || false) as boolean,
                categoryName: (item.categoryName || '') as string,
            };

            vendorMenuData[vendorId].menuItems.push(menuItem);
            vendorMenuData[vendorId].menuItemsCount += 1;

            // Track items with discounts as special offers
            if (item.discount && (item.discount as number) > 0) {
                vendorMenuData[vendorId].specialOffers.push({
                    itemId: item.id,
                    name: (item.name || '') as string,
                    price: (item.price || 0) as number,
                    discount: item.discount as number,
                    imageUrl: (item.imageUrl || '') as string,
                });
            }
        });

        // Build vendor earnings from orders
        const vendorEarnings: Record<string, { totalEarnings: number; totalOrders: number }> = {};

        orderDocs.forEach(order => {
            const vendorId = order.vendorId as string;
            if (!vendorId) return;

            if (!vendorEarnings[vendorId]) {
                vendorEarnings[vendorId] = { totalEarnings: 0, totalOrders: 0 };
            }

            vendorEarnings[vendorId].totalOrders += 1;

            const status = (order.status || '').toLowerCase();
            if (status === 'delivered' || status === 'completed') {
                // Vendor earning = itemTotal - 15% commission on original price - 18% GST on commission
                const itemTotal = order.itemTotal || order.subtotal || 0;
                const commBase = order.originalItemTotal || itemTotal;
                const vendorEarning = order.vendorEarning || (() => {
                    const commission = order.vendorPlatformCut > 0
                        ? order.vendorPlatformCut
                        : Math.round(commBase * 0.15 * 10) / 10;
                    const gst = order.vendorGstOnPlatformCut > 0
                        ? order.vendorGstOnPlatformCut
                        : Math.round(commission * 0.18 * 10) / 10;
                    return Math.round((itemTotal - commission - gst) * 10) / 10;
                })();
                vendorEarnings[vendorId].totalEarnings += vendorEarning;
            }
        });

        const vendors = vendorDocs.map(data => {
            const menuData = vendorMenuData[data.id] || { menuItems: [], menuItemsCount: 0, specialOffers: [] };
            const earnings = vendorEarnings[data.id] || { totalEarnings: 0, totalOrders: 0 };

            return {
                vendorId: data.id,
                fullName: (data.fullName || '') as string,
                shopName: (data.shopName || '') as string,
                email: (data.email || '') as string,
                phoneNumber: (data.phoneNumber || '') as string,
                profileImageUrl: (data.profileImageUrl || '') as string,
                shopImageUrl: (data.shopImageUrl || data.profileImageUrl || '') as string,
                address: (data.address || '') as string,
                city: (data.city || '') as string,
                pincode: (data.pincode || '') as string,
                gstNumber: (data.gstNumber || '') as string,
                fssaiLicense: (data.fssaiLicense || '') as string,
                rating: (data.rating || 0) as number,
                totalOrders: earnings.totalOrders || (data.totalOrders as number) || 0,
                totalEarnings: earnings.totalEarnings || (data.totalEarnings as number) || 0,
                menuItemsCount: menuData.menuItemsCount,
                menuItems: menuData.menuItems.slice(0, 10), // Top 10 items for preview
                specialOffers: menuData.specialOffers, // Items with discounts
                isOnline: data.isOnline || false,
                isVerified: data.isVerified || false,
                cuisineTypes: data.cuisineTypes || [],
                minimumOrderAmount: data.minimumOrderAmount || 0,
                averageDeliveryTime: data.averageDeliveryTime || 30,
                adminForceOffline: data.adminForceOffline || false,
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

        invalidateCache(collections.vendors);

        return NextResponse.json({ success: true, message: 'Vendor updated' });
    } catch (error) {
        console.error('Vendor update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update vendor' },
            { status: 500 }
        );
    }
}
