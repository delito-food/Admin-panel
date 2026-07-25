import { NextRequest, NextResponse } from 'next/server';
import { db, collections, sendBulkPushNotification } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// POST — Send a push notification campaign
export async function POST(req: NextRequest) {

    try {
        const { title, body, imageUrl, target, cityFilter, customerIds } = await req.json();

        if (!title || !body) {
            return NextResponse.json(
                { success: false, error: 'Title and body are required' },
                { status: 400 }
            );
        }

        if (!target || !['all', 'city', 'specific'].includes(target)) {
            return NextResponse.json(
                { success: false, error: 'Invalid target. Must be all, city, or specific' },
                { status: 400 }
            );
        }

        // Gather FCM tokens based on target
        let tokens: string[] = [];
        let totalTargeted = 0;

        if (target === 'all') {
            const snapshot = await db.collection(collections.customers).get();
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.fcmToken) {
                    tokens.push(data.fcmToken);
                }
            });
            totalTargeted = snapshot.size;
        } else if (target === 'city' && cityFilter) {
            // Query customers by city
            const snapshot = await db.collection(collections.customers)
                .where('city', '==', cityFilter)
                .get();
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.fcmToken) {
                    tokens.push(data.fcmToken);
                }
            });
            totalTargeted = snapshot.size;
        } else if (target === 'specific' && customerIds?.length > 0) {
            // Fetch specific customers by ID (batch in groups of 30 for Firestore 'in' limit)
            for (let i = 0; i < customerIds.length; i += 30) {
                const batch = customerIds.slice(i, i + 30);
                const snapshot = await db.collection(collections.customers)
                    .where('__name__', 'in', batch)
                    .get();
                snapshot.docs.forEach(doc => {
                    const data = doc.data();
                    if (data.fcmToken) {
                        tokens.push(data.fcmToken);
                    }
                });
            }
            totalTargeted = customerIds.length;
        }

        // Remove duplicates
        tokens = [...new Set(tokens)];

        if (tokens.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No customers with FCM tokens found for the selected target' },
                { status: 400 }
            );
        }

        // Send push notifications
        const result = await sendBulkPushNotification(
            tokens,
            title,
            body,
            imageUrl || undefined
        );

        // Determine status
        let status: 'sent' | 'partial' | 'failed' = 'sent';
        if (result.successCount === 0) status = 'failed';
        else if (result.failureCount > 0) status = 'partial';

        // Log campaign to Firestore
        const campaignRef = await db.collection(collections.pushNotifications).add({
            title,
            body,
            imageUrl: imageUrl || null,
            target,
            cityFilter: cityFilter || null,
            customerIds: target === 'specific' ? customerIds : null,
            sentCount: result.successCount,
            failedCount: result.failureCount,
            totalTargeted,
            tokensFound: tokens.length,
            status,
            failedTokens: result.failedTokens,
            sentBy: req.headers.get('x-user-uid') || 'admin',
            sentByName: req.headers.get('x-user-name') || 'Admin',
            createdAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            campaignId: campaignRef.id,
            sentCount: result.successCount,
            failedCount: result.failureCount,
            totalTargeted,
            tokensFound: tokens.length,
            status,
        });
    } catch (error) {
        console.error('Push notification send error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to send push notifications' },
            { status: 500 }
        );
    }
}

// GET — Fetch push notification campaign history
export async function GET(req: NextRequest) {

    try {
        const snapshot = await db.collection(collections.pushNotifications)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        const campaigns = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                title: data.title,
                body: data.body,
                imageUrl: data.imageUrl,
                target: data.target,
                cityFilter: data.cityFilter,
                sentCount: data.sentCount || 0,
                failedCount: data.failedCount || 0,
                totalTargeted: data.totalTargeted || 0,
                tokensFound: data.tokensFound || 0,
                status: data.status || 'sent',
                sentBy: data.sentByName || data.sentBy || 'Admin',
                createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            };
        });

        return NextResponse.json({ success: true, data: campaigns });
    } catch (error) {
        console.error('Push notification history fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch notification history' },
            { status: 500 }
        );
    }
}
