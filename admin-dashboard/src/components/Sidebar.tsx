'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { ChevronDown, ChevronLeft, Gift } from 'lucide-react';
import {
    NAV,
    NAV_FOOTER,
    SIDEBAR_WIDTH,
    SIDEBAR_WIDTH_COLLAPSED,
    findActive,
    type NavSection,
} from './nav-config';

interface SidebarProps {
    collapsed: boolean;
    onToggle: () => void;
}

const STORAGE_KEY = 'delito-admin:sidebar-open-sections';

function readStoredSections(): string[] {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

function storeSections(ids: string[]) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
        /* private mode / blocked storage — the sidebar still works */
    }
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
    const pathname = usePathname();
    const active = findActive(pathname);
    const activeSectionId = active?.section.id;

    // Sections the admin left open last time, plus the one owning this page.
    // (The sidebar only mounts client-side, after sign-in, so storage is readable.)
    const [openSections, setOpenSections] = useState<string[]>(() => {
        const stored = typeof window === 'undefined' ? [] : readStoredSections();
        return activeSectionId && !stored.includes(activeSectionId) ? [...stored, activeSectionId] : stored;
    });

    // Navigating to a page in a closed section opens it (state adjusted during
    // render rather than in an effect, as React recommends)
    const [seenActive, setSeenActive] = useState(activeSectionId);
    if (activeSectionId !== seenActive) {
        setSeenActive(activeSectionId);
        if (activeSectionId && !openSections.includes(activeSectionId)) {
            setOpenSections([...openSections, activeSectionId]);
        }
    }

    const toggleSection = (id: string) => {
        setOpenSections((prev) => {
            const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            storeSections(next);
            return next;
        });
    };

    // In the icon rail, clicking a group expands the sidebar with that group open
    const openFromRail = (id: string) => {
        setOpenSections((prev) => {
            const next = prev.includes(id) ? prev : [...prev, id];
            storeSections(next);
            return next;
        });
        onToggle();
    };

    const renderSection = (section: NavSection) => {
        const Icon = section.icon;
        const isOwner = activeSectionId === section.id;

        // Plain link (Dashboard, Settings)
        if (section.href && !section.items) {
            return (
                <Link
                    key={section.id}
                    href={section.href}
                    title={collapsed ? section.label : undefined}
                    className={`sb-section-btn ${isOwner ? 'is-current' : ''}`}
                >
                    <span className="sb-section-icon"><Icon size={18} /></span>
                    {!collapsed && <span className="sb-section-label">{section.label}</span>}
                </Link>
            );
        }

        const isOpen = openSections.includes(section.id);

        if (collapsed) {
            return (
                <button
                    key={section.id}
                    type="button"
                    title={section.label}
                    onClick={() => openFromRail(section.id)}
                    className={`sb-section-btn ${isOwner ? 'has-current' : ''}`}
                >
                    <span className="sb-section-icon"><Icon size={18} /></span>
                </button>
            );
        }

        return (
            <div key={section.id} className="sb-section">
                <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={isOpen}
                    className={`sb-section-btn ${isOwner ? 'has-current' : ''}`}
                >
                    <span className="sb-section-icon"><Icon size={18} /></span>
                    <span className="sb-section-label">{section.label}</span>
                    <motion.span
                        className="sb-chevron"
                        animate={{ rotate: isOpen ? 0 : -90 }}
                        transition={{ duration: 0.18 }}
                    >
                        <ChevronDown size={15} />
                    </motion.span>
                </button>

                <AnimatePresence initial={false}>
                    {isOpen && section.items && (
                        <motion.ul
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                            className="sb-links"
                        >
                            {section.items.map((item) => {
                                const current = active?.href === item.href;
                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            aria-current={current ? 'page' : undefined}
                                            className={`sb-link ${current ? 'is-current' : ''}`}
                                        >
                                            {item.label}
                                        </Link>
                                    </li>
                                );
                            })}
                        </motion.ul>
                    )}
                </AnimatePresence>
            </div>
        );
    };

    return (
        <motion.aside
            initial={false}
            animate={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            /* is-collapsed / is-open drive the off-canvas drawer behaviour on phones */
            className={`sidebar-premium ${collapsed ? 'is-collapsed' : 'is-open'}`}
        >
            {/* Brand */}
            <div className={`sb-brand ${collapsed ? 'is-collapsed' : ''}`}>
                <Link href="/" className="sb-brand-link" title="Sangyaan">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/delito-mark.png" alt="Delito" width={36} height={36} className="sidebar-logo" />
                    {!collapsed && (
                        <span className="sb-brand-text">
                            <span className="sb-brand-name">Sangyaan</span>
                            <span className="sb-brand-sub">by Delito</span>
                        </span>
                    )}
                </Link>
                <button
                    type="button"
                    onClick={onToggle}
                    className="sb-collapse-btn"
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    <motion.span
                        animate={{ rotate: collapsed ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                        className="flex"
                    >
                        <ChevronLeft size={16} />
                    </motion.span>
                </button>
            </div>

            {/* Navigation */}
            <nav className="sb-nav" aria-label="Main">
                {NAV.map((category, i) => (
                    <div key={category.caption ?? `top-${i}`} className="sb-category">
                        {category.caption && (
                            collapsed
                                ? <div className="sb-category-rule" aria-hidden />
                                : <div className="sb-category-caption">{category.caption}</div>
                        )}
                        {category.sections.map(renderSection)}
                    </div>
                ))}
            </nav>

            {/* Pinned footer */}
            <div className={`sb-footer ${collapsed ? 'is-collapsed' : ''}`}>
                {renderSection(NAV_FOOTER)}
                {/* Our story — a gift in the bottom-left corner */}
                <Link
                    href="/story"
                    className="sb-story"
                    title="Our story"
                    aria-label="Open our story"
                >
                    <Gift size={17} strokeWidth={2.2} />
                </Link>
            </div>
        </motion.aside>
    );
}
