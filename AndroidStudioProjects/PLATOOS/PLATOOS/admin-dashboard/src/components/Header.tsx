'use client';

import { useState, useEffect, useRef } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { Notifications } from './Notifications';
import { Bell, Search, Menu, LogOut, User, ChevronDown, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth';

interface HeaderProps {
    sidebarCollapsed: boolean;
    onMenuClick: () => void;
}

export function Header({ sidebarCollapsed, onMenuClick }: HeaderProps) {
    const { user, logout } = useAuth();
    const [showNotifications, setShowNotifications] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    // Close profile menu when clicking outside
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
        const handleScroll = () => {
            setScrolled(window.scrollY > 10);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll(); // Check initial state
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const sidebarWidth = sidebarCollapsed ? 80 : 280;

    return (
        <motion.header
            initial={false}
            animate={{
                left: sidebarWidth,
            }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={`header-premium ${scrolled ? 'header-scrolled' : ''}`}
            style={{ left: sidebarWidth }}
        >
            {/* Mobile Menu Button */}
            <button
                onClick={onMenuClick}
                className="lg:hidden header-action-btn"
            >
                <Menu size={22} />
            </button>

            {/* Search Bar */}
            <div className="hidden md:block header-search">
                <Search size={18} className="header-search-icon" />
                <input
                    type="text"
                    placeholder="Search vendors, orders, users..."
                    className="header-search-input"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:flex items-center gap-1 text-[10px] text-[var(--foreground-secondary)]">
                    <kbd className="px-1.5 py-0.5 bg-[var(--surface-hover)] rounded border border-[var(--border)] font-medium">⌘</kbd>
                    <kbd className="px-1.5 py-0.5 bg-[var(--surface-hover)] rounded border border-[var(--border)] font-medium">K</kbd>
                </div>
            </div>

            {/* Right Actions */}
            <div className="header-actions">
                {/* Notifications */}
                <div className="relative">
                    <button
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="header-action-btn"
                    >
                        <Bell size={22} />
                        <span className="notification-dot" />
                    </button>
                    <Notifications
                        isOpen={showNotifications}
                        onClose={() => setShowNotifications(false)}
                    />
                </div>

                {/* Theme Toggle */}
                <ThemeToggle />

                {/* Admin Profile with Dropdown */}
                <div className="relative" ref={profileMenuRef}>
                    <button
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                        className="header-profile group cursor-pointer"
                    >
                        <div className="header-profile-info hidden sm:block text-right">
                            <p className="header-profile-name">{user?.name || 'Admin'}</p>
                            <p className="header-profile-role">{user?.role === 'super_admin' ? 'Super Admin' : 'Admin'}</p>
                        </div>
                        <div className="header-profile-avatar">
                            <span>{user?.name?.charAt(0).toUpperCase() || 'A'}</span>
                        </div>
                        <ChevronDown
                            size={16}
                            className={`hidden sm:block text-[var(--foreground-secondary)] transition-transform duration-200 ${showProfileMenu ? 'rotate-180' : ''}`}
                        />
                    </button>

                    {/* Profile Dropdown Menu */}
                    <AnimatePresence>
                        {showProfileMenu && (
                            <motion.div
                                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                                transition={{ duration: 0.15, ease: 'easeOut' }}
                                className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden z-50"
                                style={{ boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)' }}
                            >
                                {/* User Info */}
                                <div className="p-4 border-b border-[var(--border)] bg-gradient-to-br from-[var(--primary)]/10 to-transparent">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/70 flex items-center justify-center shadow-lg">
                                            <span className="text-white font-semibold text-lg">{user?.name?.charAt(0).toUpperCase() || 'A'}</span>
                                        </div>
                                        <div>
                                            <p className="font-semibold text-[var(--foreground)]">{user?.name || 'Admin User'}</p>
                                            <p className="text-sm text-[var(--foreground-secondary)]">{user?.email || 'admin@delito.com'}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Menu Items */}
                                <div className="p-2">
                                    <button
                                        onClick={() => {
                                            setShowProfileMenu(false);
                                            window.location.href = '/settings';
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
                                    >
                                        <User size={18} />
                                        <span>My Profile</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowProfileMenu(false);
                                            window.location.href = '/settings';
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
                                    >
                                        <Settings size={18} />
                                        <span>Settings</span>
                                    </button>
                                </div>

                                {/* Logout */}
                                <div className="p-2 border-t border-[var(--border)]">
                                    <button
                                        onClick={() => {
                                            setShowProfileMenu(false);
                                            logout();
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-500 hover:bg-red-500/10 transition-colors"
                                    >
                                        <LogOut size={18} />
                                        <span>Sign Out</span>
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
