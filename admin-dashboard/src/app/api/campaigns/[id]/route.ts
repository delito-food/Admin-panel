import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';

/**
 * GET /api/campaigns/[id] — one campaign's live console.
 *
 * Returns the campaign, its counters, every enrolment with its consent state, the most
 * recent redemptions, and anything flagged. Read only; see /api/campaigns/route.ts.
 *
 * `?format=csv` returns the redemption rows for finance instead.
 */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const iso = (v: any): string | null => v?.toDate?.()?.toISOString?.() || null;

async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        if (!id) return NextResponse.json({ success: false, error: 'Missing campaign id' }, { status: 400 });

        const wantsCsv = new URL(request.url).searchParams.get('format') === 'csv';

        // Bounded. One redemption per redeemed order, for the whole life of the campaign:
        // unbounded, a successful campaign is exactly the one whose console times out.
        // The counters in campaignStats are the authoritative totals; this list is a
        // sample, and it says so when it has been cut short.
        const REDEMPTION_CAP = wantsCsv ? 20000 : 500;
        const ENROLLMENT_CAP = 2000;

        const [campaignSnap, statsSnap, enrollmentsSnap, redemptionsSnap, alertsSnap] = await Promise.all([
            db.collection('campaigns').doc(id).get(),
            db.collection('campaignStats').doc(id).get(),
            db.collection('campaignEnrollments').where('campaignId', '==', id).limit(ENROLLMENT_CAP).get(),
            db.collection('campaignRedemptions').where('campaignId', '==', id)
                .orderBy('committedAt', 'desc').limit(REDEMPTION_CAP).get(),
            db.collection('campaignAlerts').where('campaignId', '==', id).limit(50).get(),
        ]);

        if (!campaignSnap.exists) {
            return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
        }

        const redemptions = redemptionsSnap.docs
            .map((d) => {
                const r = d.data();
                return {
                    orderId: r.orderId || d.id,
                    vendorId: r.vendorId || '',
                    customerId: r.customerId || '',
                    grossItemTotal: num(r.G),
                    itemTotal: num(r.P),
                    discount: num(r.discount),
                    vendorFunded: num(r.vendorFunded),
                    platformFunded: num(r.platformFunded),
                    commissionRate: r.commissionRate ?? null,
                    commission: num(r.cut),
                    gstOnCommission: num(r.gstCut),
                    vendorEarning: num(r.vendorEarning),
                    status: r.status || '',
                    anomalies: Array.isArray(r.anomalies) ? r.anomalies : [],
                    committedAt: iso(r.committedAt),
                };
            })
            .sort((a, b) => (b.committedAt || '').localeCompare(a.committedAt || ''));

        if (wantsCsv) {
            const header = [
                'orderId', 'vendorId', 'customerId', 'grossItemTotal', 'itemTotal', 'discount',
                'vendorFunded', 'platformFunded', 'commissionRate', 'commission', 'gstOnCommission',
                'vendorEarning', 'status', 'anomalies', 'committedAt',
            ];
            const rows = redemptions.map((r) => [
                r.orderId, r.vendorId, r.customerId, r.grossItemTotal, r.itemTotal, r.discount,
                r.vendorFunded, r.platformFunded, r.commissionRate ?? '', r.commission, r.gstOnCommission,
                r.vendorEarning, r.status, r.anomalies.join('|'), r.committedAt ?? '',
            ]);
            // Quoting alone does not stop Excel evaluating a leading =, +, - or @ once it
            // unquotes the cell. Prefixing an apostrophe does. Every value here is
            // server-generated today, which is exactly the assumption that stops being
            // true the first time a vendor-supplied name is added to this export.
            const cell = (v: unknown) => {
                const raw = String(v ?? '');
                const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
                return `"${safe.replace(/"/g, '""')}"`;
            };
            const csv = [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
            return new NextResponse(csv, {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="campaign-${id}-redemptions.csv"`,
                },
            });
        }

        const c = campaignSnap.data() || {};
        const stats = statsSnap.exists ? statsSnap.data() || {} : {};

        // Per-vendor totals, so the console can show who is actually running the offer.
        const perVendor: Record<string, { orders: number; discount: number; vendorFunded: number; platformFunded: number }> = {};
        for (const r of redemptions) {
            if (r.status === 'RELEASED') continue;
            const v = (perVendor[r.vendorId] = perVendor[r.vendorId] || { orders: 0, discount: 0, vendorFunded: 0, platformFunded: 0 });
            v.orders += 1;
            v.discount += r.discount;
            v.vendorFunded += r.vendorFunded;
            v.platformFunded += r.platformFunded;
        }

        const enrollments = enrollmentsSnap.docs.map((d) => {
            const e = d.data();
            return {
                enrollmentId: d.id,
                vendorId: e.vendorId || '',
                vendorName: e.vendorName || '',
                status: e.status || '',
                proposedTermsHash: e.proposedTermsHash || '',
                consentTermsHash: e.consent?.termsHash || '',
                consentAt: iso(e.consent?.acceptedAt),
                consentPhoneLast4: e.consent?.phoneLast4 || '',
                declineReason: e.declineReason || '',
                withdrawnAt: iso(e.withdrawnAt),
                totals: perVendor[e.vendorId] || { orders: 0, discount: 0, vendorFunded: 0, platformFunded: 0 },
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                campaignId: id,
                campaign: {
                    ...c,
                    startAt: iso(c.startAt),
                    endAt: iso(c.endAt),
                    createdAt: iso(c.createdAt),
                    updatedAt: iso(c.updatedAt),
                },
                stats: {
                    committedPlatform: num(stats.committedPlatform),
                    committedVendor: num(stats.committedVendor),
                    accruedPlatform: num(stats.accruedPlatform),
                    accruedVendor: num(stats.accruedVendor),
                    redemptions: num(stats.redemptions),
                    anomalyOrders: num(stats.anomalyOrders),
                },
                enrollments,
                redemptions: redemptions.slice(0, 200),
                // So the console never implies these 200 rows are the whole story.
                redemptionsTruncated: redemptionsSnap.size >= REDEMPTION_CAP || redemptions.length > 200,
                alerts: alertsSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: iso(d.data().createdAt) })),
            },
        });
    } catch (error) {
        console.error('[api/campaigns/[id]] failed', error);
        return NextResponse.json({ success: false, error: 'Failed to load campaign' }, { status: 500 });
    }
}

export const GET = withAdmin(handleGET);
