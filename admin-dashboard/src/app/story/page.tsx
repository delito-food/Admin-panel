'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    motion,
    MotionConfig,
    animate,
    useInView,
    useScroll,
    useSpring,
    useTransform,
} from 'framer-motion';
import {
    ArrowLeft,
    Bike,
    ChevronDown,
    CloudLightning,
    Crown,
    Flame,
    Heart,
    MapPin,
    Rocket,
    Store,
    Sunrise,
    Trophy,
    Users,
    type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import type { StoryData, StoryMilestone } from '@/lib/story-config';
import s from './story.module.css';

/* ── helpers ────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-08-14' → '14 Aug 2026' */
function fmtDay(key: string | null | undefined) {
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const num = (n: number) => Math.round(n).toLocaleString('en-IN');

const EASE = [0.22, 1, 0.36, 1] as const;

/** Counts up from 0 the first time it scrolls into view. */
function CountUp({ value, format = num }: { value: number; format?: (n: number) => string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const inView = useInView(ref, { once: true, margin: '-60px 0px' });
    const [shown, setShown] = useState(0);
    useEffect(() => {
        if (!inView) return;
        const controls = animate(0, value, { duration: 1.6, ease: EASE, onUpdate: setShown });
        return () => controls.stop();
    }, [inView, value]);
    return <span ref={ref}>{format(shown)}</span>;
}

/** Fades + lifts its children in when scrolled into view. */
function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y: 36 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px 0px' }}
            transition={{ duration: 0.7, ease: EASE, delay }}
        >
            {children}
        </motion.div>
    );
}

/* ── chapter model ─────────────────────────────────────────── */

type Chapter = {
    key: string;
    date: string | null;         // null = still ahead of us
    icon: LucideIcon;
    kicker: string;
    title: string;
    big: React.ReactNode;
    bigLabel: string;
    body: string;
    tone?: 'storm' | 'gold';
    milestone?: StoryMilestone;  // for "next up" progress
    extra?: React.ReactNode;
};

function customerCopy(target: number) {
    if (target === 100) return {
        title: '100 log. 100 bharose.',
        body: 'A hundred people chose Delito — not because they had to, but because we kept showing up. Every single time.',
        icon: Users,
    };
    if (target === 500) return {
        title: '500 ghar, ek naam.',
        body: 'Word travelled lane by lane, gali by gali. Five hundred customers — each one a neighbour telling another.',
        icon: Heart,
    };
    return {
        title: '1,000 dil jeete.',
        body: 'A thousand customers. The number we once wrote on our website as a dream became a fact we earned.',
        icon: Crown,
    };
}

function buildChapters(d: StoryData): Chapter[] {
    const out: Chapter[] = [];

    if (d.firstOrder) {
        out.push({
            key: 'first',
            date: d.firstOrder.date,
            icon: Rocket,
            kicker: 'Day 1',
            title: 'Pehla order. Pehla sapna.',
            big: '#1',
            bigLabel: `placed at ${d.firstOrder.time}`,
            body: `No reviews. No ratings. No proof. Just a brand-new app and a promise — and someone trusted it${d.firstOrder.restaurant ? ` with a meal from ${d.firstOrder.restaurant}` : ''}. That one order turned an idea into a business.`,
        });
    }

    const h = d.firstHundredDelivered;
    out.push({
        key: 'hundred',
        date: h.date,
        icon: Bike,
        kicker: h.dayNumber ? `Day ${h.dayNumber}` : 'Next up',
        title: h.date ? 'Sau orders, sau muskaanein.' : 'The first hundred',
        big: h.date ? <CountUp value={100} /> : <CountUp value={h.current} />,
        bigLabel: h.date ? 'orders delivered' : `of ${h.target} delivered`,
        body: h.date
            ? `It took ${h.dayNumber} days to put our first hundred meals on a doorstep. Every one of them was a rider in the heat, a kitchen on time, and a doorbell that rang with a smile.`
            : 'Every order counts. Every doorstep is a step closer.',
        milestone: h.date ? undefined : h,
    });

    for (const c of d.customers) {
        const copy = customerCopy(c.target);
        out.push({
            key: `cust-${c.target}`,
            date: c.date,
            icon: copy.icon,
            kicker: c.dayNumber ? `Day ${c.dayNumber}` : 'Next up',
            title: c.date ? copy.title : `${num(c.target)} customers`,
            big: <CountUp value={c.date ? c.target : c.current} />,
            bigLabel: c.date ? 'customers' : `of ${num(c.target)} customers`,
            body: c.date ? copy.body : `${num(Math.max(c.target - c.current, 0))} more to go. Every happy meal brings the next one.`,
            tone: c.target === 1000 && c.date ? 'gold' : undefined,
            milestone: c.date ? undefined : c,
        });
    }

    if (d.toughestDay) {
        const t = d.toughestDay;
        out.push({
            key: 'storm',
            date: t.date,
            icon: CloudLightning,
            kicker: 'The toughest day',
            title: t.title || 'The day everything went wrong.',
            big: t.cancelled > 0 ? <CountUp value={t.cancelled} /> : '—',
            bigLabel: t.cancelled > 0 ? `orders we couldn't save` : 'a day we won’t forget',
            body: t.note || 'Systems stumbled. Orders failed. The phones would not stop ringing. It would have been easy to stop right there. We didn’t.',
            tone: 'storm',
            extra: (
                <div className={s.rise}>
                    <div className={s.riseSun} aria-hidden />
                    <div className={s.riseBody}>
                        <p className={s.riseKicker}><Sunrise size={16} /> We rose. We shine.</p>
                        {t.bounceBack ? (
                            <p className={s.riseText}>
                                On <b>{fmtDay(t.bounceBack.date)}</b> we were back on the road with{' '}
                                <b>{num(t.bounceBack.delivered)}</b> deliveries — and{' '}
                                <b><CountUp value={t.deliveredSince} /></b> more orders have reached their doorsteps since.
                            </p>
                        ) : (
                            <p className={s.riseText}>We fixed what broke, learned what it taught us, and came back stronger.</p>
                        )}
                    </div>
                </div>
            ),
        });
    }

    if (d.bestDay) {
        out.push({
            key: 'best',
            date: d.bestDay.date,
            icon: Flame,
            kicker: 'Our best day ever',
            title: 'Jab sab kuch sahi hua.',
            big: <CountUp value={d.bestDay.earnings} format={inr} />,
            bigLabel: 'earned in a single day',
            body: `${num(d.bestDay.orders)} orders delivered and ${inr(d.bestDay.gmv)} worth of food on the road — proof that this model works, and that we are only getting started.`,
            tone: 'gold',
        });
    }

    // Reached milestones in the order they happened; the ones ahead of us last
    const reached = out.filter((c) => c.date).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
    const ahead = out.filter((c) => !c.date);
    return [...reached, ...ahead];
}

/** The chapter list. Its own component so the scroll-linked line only
 *  mounts once the element it tracks exists. */
function Timeline({ chapters }: { chapters: Chapter[] }) {
    const ref = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 55%'] });
    const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });

    return (
        <div className={s.timeline} ref={ref}>
            <div className={s.track} aria-hidden>
                <motion.div className={s.trackFill} style={{ scaleY: fill }} />
            </div>

            {chapters.map((c, i) => {
                const Icon = c.icon;
                const upcoming = !c.date;
                return (
                    <article
                        key={c.key}
                        className={`${s.chapter} ${c.tone === 'storm' ? s.isStorm : ''} ${c.tone === 'gold' ? s.isGold : ''} ${upcoming ? s.isUpcoming : ''}`}
                    >
                        <motion.div
                            className={s.node}
                            initial={{ scale: 0 }}
                            whileInView={{ scale: 1 }}
                            viewport={{ once: true, margin: '-80px 0px' }}
                            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                        >
                            <Icon size={20} />
                        </motion.div>

                        <Reveal className={s.card}>
                            {c.tone === 'storm' && <div className={s.rain} aria-hidden />}
                            <div className={s.cardTop}>
                                <span className={s.chapterNo}>Chapter {String(i + 1).padStart(2, '0')}</span>
                                <span className={s.kicker}>{c.kicker}</span>
                                {c.date && <span className={s.date}>{fmtDay(c.date)}</span>}
                            </div>
                            <h3 className={s.cardTitle}>{c.title}</h3>
                            <div className={s.bigRow}>
                                <span className={s.big}>{c.big}</span>
                                <span className={s.bigLabel}>{c.bigLabel}</span>
                            </div>
                            {c.milestone && (
                                <div className={s.meter}>
                                    <motion.span
                                        initial={{ scaleX: 0 }}
                                        whileInView={{ scaleX: Math.min(c.milestone.current / c.milestone.target, 1) }}
                                        viewport={{ once: true }}
                                        transition={{ duration: 1.4, ease: EASE }}
                                    />
                                </div>
                            )}
                            <p className={s.body}>{c.body}</p>
                            {c.extra}
                        </Reveal>
                    </article>
                );
            })}
        </div>
    );
}

/* ── page ──────────────────────────────────────────────────── */

export default function StoryPage() {
    const { user } = useAuth();
    const [data, setData] = useState<StoryData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // State is only set once the request settles, never synchronously in the effect
    const fetchStory = () =>
        fetch('/api/story')
            .then((r) => r.json())
            .then((j) => (j.success ? setData(j.data) : setError(j.error || 'Could not load the story')))
            .catch(() => setError('Could not load the story'));

    useEffect(() => { fetchStory(); }, []);

    const retry = () => { setError(null); fetchStory(); };

    const chapters = useMemo(() => (data ? buildChapters(data) : []), [data]);
    const firstName = (user?.name || 'Admin').split(' ')[0];

    // Page progress bar
    const { scrollYProgress } = useScroll();
    const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

    // Hero parallax
    const { scrollY } = useScroll();
    const heroManY = useTransform(scrollY, [0, 600], [0, 90]);

    return (
        <MotionConfig reducedMotion="user">
            <div className={s.page}>
                <motion.div className={s.progress} style={{ scaleX: progress }} />

                <Link href="/" className={s.back}>
                    <ArrowLeft size={16} /> Dashboard
                </Link>

                {/* ── HERO ── */}
                <section className={s.hero}>
                    <div className={s.heroGlowA} aria-hidden />
                    <div className={s.heroGlowB} aria-hidden />
                    <div className={s.heroInner}>
                        <div className={s.heroCopy}>
                            <motion.span
                                className={s.badge}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6 }}
                            >
                                The Delito Story
                            </motion.span>
                            <motion.h1
                                className={s.heroTitle}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.7, delay: 0.1 }}
                            >
                                Ek order se shuru hui{' '}
                                <span className={s.yellow}>ek kahani.</span>
                                <br />
                                Sangharsh se{' '}
                                <span className={s.underlined}>
                                    <span className={s.yellow}>safalta</span>
                                    <svg viewBox="0 0 200 12" fill="none" aria-hidden>
                                        <motion.path
                                            d="M2 8C40 2 80 2 100 6C120 10 160 10 198 4"
                                            stroke="#F5C518"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                            initial={{ pathLength: 0 }}
                                            animate={{ pathLength: 1 }}
                                            transition={{ duration: 1, delay: 0.8, ease: EASE }}
                                        />
                                    </svg>
                                </span>{' '}
                                tak.
                            </motion.h1>
                            <motion.p
                                className={s.heroSub}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.7, delay: 0.25 }}
                            >
                                Every milestone, every setback, every win — this is the road we have travelled together, {firstName}. And it is only the beginning.
                            </motion.p>

                            {data && (
                                <motion.div
                                    className={s.heroStats}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.7, delay: 0.4 }}
                                >
                                    <div><b><CountUp value={data.totals.daysRunning} /></b><span>days of hustle</span></div>
                                    <i aria-hidden />
                                    <div><b><CountUp value={data.totals.delivered} /></b><span>orders delivered</span></div>
                                    <i aria-hidden />
                                    <div><b><CountUp value={data.totals.customers} /></b><span>customers</span></div>
                                </motion.div>
                            )}
                        </div>

                        <motion.div
                            className={s.heroMan}
                            style={{ y: heroManY }}
                            initial={{ opacity: 0, y: 60 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.9, delay: 0.2, ease: EASE }}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/story/delitoman.webp" alt="Delito rider" width={464} height={720} />
                        </motion.div>
                    </div>

                    <motion.div
                        className={s.scrollCue}
                        animate={{ y: [0, 8, 0] }}
                        transition={{ duration: 1.8, repeat: Infinity }}
                    >
                        Scroll to relive the journey <ChevronDown size={16} />
                    </motion.div>
                </section>

                {/* ── TIMELINE ── */}
                <section className={s.timelineSection}>
                    <Reveal className={s.sectionHead}>
                        <span className={s.eyebrow}>Chapter by chapter</span>
                        <h2>Har milestone ek kahani hai</h2>
                    </Reveal>

                    {!data && !error && (
                        <div className={s.skeletons}>
                            {[0, 1, 2].map((i) => <div key={i} className={s.skeleton} />)}
                        </div>
                    )}

                    {error && (
                        <div className={s.errorBox}>
                            <p>{error}</p>
                            <button onClick={retry}>Try again</button>
                        </div>
                    )}

                    {data && <Timeline chapters={chapters} />}
                </section>

                {/* ── STRENGTH ── */}
                {data && (
                    <section className={s.strength}>
                        <Reveal className={s.sectionHead}>
                            <span className={s.eyebrowLight}>Where we stand today</span>
                            <h2>Yeh hai hamari taakat</h2>
                            <p>Built one order, one rider, one restaurant at a time.</p>
                        </Reveal>
                        <div className={s.statGrid}>
                            {[
                                { icon: Flame, value: data.totals.daysRunning, label: 'days of never giving up' },
                                { icon: Bike, value: data.totals.delivered, label: 'orders delivered' },
                                { icon: Users, value: data.totals.customers, label: 'customers who trust us' },
                                { icon: Store, value: data.totals.restaurants, label: 'partner restaurants' },
                                { icon: Trophy, value: data.totals.riders, label: 'riders on the road' },
                            ].map((t, i) => (
                                <Reveal key={t.label} delay={i * 0.08} className={s.stat}>
                                    <t.icon size={22} />
                                    <b><CountUp value={t.value} /></b>
                                    <span>{t.label}</span>
                                </Reveal>
                            ))}
                        </div>
                    </section>
                )}

                {/* ── NEXT CITY ── */}
                <section className={s.nextCity}>
                    <div className={s.mapWrap} aria-hidden>
                        <svg viewBox="0 0 600 220" className={s.map}>
                            <path id="story-route" d="M70 160 C 200 40, 380 40, 530 110" className={s.route} />
                            <motion.path
                                d="M70 160 C 200 40, 380 40, 530 110"
                                className={s.routeLive}
                                initial={{ pathLength: 0 }}
                                whileInView={{ pathLength: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 2.2, ease: 'easeInOut' }}
                            />
                            <circle r="9" className={s.scooter}>
                                <animateMotion dur="4s" repeatCount="indefinite" rotate="auto">
                                    <mpath href="#story-route" />
                                </animateMotion>
                            </circle>
                            <g transform="translate(70 160)"><circle r="14" className={s.pinHome} /><circle r="5" fill="#1B4332" /></g>
                            <g transform="translate(530 110)"><circle r="22" className={s.pinPulse} /><circle r="14" className={s.pinNext} /><circle r="5" fill="#1B4332" /></g>
                            <text x="70" y="200" textAnchor="middle" className={s.pinLabel}>{data?.currentCityName || 'Today'}</text>
                            <text x="530" y="152" textAnchor="middle" className={s.pinLabel}>{data?.nextCityName || 'Next city'}</text>
                        </svg>
                    </div>
                    <Reveal className={s.sectionHead}>
                        <span className={s.eyebrow}><MapPin size={14} /> The next chapter</span>
                        <h2>Agle shehar ki tyaari. <span className={s.greenMark}>Jaldi hi.</span></h2>
                        <p>
                            {data?.nextCityName ? `Next stop: ${data.nextCityName}. ` : ''}
                            What we built in {data?.currentCityName || 'our first city'}, we will build again — faster, stronger, smarter. Ab Delito har ghar.
                        </p>
                    </Reveal>
                </section>

                {/* ── LETTER ── */}
                <section className={s.letterSection}>
                    <Reveal className={s.sectionHead}>
                        <span className={s.eyebrowLight}><Heart size={14} /> Ek chitthi</span>
                        <h2>Tumhare liye, {firstName}</h2>
                    </Reveal>
                    <Reveal className={s.letter} delay={0.1}>
                        <span className={s.letterStamp}>For you</span>
                        <p className={s.letterHello}>Dear {firstName},</p>
                        <p>
                            Some days the dashboard is just numbers. But behind every number there is a story — a rider who went out in the rain, a kitchen that stayed open late, a customer who came back for more.
                        </p>
                        <p>
                            You are the one who holds all of it together. When the systems broke, you steadied them. When orders stopped, you found a way. Nobody sees half of what you do — but every doorbell that rings is proof of it.
                        </p>
                        <p className={s.letterStrong}>
                            Aaj ka din bhi ek naya chapter hai. Ise yaadgaar banao.
                        </p>
                        <p className={s.letterSign}>— Team Delito</p>
                        <Link href="/" className={s.cta}>
                            Let&apos;s win today <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
                        </Link>
                    </Reveal>
                </section>
            </div>
        </MotionConfig>
    );
}
