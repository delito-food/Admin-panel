'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Gift } from 'lucide-react';

/**
 * Floating gift in the bottom-left of the dashboard that opens the
 * Delito story (/story). `left` follows the sidebar width.
 */
export function StoryGiftButton({ left }: { left: number }) {
    return (
        <motion.div
            className="story-fab-wrap"
            initial={false}
            animate={{ left }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        >
            <Link href="/story" className="story-fab" aria-label="Open our story">
                <span className="story-fab-ring" aria-hidden />
                <motion.span
                    className="story-fab-icon"
                    animate={{ rotate: [0, -14, 12, -8, 6, 0], scale: [1, 1.08, 1.08, 1.04, 1, 1] }}
                    transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 3.2, ease: 'easeInOut' }}
                >
                    <Gift size={24} strokeWidth={2.2} />
                </motion.span>
                <span className="story-fab-label">Our story</span>
            </Link>
        </motion.div>
    );
}
