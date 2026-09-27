'use client';

/**
 * Order details — items with their variants, the customer's bill built up
 * step by step, and where every rupee of it went.
 *
 * Figures come from what the app stored on the order (PricingCalculator.kt);
 * nothing is re-priced here. Where a stored figure is missing on an older
 * order we derive it the same way the app does and say so.
 */

import type { Order } from '@/hooks/useApi';

type Item = Order['items'][number];

const CANCELLED = ['Cancelled', 'Cancelled by Admin', 'Declined', 'Not Responded', 'Expired'];

const r2 = (n: number) => Math.round(n * 100) / 100;
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** ₹1,234 or ₹1,234.50 */
function inr(v: number) {
    const x = r2(v);
    const whole = Math.abs(x % 1) < 0.005;
    return '₹' + Math.abs(x).toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

/* ── items ─────────────────────────────────────────────────── */

function lineMath(item: Item) {
    const qty = n0(item.quantity) || 1;
    const unit = n0(item.discountedPrice) || n0(item.price);
    const addOns = n0(item.addOnsTotal);
    const combo = n0(item.comboExtraPrice);
    const listUnit = Math.max(unit, n0(item.originalPrice) || unit);
    // Base = the variant's (or item's) menu price, before its % discount
    const base = n0(item.selectedVariantPrice) > 0 ? n0(item.selectedVariantPrice) : Math.max(listUnit - addOns - combo, 0);
    const discountedBase = Math.max(unit - addOns - combo, 0);
    const discountPct = base > 0 && discountedBase < base - 0.009 ? (1 - discountedBase / base) * 100 : 0;
    return { qty, unit, listUnit, base, discountedBase, discountPct, addOns, combo, line: r2(unit * qty), listLine: r2(listUnit * qty) };
}

function ItemRow({ item, last }: { item: Item; last: boolean }) {
    const m = lineMath(item);
    const hasExtras = !!(item.selectedVariant || item.selectedAddOns?.length || item.selectedCombo);
    const discounted = m.listUnit - m.unit > 0.009;

    return (
        <div className={`px-4 py-3.5 ${last ? '' : 'border-b border-[var(--glass-border)]'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 shrink-0 rounded-lg bg-[var(--surface-hover)] px-2 py-1 text-xs font-bold tabular-nums">
                        {m.qty}×
                    </span>
                    <div className="min-w-0">
                        <p className="text-[0.9rem] font-semibold leading-snug">{item.name}</p>

                        {hasExtras && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {item.selectedVariant && (
                                    <span className="rounded-md border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--primary)]">
                                        Variant: {item.selectedVariant}
                                        {n0(item.selectedVariantPrice) > 0 && <span className="font-normal opacity-80"> · {inr(n0(item.selectedVariantPrice))}</span>}
                                    </span>
                                )}
                                {!!item.selectedAddOns?.length && (
                                    <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[0.7rem] font-semibold text-sky-500">
                                        Add-ons: {item.selectedAddOns.join(', ')}
                                        {m.addOns > 0 && <span className="font-normal opacity-80"> · +{inr(m.addOns)}</span>}
                                    </span>
                                )}
                                {item.selectedCombo && (
                                    <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[0.7rem] font-semibold text-violet-500">
                                        Combo: {item.selectedCombo}
                                        {m.combo > 0 && <span className="font-normal opacity-80"> · +{inr(m.combo)}</span>}
                                    </span>
                                )}
                            </div>
                        )}

                        {item.specialInstructions && (
                            <p className="mt-1.5 text-[0.72rem] italic text-[var(--foreground-secondary)]">“{item.specialInstructions}”</p>
                        )}

                        {/* How the line price is built */}
                        <p className="mt-1.5 text-[0.72rem] leading-relaxed text-[var(--foreground-secondary)] tabular-nums">
                            {inr(m.base)}{item.selectedVariant ? ` (${item.selectedVariant})` : ''}
                            {m.discountPct > 0 && <> − {pct(m.discountPct)} = {inr(m.discountedBase)}</>}
                            {m.addOns > 0 && <> + add-ons {inr(m.addOns)}</>}
                            {m.combo > 0 && <> + combo {inr(m.combo)}</>}
                            {(m.addOns > 0 || m.combo > 0) && <> = {inr(m.unit)}</>}
                            {' '}× {m.qty} = <b className="text-[var(--foreground)]">{inr(m.line)}</b>
                        </p>
                    </div>
                </div>

                <div className="shrink-0 text-right tabular-nums">
                    {discounted && <p className="text-xs text-[var(--foreground-secondary)] line-through">{inr(m.listLine)}</p>}
                    <p className={`text-[0.95rem] font-bold ${discounted ? 'text-emerald-500' : ''}`}>{inr(m.line)}</p>
                </div>
            </div>
        </div>
    );
}

/* ── bill rows ─────────────────────────────────────────────── */

type Op = '+' | '−' | '=' | '';

function Row({ op, label, hint, amount, tone, strong }: {
    op: Op; label: React.ReactNode; hint?: React.ReactNode; amount: number;
    tone?: 'green' | 'red' | 'amber' | 'violet' | 'muted'; strong?: boolean;
}) {
    const color =
        tone === 'green' ? 'text-emerald-500' :
        tone === 'red' ? 'text-red-500' :
        tone === 'amber' ? 'text-amber-500' :
        tone === 'violet' ? 'text-violet-500' :
        tone === 'muted' ? 'text-[var(--foreground-secondary)]' : '';
    return (
        <div className={`grid grid-cols-[18px_1fr_auto] items-baseline gap-x-2 py-1.5 ${strong ? 'text-[0.95rem] font-bold' : 'text-[0.84rem]'}`}>
            <span className={`text-center font-bold ${color || 'text-[var(--foreground-secondary)]'}`}>{op}</span>
            <div className="min-w-0">
                <span className={color}>{label}</span>
                {hint && <p className="text-[0.7rem] leading-snug text-[var(--foreground-secondary)] tabular-nums">{hint}</p>}
            </div>
            <span className={`tabular-nums ${color}`}>{op === '−' ? '−' : ''}{inr(amount)}</span>
        </div>
    );
}

const Divider = ({ dashed }: { dashed?: boolean }) => (
    <div className={`my-1 border-t ${dashed ? 'border-dashed' : ''} border-[var(--glass-border)]`} />
);

const Heading = ({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) => (
    <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">{children}</p>
        {note && <span className="text-[0.68rem] text-[var(--foreground-secondary)]">{note}</span>}
    </div>
);

/* ── main ──────────────────────────────────────────────────── */

export function OrderBill({ order }: { order: Order }) {
    const items = order.items ?? [];

    // ── Food ──
    const itemTotal = n0(order.itemTotal) || n0(order.subtotal);
    const menuTotal = Math.max(n0(order.originalItemTotal), itemTotal);
    const menuDiscount = r2(menuTotal - itemTotal);
    const linesSum = r2(items.reduce((s, it) => s + lineMath(it).line, 0));

    // ── Discounts ──
    const campaign = n0(order.campaignDiscount);
    const campaignVendor = n0(order.campaignVendorFunded);
    const campaignSplitKnown = campaign > 0 && Math.abs(campaignVendor + n0(order.campaignPlatformFunded) - campaign) <= 0.05;
    const campaignPlatform = campaignSplitKnown ? n0(order.campaignPlatformFunded) : campaign;
    const promo = n0(order.promoDiscount);
    const coins = n0(order.coinDiscount);
    const hgTotal = n0(order.hungerGameTotalDiscount);
    const hgDelivery = Math.min(n0(order.hungerGameLevel2DeliveryDiscount), hgTotal);
    const hgFood = r2(Math.max(hgTotal - hgDelivery, 0));

    // ── Fees & tax ──
    const techFee = n0(order.technologyServiceFee);
    const smallFee = n0(order.smallOrderSupportFee);
    const platformFee = r2(techFee + smallFee);
    const cod = n0(order.codCharges);
    const deliveryFee = n0(order.deliveryFee);
    const deliveryBefore = Math.max(n0(order.deliveryFeeBeforeDiscount), deliveryFee);
    const deliveryWaived = r2(deliveryBefore - deliveryFee);
    const gstFood = n0(order.gstOnFood);
    const gstServices = n0(order.gstOnServices);
    const taxes = n0(order.taxes) || r2(gstFood + gstServices);
    const gstSplitKnown = gstFood + gstServices > 0;

    const total = n0(order.total);
    const tip = n0(order.tip);

    const built = r2(itemTotal - campaign - promo - hgFood + deliveryFee + platformFee + cod + taxes - coins - hgDelivery);
    const rounding = r2(total - built);

    // ── Settlement ──
    const cancelled = CANCELLED.includes(order.status);
    const commissionBase = menuTotal || itemTotal;
    const commission = n0(order.vendorPlatformCut) > 0 ? n0(order.vendorPlatformCut) : r2(commissionBase * 0.15);
    const commissionRate = commissionBase > 0 ? (commission / commissionBase) * 100 : 15;
    const gstOnCommission = n0(order.vendorGstOnPlatformCut) > 0 ? n0(order.vendorGstOnPlatformCut) : r2(commission * 0.18);
    const vendorStored = n0(order.vendorEarning) > 0;
    const vendorPayout = vendorStored ? n0(order.vendorEarning) : r2(Math.max(itemTotal - commission - gstOnCommission - campaignVendor, 0));
    const km = n0(order.distanceKm);
    const riderStored = n0(order.deliveryPersonEarnings) > 0;
    const riderPay = riderStored ? n0(order.deliveryPersonEarnings) : (km > 0 ? Math.max(15, r2(10 + km * 6.5)) : 15);
    const delitoShare = r2(total - vendorPayout - riderPay - taxes);

    const delitoParts = r2(commission + gstOnCommission + platformFee + cod + deliveryFee - riderPay - campaignPlatform - promo - hgFood - coins - hgDelivery);
    const delitoAdjust = r2(delitoShare - delitoParts);
    const delitoNet = r2(delitoShare - gstOnCommission);

    const shares = [
        { key: 'vendor', label: 'Restaurant', amount: vendorPayout, color: '#F59E0B' },
        { key: 'rider', label: 'Rider', amount: riderPay, color: '#0EA5E9' },
        { key: 'gst', label: 'GST to govt.', amount: taxes, color: '#94A3B8' },
        { key: 'delito', label: 'Delito', amount: Math.max(delitoShare, 0), color: '#10B981' },
    ];
    const barTotal = shares.reduce((s, x) => s + x.amount, 0) || 1;

    return (
        <>
            {/* ── ITEMS ── */}
            <div>
                <Heading note={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}>Ordered items</Heading>
                <div className="glass-card overflow-hidden" style={{ padding: 0 }}>
                    {items.length === 0 && (
                        <p className="p-4 text-center text-sm text-[var(--foreground-secondary)]">No items available</p>
                    )}
                    {items.map((item, i) => <ItemRow key={i} item={item} last={i === items.length - 1} />)}
                    {items.length > 0 && (
                        <div className="flex items-center justify-between border-t border-[var(--glass-border)] bg-[var(--surface-hover)] px-4 py-2.5 text-[0.84rem]">
                            <span className="text-[var(--foreground-secondary)]">
                                Item total
                                {Math.abs(linesSum - itemTotal) > 0.5 && (
                                    <span className="ml-2 text-[0.7rem] text-amber-500">lines add to {inr(linesSum)}</span>
                                )}
                            </span>
                            <span className="font-bold tabular-nums">{inr(itemTotal)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* ── CUSTOMER BILL ── */}
            <div className="glass-card p-4">
                <Heading note="how the customer's total is built">Customer bill</Heading>

                {menuDiscount > 0 && (
                    <>
                        <Row op="" label="Food at menu price" amount={menuTotal} tone="muted" />
                        <Row op="−" label="Menu & item offers" hint="restaurant-funded, already inside the item prices" amount={menuDiscount} tone="green" />
                    </>
                )}
                <Row op={menuDiscount > 0 ? '=' : ''} label="Item total" amount={itemTotal} strong={false} />

                {campaign > 0 && (
                    <Row op="−" label={`Co-funded offer${order.campaignTitle ? ` · ${order.campaignTitle}` : ''}`}
                        hint={campaignSplitKnown ? `restaurant ${inr(campaignVendor)} + Delito ${inr(campaignPlatform)}` : 'split between restaurant and Delito at settlement'}
                        amount={campaign} tone="green" />
                )}
                {promo > 0 && <Row op="−" label={`Promo${order.promoCode ? ` · ${order.promoCode}` : ''}`} hint="Delito-funded" amount={promo} tone="violet" />}
                {hgFood > 0 && <Row op="−" label="HungerGame reward" hint="Delito-funded" amount={hgFood} tone="violet" />}

                <Row op="+" label="Delivery fee"
                    hint={deliveryWaived > 0
                        ? <>{inr(deliveryBefore)} for {km || '—'} km − free delivery {inr(deliveryWaived)}</>
                        : km > 0 ? `${km} km` : undefined}
                    amount={deliveryFee} />
                {platformFee > 0 && (
                    <Row op="+" label="Platform fee"
                        hint={smallFee > 0 ? `technology ${inr(techFee)} + small-order ${inr(smallFee)}` : 'technology service fee'}
                        amount={platformFee} />
                )}
                {cod > 0 && <Row op="+" label="Cash-on-delivery charge" amount={cod} />}

                {gstSplitKnown ? (
                    <>
                        <Row op="+" label="GST on food (5%)" hint={<>5% × {inr(itemTotal)} item total</>} amount={gstFood} />
                        {gstServices > 0 && (
                            <Row op="+" label="GST on services (18%)" hint={<>18% × {inr(r2(deliveryFee + platformFee))} delivery + platform fee</>} amount={gstServices} />
                        )}
                    </>
                ) : (
                    taxes > 0 && <Row op="+" label="Taxes (GST)" amount={taxes} />
                )}

                {coins > 0 && <Row op="−" label={`Delito coins${order.coinsUsed ? ` · ${order.coinsUsed} coins` : ''}`} hint="Delito-funded" amount={coins} tone="amber" />}
                {hgDelivery > 0 && <Row op="−" label="HungerGame free delivery" hint="delivery fee + its GST, Delito-funded" amount={hgDelivery} tone="violet" />}
                {Math.abs(rounding) >= 0.01 && (
                    <Row op={rounding > 0 ? '+' : '−'} label="Rounding" hint={order.paymentMode?.toLowerCase().includes('cash') ? 'cash orders round to whole rupees' : undefined} amount={Math.abs(rounding)} tone="muted" />
                )}

                <Divider />
                <Row op="=" label="Customer paid" amount={total} strong />
                {tip > 0 && <Row op="" label="Tip (paid separately)" hint="goes entirely to the rider" amount={tip} tone="green" />}
            </div>

            {/* ── WHERE THE MONEY WENT ── */}
            <div className="glass-card p-4">
                <Heading note={cancelled ? undefined : 'every rupee the customer paid'}>Where the money goes</Heading>

                {cancelled ? (
                    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[0.82rem] font-semibold text-red-500">
                        No settlement — order {order.status.toLowerCase()}.
                    </p>
                ) : (
                    <>
                        {/* share bar */}
                        <div className="mb-2 flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
                            {shares.map((s) => s.amount > 0 && (
                                <span key={s.key} style={{ width: `${(s.amount / barTotal) * 100}%`, background: s.color }} title={`${s.label} ${inr(s.amount)}`} />
                            ))}
                        </div>
                        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-[var(--foreground-secondary)]">
                            {shares.map((s) => (
                                <span key={s.key} className="inline-flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                                    {s.label} {total > 0 ? `${Math.round((s.amount / total) * 100)}%` : ''}
                                </span>
                            ))}
                        </div>

                        <Row op="" label="Customer paid" amount={total} strong />

                        {/* Restaurant */}
                        <Row op="−" label={<span className="font-semibold text-amber-500">Restaurant payout</span>}
                            hint={<>
                                {inr(itemTotal)} item total − commission {inr(commission)} ({pct(commissionRate)} of {inr(commissionBase)}{menuDiscount > 0 ? ' menu price' : ''})
                                {' '}− 18% GST on it {inr(gstOnCommission)}
                                {campaignVendor > 0 && <> − offer share {inr(campaignVendor)}</>}
                                {!vendorStored && ' · estimated'}
                            </>}
                            amount={vendorPayout} />

                        {/* Rider */}
                        <Row op="−" label={<span className="font-semibold text-sky-500">Rider pay</span>}
                            hint={<>₹10 + ₹6.5 × {km || '—'} km (min ₹15){!riderStored && ' · estimated'}{tip > 0 && <> · plus the {inr(tip)} tip</>}</>}
                            amount={riderPay} />

                        {/* GST */}
                        <Row op="−" label={<span className="font-semibold">GST collected → government</span>}
                            hint={gstSplitKnown ? <>food {inr(gstFood)} + services {inr(gstServices)}</> : undefined}
                            amount={taxes} />

                        <Divider />
                        <Row op="=" label={<span className="text-emerald-500">{delitoShare >= 0 ? 'Delito keeps' : 'Delito spends'}</span>}
                            amount={Math.abs(delitoShare)} strong tone={delitoShare >= 0 ? 'green' : 'red'} />

                        {/* Delito, explained */}
                        <div className="mt-2 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-hover)] px-3 py-2">
                            <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">Delito&apos;s share, line by line</p>
                            <Row op="+" label={`Commission (${pct(commissionRate)})`} amount={commission} />
                            <Row op="+" label="GST on commission" hint="collected from the restaurant, owed to govt." amount={gstOnCommission} />
                            {platformFee > 0 && <Row op="+" label="Platform fee" amount={platformFee} />}
                            {cod > 0 && <Row op="+" label="COD charge" amount={cod} />}
                            <Row op="+" label="Delivery fee charged" amount={deliveryFee} />
                            <Row op="−" label="Rider pay" amount={riderPay} tone="red" />
                            {campaignPlatform > 0 && <Row op="−" label="Delito's share of the offer" amount={campaignPlatform} tone="red" />}
                            {promo > 0 && <Row op="−" label="Promo" amount={promo} tone="red" />}
                            {hgFood > 0 && <Row op="−" label="HungerGame reward" amount={hgFood} tone="red" />}
                            {coins > 0 && <Row op="−" label="Coins" amount={coins} tone="red" />}
                            {hgDelivery > 0 && <Row op="−" label="HungerGame free delivery" amount={hgDelivery} tone="red" />}
                            {Math.abs(delitoAdjust) >= 0.05 && (
                                <Row op={delitoAdjust > 0 ? '+' : '−'} label="Rounding & settlement adjustments" amount={Math.abs(delitoAdjust)} tone="muted" />
                            )}
                            <Divider dashed />
                            <Row op="=" label="Delito keeps" amount={Math.abs(delitoShare)} strong tone={delitoShare >= 0 ? 'green' : 'red'} />
                            <Row op="−" label="GST on commission to govt." amount={gstOnCommission} tone="muted" />
                            <Row op="=" label={delitoNet >= 0 ? 'Delito net earning' : 'Delito net cost'} amount={Math.abs(delitoNet)} strong tone={delitoNet >= 0 ? 'green' : 'red'} />
                        </div>

                        <p className="mt-2 text-[0.68rem] text-[var(--foreground-secondary)] tabular-nums">
                            ✓ {inr(vendorPayout)} + {inr(riderPay)} + {inr(taxes)} {delitoShare >= 0 ? '+' : '−'} {inr(Math.abs(delitoShare))} = {inr(total)}
                        </p>
                    </>
                )}
            </div>
        </>
    );
}
