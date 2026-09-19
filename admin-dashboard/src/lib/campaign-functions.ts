/**
 * Calls the co-funded offer Cloud Functions as the signed-in admin.
 *
 * Every write — create, publish, pause, invite, simulate — lives in
 * functions/campaigns.js, which validates the draft, freezes the terms hash and writes
 * the audit trail. Doing any of that here with the Admin SDK would mean two
 * implementations of the same rules, and the vendor would have consented to only one of
 * them. The API routes under /api/campaigns are therefore read-only.
 */

import { app } from '@/lib/firebase';
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';

let cached: Functions | null = null;

function functionsInstance(): Functions {
    if (!app) throw new Error('Firebase is not configured in this environment.');
    if (!cached) cached = getFunctions(app);
    return cached;
}

export async function callCampaignFunction<T = unknown>(name: string, data: unknown = {}): Promise<T> {
    const callable = httpsCallable(functionsInstance(), name);
    const result = await callable(data);
    return result.data as T;
}

export interface CampaignDraft {
    name: string;
    type: 'PERCENT' | 'FLAT';
    percent: number;
    flat: number;
    maxDiscount: number;
    minOrderValue: number;
    funding: { vendorPercent: number; vendorMaxPerOrder: number; vendorFloorPercent: number };
    commissionRateOverride: number | null;
    platformBudget: number;
    alertAtPercent: number;
    /** Epoch millis — the callable converts them to Timestamps. */
    startAt: number;
    endAt: number;
    dayOfWeekMask: number;
    startMinuteIst: number;
    endMinuteIst: number;
    perCustomerLimit: number;
    perCustomerPerDay: number;
    newCustomersOnly: boolean;
    customerAllowlist: string[];
    excludedItemIds: string[];
    priceLockTolerancePercent: number;
    /** bannerImageUrl: optional background photo for the home-screen offer slide (no text in it). */
    customer: { title: string; subtitle: string; badgeText: string; badgeColorHex: string; bannerImageUrl?: string };
}

export const saveCampaign = (draft: CampaignDraft, campaignId?: string) =>
    callCampaignFunction<{ campaignId: string; termsChanged?: boolean; reconsentRequired?: number }>(
        'adminSaveCampaign',
        campaignId ? { campaignId, draft } : { draft }
    );

export const setCampaignStatus = (campaignId: string, action: 'publish' | 'pause' | 'resume' | 'end' | 'cancel') =>
    callCampaignFunction<{ campaignId: string; status: string }>('adminSetCampaignStatus', { campaignId, action });

export const inviteVendors = (campaignId: string, vendorIds: string[]) =>
    callCampaignFunction<{ invited: number; reinvited: number; unchanged: number; missingVendors: string[] }>(
        'adminInviteVendors',
        { campaignId, vendorIds }
    );

export interface SimulationRow {
    cartValue: number;
    customerDiscount: number;
    vendorFunded: number;
    platformFunded: number;
    commission: number;
    vendorEarning: number;
    vendorEarningWithoutOffer: number;
    vendorTakeRatePercent: number;
    platformFoodNet: number;
}

export const simulateCampaign = (draft: CampaignDraft, vendorIds: string[], days = 30) =>
    callCampaignFunction<{
        days: number;
        samplesAt15Percent: SimulationRow[];
        totals: { orders: number; qualifying: number; customerDiscount: number; vendorFunded: number; platformFunded: number; grossSales: number; platformLossOrders: number };
        perVendor: Array<{ vendorId: string; vendorName: string; recent: Record<string, number> }>;
    }>('adminSimulateCampaign', { draft, vendorIds, days });
