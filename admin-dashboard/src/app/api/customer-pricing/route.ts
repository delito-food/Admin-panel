import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';

/**
 * Customer delivery charges + minimum cart value — /api/customer-pricing
 *
 * One document, `config/customerPricing`, read live by the customer app
 * (shared/CustomerPricingConfig.kt → PricingCalculator.calculateDeliveryFee and the
 * cart's minimum-order gate). No document = the values the app shipped with.
 *
 *   GET            current values (defaults filled in) + last change
 *   PUT { values } validate and save
 *
 * The limits below are ALSO clamped by the app on read, so a bad document can never
 * charge more than MAX_FEE_CAP for delivery.
 */

const COLLECTION = 'config';
const DOC = 'customerPricing';
const LOGS = 'customerPricingLogs';

/** Same values as the PricingCalculator constants the app falls back to. */
const DEFAULTS = {
    minimumOrderValue: 49,
    deliveryBaseFee: 0,
    deliveryPerKm: 4.5,
    deliveryPerKmSmallOrder: 7.5,
    smallOrderThreshold: 129,
    minDeliveryFee: 15,
    maxDeliveryFee: 100,
};
type Values = typeof DEFAULTS;

const LIMITS: Record<keyof Values, [number, number, string]> = {
    minimumOrderValue: [0, 2000, 'Minimum cart value'],
    deliveryBaseFee: [0, 200, 'Base delivery fee'],
    deliveryPerKm: [0, 50, 'Per-km rate'],
    deliveryPerKmSmallOrder: [0, 50, 'Small-order per-km rate'],
    smallOrderThreshold: [0, 5000, 'Small-order threshold'],
    minDeliveryFee: [0, 500, 'Minimum delivery fee'],
    maxDeliveryFee: [0, 500, 'Maximum delivery fee'],
};

class BadRequest extends Error {}

const round1 = (n: number) => Math.round(n * 10) / 10;

function clean(input: Record<string, unknown>): Values {
    const out = {} as Values;
    for (const key of Object.keys(LIMITS) as (keyof Values)[]) {
        const [lo, hi, label] = LIMITS[key];
        const n = Number(input?.[key]);
        if (!Number.isFinite(n) || n < lo || n > hi) throw new BadRequest(`${label} must be between ₹${lo} and ₹${hi}`);
        out[key] = round1(n);
    }
    if (out.maxDeliveryFee < out.minDeliveryFee) throw new BadRequest('Maximum delivery fee must be at least the minimum delivery fee');
    return out;
}

function read(d: FirebaseFirestore.DocumentData | undefined): Values {
    const out = { ...DEFAULTS };
    if (!d) return out;
    for (const key of Object.keys(DEFAULTS) as (keyof Values)[]) {
        const n = Number(d[key]);
        if (d[key] !== undefined && Number.isFinite(n)) out[key] = n;
    }
    return out;
}

function who(auth: AdminResult): string {
    return auth?.email || auth?.uid || 'admin';
}

function fail(error: unknown) {
    if (error instanceof BadRequest) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('[customer-pricing] error', error);
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}

async function handleGET() {
    try {
        const snap = await db.collection(COLLECTION).doc(DOC).get();
        const d = snap.exists ? snap.data() : undefined;
        return NextResponse.json({
            success: true,
            data: {
                values: read(d),
                defaults: DEFAULTS,
                isDefault: !snap.exists,
                updatedAt: d?.updatedAt?.toDate?.()?.toISOString?.() || null,
                updatedBy: d?.updatedBy || null,
            },
        });
    } catch (e) {
        return fail(e);
    }
}

async function handlePUT(request: Request, _ctx: unknown, auth: AdminResult) {
    try {
        const body = await request.json();
        const values = clean(body?.values || {});
        const ref = db.collection(COLLECTION).doc(DOC);
        const before = await ref.get();
        const now = Timestamp.now();
        await ref.set({ ...values, updatedAt: now, updatedBy: who(auth) });
        try {
            await db.collection(LOGS).add({
                by: who(auth),
                at: now,
                before: before.exists ? read(before.data()) : null,
                after: values,
            });
        } catch (e) {
            console.error('[customer-pricing] audit log failed', e);
        }
        return NextResponse.json({ success: true, data: { values, updatedAt: now.toDate().toISOString(), updatedBy: who(auth) } });
    } catch (e) {
        return fail(e);
    }
}

export const GET = withAdmin(handleGET);
export const PUT = withAdmin(handlePUT);
