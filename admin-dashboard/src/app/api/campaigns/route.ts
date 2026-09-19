import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';

/**
 * GET /api/campaigns — co-funded merchant offers, with live spend.
 *
 * READ ONLY, deliberately. Everything that changes a campaign (create, publish, pause,
 * invite, consent) goes through the Cloud Functions callables in functions/campaigns.js,
 * so the validation, the terms hash and the audit trail have exactly one home. The admin
 * UI calls those directly with the signed-in admin's ID token.
 *
 * See CO_FUNDED_OFFERS_IMPLEMENTATION_PLAN.md §12.
 */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const iso = (v: any): string | null => v?.toDate?.()?.toISOString?.() || null;

async function handleGET() {
    try {
        // Bounded: enrollments grow as campaigns x vendors and are only used here to
        // count statuses per campaign. Reading the whole collection to draw a few badges
        // is how this page stops loading once the feature is actually used.
        const [campaignsSnap, statsSnap, enrollmentsSnap] = await Promise.all([
            db.collection('campaigns').orderBy('updatedAt', 'desc').limit(200).get(),
            db.collection('campaignStats').limit(500).get(),
            db.collection('campaignEnrollments').limit(20000).get(),
        ]);

        const statsById: Record<string, any> = {};
        statsSnap.docs.forEach((d) => { statsById[d.id] = d.data(); });

        const enrollmentCounts: Record<string, Record<string, number>> = {};
        enrollmentsSnap.docs.forEach((d) => {
            const e = d.data();
            const campaignId = String(e.campaignId || '');
            const status = String(e.status || 'UNKNOWN');
            if (!campaignId) return;
            enrollmentCounts[campaignId] = enrollmentCounts[campaignId] || {};
            enrollmentCounts[campaignId][status] = (enrollmentCounts[campaignId][status] || 0) + 1;
        });

        const campaigns = campaignsSnap.docs.map((doc) => {
            const c = doc.data();
            const stats = statsById[doc.id] || {};
            const budget = num(c.platformBudget);
            const committed = num(stats.committedPlatform);
            return {
                campaignId: doc.id,
                name: c.name || '',
                status: c.status || 'DRAFT',
                type: c.type || '',
                percent: num(c.percent),
                flat: num(c.flat),
                maxDiscount: num(c.maxDiscount),
                minOrderValue: num(c.minOrderValue),
                funding: {
                    vendorPercent: num(c.funding?.vendorPercent),
                    vendorMaxPerOrder: num(c.funding?.vendorMaxPerOrder),
                    vendorFloorPercent: num(c.funding?.vendorFloorPercent),
                },
                commissionRateOverride: c.commissionRateOverride ?? null,
                platformBudget: budget,
                alertAtPercent: num(c.alertAtPercent) || 80,
                perCustomerLimit: num(c.perCustomerLimit),
                perCustomerPerDay: num(c.perCustomerPerDay),
                newCustomersOnly: c.newCustomersOnly === true,
                customerAllowlist: Array.isArray(c.customerAllowlist) ? c.customerAllowlist : [],
                excludedItemIds: Array.isArray(c.excludedItemIds) ? c.excludedItemIds : [],
                priceLockTolerancePercent: num(c.priceLockTolerancePercent),
                dayOfWeekMask: num(c.dayOfWeekMask) || 127,
                startMinuteIst: num(c.startMinuteIst),
                endMinuteIst: num(c.endMinuteIst) || 1440,
                customer: {
                    title: c.customer?.title || '',
                    subtitle: c.customer?.subtitle || '',
                    badgeText: c.customer?.badgeText || '',
                    badgeColorHex: c.customer?.badgeColorHex || '#E23744',
                    bannerImageUrl: c.customer?.bannerImageUrl || '',
                },
                startAt: iso(c.startAt),
                endAt: iso(c.endAt),
                termsHash: c.termsHash || '',
                termsVersion: num(c.termsVersion) || 1,
                createdAt: iso(c.createdAt),
                updatedAt: iso(c.updatedAt),
                stats: {
                    committedPlatform: committed,
                    committedVendor: num(stats.committedVendor),
                    accruedPlatform: num(stats.accruedPlatform),
                    accruedVendor: num(stats.accruedVendor),
                    redemptions: num(stats.redemptions),
                    anomalyOrders: num(stats.anomalyOrders),
                    budgetUsedPercent: budget > 0 ? Math.round((committed / budget) * 1000) / 10 : 0,
                },
                enrollments: enrollmentCounts[doc.id] || {},
            };
        });

        campaigns.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return NextResponse.json({ success: true, data: campaigns });
    } catch (error) {
        console.error('[api/campaigns] list failed', error);
        return NextResponse.json({ success: false, error: 'Failed to load campaigns' }, { status: 500 });
    }
}

export const GET = withAdmin(handleGET);
