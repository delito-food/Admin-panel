import { NextResponse } from 'next/server';
import { db, invalidateCache } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
    evaluateSchedule,
    validateBusinessHours,
    isValidTimezone,
    withLegacyMirror,
    DEFAULT_TZ,
} from '@/lib/scheduleEngine';

/**
 * Business-hours admin API.
 *
 * Shares scheduleEngine with the Cloud Function (functions/scheduleEngine.js) so the
 * admin panel and the cron can never disagree about whether a shop should be open.
 *
 * GET  /api/vendors/business-hours?vendorId=xxx
 * PUT  /api/vendors/business-hours
 */

function describe(vendorId: string, v: Record<string, unknown>) {
    const { shouldBeOpen, reason, nextTransitionAt } = evaluateSchedule(v, new Date());
    return {
        vendorId,
        shopName: (v.shopName as string) ?? '',
        city: (v.city as string) ?? '',
        isOnline: v.isOnline === true,
        shouldBeOpen,
        scheduleReason: reason,
        autoScheduleEnabled: v.autoScheduleEnabled === true,
        timezone: (v.timezone as string) || DEFAULT_TZ,
        businessHours: v.businessHours ?? {},
        holidays: v.holidays ?? [],
        manualOverride: v.manualOverride ?? null,
        nextTransitionAt: nextTransitionAt ? nextTransitionAt.toISOString() : null,
        // Surfaced so support can see WHY a shop is dark without guessing.
        blockers: {
            isSuspended: v.isSuspended === true,
            adminForceOffline: v.adminForceOffline === true,
            verificationStatus: (v.verificationStatus as string) ?? 'pending',
        },
        // Drift detector: the scheduler should have reconciled these already.
        // A persistent mismatch means the tick isn't running or nextTransitionAt is stale.
        drift: v.autoScheduleEnabled === true && v.isOnline !== shouldBeOpen,
    };
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const vendorId = searchParams.get('vendorId');

        // Single vendor
        if (vendorId) {
            const snap = await db.collection('vendors').doc(vendorId).get();
            if (!snap.exists) {
                return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 });
            }
            return NextResponse.json({
                success: true,
                data: describe(vendorId, snap.data() as Record<string, unknown>),
            });
        }

        // List all vendors with their schedule state
        const all = await db.collection('vendors').get();
        const vendors = all.docs
            .map((d) => describe(d.id, d.data() as Record<string, unknown>))
            .sort((a, b) => a.shopName.localeCompare(b.shopName));

        return NextResponse.json({
            success: true,
            data: {
                vendors,
                summary: {
                    total: vendors.length,
                    autoScheduled: vendors.filter((v) => v.autoScheduleEnabled).length,
                    open: vendors.filter((v) => v.isOnline).length,
                    paused: vendors.filter((v) => v.scheduleReason === 'VENDOR_PAUSED').length,
                    drifting: vendors.filter((v) => v.drift).length,
                },
            },
        });
    } catch (error) {
        console.error('[business-hours GET]', error);
        return NextResponse.json({ success: false, error: 'Failed to load business hours' }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { vendorId, businessHours, timezone, holidays, autoScheduleEnabled } = body;

        if (!vendorId) {
            return NextResponse.json({ success: false, error: 'vendorId is required' }, { status: 400 });
        }

        const validation = validateBusinessHours(businessHours);
        if (!validation.valid) {
            return NextResponse.json(
                { success: false, error: validation.errors.join('; '), details: validation.errors },
                { status: 400 }
            );
        }

        const tz = timezone || DEFAULT_TZ;
        if (!isValidTimezone(tz)) {
            return NextResponse.json({ success: false, error: `Unknown timezone "${tz}"` }, { status: 400 });
        }

        const cleanHolidays: string[] = Array.isArray(holidays)
            ? holidays.filter((h: string) => /^\d{4}-\d{2}-\d{2}$/.test(h))
            : [];

        const ref = db.collection('vendors').doc(vendorId);
        const snap = await ref.get();
        if (!snap.exists) {
            return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 404 });
        }
        const current = snap.data() as Record<string, unknown>;

        const update: Record<string, unknown> = {
            // withLegacyMirror keeps openTime/closeTime populated so vendor app v2.5
            // continues to render hours correctly. Do not drop this.
            businessHours: withLegacyMirror(businessHours),
            timezone: tz,
            holidays: cleanHolidays,
            updatedAt: Timestamp.now(),
        };
        if (typeof autoScheduleEnabled === 'boolean') {
            update.autoScheduleEnabled = autoScheduleEnabled;
        }

        // Apply immediately rather than waiting for the next 10-minute tick.
        const merged = { ...current, ...update };
        const { shouldBeOpen, reason, nextTransitionAt } = evaluateSchedule(merged, new Date());

        if (reason !== 'MANUAL_MODE') {
            // Never let a schedule edit override an admin block.
            const blocked =
                current.isSuspended === true ||
                current.adminForceOffline === true ||
                (current.verificationStatus && current.verificationStatus !== 'verified');

            if (!(shouldBeOpen && blocked)) {
                update.isOnline = shouldBeOpen;
                update.scheduleReason = reason;
                update.statusChangedBy = 'admin';
                update.statusChangedAt = Timestamp.now();
            }
        }
        update.nextTransitionAt = nextTransitionAt ? Timestamp.fromDate(nextTransitionAt) : null;

        await ref.update(update);
        invalidateCache('vendors');

        await ref.collection('auditLog').add({
            action: 'SET_BUSINESS_HOURS',
            by: 'admin',
            autoScheduleEnabled: update.autoScheduleEnabled ?? current.autoScheduleEnabled ?? false,
            at: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            data: {
                isOnline: update.isOnline ?? current.isOnline,
                scheduleReason: reason,
                nextTransitionAt: nextTransitionAt ? nextTransitionAt.toISOString() : null,
            },
        });
    } catch (error) {
        console.error('[business-hours PUT]', error);
        return NextResponse.json({ success: false, error: 'Failed to save business hours' }, { status: 500 });
    }
}
