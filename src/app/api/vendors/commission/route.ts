import { NextResponse } from 'next/server';
import { db, collections, cachedCollection, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function GET() {
    try {
        const vendorDocs = await cachedCollection(collections.vendors);

        const vendors = vendorDocs.map(data => {
            return {
                vendorId: data.id,
                shopName: (data.shopName || data.fullName || 'Unknown') as string,
                fullName: (data.fullName || '') as string,
                shopImageUrl: (data.shopImageUrl || data.profileImageUrl || '') as string,
                city: (data.city || '') as string,
                isVerified: (data.isVerified || false) as boolean,
                isOnline: (data.isOnline || false) as boolean,
                commissionRate: (data.commissionRate ?? 15) as number,
                customCommission: (data.customCommission || false) as boolean,
                commissionHistory: (data.commissionHistory || []) as Array<{ previousRate: number; newRate: number; reason: string; changedAt: { seconds: number }; }>,
            };
        });

        // Get platform default commission
        const settingsDoc = await db.collection('platformSettings').doc('commission').get();
        const platformSettings = settingsDoc.exists ? settingsDoc.data() : { defaultRate: 15 };

        return NextResponse.json({
            success: true,
            data: {
                vendors,
                platformDefaultRate: platformSettings?.defaultRate || 15,
            }
        });
    } catch (error) {
        console.error('Commission settings fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch commission settings' },
            { status: 500 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, commissionRate, reason } = body;

        if (!vendorId) {
            return NextResponse.json(
                { success: false, error: 'Vendor ID required' },
                { status: 400 }
            );
        }

        if (commissionRate === undefined || commissionRate < 0 || commissionRate > 100) {
            return NextResponse.json(
                { success: false, error: 'Valid commission rate (0-100) required' },
                { status: 400 }
            );
        }

        // Get current vendor data
        const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
        const currentData = vendorDoc.data() || {};
        const previousRate = currentData.commissionRate ?? 15;

        // Update vendor with new commission
        await db.collection(collections.vendors).doc(vendorId).update({
            commissionRate: commissionRate,
            customCommission: true,
            commissionHistory: [
                ...(currentData.commissionHistory || []),
                {
                    previousRate,
                    newRate: commissionRate,
                    reason: reason || 'Admin update',
                    changedAt: Timestamp.now(),
                }
            ].slice(-10), // Keep last 10 changes
            updatedAt: Timestamp.now(),
        });

        // Invalidate vendor cache so next read picks up the new commission rate
        invalidateCache(collections.vendors);

        return NextResponse.json({
            success: true,
            message: `Commission rate updated to ${commissionRate}%`
        });
    } catch (error) {
        console.error('Commission update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update commission' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { defaultRate } = body;

        if (defaultRate === undefined || defaultRate < 0 || defaultRate > 100) {
            return NextResponse.json(
                { success: false, error: 'Valid default rate (0-100) required' },
                { status: 400 }
            );
        }

        // Update platform default commission
        await db.collection('platformSettings').doc('commission').set({
            defaultRate: defaultRate,
            updatedAt: Timestamp.now(),
        }, { merge: true });

        return NextResponse.json({
            success: true,
            message: `Platform default commission updated to ${defaultRate}%`
        });
    } catch (error) {
        console.error('Platform commission update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update platform commission' },
            { status: 500 }
        );
    }
}
