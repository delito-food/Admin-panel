import { NextResponse } from 'next/server';
import { collections, cachedCollection, cachedQuery } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { toDate, istParts, formatIstTime } from '@/lib/fiscal';
import { calcOrderBreakdown } from '@/lib/order-breakdown';
import { STORY_CONFIG, type StoryData, type StoryMilestone } from '@/lib/story-config';

/**
 * GET /api/story — milestones for the motivational story page.
 * Everything is derived from the same cached collections the dashboard reads.
 */

const STORY_TTL = 5 * 60_000;
const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' for the IST calendar day of an instant. */
function istDayKey(d: Date): string {
    const { year, month, day } = istParts(d);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole IST days between two day keys. */
function daysBetween(fromKey: string, toKey: string): number {
    return Math.round((Date.parse(toKey + 'T00:00:00Z') - Date.parse(fromKey + 'T00:00:00Z')) / DAY_MS);
}

const isDelivered = (s: unknown) => /^(delivered|completed)$/i.test(String(s || ''));
const isCancelled = (s: unknown) => /cancel/i.test(String(s || ''));
const round2 = (n: number) => Math.round(n * 100) / 100;

async function buildStory(): Promise<StoryData> {
    const [orders, customers, vendors, riders] = await Promise.all([
        cachedCollection(collections.orders),
        cachedCollection(collections.customers),
        cachedCollection(collections.vendors),
        cachedCollection(collections.deliveryPersons),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dated = (orders as any[])
        .map((o) => ({ o, at: toDate(o.createdAt) }))
        .filter((x): x is { o: any; at: Date } => !!x.at) // eslint-disable-line @typescript-eslint/no-explicit-any
        .sort((a, b) => a.at.getTime() - b.at.getTime());

    const todayKey = istDayKey(new Date());
    const first = dated[0];
    const firstKey = first ? istDayKey(first.at) : null;
    const dayNo = (key: string | null) => (key && firstKey ? daysBetween(firstKey, key) + 1 : null);

    // ── Per-day rollup ──
    type Day = { orders: number; delivered: number; cancelled: number; earnings: number; gmv: number };
    const days = new Map<string, Day>();
    const delivered: { at: Date }[] = [];
    let totalGmv = 0;

    for (const { o, at } of dated) {
        const key = istDayKey(at);
        const day = days.get(key) ?? { orders: 0, delivered: 0, cancelled: 0, earnings: 0, gmv: 0 };
        day.orders += 1;
        if (isDelivered(o.status)) {
            const b = calcOrderBreakdown(o);
            day.delivered += 1;
            day.earnings += b.netPlatformEarning;
            day.gmv += b.gmv;
            totalGmv += b.gmv;
            // The moment it reached the customer, when we know it
            delivered.push({ at: toDate(o.deliveredAt) ?? at });
        } else if (isCancelled(o.status)) {
            day.cancelled += 1;
        }
        days.set(key, day);
    }
    delivered.sort((a, b) => a.at.getTime() - b.at.getTime());

    const milestone = (list: { at: Date }[], target: number): StoryMilestone => {
        const hit = list[target - 1];
        const date = hit ? istDayKey(hit.at) : null;
        return { date, current: list.length, target, dayNumber: dayNo(date) };
    };

    // ── Customers ──
    const customerJoins = (customers as { createdAt?: unknown }[])
        .map((c) => ({ at: toDate(c.createdAt) }))
        .filter((x): x is { at: Date } => !!x.at)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
    const customerMilestones = [100, 500, 1000].map((t) => {
        const m = milestone(customerJoins, t);
        // Customers without a join date still count towards "where we are now"
        return { ...m, current: customers.length };
    });

    // ── Best day ──
    let bestDay: StoryData['bestDay'] = null;
    for (const [date, d] of days) {
        if (d.delivered === 0) continue;
        if (!bestDay || d.earnings > bestDay.earnings) {
            bestDay = { date, earnings: round2(d.earnings), orders: d.delivered, gmv: round2(d.gmv) };
        }
    }

    // ── Toughest day: configured, or the day with the most cancellations ──
    let tough: { date: string; d: Day } | null = null;
    const override = STORY_CONFIG.toughestDay;
    if (override?.date) {
        tough = { date: override.date, d: days.get(override.date) ?? { orders: 0, delivered: 0, cancelled: 0, earnings: 0, gmv: 0 } };
    } else {
        for (const [date, d] of days) {
            if (d.cancelled < 2) continue;
            const better = !tough
                || d.cancelled > tough.d.cancelled
                || (d.cancelled === tough.d.cancelled && d.cancelled / d.orders > tough.d.cancelled / tough.d.orders);
            if (better) tough = { date, d };
        }
    }

    let toughestDay: StoryData['toughestDay'] = null;
    if (tough) {
        const after = [...days.entries()]
            .filter(([k, d]) => k > tough!.date && d.delivered > 0)
            .sort(([a], [b]) => (a < b ? -1 : 1));
        toughestDay = {
            date: tough.date,
            cancelled: tough.d.cancelled,
            totalOrders: tough.d.orders,
            title: override?.title ?? null,
            note: override?.note ?? null,
            bounceBack: after[0] ? { date: after[0][0], delivered: after[0][1].delivered } : null,
            deliveredSince: after.reduce((sum, [, d]) => sum + d.delivered, 0),
        };
    }

    return {
        firstOrder: first
            ? {
                date: firstKey!,
                time: formatIstTime(first.at),
                restaurant: typeof first.o.vendorName === 'string' ? first.o.vendorName : null,
            }
            : null,
        firstHundredDelivered: milestone(delivered, 100),
        customers: customerMilestones,
        bestDay,
        toughestDay,
        totals: {
            delivered: delivered.length,
            customers: customers.length,
            restaurants: (vendors as { isVerified?: boolean }[]).filter((v) => v.isVerified === true).length,
            riders: (riders as { isVerified?: boolean }[]).filter((r) => r.isVerified === true).length,
            daysRunning: firstKey ? daysBetween(firstKey, todayKey) + 1 : 0,
            gmv: round2(totalGmv),
        },
        nextCityName: STORY_CONFIG.nextCityName,
        currentCityName: STORY_CONFIG.currentCityName,
        generatedAt: new Date().toISOString(),
    };
}

async function handleGET() {
    try {
        const data = await cachedQuery('story:summary', buildStory, STORY_TTL);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('Story build error:', error);
        return NextResponse.json({ success: false, error: 'Failed to build the story' }, { status: 500 });
    }
}

export const GET = withAdmin(handleGET);
