/**
 * Hand-set facts for the Delito story page (/story).
 *
 * Everything else on that page is computed from live data. These are the
 * bits the database can't know — edit them freely, no other code changes.
 */
export const STORY_CONFIG = {
    /**
     * The day things broke. Left as null, the page picks the day with the
     * most cancelled orders. Set a date ('YYYY-MM-DD', IST) to tell the real
     * story instead, e.g.
     *   { date: '2026-08-14', title: 'The day the servers went quiet', note: 'Payments failed for 3 hours…' }
     */
    toughestDay: null as null | { date: string; title?: string; note?: string },

    /** Shown in the "next city" chapter. Leave empty to keep it a surprise. */
    nextCityName: '',

    /** The city Delito runs in today. */
    currentCityName: '',
};

/* ── Shape of GET /api/story ─────────────────────────────── */

export interface StoryMilestone {
    /** IST calendar day, 'YYYY-MM-DD'. null = not reached yet. */
    date: string | null;
    /** Where we stand right now against the target. */
    current: number;
    target: number;
    /** Days after the very first order. */
    dayNumber: number | null;
}

export interface StoryData {
    firstOrder: { date: string; time: string; restaurant: string | null } | null;
    firstHundredDelivered: StoryMilestone;
    customers: StoryMilestone[]; // 100, 500, 1000
    bestDay: { date: string; earnings: number; orders: number; gmv: number } | null;
    toughestDay: {
        date: string;
        cancelled: number;
        totalOrders: number;
        title: string | null;
        note: string | null;
        /** The next day we delivered anything after the bad day. */
        bounceBack: { date: string; delivered: number } | null;
        /** Delivered orders from the day after the bad day up to today. */
        deliveredSince: number;
    } | null;
    totals: {
        delivered: number;
        customers: number;
        restaurants: number;
        riders: number;
        daysRunning: number;
        gmv: number;
    };
    nextCityName: string;
    currentCityName: string;
    generatedAt: string;
}
