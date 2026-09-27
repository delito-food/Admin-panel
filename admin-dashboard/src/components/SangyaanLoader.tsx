'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

/**
 * Lines that roll through the loader, in order. `hi` marks the words
 * that get the brand highlight.
 */
export const LOADER_LINES: { text: string; hi?: string }[] = [
    { text: 'Sangyaan is loading…', hi: 'Sangyaan' },
    { text: 'Ab Delito har ghar', hi: 'har ghar' },
    { text: 'Agle shehar ki tyaari, jaldi hi', hi: 'jaldi hi' },
];

/** How long the loader stays on screen (ms). Every line gets an equal slot. */
export const LOADER_TOTAL_MS = 3000;
const LINE_MS = LOADER_TOTAL_MS / LOADER_LINES.length;

const EASE = [0.22, 1, 0.36, 1] as const;

/** Splits a line into words, marking the highlighted phrase. */
function toWords(text: string, hi?: string) {
    const start = hi ? text.indexOf(hi) : -1;
    const end = start >= 0 ? start + (hi as string).length : -1;
    const words: { word: string; at: number; hi: boolean }[] = [];
    let at = 0;
    for (const word of text.split(' ')) {
        words.push({ word, at, hi: start >= 0 && at >= start && at < end });
        at += word.length + 1;
    }
    return words;
}

function RollingLine({ text, hi, reduce }: { text: string; hi?: string; reduce: boolean }) {
    const words = toWords(text, hi);
    // Keep the whole roll-in well inside one slot, however long the line is
    const stagger = Math.min(0.016, 0.22 / Math.max(text.length, 1));

    return (
        <motion.p
            className="sgy-line"
            initial={reduce ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: '-60%', opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
        >
            {words.map(({ word, at, hi: isHi }) => (
                // Words never break internally, so wrapping on a narrow screen
                // happens between words and nothing is cut off.
                <span key={at} className={`sgy-word-chunk ${isHi ? 'is-hi' : ''}`}>
                    {Array.from(word).map((ch, i) => (
                        <motion.span
                            key={i}
                            className="sgy-char"
                            initial={reduce ? false : { y: '0.9em', opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ duration: 0.36, ease: EASE, delay: reduce ? 0 : (at + i) * stagger }}
                        >
                            {ch}
                        </motion.span>
                    ))}
                </span>
            ))}
        </motion.p>
    );
}

export function SangyaanLoader() {
    const reduce = !!useReducedMotion();
    const [index, setIndex] = useState(0);

    // Step through the lines once and stay on the last one
    useEffect(() => {
        const t = window.setInterval(
            () => setIndex((i) => Math.min(i + 1, LOADER_LINES.length - 1)),
            LINE_MS
        );
        return () => window.clearInterval(t);
    }, []);

    const line = LOADER_LINES[index];

    return (
        <motion.div
            className="sgy-loader"
            role="status"
            aria-live="polite"
            aria-label={line.text}
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
        >
            <div className="sgy-center">
                <motion.div
                    className="sgy-mark"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, ease: EASE }}
                >
                    <span className="sgy-glow" aria-hidden />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/delito-mark.png" alt="" width={64} height={64} className="sgy-logo" />
                </motion.div>

                <motion.h1
                    className="sgy-word"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}
                >
                    Sangyaan
                </motion.h1>

                {/* Every line sits in the same grid cell, so the box is always
                    as tall as the tallest line — nothing gets clipped. */}
                <div className="sgy-roller">
                    <AnimatePresence>
                        <RollingLine key={index} text={line.text} hi={line.hi} reduce={reduce} />
                    </AnimatePresence>
                </div>

                <div className="sgy-bar" aria-hidden>
                    <span
                        className="sgy-bar-fill"
                        style={{ animationDuration: `${LOADER_TOTAL_MS}ms` }}
                    />
                </div>
            </div>
        </motion.div>
    );
}
