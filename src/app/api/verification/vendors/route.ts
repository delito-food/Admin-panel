import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Required document keys
const REQUIRED_DOC_KEYS = ['fssai', 'pan', 'gst', 'bank', 'menuPhoto'];

// URL field mapping for each document key
const DOC_URL_FIELDS: Record<string, string> = {
    fssai: 'fssaiLicenseUrl',
    pan: 'panCardUrl',
    gst: 'gstDocumentUrl',
    bank: 'bankProofUrl',
    menuPhoto: 'menuPhotoUrl',
};

const DOC_LABELS: Record<string, string> = {
    fssai: 'FSSAI License',
    pan: 'PAN Card',
    gst: 'GST Registration',
    bank: 'Bank Account Proof',
    menuPhoto: 'Menu Photo',
};

// GET pending vendors for verification (with menu items + document statuses)
export async function GET() {
    try {
        const snapshot = await db.collection(collections.vendors)
            .where('isVerified', '==', false)
            .get();

        const vendorIds = snapshot.docs.map(doc => doc.id);
        const menuItemsMap: Record<string, Array<{
            itemId: string; name: string; description: string; price: number;
            categoryName: string; imageUrl: string; isVeg: boolean; isBestSeller: boolean;
            preparationTime: number; discount: number; isVerified: boolean;
            verificationStatus: string; verificationNotes: string;
        }>> = {};

        if (vendorIds.length > 0) {
            const batches = [];
            for (let i = 0; i < vendorIds.length; i += 30) {
                batches.push(vendorIds.slice(i, i + 30));
            }
            for (const batch of batches) {
                const menuSnapshot = await db.collection(collections.menuItems)
                    .where('vendorId', 'in', batch)
                    .get();
                menuSnapshot.docs.forEach(doc => {
                    const data = doc.data();
                    const vendorId = data.vendorId;
                    if (!menuItemsMap[vendorId]) menuItemsMap[vendorId] = [];
                    menuItemsMap[vendorId].push({
                        itemId: doc.id, name: data.name || '', description: data.description || '',
                        price: data.price || 0, categoryName: data.categoryName || 'Uncategorized',
                        imageUrl: data.imageUrl || '', isVeg: data.isVeg ?? true,
                        isBestSeller: data.isBestSeller || false, preparationTime: data.preparationTime || 0,
                        discount: data.discount || 0, isVerified: data.isVerified || false,
                        verificationStatus: data.verificationStatus || 'pending',
                        verificationNotes: data.verificationNotes || '',
                    });
                });
            }
        }

        const pendingVendors = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                vendorId: doc.id,
                fullName: data.fullName || '',
                shopName: data.shopName || '',
                email: data.email || '',
                phoneNumber: data.phoneNumber || '',
                address: data.address || '',
                city: data.city || '',
                pincode: data.pincode || '',
                gstNumber: data.gstNumber || '',
                fssaiLicense: data.fssaiLicense || '',
                panCardNumber: data.panCardNumber || '',
                // Document URLs
                fssaiLicenseUrl: data.fssaiLicenseUrl || '',
                gstDocumentUrl: data.gstDocumentUrl || '',
                panCardUrl: data.panCardUrl || '',
                bankProofUrl: data.bankProofUrl || '',
                menuPhotoUrl: data.menuPhotoUrl || '',
                profileImageUrl: data.profileImageUrl || '',
                shopImageUrl: data.shopImageUrl || data.profileImageUrl || '',
                cuisineTypes: data.cuisineTypes || [],
                // Bank info
                bankAccountNumber: data.bankAccountNumber || '',
                bankAccountHolderName: data.bankAccountHolderName || data.accountHolderName || '',
                bankName: data.bankName || '',
                bankIfscCode: data.bankIfscCode || data.ifscCode || '',
                upiId: data.upiId || '',
                // Per-document verification statuses
                documentStatuses: data.documentStatuses || {},
                // Verification messages
                verificationMessages: data.verificationMessages || [],
                verificationNotes: data.verificationNotes || '',
                // Language preference
                preferredLanguage: data.preferredLanguage || 'en',
                // Menu items
                menuItems: menuItemsMap[doc.id] || [],
                submittedAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
                verificationStatus: data.verificationStatus || 'pending',
            };
        });

        return NextResponse.json({ success: true, data: pendingVendors });
    } catch (error) {
        console.error('Verification vendors fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch pending vendors' }, { status: 500 });
    }
}

// PATCH to approve/reject vendor OR review individual documents
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, action, notes, documentKey, documentAction, documentNote, messageAction, messageText, messageDocKey } = body;

        if (!vendorId) {
            return NextResponse.json({ success: false, error: 'Vendor ID required' }, { status: 400 });
        }

        // ===== Send a verification message =====
        if (messageAction === 'send_message') {
            if (!messageText) {
                return NextResponse.json({ success: false, error: 'Message text is required' }, { status: 400 });
            }
            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const newMessage = {
                id: messageId,
                sender: 'admin',
                senderName: 'Admin',
                message: messageText,
                documentKey: messageDocKey || null,
                createdAt: new Date().toISOString(),
            };

            const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
            const vendorData = vendorDoc.data();
            const existingMessages = vendorData?.verificationMessages || [];
            existingMessages.push(newMessage);

            await db.collection(collections.vendors).doc(vendorId).update({
                verificationMessages: existingMessages,
                updatedAt: Timestamp.now(),
            });

            return NextResponse.json({ success: true, message: 'Message sent' });
        }

        // ===== Per-document review action =====
        if (documentKey && documentAction) {
            if (!REQUIRED_DOC_KEYS.includes(documentKey)) {
                return NextResponse.json({ success: false, error: 'Invalid document key' }, { status: 400 });
            }
            if (!['approve', 'reject', 'needs_revision'].includes(documentAction)) {
                return NextResponse.json({ success: false, error: 'Invalid document action' }, { status: 400 });
            }

            const docStatusValue = documentAction === 'approve' ? 'approved'
                : documentAction === 'reject' ? 'rejected' : 'needs_revision';

            // Update the specific document status
            const updates: Record<string, unknown> = {
                [`documentStatuses.${documentKey}.status`]: docStatusValue,
                [`documentStatuses.${documentKey}.note`]: documentNote || '',
                [`documentStatuses.${documentKey}.reviewedAt`]: new Date().toISOString(),
                updatedAt: Timestamp.now(),
            };

            await db.collection(collections.vendors).doc(vendorId).update(updates);

            // Re-read to compute overall status
            const vendorDoc = await db.collection(collections.vendors).doc(vendorId).get();
            const vendorData = vendorDoc.data();
            const docStatuses = vendorData?.documentStatuses || {};

            const allApproved = REQUIRED_DOC_KEYS.every(k => docStatuses[k]?.status === 'approved');
            const anyRejected = REQUIRED_DOC_KEYS.some(k => docStatuses[k]?.status === 'rejected' || docStatuses[k]?.status === 'needs_revision');
            const anyPending = REQUIRED_DOC_KEYS.some(k => docStatuses[k]?.status === 'pending');

            let overallStatus = 'pending';
            if (allApproved) overallStatus = 'approved';
            else if (anyRejected) overallStatus = 'needs_revision';
            else if (anyPending) overallStatus = 'pending';

            const overallUpdates: Record<string, unknown> = {
                verificationStatus: overallStatus,
            };
            if (allApproved) {
                overallUpdates.isVerified = true;
                overallUpdates.verifiedAt = Timestamp.now();
                overallUpdates.isOnline = true;
                overallUpdates.hasCompletedSetup = true;
            }

            // Build overall notes from all rejected docs
            const rejectedNotes = REQUIRED_DOC_KEYS
                .filter(k => docStatuses[k]?.status === 'rejected' || docStatuses[k]?.status === 'needs_revision')
                .map(k => `${DOC_LABELS[k]}: ${docStatuses[k]?.note || 'Rejected'}`)
                .join(' | ');
            overallUpdates.verificationNotes = rejectedNotes;

            await db.collection(collections.vendors).doc(vendorId).update(overallUpdates);

            return NextResponse.json({
                success: true,
                message: `${DOC_LABELS[documentKey]} ${docStatusValue}`,
                overallStatus,
            });
        }

        // ===== Full vendor approve/reject action =====
        if (!action) {
            return NextResponse.json({ success: false, error: 'Action required' }, { status: 400 });
        }

        const updates: Record<string, unknown> = {
            updatedAt: Timestamp.now(),
            verifiedAt: Timestamp.now(),
            verificationNotes: notes || '',
        };

        if (action === 'approve') {
            updates.isVerified = true;
            updates.verificationStatus = 'approved';
            updates.isOnline = true;
            updates.hasCompletedSetup = true;
            // Set all documents to approved
            const approvedStatuses: Record<string, { status: string; note: string; reviewedAt: string }> = {};
            REQUIRED_DOC_KEYS.forEach(k => {
                approvedStatuses[k] = { status: 'approved', note: '', reviewedAt: new Date().toISOString() };
            });
            updates.documentStatuses = approvedStatuses;
        } else if (action === 'reject') {
            updates.isVerified = false;
            updates.verificationStatus = 'rejected';
            updates.isOnline = false;
        }

        await db.collection(collections.vendors).doc(vendorId).update(updates);

        return NextResponse.json({
            success: true,
            message: `Vendor ${action === 'approve' ? 'approved' : 'rejected'}`
        });
    } catch (error) {
        console.error('Vendor verification error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update vendor verification' }, { status: 500 });
    }
}

