/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { collections, cachedCollection } from '@/lib/firebase-admin';

/**
 * GET /api/coins
 * Reads coin balances from the `wallets` collection (top-level),
 * cross-references customers and orders for display.
 * Wallet doc fields: totalCoins, lifetimeEarned, lifetimeRedeemed
 */

function tsToIso(v: any): string | null {
    if (!v) return null;
    if (v?.toDate) return v.toDate().toISOString();
    if (v?._seconds) return new Date(v._seconds * 1000).toISOString();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function GET() {
    try {
        const allCustomers = await cachedCollection(collections.customers, 60000);
        const allWallets = await cachedCollection(collections.wallets, 30000);
        const allOrders = await cachedCollection(collections.orders, 30000);

        // Build wallet map: userId → wallet data
        const walletMap: Record<string, { totalCoins: number; lifetimeEarned: number; lifetimeRedeemed: number }> = {};
        allWallets.forEach(w => {
            walletMap[w.id] = {
                totalCoins: Number(w.totalCoins || 0),
                lifetimeEarned: Number(w.lifetimeEarned || 0),
                lifetimeRedeemed: Number(w.lifetimeRedeemed || 0),
            };
        });

        // Track coin usage from orders
        const customerCoinUsage: Record<string, { coinsUsed: number; coinDiscount: number; ordersWithCoins: number }> = {};
        allOrders.forEach(order => {
            const cid = order.customerId as string;
            if (!cid) return;
            const coinsUsed = Number(order.coinsUsed || 0);
            const coinDiscount = Number(order.coinDiscount || 0);
            if (coinsUsed > 0) {
                if (!customerCoinUsage[cid]) customerCoinUsage[cid] = { coinsUsed: 0, coinDiscount: 0, ordersWithCoins: 0 };
                customerCoinUsage[cid].coinsUsed += coinsUsed;
                customerCoinUsage[cid].coinDiscount += coinDiscount;
                customerCoinUsage[cid].ordersWithCoins += 1;
            }
        });

        let totalCoinsBalance = 0;
        let totalCoinsEarned = 0;
        let totalCoinsRedeemed = 0;
        let customersWithCoins = 0;

        const customers = allCustomers.map(c => {
            const wallet = walletMap[c.id] || { totalCoins: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 };
            const usage = customerCoinUsage[c.id] || { coinsUsed: 0, coinDiscount: 0, ordersWithCoins: 0 };

            totalCoinsBalance += wallet.totalCoins;
            totalCoinsEarned += wallet.lifetimeEarned;
            totalCoinsRedeemed += wallet.lifetimeRedeemed;
            if (wallet.totalCoins > 0 || wallet.lifetimeEarned > 0) customersWithCoins++;

            return {
                customerId: c.id,
                name: (c.fullName || '') as string,
                phone: (c.phoneNumber || '') as string,
                email: (c.email || '') as string,
                coinBalance: wallet.totalCoins,
                totalEarned: wallet.lifetimeEarned,
                totalRedeemed: wallet.lifetimeRedeemed,
                coinDiscount: usage.coinDiscount,
                ordersWithCoins: usage.ordersWithCoins,
                totalOrders: Number(c.totalOrders || 0),
                registeredAt: tsToIso(c.createdAt) || '',
            };
        }).sort((a, b) => b.coinBalance - a.coinBalance);

        // 1 coin = ₹1 (standard)
        const totalCoinValueINR = totalCoinsBalance;
        const totalRedeemedValueINR = totalCoinsRedeemed;

        const summary = {
            totalCoinsOnPlatform: totalCoinsBalance,
            totalCoinsEarned,
            totalCoinsRedeemed,
            totalCoinValueINR,
            totalRedeemedValueINR,
            customersWithCoins,
            totalCustomers: allCustomers.length,
            avgCoinsPerCustomer: allCustomers.length > 0 ? Math.round(totalCoinsBalance / allCustomers.length) : 0,
        };

        return NextResponse.json({ success: true, data: { summary, customers } });
    } catch (error: any) {
        console.error('Coins fetch error:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Failed to fetch coin data' }, { status: 500 });
    }
}
