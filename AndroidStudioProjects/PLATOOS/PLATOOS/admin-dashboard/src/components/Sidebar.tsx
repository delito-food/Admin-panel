'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import {
    LayoutDashboard,
    ShieldCheck,
    Store,
    Bike,
    UtensilsCrossed,
    Users,
    ShoppingBag,
    BarChart3,
    Settings,
    ChevronLeft,
    ChevronDown,
    Sparkles,
    TrendingUp,
    Percent,
    DollarSign,
    UserPlus,
    Banknote,
    LogOut,
    MessageSquare,
    RefreshCcw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface NavItem {
    label: string;
    href?: string;
    icon: React.ReactNode;
    children?: { label: string; href: string }[];
}

const navigation: NavItem[] = [
    {
        label: 'Dashboard',
        href: '/',
        icon: <LayoutDashboard size={20} />,
    },
    {
        label: 'Verification',
        icon: <ShieldCheck size={20} />,
        children: [
            { label: 'Vendors', href: '/verification/vendors' },
            { label: 'Delivery Partners', href: '/verification/delivery' },
        ],
    },
    {
        label: 'Users',
        icon: <Users size={20} />,
        children: [
            { label: 'Vendors', href: '/users/vendors' },
            { label: 'Delivery Partners', href: '/users/delivery' },
            { label: 'Customers', href: '/users/customers' },
        ],
    },
    {
        label: 'Vendors',
        icon: <Store size={20} />,
        children: [
            { label: 'Performance', href: '/vendors/performance' },
            { label: 'Commission', href: '/vendors/commission' },
            { label: 'Payouts', href: '/vendors/payouts' },
        ],
    },
    {
        label: 'Delivery',
        icon: <Bike size={20} />,
        children: [
            { label: 'Performance', href: '/delivery/performance' },
            { label: 'COD Tracking', href: '/delivery/cod' },
            { label: 'Payouts', href: '/delivery/payouts' },
        ],
    },
    {
        label: 'Orders',
        icon: <ShoppingBag size={20} />,
        children: [
            { label: 'All Orders', href: '/orders' },
            { label: 'Manual Assignment', href: '/orders/assignment' },
            { label: 'Pending Refunds', href: '/orders/pending-refunds' },
            { label: 'Refund History', href: '/orders/refunds' },
        ],
    },
    {
        label: 'Complaints',
        href: '/complaints',
        icon: <MessageSquare size={20} />,
    },
    {
        label: 'Reports',
        icon: <BarChart3 size={20} />,
        children: [
            { label: 'Overview', href: '/reports' },
            { label: 'Advanced Analytics', href: '/reports/advanced' },
        ],
    },
    {
        label: 'Settings',
        href: '/settings',
        icon: <Settings size={20} />,
    },
];

interface SidebarProps {
    collapsed: boolean;
    onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const [expandedItems, setExpandedItems] = useState<string[]>(['Verification', 'Users', 'Vendors', 'Delivery', 'Orders', 'Reports']);

    const toggleExpanded = (label: string) => {
        setExpandedItems(prev =>
            prev.includes(label)
                ? prev.filter(item => item !== label)
                : [...prev, label]
        );
    };

    const isActive = (href?: string) => {
        if (!href) return false;
        if (href === '/') return pathname === '/';
        return pathname.startsWith(href);
    };

    const isParentActive = (children?: { href: string }[]) => {
        if (!children) return false;
        return children.some(child => pathname.startsWith(child.href));
    };

    return (
        <motion.aside
            initial={false}
            animate={{ width: collapsed ? 80 : 280 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="sidebar-premium"
        >
            {/* Logo Section */}
            <div className="sidebar-header">
                <AnimatePresence mode="wait">
                    {!collapsed && (
                        <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center gap-3"
                        >
                            <div className="sidebar-logo">
                                <Sparkles size={18} className="text-white" />
                            </div>
                            <div>
                                <span className="font-bold text-lg text-[var(--foreground)]">Delito</span>
                                <span className="block text-[10px] text-[var(--foreground-secondary)] uppercase tracking-wider">Admin Panel</span>
                            </div>
                        </motion.div>
                    )}
                    {collapsed && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="sidebar-logo mx-auto"
                        >
                            <Sparkles size={18} className="text-white" />
                        </motion.div>
                    )}
                </AnimatePresence>

                <button
                    onClick={onToggle}
                    className="sidebar-toggle"
                >
                    <motion.div
                        animate={{ rotate: collapsed ? 180 : 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <ChevronLeft size={18} />
                    </motion.div>
                </button>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                <ul className="space-y-1">
                    {navigation.map((item) => (
                        <li key={item.label}>
                            {item.href ? (
                                <Link
                                    href={item.href}
                                    className={`sidebar-nav-item ${isActive(item.href) ? 'active' : ''}`}
                                >
                                    <div className={`sidebar-nav-icon ${isActive(item.href) ? 'active' : ''}`}>
                                        {item.icon}
                                    </div>
                                    <AnimatePresence mode="wait">
                                        {!collapsed && (
                                            <motion.span
                                                initial={{ opacity: 0, width: 0 }}
                                                animate={{ opacity: 1, width: 'auto' }}
                                                exit={{ opacity: 0, width: 0 }}
                                                className="sidebar-nav-label"
                                            >
                                                {item.label}
                                            </motion.span>
                                        )}
                                    </AnimatePresence>
                                    {isActive(item.href) && !collapsed && (
                                        <motion.div
                                            layoutId="activeIndicator"
                                            className="sidebar-active-indicator"
                                        />
                                    )}
                                </Link>
                            ) : (
                                <div>
                                    <button
                                        onClick={() => toggleExpanded(item.label)}
                                        className={`sidebar-nav-item ${isParentActive(item.children) ? 'parent-active' : ''}`}
                                    >
                                        <div className={`sidebar-nav-icon ${isParentActive(item.children) ? 'active' : ''}`}>
                                            {item.icon}
                                        </div>
                                        <AnimatePresence mode="wait">
                                            {!collapsed && (
                                                <motion.div
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    exit={{ opacity: 0 }}
                                                    className="flex-1 flex items-center justify-between"
                                                >
                                                    <span className="sidebar-nav-label">{item.label}</span>
                                                    <motion.div
                                                        animate={{ rotate: expandedItems.includes(item.label) ? 180 : 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="text-[var(--foreground-secondary)]"
                                                    >
                                                        <ChevronDown size={16} />
                                                    </motion.div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </button>

                                    <AnimatePresence>
                                        {!collapsed && expandedItems.includes(item.label) && item.children && (
                                            <motion.ul
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="sidebar-submenu"
                                            >
                                                {item.children.map((child) => (
                                                    <li key={child.href}>
                                                        <Link
                                                            href={child.href}
                                                            className={`sidebar-submenu-item ${isActive(child.href) ? 'active' : ''}`}
                                                        >
                                                            <span className="sidebar-submenu-dot" />
                                                            {child.label}
                                                        </Link>
                                                    </li>
                                                ))}
                                            </motion.ul>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </nav>

            {/* Footer */}
            <div className="sidebar-footer" style={{ paddingTop: '16px' }}>
                <AnimatePresence mode="wait">
                    {!collapsed ? (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="space-y-4"
                        >
                            {/* User info card */}
                            <div
                                className="flex items-center gap-3 px-3 py-3 rounded-xl"
                                style={{
                                    background: 'var(--glass-bg)',
                                    border: '1px solid var(--border)',
                                    backdropFilter: 'blur(10px)',
                                }}
                            >
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                                    style={{
                                        background: 'var(--gradient-primary)',
                                        boxShadow: 'var(--shadow-glow)',
                                    }}
                                >
                                    <span className="text-white font-bold text-sm">{user?.name?.charAt(0).toUpperCase() || 'A'}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-[var(--foreground)] truncate">{user?.name || 'Admin'}</p>
                                    <p className="text-xs text-[var(--foreground-secondary)] truncate">{user?.email || 'admin@delito.com'}</p>
                                </div>
                            </div>

                            {/* Logout button */}
                            <button
                                onClick={logout}
                                className="group w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl transition-all duration-300"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(233, 25, 12, 0.08) 0%, rgba(233, 25, 12, 0.04) 100%)',
                                    border: '1px solid rgba(233, 25, 12, 0.2)',
                                    marginTop: '8px',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(233, 25, 12, 0.15) 0%, rgba(233, 25, 12, 0.08) 100%)';
                                    e.currentTarget.style.borderColor = 'rgba(233, 25, 12, 0.4)';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(233, 25, 12, 0.15)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(233, 25, 12, 0.08) 0%, rgba(233, 25, 12, 0.04) 100%)';
                                    e.currentTarget.style.borderColor = 'rgba(233, 25, 12, 0.2)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            >
                                <LogOut size={18} style={{ color: 'var(--accent-error)' }} />
                                <span className="text-sm font-semibold" style={{ color: 'var(--accent-error)' }}>Sign Out</span>
                            </button>

                            {/* Divider */}
                            <div style={{
                                height: '1px',
                                background: 'var(--border)',
                                margin: '8px 0',
                                opacity: 0.5,
                            }} />

                            <div className="sidebar-version">
                                <div className="sidebar-version-badge">v1.0.0</div>
                                <span>Delito Admin</span>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="flex flex-col items-center gap-3"
                        >
                            {/* User avatar */}
                            <div
                                className="w-10 h-10 rounded-xl flex items-center justify-center"
                                style={{
                                    background: 'var(--gradient-primary)',
                                    boxShadow: 'var(--shadow-glow)',
                                }}
                                title={user?.name || 'Admin'}
                            >
                                <span className="text-white font-bold text-sm">{user?.name?.charAt(0).toUpperCase() || 'A'}</span>
                            </div>

                            {/* Logout button */}
                            <button
                                onClick={logout}
                                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200"
                                style={{
                                    background: 'rgba(233, 25, 12, 0.08)',
                                    border: '1px solid rgba(233, 25, 12, 0.15)',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(233, 25, 12, 0.15)';
                                    e.currentTarget.style.borderColor = 'rgba(233, 25, 12, 0.3)';
                                    e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(233, 25, 12, 0.08)';
                                    e.currentTarget.style.borderColor = 'rgba(233, 25, 12, 0.15)';
                                    e.currentTarget.style.transform = 'scale(1)';
                                }}
                                title="Sign Out"
                            >
                                <LogOut size={18} style={{ color: 'var(--accent-error)' }} />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.aside>
    );
}
