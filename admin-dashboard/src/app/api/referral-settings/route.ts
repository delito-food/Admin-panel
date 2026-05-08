import { NextResponse } from 'next/server';
import { db, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const REFERRAL_CONFIG_DOC = 'referralConfig';
const SETTINGS_COLLECTION = 'platformSettings';

/**
 * GET /api/referral-settings
 * Fetch current referral configuration
 */
export async function GET() {
    try {
        const configRef = db.collection(SETTINGS_COLLECTION).doc(REFERRAL_CONFIG_DOC);
        const configDoc = await configRef.get();

        if (!configDoc.exists) {
            // Return defaults matching the actual app values
            const defaults = {
                isReferralEnabled: true,
                customerReferralBonus: 100,      // Coins the referring customer earns
                referredCustomerBonus: 100,       // Coins the new customer gets
                vendorReferralBonus: 10,          // ₹ the referring vendor earns
                referredVendorBonus: 0,           // New vendor gets nothing currently
                minOrderForReferral: 0,           // No min order for referral
                maxReferralsPerUser: 50,          // Max referrals per user
                referralExpiryDays: 30,           // Days before referral expires
                coinValue: 1,                      // 1 coin = ₹1
                maxCoinRedeemPerOrder: 50,         // Max coins redeemable per order
                maxCoinRedeemPercent: 20,          // Max % of order payable via coins
                welcomeBonus: 20,                  // Coins for new users
                firstOrderBonus: 10,               // Extra coins on first order
                updatedAt: null,
                lastUpdatedBy: null,
            };

            return NextResponse.json({ success: true, data: defaults });
        }

        const data = configDoc.data()!;
        return NextResponse.json({
            success: true,
            data: {
                isReferralEnabled: data.isReferralEnabled !== false,
                customerReferralBonus: data.customerReferralBonus ?? 100,
                referredCustomerBonus: data.referredCustomerBonus ?? 100,
                vendorReferralBonus: data.vendorReferralBonus ?? 10,
                referredVendorBonus: data.referredVendorBonus ?? 0,
                minOrderForReferral: data.minOrderForReferral ?? 0,
                maxReferralsPerUser: data.maxReferralsPerUser ?? 50,
                referralExpiryDays: data.referralExpiryDays ?? 30,
                coinValue: data.coinValue ?? 1,
                maxCoinRedeemPerOrder: data.maxCoinRedeemPerOrder ?? 50,
                maxCoinRedeemPercent: data.maxCoinRedeemPercent ?? 20,
                welcomeBonus: data.welcomeBonus ?? 20,
                firstOrderBonus: data.firstOrderBonus ?? 10,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
                lastUpdatedBy: data.lastUpdatedBy || null,
            },
        });
    } catch (error) {
        console.error('Referral settings fetch error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch referral settings' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/referral-settings
 * Admin updates referral configuration
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { settings, adminId } = body;

        if (!settings || typeof settings !== 'object') {
            return NextResponse.json(
                { success: false, error: 'Settings object is required' },
                { status: 400 }
            );
        }

        // Validate numeric fields
        const numericFields = [
            'customerReferralBonus', 'referredCustomerBonus',
            'vendorReferralBonus', 'referredVendorBonus',
            'minOrderForReferral', 'maxReferralsPerUser',
            'referralExpiryDays', 'coinValue',
            'maxCoinRedeemPerOrder', 'maxCoinRedeemPercent',
            'welcomeBonus', 'firstOrderBonus',
        ];

        const safeSettings: Record<string, unknown> = {};

        for (const key of numericFields) {
            if (settings[key] !== undefined) {
                const val = Number(settings[key]);
                if (isNaN(val) || val < 0) {
                    return NextResponse.json(
                        { success: false, error: `Invalid value for ${key}` },
                        { status: 400 }
                    );
                }
                safeSettings[key] = val;
            }
        }

        // Boolean fields
        if (settings.isReferralEnabled !== undefined) {
            safeSettings.isReferralEnabled = Boolean(settings.isReferralEnabled);
        }

        safeSettings.updatedAt = Timestamp.now();
        safeSettings.lastUpdatedBy = adminId || 'admin';

        const configRef = db.collection(SETTINGS_COLLECTION).doc(REFERRAL_CONFIG_DOC);
        const configDoc = await configRef.get();

        if (configDoc.exists) {
            await configRef.update(safeSettings);
        } else {
            await configRef.set({
                isReferralEnabled: true,
                customerReferralBonus: 100,
                referredCustomerBonus: 100,
                vendorReferralBonus: 10,
                referredVendorBonus: 0,
                minOrderForReferral: 0,
                maxReferralsPerUser: 50,
                referralExpiryDays: 30,
                coinValue: 1,
                maxCoinRedeemPerOrder: 50,
                maxCoinRedeemPercent: 20,
                welcomeBonus: 20,
                firstOrderBonus: 10,
                ...safeSettings,
                createdAt: Timestamp.now(),
            });
        }

        invalidateCache(SETTINGS_COLLECTION);

        return NextResponse.json({
            success: true,
            message: 'Referral settings updated successfully',
        });
    } catch (error) {
        console.error('Referral settings update error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update referral settings' },
            { status: 500 }
        );
    }
}




