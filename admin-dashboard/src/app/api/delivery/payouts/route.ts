 
import { NextResponse } from 'next/server';
import { db, collections } from '@/lib/firebase-admin';
import { withAdmin } from '@/lib/api-guard';
import { allLedgerBalances, divergence, type LedgerBalance } from '@/lib/ledger';

// Constants for delivery earnings calculation
const BASE_DELIVERY_FEE = 10; // ₹10 base
const PER_KM_RATE = 6.5; // ₹6.5 per km

async function handleGET() {
    try {
        // Get all delivery partners
        const deliverySnapshot = await db.collection(collections.deliveryPersons).get();

        // Get all orders - check for delivered status
        const ordersSnapshot = await db.collection(collections.orders).get();

        // Get all delivery tasks (more reliable for delivery-specific data)
        const deliveryTasksSnapshot = await db.collection('deliveryTasks').get();

        // Get payout history
        const payoutsSnapshot = await db.collection('deliveryPayouts')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        // Calculate delivery partner earnings from BOTH orders and deliveryTasks
        const deliveryEarnings: Record<string, {
            totalEarnings: number;
            deliveryCount: number;
            incentives: number;
            tips: number;
            codCollected: number;
            codSettled: number;
            lastDeliveryDate: string | null;
            deliveryDetails: Array<{
                orderId: string;
                distanceKm: number;
                earnings: number;
                tip: number;
                date: string;
            }>;
        }> = {};

        // First, process deliveryTasks (more accurate for delivery person earnings)
        deliveryTasksSnapshot.docs.forEach(doc => {
            const task = doc.data();
            const deliveryPersonId = task.deliveryPersonId;
            const status = task.status?.toUpperCase() || '';

            if (!deliveryPersonId) return;
            if (status !== 'DELIVERED') return;

            if (!deliveryEarnings[deliveryPersonId]) {
                deliveryEarnings[deliveryPersonId] = {
                    totalEarnings: 0,
                    deliveryCount: 0,
                    incentives: 0,
                    tips: 0,
                    codCollected: 0,
                    codSettled: 0,
                    lastDeliveryDate: null,
                    deliveryDetails: [],
                };
            }

            // Calculate delivery earnings: Base ₹10 + ₹6.5/km
            const distanceKm = task.distanceKm ||
                (task.deliveryDistanceMeters ? task.deliveryDistanceMeters / 1000 : 0);

            // Use pre-calculated earnings or calculate fresh
            const deliveryEarningsAmount = task.deliveryEarnings || task.deliveryPersonEarnings ||
                (distanceKm > 0 ? Math.max(15, Math.round((BASE_DELIVERY_FEE + (distanceKm * PER_KM_RATE)) * 10) / 10) :
                BASE_DELIVERY_FEE + 5); // ₹15 minimum if no distance

            const tip = task.tip || 0;

            deliveryEarnings[deliveryPersonId].totalEarnings += deliveryEarningsAmount + tip;
            deliveryEarnings[deliveryPersonId].deliveryCount += 1;
            deliveryEarnings[deliveryPersonId].tips += tip;

            // Track COD — count ALL delivered COD orders as collected
            // (codCollected flag may not be set on older tasks but cash was still received)
            if (task.paymentMode?.toUpperCase() === 'COD') {
                const codAmt = task.codAmount || task.orderTotal || 0;
                deliveryEarnings[deliveryPersonId].codCollected += codAmt;
                if (task.codSettled) {
                    deliveryEarnings[deliveryPersonId].codSettled += codAmt;
                }
            }

            // Track last delivery
            const taskDate = task.deliveredAt?.toDate?.() || task.createdAt?.toDate?.() || task.createdAt;
            if (taskDate) {
                const dateStr = taskDate instanceof Date
                    ? taskDate.toISOString()
                    : new Date(taskDate).toISOString();
                if (!deliveryEarnings[deliveryPersonId].lastDeliveryDate ||
                    dateStr > deliveryEarnings[deliveryPersonId].lastDeliveryDate!) {
                    deliveryEarnings[deliveryPersonId].lastDeliveryDate = dateStr;
                }

                deliveryEarnings[deliveryPersonId].deliveryDetails.push({
                    orderId: task.orderId || doc.id,
                    distanceKm: distanceKm,
                    earnings: deliveryEarningsAmount,
                    tip: tip,
                    date: dateStr,
                });
            }
        });

        // Fallback: Also check orders collection for any missing data
        const processedOrderIds = new Set(
            Object.values(deliveryEarnings).flatMap(e => e.deliveryDetails.map(d => d.orderId))
        );

        ordersSnapshot.docs.forEach(doc => {
            const order = doc.data();
            const deliveryPersonId = order.deliveryPersonId;
            const status = order.status?.toLowerCase() || '';

            if (!deliveryPersonId) return;
            if (status !== 'delivered' && status !== 'completed') return;
            if (processedOrderIds.has(doc.id)) return; // Already processed from tasks

            if (!deliveryEarnings[deliveryPersonId]) {
                deliveryEarnings[deliveryPersonId] = {
                    totalEarnings: 0,
                    deliveryCount: 0,
                    incentives: 0,
                    tips: 0,
                    codCollected: 0,
                    codSettled: 0,
                    lastDeliveryDate: null,
                    deliveryDetails: [],
                };
            }

            // Delivery person earnings (Base ₹10 + ₹6.5/km)
            const distanceKm = order.distanceKm || 0;
            const deliveryPersonEarnings = order.deliveryPersonEarnings ||
                (distanceKm > 0 ? Math.max(15, Math.round((BASE_DELIVERY_FEE + (distanceKm * PER_KM_RATE)) * 10) / 10) :
                BASE_DELIVERY_FEE + 5); // ₹15 minimum if no distance

            const tip = order.tip || 0;

            deliveryEarnings[deliveryPersonId].totalEarnings += deliveryPersonEarnings + tip;
            deliveryEarnings[deliveryPersonId].deliveryCount += 1;
            deliveryEarnings[deliveryPersonId].tips += tip;

            // Track last delivery
            const orderDate = order.deliveredAt?.toDate?.() || order.createdAt?.toDate?.() || order.createdAt;
            if (orderDate) {
                const dateStr = orderDate instanceof Date
                    ? orderDate.toISOString()
                    : new Date(orderDate).toISOString();
                if (!deliveryEarnings[deliveryPersonId].lastDeliveryDate ||
                    dateStr > deliveryEarnings[deliveryPersonId].lastDeliveryDate!) {
                    deliveryEarnings[deliveryPersonId].lastDeliveryDate = dateStr;
                }
            }
        });

        // Process payout history
        const paidByPartner: Record<string, number> = {};
        const issuedPayoutByPartner: Record<string, { payoutId: string; amount: number; method: string; issuedAt: string | null }> = {};
        const recentPayouts: Array<{
            payoutId: string;
            deliveryPersonId: string;
            deliveryPersonName: string;
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
            const deliveryPersonId = payout.deliveryPersonId;

            // Only count CONFIRMED (completed) payouts toward paidAmount
            if (payout.status === 'completed' || payout.status === 'processed') {
                paidByPartner[deliveryPersonId] =
                    (paidByPartner[deliveryPersonId] || 0) + (payout.amount || 0);
            }

            // Track the most recent issued (unconfirmed) payout per partner
            if (payout.status === 'issued' && deliveryPersonId && !issuedPayoutByPartner[deliveryPersonId]) {
                issuedPayoutByPartner[deliveryPersonId] = {
                    payoutId: doc.id,
                    amount: payout.amount || 0,
                    method: payout.method || 'Cash',
                    issuedAt: payout.issuedAt?.toDate?.()?.toISOString() || payout.createdAt?.toDate?.()?.toISOString() || null,
                };
            }

            recentPayouts.push({
                payoutId: doc.id,
                deliveryPersonId: payout.deliveryPersonId || '',
                deliveryPersonName: payout.deliveryPersonName || '',
                amount: payout.amount || 0,
                method: payout.method || 'Cash',
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

        // Build delivery partner payout data
        // The ledger is the authority on what each partner is owed. Read once;
        // the task-derived figures are the fallback for partners not yet
        // backfilled, and the cross-check for those that are.
        let ledgerBalances: Record<string, LedgerBalance> = {};
        try {
            ledgerBalances = await allLedgerBalances('deliveryPartner');
        } catch (err) {
            console.warn('[delivery/payouts] ledger unavailable, using task-derived figures:', err);
        }

        const deliveryPartners = deliverySnapshot.docs.map(doc => {
            const data = doc.data();
            const earnings = deliveryEarnings[doc.id] || {
                totalEarnings: 0, deliveryCount: 0, incentives: 0,
                tips: 0, codCollected: 0, codSettled: 0, lastDeliveryDate: null, deliveryDetails: [],
            };

            // ── Reconciliation ──
            //
            // Same rule as the vendor payouts screen: one source of truth, in a
            // defined order — the append-only ledger where rows exist, otherwise
            // the figures derived from delivery tasks. The counters on the
            // delivery person document are a cache, compared and reported, never
            // a value source.
            //
            // What this replaces took Math.max() of the derived and cached
            // figures for earnings, delivery count AND paid amount, which quietly
            // inflated every one of them the moment a cache went stale, and made
            // the direction of the error impossible to reason about.
            const docTotalEarnings = Math.round(((data.totalEarnings as number) || 0) * 100) / 100;
            const docTotalDeliveries = (data.totalDeliveries as number) || 0;
            const calculatedTotalEarnings = Math.round((earnings.totalEarnings + ((data.incentives as number) || 0)) * 100) / 100;
            const payoutsCollectionPaid = Math.round(((paidByPartner[doc.id] || 0) as number) * 100) / 100;
            const docPaidAmount = Math.round(((data.paidAmount as number) || 0) * 100) / 100;

            const ledger = ledgerBalances[doc.id];
            const balanceSource: 'ledger' | 'deliveries' = ledger && ledger.entryCount > 0 ? 'ledger' : 'deliveries';

            const totalEarnings = balanceSource === 'ledger'
                ? Math.round((ledger.balance + ledger.paidOut) * 100) / 100
                : calculatedTotalEarnings;
            const paidAmount = balanceSource === 'ledger' ? ledger.paidOut : payoutsCollectionPaid;
            const deliveryCount = earnings.deliveryCount;

            const discrepancies: string[] = [];
            const earnGap = divergence(totalEarnings, docTotalEarnings);
            const paidGapCollection = divergence(paidAmount, payoutsCollectionPaid);
            const paidGapDoc = divergence(paidAmount, docPaidAmount);
            if (docTotalEarnings > 0 && !earnGap.agrees) discrepancies.push(`earnings differ from the partner record by ₹${earnGap.gap.toFixed(2)}`);
            if (!paidGapCollection.agrees) discrepancies.push(`paid differs from the payouts collection by ₹${paidGapCollection.gap.toFixed(2)}`);
            if (!paidGapDoc.agrees) discrepancies.push(`paid differs from the partner record by ₹${paidGapDoc.gap.toFixed(2)}`);
            if (docTotalDeliveries !== deliveryCount) discrepancies.push(`delivery count differs from the partner record by ${deliveryCount - docTotalDeliveries}`);

            // grossPendingAmount = what delivery person is actually owed (earnings - paid)
            // This is the number that should match the delivery app's "due" amount.
            const grossPendingAmount = Math.round(Math.max(0, totalEarnings - paidAmount) * 100) / 100;

            const codCollected = earnings.codCollected;
            const codSettled = earnings.codSettled;
            const codPending = Math.round(Math.max(0, codCollected - codSettled) * 100) / 100;

            // netPendingAmount = gross pending minus COD cash the partner still holds.
            // Shown as informational only — NOT used as the primary pending figure.
            const netPendingAmount = Math.round(Math.max(0, grossPendingAmount - codPending) * 100) / 100;

            return {
                /** Where totalEarnings and paidAmount came from. */
                balanceSource,
                /** Empty when every record agrees. Each string names a gap to investigate. */
                discrepancies,
                ledgerEntryCount: ledger?.entryCount || 0,
                deliveryPersonId: doc.id,
                fullName: data.fullName || 'Unknown',
                profilePhotoUrl: data.profileImageUrl || data.profilePhotoUrl || '',
                phoneNumber: data.phoneNumber || '',
                email: data.email || '',
                city: data.city || '',
                isOnline: data.isOnline || false,
                isVerified: data.isVerified || false,
                bankDetails: data.bankDetails || (data.bankAccountNumber ? {
                    accountNumber: data.bankAccountNumber,
                    ifsc: data.bankIfscCode || data.ifscCode || '',
                    bankName: data.bankName || '',
                    accountHolderName: data.bankAccountHolderName || data.accountHolderName || '',
                } : null),
                upiId: data.upiId || null,
                bankPassbookUrl: data.bankPassbookUrl || '',
                totalEarnings,
                // deliveryFees = corrected totalEarnings minus tips.
                // Use totalEarnings (which takes max of task-calculated vs stored doc value)
                // so it stays correct even when tasks lack distance data (stuck at ₹15/delivery).
                deliveryFees: Math.round(Math.max(totalEarnings - earnings.tips, 0) * 100) / 100,
                tips: earnings.tips,
                incentives: data.incentives || earnings.incentives || 0,
                deliveryCount,
                paidAmount,
                pendingAmount: grossPendingAmount,      // gross: earnings - paid (matches delivery app)
                netPendingAmount,                       // informational: after COD deduction
                grossPendingAmount,
                codCollected, codSettled, codPending,
                lastDeliveryDate: earnings.lastDeliveryDate,
                recentDeliveries: earnings.deliveryDetails?.slice(0, 10) || [],
                issuedPayout: issuedPayoutByPartner[doc.id] || null,
            };
        });

        deliveryPartners.sort((a, b) => b.pendingAmount - a.pendingAmount || a.fullName.localeCompare(b.fullName));
        const activePartners = deliveryPartners.filter(d => d.deliveryCount > 0);

        const summary = {
            totalPendingPayouts: Math.round(deliveryPartners.reduce((s, d) => s + d.pendingAmount, 0) * 100) / 100,
            totalPaidAmount: Math.round(deliveryPartners.reduce((s, d) => s + d.paidAmount, 0) * 100) / 100,
            totalEarnings: Math.round(deliveryPartners.reduce((s, d) => s + d.totalEarnings, 0) * 100) / 100,
            totalTips: Math.round(deliveryPartners.reduce((s, d) => s + d.tips, 0) * 100) / 100,
            totalDeliveryFees: Math.round(deliveryPartners.reduce((s, d) => s + d.deliveryFees, 0) * 100) / 100,
            totalDeliveries: deliveryPartners.reduce((s, d) => s + d.deliveryCount, 0),
            totalCodCollected: Math.round(deliveryPartners.reduce((s, d) => s + d.codCollected, 0) * 100) / 100,
            totalCodSettled: Math.round(deliveryPartners.reduce((s, d) => s + d.codSettled, 0) * 100) / 100,
            totalCodPending: Math.round(deliveryPartners.reduce((s, d) => s + d.codPending, 0) * 100) / 100,
            partnersWithPending: deliveryPartners.filter(d => d.pendingAmount > 0).length,
            activePartners: activePartners.length,
        };

        return NextResponse.json({ success: true, data: { deliveryPartners, recentPayouts, summary } });
    } catch (error) {
        console.error('Delivery payouts fetch error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch delivery payouts' }, { status: 500 });
    }
}

// ── Auth ──
// Verified Firebase ID token + admin authorisation, enforced in the Node
// runtime. middleware.ts only checks that a header is present.
export const GET = withAdmin(handleGET);
