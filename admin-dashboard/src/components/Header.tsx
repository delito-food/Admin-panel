'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { Notifications } from './Notifications';
import { Bell, Menu, LogOut, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth';
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED, findActive } from './nav-config';

interface HeaderProps {
    sidebarCollapsed: boolean;
    onMenuClick: () => void;
}

/** "/vendors/suspend" → "Suspend" for pages that aren't in the sidebar. */
function titleFromPath(pathname: string) {
    const last = pathname.split('/').filter(Boolean).pop() ?? 'Dashboard';
    return last.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Header({ sidebarCollapsed, onMenuClick }: HeaderProps) {
    const { user, logout } = useAuth();
    const pathname = usePathname();
    const [showNotifications, setShowNotifications] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
                setShowProfileMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 4);
        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Close menus when the route changes
    useEffect(() => {
        setShowProfileMenu(false);
        setShowNotifications(false);
    }, [pathname]);

    const sidebarWidth = isMobile ? 0 : (sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH);

    const active = findActive(pathname);
    const pageTitle = active?.label ?? titleFromPath(pathname);
    const parent = active && active.section.items ? active.section.label : null;

    const initial = user?.name?.charAt(0).toUpperCase() || 'A';
    const roleLabel = user?.role === 'super_admin' ? 'Super Admin' : 'Admin';

    return (
        <motion.header
            initial={false}
            animate={{ left: sidebarWidth }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={`topbar ${scrolled ? 'is-scrolled' : ''}`}
        >
            {/* Left: menu + breadcrumb */}
            <div className="topbar-left">
                <button
                    type="button"
                    onClick={onMenuClick}
                    className="topbar-icon-btn topbar-menu-btn"
                    aria-label="Open menu"
                >
                    <Menu size={20} />
                </button>

                <nav className="topbar-crumbs" aria-label="Breadcrumb">
                    {parent && (
                        <>
                            <span className="topbar-crumb-parent">{parent}</span>
                            <ChevronRight size={14} className="topbar-crumb-sep" />
                        </>
                    )}
                    <span className="topbar-crumb-current">{pageTitle}</span>
                </nav>
            </div>

            {/* Right: actions */}
            <div className="topbar-actions">
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="topbar-icon-btn"
                        aria-label="Notifications"
                    >
                        <Bell size={19} />
                        <span className="topbar-dot" />
                    </button>
                    <Notifications
                        isOpen={showNotifications}
                        onClose={() => setShowNotifications(false)}
                    />
                </div>

                <ThemeToggle />

                <span className="topbar-divider" aria-hidden />

                <div className="relative" ref={profileMenuRef}>
                    <button
                        type="button"
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                        className="topbar-profile"
                        aria-haspopup="menu"
                        aria-expanded={showProfileMenu}
                    >
                        <span className="topbar-avatar">{initial}</span>
                        <span className="topbar-profile-text">
                            <span className="topbar-profile-name">{user?.name || 'Admin'}</span>
                            <span className="topbar-profile-role">{roleLabel}</span>
                        </span>
                        <ChevronDown
                            size={15}
                            className={`topbar-profile-chevron ${showProfileMenu ? 'rotate-180' : ''}`}
                        />
                    </button>

                    <AnimatePresence>
                        {showProfileMenu && (
                            <motion.div
                                role="menu"
                                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                                transition={{ duration: 0.14, ease: 'easeOut' }}
                                className="topbar-menu"
                            >
                                <div className="topbar-menu-head">
                                    <span className="topbar-avatar topbar-avatar-lg">{initial}</span>
                                    <div className="min-w-0">
                                        <p className="topbar-menu-name">{user?.name || 'Admin'}</p>
                                        <p className="topbar-menu-email">{user?.email || '—'}</p>
                                        <span className="topbar-menu-role">{roleLabel}</span>
                                    </div>
                                </div>

                                <div className="topbar-menu-group">
                                    <Link href="/settings" role="menuitem" className="topbar-menu-item">
                                        <Settings size={16} />
                                        <span>Settings</span>
                                    </Link>
                                </div>

                                <div className="topbar-menu-group">
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                            setShowProfileMenu(false);
                                            logout();
                                        }}
                                        className="topbar-menu-item is-danger"
                                    >
                                        <LogOut size={16} />
                                        <span>Sign out</span>
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </motion.header>
    );
}
