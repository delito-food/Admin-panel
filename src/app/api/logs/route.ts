import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

// GET - Get admin action logs
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '100');
        const action = searchParams.get('action'); // Filter by action type
        const targetType = searchParams.get('targetType'); // vendor, deliveryPerson, order, etc.

        let query: FirebaseFirestore.Query = db.collection('adminLogs')
            .orderBy('createdAt', 'desc')
            .limit(limit);

        if (action) {
            query = query.where('action', '==', action);
        }

        if (targetType) {
            query = query.where('targetType', '==', targetType);
        }

        const snapshot = await query.get();

        const logs = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                logId: doc.id,
                action: data.action || '',
                targetId: data.targetId || '',
                targetType: data.targetType || '',
                targetName: data.targetName || '',
                reason: data.reason || '',
                notes: data.notes || '',
                adminId: data.adminId || '',
                previousReason: data.previousReason || '',
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
            };
        });

        return NextResponse.json({ success: true, data: logs });
    } catch (error) {
        console.error('Admin logs fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch admin logs' },
            { status: 500 }
        );
    }
}

