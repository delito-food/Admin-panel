/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, NextRequest } from 'next/server';
import { db, collections, cachedCollection } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { computeCommission, r2 } from '@/lib/pricing-engine';
import { allLedgerBalances, divergence, type LedgerBalance } from '@/lib/ledger';

async function handleGET(request: NextRequest) {
    try {
        // Parse optional date range query params
        const { searchParams } = new URL(request.url);
        const startDateParam = searchParams.get('startDate'); // ISO string e.g. '2026-07-01'
        const endDateParam = searchParams.get('endDate');       // ISO string e.g. '2026-07-14'

        const startDate = startDateParam ? new Date(startDateParam) : null;
        const endDate = endDateParam ? new Date(endDateParam + 'T23:59:59.999Z') : null;

        // Use cached vendors (60s TTL) — vendor profiles change rarely
        const vendorDocs = await cachedCollection(collections.vendors);

        // Always fetch orders fresh — this is a financial calculation and must be accurate
        // Using cachedCollection here caused stale data and ₹0 pending when orders exist
        const ordersSnapshot = await db.collection(collections.orders).get();
        let orderDocs = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, unknown> & { id: string }));

        // Filter orders by date range if provided
        if (startDate || endDate) {
            orderDocs = orderDocs.filter(order => {
                 
                const rawCreatedAt = order.createdAt as any;
                const orderDate = rawCreatedAt?.toDate?.() || (rawCreatedAt ? new Date(rawCreatedAt) : null);
                if (!orderDate) return false;
                const d = orderDate instanceof Date ? orderDate : new Date(orderDate);
                if (isNaN(d.getTime())) return false;
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            });
        }

        // The ledger is the authority on what each vendor is owed. It is read
        // once here; the order-derived figures below are kept only as a
        // cross-check and as the fallback for vendors not yet backfilled.
        let ledgerBalances: Record<string, LedgerBalance> = {};
        try {
            ledgerBalances = await allLedgerBalances('vendor');
        } catch (err) {
            console.warn('[payouts] ledger unavailable, falling back to order-derived figures:', err);
        }

        // Get payout history (small collection, fetch fresh)
        const payoutsSnapshot = await db.collection('vendorPayouts').orderBy('createdAt', 'desc').limit(200).get()
            .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));

        // GST rate on commission (platform earnings)
        // Commission and its GST now come from lib/pricing-engine.

        // Calculate vendor payouts
        const vendorPayouts: Record<string, {
            totalRevenue: number;
            commissionAmount: number;
            gstOnCommission: number;
            smallOrderFees: number;
            deliveryFeeProfit: number;
            totalPlatformEarning: number;
            /** The vendor's own share of co-funded offers. Already inside netPayable. */
            offerContribution: number;
            offerOrders: number;
            netPayable: number;
            paidAmount: number;
            pendingAmount: number;
            orderCount: number;
            lastOrderDate: string | null;
        }> = {};

        orderDocs.forEach(order => {
            const vendorId = order.vendorId as string;
            const status = ((order.status as string) || '').toLowerCase();

            if (!vendorId) return;
            if (status !== 'delivered' && status !== 'completed') return;

            if (!vendorPayouts[vendorId]) {
                vendorPayouts[vendorId] = {
                    totalRevenue: 0,
                    commissionAmount: 0,
                    gstOnCommission: 0,
                    smallOrderFees: 0,
                    deliveryFeeProfit: 0,
                    totalPlatformEarning: 0,
                    offerContribution: 0,
                    offerOrders: 0,
                    netPayable: 0,
                    paidAmount: 0,
                    pendingAmount: 0,
                    orderCount: 0,
                    lastOrderDate: null,
                };
            }

            // Item total (what customer pays for food — items only, no delivery)
            // Fallback chain matches vendor app: itemTotal → subtotal → (total - deliveryFee)
            // Without the total fallback, orders that only have `total` show as ₹0 here
            const deliveryFeeAmt = (order.deliveryFee as number) || 0;
            const itemTotal = (order.itemTotal as number) || (order.subtotal as number) ||
                Math.max(0, ((order.total as number) || 0) - deliveryFeeAmt);

            // Commission comes from the shared pricing engine — the same call the
            // commission invoice and the GST report make — so the three can no
            // longer report three different figures for the same order.
            const commissionResult = computeCommission(order, itemTotal);
            const commission = commissionResult.amount;
            const gstOnCommission = commissionResult.gst;

            // Small order fee (₹10 if order < ₹99) - goes to platform
            const smallOrderFee = (order.smallOrderSupportFee as number) || 0;

            // Delivery fee profit = customer delivery fee - delivery person earnings
            const customerDeliveryFee = (order.deliveryFee as number) || 0;
            const deliveryPersonEarnings = (order.deliveryPersonEarnings as number) ||
                (order.distanceKm ? Math.max(15, Math.round((10 + ((order.distanceKm as number) * 6.5)) * 10) / 10) : Math.max(15, customerDeliveryFee));
            const deliveryFeeProfit = customerDeliveryFee - deliveryPersonEarnings;

            // Total platform earning
            const totalPlatformEarning = commission + gstOnCommission + smallOrderFee + deliveryFeeProfit;

            // Vendor earns: the stored figure whenever the field EXISTS.
            //
            // This used to fall back to a recomputation when the stored value was 0 or
            // less. That recomputation knows nothing about a co-funded offer — the
            // vendor's share of it is taken off by functions/orderFinance.js — so on an
            // offer order it would have overpaid the vendor. A stored 0 is also a real
            // answer (a fully discounted order), not a missing one.
            // See CO_FUNDED_OFFERS_IMPLEMENTATION_PLAN.md §3 H5.
            const storedVendorEarning = order.vendorEarning;
            const vendorEarning = (storedVendorEarning != null && Number.isFinite(storedVendorEarning as number))
                ? Math.max(0, storedVendorEarning as number)
                : Math.max(0, itemTotal - commission - gstOnCommission);
            const offerContribution = Math.max(0, (order.campaignVendorFunded as number) || 0);

            vendorPayouts[vendorId].totalRevenue += itemTotal;
            vendorPayouts[vendorId].commissionAmount += commission;
            vendorPayouts[vendorId].gstOnCommission += gstOnCommission;
            vendorPayouts[vendorId].smallOrderFees += smallOrderFee;
            vendorPayouts[vendorId].deliveryFeeProfit += deliveryFeeProfit;
            vendorPayouts[vendorId].totalPlatformEarning += totalPlatformEarning;
            vendorPayouts[vendorId].offerContribution += offerContribution;
            // Counts orders the vendor ACTUALLY co-funded. An order where the whole
            // discount fell to Delito (an anomaly, or a customer past the campaign's
            // limit) carries campaignDiscount > 0 but costs the vendor nothing, and
            // counting it made "your share on N orders" read higher than the truth.
            if (offerContribution > 0) vendorPayouts[vendorId].offerOrders += 1;
            vendorPayouts[vendorId].netPayable += vendorEarning;
            vendorPayouts[vendorId].orderCount += 1;

             
            const rawCreatedAt = order.createdAt as any;
            const orderDate = rawCreatedAt?.toDate?.() || (rawCreatedAt ? new Date(rawCreatedAt) : null);
            if (orderDate) {
                const dateStr = orderDate instanceof Date 
                    ? orderDate.toISOString() 
                    : new Date(orderDate).toISOString();
                if (!vendorPayouts[vendorId].lastOrderDate || dateStr > vendorPayouts[vendorId].lastOrderDate!) {
                    vendorPayouts[vendorId].lastOrderDate = dateStr;
                }
            }
        });

        // Process payout history — track both confirmed paid amounts AND active issued payouts
        const payoutsByVendor: Record<string, number> = {};
        const issuedPayoutByVendor: Record<string, { payoutId: string; amount: number; method: string; issuedAt: string | null }> = {};
        const recentPayouts: Array<{
            payoutId: string;
            vendorId: string;
            vendorName: string;
            amount: number;
            method: string;
            status: string;
            createdAt: string;
            processedAt: string | null;
            issuedAt: string | null;
            confirmedAt: string | null;
            transactionId: string | null;
            notes: string | null;
            issuedBy: string | null;
            confirmedBy: string | null;
        }> = [];

        payoutsSnapshot.docs.forEach(doc => {
            const payout = doc.data();
            const vendorId = payout.vendorId;
            
            // Only count CONFIRMED (completed) payouts toward paidAmount
            if (payout.status === 'completed' || payout.status === 'processed') {
                payoutsByVendor[vendorId] = (payoutsByVendor[vendorId] || 0) + (payout.amount || 0);
            }

            // Track the most recent issued (awaiting confirmation) payout per vendor
            if (payout.status === 'issued' && vendorId && !issuedPayoutByVendor[vendorId]) {
                issuedPayoutByVendor[vendorId] = {
                    payoutId: doc.id,
                    amount: payout.amount || 0,
                    method: payout.method || 'Bank Transfer',
                    issuedAt: payout.issuedAt?.toDate?.()?.toISOString() || payout.createdAt?.toDate?.()?.toISOString() || null,
                };
            }

            recentPayouts.push({
                payoutId: doc.id,
                vendorId: payout.vendorId || '',
                vendorName: payout.vendorName || '',
                amount: payout.amount || 0,
                method: payout.method || 'Bank Transfer',
                status: payout.status || 'pending',
                createdAt: payout.createdAt?.toDate?.()?.toISOString() || '',
                processedAt: payout.processedAt?.toDate?.()?.toISOString() || null,
                issuedAt: payout.issuedAt?.toDate?.()?.toISOString() || null,
                confirmedAt: payout.confirmedAt?.toDate?.()?.toISOString() || null,
                transactionId: payout.transactionId || null,
                notes: payout.notes || null,
                issuedBy: payout.issuedBy || null,
                confirmedBy: payout.confirmedBy || null,
            });
        });

        // Filter recentPayouts by date range if provided
        const filteredRecentPayouts = (startDate || endDate)
            ? recentPayouts.filter(p => {
                if (!p.createdAt) return false;
                const d = new Date(p.createdAt);
                if (isNaN(d.getTime())) return false;
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            })
            : recentPayouts;

        // Build vendor list with payout data
        const vendors = vendorDocs.map(data => {
            const payout = vendorPayouts[data.id] || {
                totalRevenue: 0, commissionAmount: 0, gstOnCommission: 0,
                smallOrderFees: 0, deliveryFeeProfit: 0, totalPlatformEarning: 0,
                netPayable: 0, paidAmount: 0, pendingAmount: 0,
                // Present here too: a vendor with an issued payout but no delivered orders
                // in the window still reaches the spread below, and these came back
                // undefined rather than 0.
                offerContribution: 0, offerOrders: 0,
                orderCount: 0, lastOrderDate: null,
            };

            // ── Reconciliation ──
            //
            // One source of truth, in a defined order of preference:
            //   1. the append-only ledger, when it actually accounts for this
            //      vendor's delivered orders (see the test below);
            //   2. otherwise the order-derived figures computed above.
            //
            // The denormalised counters on the vendor document are never a value
            // source any more. They are compared, and any gap is reported as a
            // discrepancy for someone to investigate. The rule this replaces was
            // Math.max() of two records that disagreed — which silently underpaid
            // the vendor when the cache was stale-high and overpaid when it was
            // stale-low, with no way to tell which had happened.
            const ledger = ledgerBalances[data.id];
            const payoutsCollectionPaid = r2(payoutsByVendor[data.id] || 0);
            const vendorDocPaid = r2((data.paidAmount as number) || 0);
            const vendorDocNet = r2(((data.totalEarnings as number) || 0) - ((data.totalCommission as number) || 0));

            const derivedNet = r2(payout.netPayable);

            // ── When the ledger may be believed ──
            //
            // Having rows is not the same as being a record of what a vendor is
            // owed. Confirming a payout posts a PAYOUT row by itself (see
            // app/api/payouts/route.ts), but nothing in the running system ever
            // posts EARNING or COMMISSION rows — only scripts/backfill-ledger.js
            // does, and only for the history that existed when it was last run.
            //
            // So a vendor can hold a ledger of payouts and nothing else. Its
            // balance is then exactly minus what has been paid, and
            // `balance + paidOut` comes to 0: the screen reported ₹0 payable,
            // ₹0 pending, and the vendor dropped out of the pending list
            // entirely while real money was still owed to them. The same thing
            // happens in smaller degree whenever the backfill is behind the
            // orders.
            //
            // The test is therefore whether the ledger carries earnings at all,
            // and then whether those earnings can account for the delivered
            // orders. A ledger that says a vendor earned less than their own
            // delivered orders do is missing rows, and the missing rows are
            // money. In both cases the order-derived figures take over and the
            // gap is named in `discrepancies` rather than silently applied.
            const ledgerHasEarnings = !!ledger && ledger.earnings > 0;
            const ledgerRows = ledger?.entryCount || 0;
            let source: 'ledger' | 'orders' = ledgerRows > 0 && ledgerHasEarnings ? 'ledger' : 'orders';
            let ledgerIncomplete = ledgerRows > 0 && !ledgerHasEarnings;

            if (source === 'ledger') {
                // balance = earnings − commission − credit notes − payouts
                //
                // MINUS ANY CO-FUNDING SHARE THE LEDGER DOES NOT ALREADY CARRY.
                //
                // The ledger's EARNING rows are the order's full itemTotal and its
                // COMMISSION rows are commission + GST. Neither knows about
                // campaignVendorFunded: the only writer of those rows
                // (scripts/backfill-ledger.js) predates co-funded offers. Left alone, the
                // ledger hands every vendor their own promo share back on top of their
                // earnings, so Delito ends up funding the whole discount on every
                // campaign order — the order-derived figure already nets it off, which is
                // exactly why the two disagree by that amount.
                //
                // Subtracting only the REMAINDER keeps this correct while the ledger
                // catches up: once the backfill has written OFFER_SHARE rows they are
                // already inside `balance`, and this term goes to zero on its own.
                const shareInLedger = r2(ledger.offerShare || 0);
                const shareOutstanding = Math.max(0, r2((payout.offerContribution || 0) - shareInLedger));
                const ledgerPaid = r2(ledger.paidOut);
                const ledgerNet = r2(ledger.balance + ledger.paidOut - shareOutstanding);

                if (r2(derivedNet - ledgerNet) >= 0.01) {
                    // The ledger is behind the orders. Reporting its figure would
                    // hide money that is owed, so the orders are used and the
                    // shortfall is reported. Paid still takes the larger of the
                    // two records, because overstating what has been paid can
                    // only delay a payout, while understating it pays twice.
                    ledgerIncomplete = true;
                    source = 'orders';
                    payout.paidAmount = Math.max(ledgerPaid, payoutsCollectionPaid);
                } else {
                    payout.paidAmount = ledgerPaid;
                    payout.netPayable = ledgerNet;
                }
            } else {
                payout.paidAmount = Math.max(r2(ledger?.paidOut || 0), payoutsCollectionPaid);
            }
            payout.pendingAmount = r2(Math.max(0, payout.netPayable - payout.paidAmount));

            const paidVsPayoutsCollection = divergence(payout.paidAmount, payoutsCollectionPaid);
            const paidVsVendorDoc = divergence(payout.paidAmount, vendorDocPaid);
            const netVsVendorDoc = divergence(payout.netPayable, vendorDocNet);
            const netVsDerived = divergence(payout.netPayable, derivedNet);
            const discrepancies: string[] = [];
            if (!paidVsPayoutsCollection.agrees) discrepancies.push(`paid differs from the payouts collection by ₹${paidVsPayoutsCollection.gap.toFixed(2)}`);
            if (!paidVsVendorDoc.agrees) discrepancies.push(`paid differs from the vendor record by ₹${paidVsVendorDoc.gap.toFixed(2)}`);
            if (vendorDocNet > 0 && !netVsVendorDoc.agrees) discrepancies.push(`payable differs from the vendor record by ₹${netVsVendorDoc.gap.toFixed(2)}`);
            if (source === 'ledger' && !netVsDerived.agrees) discrepancies.push(`ledger payable differs from the order-derived figure by ₹${netVsDerived.gap.toFixed(2)}`);
            if (ledgerIncomplete) discrepancies.push(
                ledgerHasEarnings
                    ? `the ledger is behind this vendor's delivered orders — payable taken from the orders; re-run scripts/backfill-ledger.js`
                    : `the ledger holds ${ledgerRows} row(s) but no earnings for this vendor — payable taken from the orders; re-run scripts/backfill-ledger.js`
            );

            return {
                vendorId: data.id,
                shopName: (data.shopName || data.fullName || 'Unknown') as string,
                fullName: (data.fullName || '') as string,
                shopImageUrl: (data.shopImageUrl || data.profileImageUrl || '') as string,
                email: (data.email || '') as string,
                phoneNumber: (data.phoneNumber || '') as string,
                city: (data.city || '') as string,
                isVerified: (data.isVerified || false) as boolean,
                commissionRate: (data.commissionRate || 15) as number,
                /** Where paidAmount and netPayable came from. */
                balanceSource: source,
                /** Empty when every record agrees. Each string names a gap to investigate. */
                discrepancies,
                ledgerEntryCount: ledger?.entryCount || 0,
                /** True when this vendor has ledger rows that do not account for their orders. */
                ledgerIncomplete,
                bankDetails: data.bankDetails || (data.bankAccountNumber ? {
                    accountNumber: data.bankAccountNumber,
                    ifsc: data.bankIfscCode || data.ifscCode || '',
                    bankName: data.bankName || '',
                    accountHolderName: data.bankAccountHolderName || data.accountHolderName || '',
                } : null),
                upiId: (data.upiId || null) as string | null,
                bankPassbookUrl: (data.bankPassbookUrl || data.bankProofUrl || '') as string,
                issuedPayout: issuedPayoutByVendor[data.id] || null,
                ...payout,
            };
        }).filter(v => v.totalRevenue > 0 || v.pendingAmount > 0 || v.paidAmount > 0 ||
            ((vendorDocs.find(d => d.id === v.vendorId)?.pendingPayout as number || 0) > 0) ||
            !!issuedPayoutByVendor[v.vendorId]
        );

        vendors.sort((a, b) => b.pendingAmount - a.pendingAmount);

        const summary = {
            totalPendingPayouts: Math.round(vendors.reduce((s, v) => s + v.pendingAmount, 0) * 100) / 100,
            totalPaidAmount: Math.round(vendors.reduce((s, v) => s + v.paidAmount, 0) * 100) / 100,
            totalCommissionEarned: Math.round(vendors.reduce((s, v) => s + v.commissionAmount, 0) * 100) / 100,
            totalGstCollected: Math.round(vendors.reduce((s, v) => s + v.gstOnCommission, 0) * 100) / 100,
            totalSmallOrderFees: Math.round(vendors.reduce((s, v) => s + v.smallOrderFees, 0) * 100) / 100,
            totalDeliveryFeeProfit: Math.round(vendors.reduce((s, v) => s + v.deliveryFeeProfit, 0) * 100) / 100,
            totalPlatformEarning: Math.round(vendors.reduce((s, v) => s + v.totalPlatformEarning, 0) * 100) / 100,
            vendorsWithPending: vendors.filter(v => v.pendingAmount > 0).length,
        };

        return NextResponse.json({ success: true, data: { vendors, recentPayouts: filteredRecentPayouts, summary } });
    } catch (error) {
        console.error('Vendor payouts fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch vendor payouts' }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
