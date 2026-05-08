import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const REQUIRED_DOC_KEYS = ['aadhar', 'pan', 'license', 'rc', 'passbook'];

const DOC_LABELS: Record<string, string> = {
    aadhar: 'Aadhaar Card',
    pan: 'PAN Card',
    license: 'Driving License',
    rc: 'RC of Bike',
    passbook: 'Bank Passbook',
};

// GET pending delivery persons for verification
export async function GET() {
    try {
        const snapshot = await db.collection(collections.deliveryPersons).get();

        const pendingPartners = snapshot.docs
            .map(doc => {
                const data = doc.data();
                return {
                    deliveryPersonId: doc.id,
                    fullName: data.fullName || '',
                    email: data.email || '',
                    phoneNumber: data.phoneNumber || '',
                    address: data.address || '',
                    city: data.city || '',
                    pincode: data.pincode || '',
                    vehicleType: data.vehicleType || 'Bike',
                    vehicleNumber: data.vehicleNumber || '',
                    driverLicenseNumber: data.driverLicenseNumber || data.drivingLicense || '',
                    // Document URLs
                    aadharCardUrl: data.aadharCardUrl || '',
                    aadharCardNumber: data.aadharCardNumber || '',
                    panCardUrl: data.panCardUrl || '',
                    panCardNumber: data.panCardNumber || '',
                    driverLicenseUrl: data.driverLicenseUrl || '',
                    vehicleImageUrl: data.vehicleImageUrl || '',
                    rcBookUrl: data.rcBookUrl || '',
                    rcBookNumber: data.rcBookNumber || '',
                    bankPassbookUrl: data.bankPassbookUrl || '',
                    vehicleDocumentUrl: data.vehicleDocumentUrl || '',
                    profilePhotoUrl: data.profilePhotoUrl || '',
                    profileImageUrl: data.profileImageUrl || '',
                    // Bank info
                    bankName: data.bankName || '',
                    bankAccountNumber: data.bankAccountNumber || '',
                    bankAccountHolderName: data.bankAccountHolderName || data.accountHolderName || '',
                    ifscCode: data.ifscCode || data.bankIfscCode || '',
                    upiId: data.upiId || '',
                    // Per-document verification statuses
                    documentStatuses: data.documentStatuses || {},
                    verificationMessages: data.verificationMessages || [],
                    verificationNotes: data.verificationNotes || '',
                    // Language preference
                    preferredLanguage: data.preferredLanguage || 'en',
                    submittedAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
                    verificationStatus: data.verificationStatus || 'pending',
                    isVerified: data.isVerified === true,
                };
            })
            .filter(partner => !partner.isVerified);

        return NextResponse.json({ success: true, data: pendingPartners });
    } catch (error) {
        console.error('Verification delivery fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch pending delivery persons' }, { status: 500 });
    }
}

// PATCH to approve/reject delivery person OR review individual documents
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { deliveryPersonId, action, notes, documentKey, documentAction, documentNote, messageAction, messageText, messageDocKey } = body;

        if (!deliveryPersonId) {
            return NextResponse.json({ success: false, error: 'Delivery person ID required' }, { status: 400 });
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

            const dpDoc = await db.collection(collections.deliveryPersons).doc(deliveryPersonId).get();
            const dpData = dpDoc.data();
            const existingMessages = dpData?.verificationMessages || [];
            existingMessages.push(newMessage);

            await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update({
                verificationMessages: existingMessages,
                updatedAt: Timestamp.now(),
            });

            return NextResponse.json({ success: true, message: 'Message sent' });
        }

        // ===== Per-document review =====
        if (documentKey && documentAction) {
            if (!REQUIRED_DOC_KEYS.includes(documentKey)) {
                return NextResponse.json({ success: false, error: 'Invalid document key' }, { status: 400 });
            }
            if (!['approve', 'reject', 'needs_revision'].includes(documentAction)) {
                return NextResponse.json({ success: false, error: 'Invalid document action' }, { status: 400 });
            }

            const docStatusValue = documentAction === 'approve' ? 'approved'
                : documentAction === 'reject' ? 'rejected' : 'needs_revision';

            const updates: Record<string, unknown> = {
                [`documentStatuses.${documentKey}.status`]: docStatusValue,
                [`documentStatuses.${documentKey}.note`]: documentNote || '',
                [`documentStatuses.${documentKey}.reviewedAt`]: new Date().toISOString(),
                updatedAt: Timestamp.now(),
            };

            await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update(updates);

            // Re-read to compute overall status
            const dpDoc = await db.collection(collections.deliveryPersons).doc(deliveryPersonId).get();
            const dpData = dpDoc.data();
            const docStatuses = dpData?.documentStatuses || {};

            const allApproved = REQUIRED_DOC_KEYS.every(k => docStatuses[k]?.status === 'approved');
            const anyRejected = REQUIRED_DOC_KEYS.some(k => docStatuses[k]?.status === 'rejected' || docStatuses[k]?.status === 'needs_revision');
            const anyPending = REQUIRED_DOC_KEYS.some(k => docStatuses[k]?.status === 'pending');

            let overallStatus = 'pending';
            if (allApproved) overallStatus = 'approved';
            else if (anyRejected) overallStatus = 'needs_revision';
            else if (anyPending) overallStatus = 'pending';

            const overallUpdates: Record<string, unknown> = { verificationStatus: overallStatus };
            if (allApproved) {
                overallUpdates.isVerified = true;
                overallUpdates.verifiedAt = Timestamp.now();
            }

            const rejectedNotes = REQUIRED_DOC_KEYS
                .filter(k => docStatuses[k]?.status === 'rejected' || docStatuses[k]?.status === 'needs_revision')
                .map(k => `${DOC_LABELS[k]}: ${docStatuses[k]?.note || 'Rejected'}`)
                .join(' | ');
            overallUpdates.verificationNotes = rejectedNotes;

            await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update(overallUpdates);

            return NextResponse.json({ success: true, message: `${DOC_LABELS[documentKey]} ${docStatusValue}`, overallStatus });
        }

        // ===== Full approve/reject =====
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
            const approvedStatuses: Record<string, { status: string; note: string; reviewedAt: string }> = {};
            REQUIRED_DOC_KEYS.forEach(k => {
                approvedStatuses[k] = { status: 'approved', note: '', reviewedAt: new Date().toISOString() };
            });
            updates.documentStatuses = approvedStatuses;
        } else if (action === 'reject') {
            updates.isVerified = false;
            updates.verificationStatus = 'rejected';
        }

        await db.collection(collections.deliveryPersons).doc(deliveryPersonId).update(updates);

        return NextResponse.json({ success: true, message: `Delivery person ${action === 'approve' ? 'approved' : 'rejected'}` });
    } catch (error) {
        console.error('Delivery verification error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update delivery person verification' }, { status: 500 });
    }
}

