import { NextRequest, NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';

// GET — Fetch customers for notification targeting
export async function GET(req: NextRequest) {

    try {
        const { searchParams } = new URL(req.url);
        const search = searchParams.get('search')?.toLowerCase() || '';

        const snapshot = await db.collection(collections.customers).get();

        let customers = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.fullName || data.name || data.displayName || 'Unknown',
                phone: data.phone || data.phoneNumber || '',
                email: data.email || '',
                city: data.city || data.address?.city || '',
                hasFcmToken: !!data.fcmToken,
            };
        });

        // Apply search filter
        if (search) {
            customers = customers.filter(c =>
                c.name.toLowerCase().includes(search) ||
                c.phone.includes(search) ||
                c.email.toLowerCase().includes(search) ||
                c.id.toLowerCase().includes(search)
            );
        }

        // Get unique cities for the city filter dropdown
        const cities = [...new Set(
            snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    return (data.city || data.address?.city || '') as string;
                })
                .filter(city => city.length > 0)
        )].sort();

        return NextResponse.json({
            success: true,
            data: customers,
            cities,
            totalCount: snapshot.size,
            withTokenCount: customers.filter(c => c.hasFcmToken).length,
        });
    } catch (error) {
        console.error('Customer fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch customers' },
            { status: 500 }
        );
    }
}
