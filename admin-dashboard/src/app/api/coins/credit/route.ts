import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { db, collections, invalidateCache, sendPushNotification } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import type { AdminResult } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/coins/credit — admin adds coins to a customer's wallet.
 *
 * Body:
 *   customerId      string   (required)
 *   coins           integer  1 … 100,000
 *   reason          string   shown to the customer in their wallet history
 *   expiry          { mode: 'days', days }        — expires N days from now
 *                 | { mode: 'date', date: 'YYYY-MM-DD' } — end of that day, IST
 *                 | { mode: 'never' }
 *   notify          boolean  send a push notification to the customer
 *   requestId       string   client-generated; makes double-clicks harmless
 *
 * Written exactly like a referral bonus (see ReferralRepository.kt) so the
 * customer app needs no update: a `BONUS` transaction under
 * wallets/{uid}/transactions with `expiresAt`. WalletViewModel.expireOldCoins()
 * already deducts BONUS coins once `expiresAt` passes, and the wallet screen
 * shows the "expires in N days" note. "Never" simply omits `expiresAt`.
 */

const MAX_COINS_PER_GRANT = 100_000;
const MAX_EXPIRY_DAYS = 730;
const COINS_PER_RUPEE = 10; // WalletConstants.COINS_PER_RUPEE in the customer app

type Expiry =
    | { mode: 'days'; days: number }
    | { mode: 'date'; date: string }
    | { mode: 'never' };

function resolveExpiry(raw: unknown): { expiresAt: Date | null } | { error: string } {
    const e = (raw || {}) as Partial<Expiry> & { days?: unknown; date?: unknown };
    const now = Date.now();

    if (e.mode === 'never') return { expiresAt: null };

    if (e.mode === 'days') {
        const days = Number(e.days);
        if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
            return { error: `Expiry must be 1–${MAX_EXPIRY_DAYS} days` };
        }
        return { expiresAt: new Date(now + days * 86_400_000) };
    }

    if (e.mode === 'date') {
        if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
            return { error: 'Expiry date must be YYYY-MM-DD' };
        }
        // End of the chosen day in India time.
        const expiresAt = new Date(`${e.date}T23:59:59+05:30`);
        if (isNaN(expiresAt.getTime())) return { error: 'Invalid expiry date' };
        if (expiresAt.getTime() <= now) return { error: 'Expiry date must be in the future' };
        if (expiresAt.getTime() > now + MAX_EXPIRY_DAYS * 86_400_000) {
            return { error: `Expiry can be at most ${MAX_EXPIRY_DAYS} days away` };
        }
        return { expiresAt };
    }

    return { error: 'Choose an expiry: days, date or never' };
}

async function handlePOST(request: Request, _context: unknown, caller: AdminResult) {
    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
    const coins = Number(body.coins);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 120) : '';
    const notify = body.notify === true;
    const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(body.requestId)
        ? body.requestId
        : null;

    if (!customerId || customerId.includes('/')) {
        return NextResponse.json({ success: false, error: 'customerId is required' }, { status: 400 });
    }
    if (!Number.isInteger(coins) || coins < 1 || coins > MAX_COINS_PER_GRANT) {
        return NextResponse.json(
            { success: false, error: `Coins must be a whole number from 1 to ${MAX_COINS_PER_GRANT.toLocaleString('en-IN')}` },
            { status: 400 }
        );
    }
    if (reason.length < 3) {
        return NextResponse.json({ success: false, error: 'Add a short reason (the customer sees it)' }, { status: 400 });
    }
    const expiry = resolveExpiry(body.expiry);
    if ('error' in expiry) {
        return NextResponse.json({ success: false, error: expiry.error }, { status: 400 });
    }

    try {
        const customerSnap = await db.collection(collections.customers).doc(customerId).get();
        if (!customerSnap.exists) {
            return NextResponse.json({ success: false, error: 'Customer not found' }, { status: 404 });
        }

        const walletRef = db.collection(collections.wallets).doc(customerId);
        const txRef = requestId
            ? walletRef.collection('transactions').doc(`admin-${requestId}`)
            : walletRef.collection('transactions').doc();
        const now = Timestamp.now();
        const expiresAt = expiry.expiresAt ? Timestamp.fromDate(expiry.expiresAt) : null;

        const result = await db.runTransaction(async (tx) => {
            const [walletDoc, existingTx] = await Promise.all([tx.get(walletRef), tx.get(txRef)]);

            // Same requestId already applied (double click / retry) — report the original.
            if (existingTx.exists) {
                return { duplicate: true, balance: Number(existingTx.data()?.balanceAfter ?? walletDoc.data()?.totalCoins ?? 0) };
            }

            const current = Number(walletDoc.data()?.totalCoins || 0);
            const newBalance = current + coins;

            if (walletDoc.exists) {
                tx.update(walletRef, {
                    totalCoins: newBalance,
                    lifetimeEarned: Number(walletDoc.data()?.lifetimeEarned || 0) + coins,
                    updatedAt: now,
                });
            } else {
                tx.set(walletRef, {
                    userId: customerId,
                    totalCoins: newBalance,
                    lifetimeEarned: coins,
                    lifetimeRedeemed: 0,
                    createdAt: now,
                    updatedAt: now,
                });
            }

            tx.set(txRef, {
                type: 'BONUS',
                coins,
                description: reason,
                orderId: '',
                createdAt: now,
                ...(expiresAt ? { expiresAt } : {}),
                expired: false,
                balanceAfter: newBalance,
                // Audit trail — ignored by the app.
                source: 'admin',
                grantedBy: caller.email || caller.uid || 'admin',
                grantedByUid: caller.uid || null,
            });

            return { duplicate: false, balance: newBalance };
        });

        invalidateCache(collections.wallets);

        if (notify && !result.duplicate) {
            const expiryText = expiry.expiresAt
                ? ` Use them before ${expiry.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}.`
                : '';
            await sendPushNotification(
                'customer',
                customerId,
                `🪙 ${coins.toLocaleString('en-IN')} coins added to your wallet`,
                `${reason}.${expiryText}`,
                { type: 'wallet', navigateTo: 'wallet' }
            );
        }

        console.log(
            `[coins] ${caller.email || caller.uid} credited ${coins} coins to ${customerId}` +
            ` (expires ${expiry.expiresAt ? expiry.expiresAt.toISOString() : 'never'})${result.duplicate ? ' [duplicate request ignored]' : ''}`
        );

        return NextResponse.json({
            success: true,
            data: {
                customerId,
                coins,
                newBalance: result.balance,
                valueINR: coins / COINS_PER_RUPEE,
                expiresAt: expiry.expiresAt ? expiry.expiresAt.toISOString() : null,
                duplicate: result.duplicate,
            },
        });
    } catch (error) {
        console.error('[coins] credit failed:', error);
        return NextResponse.json({ success: false, error: 'Could not add coins. Please try again.' }, { status: 500 });
    }
}

export const POST = withAdmin(handlePOST);
