/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { collections, cachedCollection } from '@/lib/firebase-admin';

/**
 * GET /api/documents
 * Returns document details for vendors and delivery partners
 */
export async function GET() {
    try {
        const allVendors = await cachedCollection(collections.vendors);
        const allDP = await cachedCollection(collections.deliveryPersons);

        const vendors = allVendors.map(v => ({
            id: v.id,
            type: 'vendor' as const,
            name: (v.shopName || v.fullName || '') as string,
            ownerName: (v.fullName || '') as string,
            phone: (v.phoneNumber || '') as string,
            email: (v.email || '') as string,
            address: (v.address || '') as string,
            city: (v.city || '') as string,
            pincode: (v.pincode || '') as string,
            profileImageUrl: (v.profileImageUrl || '') as string,
            isVerified: (v.isVerified || false) as boolean,
            isOnline: (v.isOnline || false) as boolean,
            // Documents
            pan: (v.panCardNumber || v.pan || '') as string,
            panUrl: (v.panCardUrl || v.panUrl || v.panImageUrl || '') as string,
            gstin: (v.gstNumber || v.gstin || '') as string,
            gstCertificateUrl: (v.gstDocumentUrl || v.gstCertificateUrl || v.gstUrl || '') as string,
            fssaiLicense: (v.fssaiLicense || '') as string,
            fssaiUrl: (v.fssaiLicenseUrl || v.fssaiUrl || '') as string,
            aadhaarNumber: (v.aadhaarNumber || v.aadharNumber || '') as string,
            aadhaarUrl: (v.aadhaarUrl || v.aadharUrl || v.aadhaarFrontUrl || '') as string,
            aadhaarBackUrl: (v.aadhaarBackUrl || v.aadharBackUrl || '') as string,
            shopLicenseUrl: (v.shopLicenseUrl || v.tradeLicenseUrl || '') as string,
            shopImageUrl: (v.shopImageUrl || '') as string,
            // Bank details
            bankName: (v.bankName || '') as string,
            bankAccountNumber: (v.bankAccountNumber || '') as string,
            ifscCode: (v.bankIfscCode || v.ifscCode || '') as string,
            upiId: (v.upiId || '') as string,
            bankPassbookUrl: (v.bankPassbookUrl || v.bankProofUrl || '') as string,
            // Timestamps
            registeredAt: v.createdAt?.toDate?.()?.toISOString() || (v.createdAt || '') as string,
        }));

        const deliveryPartners = allDP.map(d => ({
            id: d.id,
            type: 'delivery' as const,
            name: (d.fullName || d.name || '') as string,
            phone: (d.phoneNumber || d.phone || '') as string,
            email: (d.email || '') as string,
            address: (d.address || '') as string,
            city: (d.city || '') as string,
            pincode: (d.pincode || '') as string,
            profilePhotoUrl: (d.profilePhotoUrl || d.profileImageUrl || '') as string,
            isVerified: (d.isVerified || false) as boolean,
            isOnline: (d.isOnline || false) as boolean,
            // Documents
            pan: (d.panCardNumber || d.pan || '') as string,
            panUrl: (d.panCardUrl || d.panUrl || d.panImageUrl || '') as string,
            aadhaarNumber: (d.aadharCardNumber || d.aadhaarNumber || d.aadharNumber || '') as string,
            aadhaarFrontUrl: (d.aadharCardUrl || d.aadhaarFrontUrl || d.aadhaarUrl || d.aadharUrl || '') as string,
            aadhaarBackUrl: (d.aadhaarBackUrl || d.aadharBackUrl || '') as string,
            driverLicenseNumber: (d.driverLicenseNumber || '') as string,
            driverLicenseUrl: (d.driverLicenseUrl || '') as string,
            vehicleType: (d.vehicleType || '') as string,
            vehicleNumber: (d.vehicleNumber || '') as string,
            vehicleDocumentUrl: (d.rcBookUrl || d.vehicleDocumentUrl || d.vehicleRcUrl || '') as string,
            vehicleInsuranceUrl: (d.vehicleInsuranceUrl || '') as string,
            // Bank details
            bankName: (d.bankName || '') as string,
            bankAccountNumber: (d.bankAccountNumber || '') as string,
            ifscCode: (d.bankIfscCode || d.ifscCode || '') as string,
            upiId: (d.upiId || '') as string,
            bankPassbookUrl: (d.bankPassbookUrl || '') as string,
            // Timestamps
            registeredAt: d.createdAt?.toDate?.()?.toISOString() || (d.createdAt || '') as string,
        }));

        // Summary
        const summary = {
            totalVendors: vendors.length,
            verifiedVendors: vendors.filter(v => v.isVerified).length,
            vendorsWithPAN: vendors.filter(v => v.pan).length,
            vendorsWithGST: vendors.filter(v => v.gstin).length,
            vendorsWithFSSAI: vendors.filter(v => v.fssaiLicense).length,
            totalDP: deliveryPartners.length,
            verifiedDP: deliveryPartners.filter(d => d.isVerified).length,
            dpWithPAN: deliveryPartners.filter(d => d.pan).length,
            dpWithLicense: deliveryPartners.filter(d => d.driverLicenseNumber).length,
            dpWithVehicleDoc: deliveryPartners.filter(d => d.vehicleDocumentUrl).length,
        };

        return NextResponse.json({ success: true, data: { vendors, deliveryPartners, summary } });
    } catch (error: any) {
        console.error('Documents fetch error:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Failed to fetch documents' }, { status: 500 });
    }
}




