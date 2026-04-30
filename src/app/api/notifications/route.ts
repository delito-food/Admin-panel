import { NextResponse } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';

// Returns real-time notification items by querying Firestore for:
//  • New / unverified vendors
//  • Unverified delivery partners
//  • Recent new orders (last 2 hours)
//  • Any docs in the native `notifications` collection
export async function GET() {
    try {
        const items: {
            id: string;
            type: 'vendor' | 'delivery' | 'order' | 'menu';
            title: string;
            message: string;
            time: string;
            createdAt: string;
            read: boolean;
        }[] = [];

        const now = Date.now();

        const relativeTime = (isoStr: string | null): string => {
            if (!isoStr) return 'recently';
            const diff = Math.floor((now - new Date(isoStr).getTime()) / 1000);
            if (diff < 60) return `${diff}s ago`;
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            return `${Math.floor(diff / 86400)}d ago`;
        };

        const tsToIso = (v: any): string | null => {
            if (!v) return null;
            if (v?.toDate) return v.toDate().toISOString();
            if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString();
        };

        // ── 1. Unverified vendors (use cached collection) ──
        try {
            const allVendors = await cachedCollection(collections.vendors);
            allVendors
                .filter(d => d.isVerified === false)
                .slice(0, 10)
                .forEach(d => {
                    const at = tsToIso(d.createdAt);
                    items.push({
                        id: `vendor-${d.id}`,
                        type: 'vendor',
                        title: '🏪 New Vendor Registration',
                        message: `${d.shopName || d.fullName || 'A vendor'} has requested verification`,
                        time: relativeTime(at),
                        createdAt: at || new Date().toISOString(),
                        read: false,
                    });
                });
        } catch (e) { console.error('Vendor notification fetch error:', e); }

        // ── 2. Unverified delivery partners (use cached collection) ──
        try {
            const allDp = await cachedCollection(collections.deliveryPersons);
            allDp
                .filter(d => d.isVerified === false)
                .slice(0, 10)
                .forEach(d => {
                    const at = tsToIso(d.createdAt);
                    items.push({
                        id: `delivery-${d.id}`,
                        type: 'delivery',
                        title: '🚴 Delivery Partner Pending',
                        message: `${d.fullName || d.name || 'A partner'} is awaiting verification`,
                        time: relativeTime(at),
                        createdAt: at || new Date().toISOString(),
                        read: false,
                    });
                });
        } catch (e) { console.error('Delivery notification fetch error:', e); }

        // ── 3. Recent orders (last 4 hours) — use cached orders, filter in JS ──
        try {
            const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000);
            const allOrders = await cachedCollection(collections.orders);

            // Sort by createdAt desc and take first 20 for notifications
            const recentOrders = allOrders
                .map(d => {
                    const o = d as any;
                    return { ...o, _at: tsToIso(d.createdAt) as string | null };
                })
                .filter((d: any) => {
                    if (!d._at) return false;
                    if (new Date(d._at) < fourHoursAgo) return false;
                    const status = String(d.status || '').toLowerCase();
                    return status === 'pending' || status === 'placed';
                })
                .sort((a: any, b: any) => (b._at || '').localeCompare(a._at || ''))
                .slice(0, 20);

            recentOrders.forEach((d: any) => {
                    items.push({
                        id: `order-${d.id}`,
                        type: 'order',
                        title: '🛒 New Order Placed',
                        message: `${d.customerName || 'Customer'} ordered from ${d.vendorName || 'a restaurant'} • ₹${(Number(d.total) || 0).toLocaleString('en-IN')}`,
                        time: relativeTime(d._at),
                        createdAt: d._at!,
                        read: false,
                    });
                });
        } catch (e) {
            console.error('Orders notification fetch error:', e);
        }

        // ── 4. Native notifications collection ───────────────────────────────
        try {
            const notifSnap = await db.collection(collections.notifications)
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get();

            notifSnap.docs.forEach(doc => {
                const d = doc.data();
                const at = tsToIso(d.createdAt);
                items.push({
                    id: `notif-${doc.id}`,
                    type: (d.type as any) || 'order',
                    title: d.title || 'Notification',
                    message: d.message || d.body || '',
                    time: relativeTime(at),
                    createdAt: at || new Date().toISOString(),
                    read: d.read ?? false,
                });
            });
        } catch { /* skip */ }

        // Sort all items newest first
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return NextResponse.json({ success: true, data: items });
    } catch (error) {
        console.error('Notifications fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch notifications' }, { status: 500 });
    }
}
