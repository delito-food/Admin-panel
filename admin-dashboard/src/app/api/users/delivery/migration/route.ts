import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';

export async function POST(request: Request) {
    try {
        const { oldDeliveryPersonId, newDeliveryPersonId } = await request.json();

        if (!oldDeliveryPersonId || !newDeliveryPersonId) {
            return NextResponse.json({ success: false, error: 'Both old and new IDs are required' }, { status: 400 });
        }

        if (oldDeliveryPersonId === newDeliveryPersonId) {
            return NextResponse.json({ success: false, error: 'Old and new IDs cannot be the same' }, { status: 400 });
        }

        const collections = [
            { name: 'orders', field: 'deliveryPersonId' },
            { name: 'deliveryTasks', field: 'deliveryPersonId' },
            { name: 'deliveryPayouts', field: 'recipientId' }, // Payouts use recipientId
            { name: 'codSettlements', field: 'deliveryPersonId' },
            { name: 'payoutDisputes', field: 'recipientId' },
            { name: 'deliveryHistory', field: 'deliveryPersonId' }
        ];

        let totalUpdated = 0;

        for (const coll of collections) {
            try {
                const snapshot = await db.collection(coll.name)
                    .where(coll.field, '==', oldDeliveryPersonId)
                    .get();

                if (snapshot.empty) continue;

                // Process in batches of 400 (Firestore limit is 500)
                const chunks = [];
                for (let i = 0; i < snapshot.docs.length; i += 400) {
                    chunks.push(snapshot.docs.slice(i, i + 400));
                }

                for (const chunk of chunks) {
                    const batch = db.batch();
                    for (const doc of chunk) {
                        const updateData: any = { [coll.field]: newDeliveryPersonId };
                        // If it's deliveryPayouts and happens to have a deliveryPersonId field too, update it
                        if (coll.name === 'deliveryPayouts' && doc.data().deliveryPersonId === oldDeliveryPersonId) {
                            updateData['deliveryPersonId'] = newDeliveryPersonId;
                        }
                        batch.update(doc.ref, updateData);
                    }
                    await batch.commit();
                    totalUpdated += chunk.length;
                }
            } catch (err) {
                console.error(`Error migrating collection ${coll.name}:`, err);
                // Continue with other collections even if one fails
            }
        }

        return NextResponse.json({
            success: true,
            message: `Successfully migrated ${totalUpdated} records to the new ID.`,
            migratedCount: totalUpdated
        });

    } catch (error: any) {
        console.error('Migration error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
