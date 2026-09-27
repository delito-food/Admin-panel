/**
 * Single source of truth for admin navigation.
 * Sidebar renders it; Header uses it to build the breadcrumb.
 *
 * Structure:  category (small caption) → section (collapsible) → link
 * A section with a single `href` and no `items` renders as a plain link.
 */
import type { LucideIcon } from 'lucide-react';
import {
    LayoutDashboard,
    ShoppingBag,
    ShieldCheck,
    Store,
    Bike,
    Users,
    Megaphone,
    Wallet,
    BarChart3,
    Settings,
} from 'lucide-react';

export const SIDEBAR_WIDTH = 264;
export const SIDEBAR_WIDTH_COLLAPSED = 76;
export const HEADER_HEIGHT = 64;
export const HEADER_HEIGHT_MOBILE = 60;

export interface NavLink {
    label: string;
    href: string;
}

export interface NavSection {
    id: string;
    label: string;
    icon: LucideIcon;
    href?: string;
    items?: NavLink[];
}

export interface NavCategory {
    /** Caption shown above the sections. Omit for the top-level block. */
    caption?: string;
    sections: NavSection[];
}

export const NAV: NavCategory[] = [
    {
        sections: [
            { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
        ],
    },
    {
        caption: 'Operations',
        sections: [
            {
                id: 'orders',
                label: 'Orders',
                icon: ShoppingBag,
                items: [
                    { label: 'All Orders', href: '/orders' },
                    { label: 'Manual Assignment', href: '/orders/assignment' },
                    { label: 'Pending Refunds', href: '/orders/pending-refunds' },
                    { label: 'Refund History', href: '/orders/refunds' },
                    { label: 'Complaints', href: '/complaints' },
                ],
            },
            {
                id: 'verification',
                label: 'Verification',
                icon: ShieldCheck,
                items: [
                    { label: 'Restaurants', href: '/verification/vendors' },
                    { label: 'Outlet Photos', href: '/verification/shop-photos' },
                    { label: 'Delivery Partners', href: '/verification/delivery' },
                    { label: 'Documents', href: '/documents' },
                ],
            },
        ],
    },
    {
        caption: 'Partners',
        sections: [
            {
                id: 'restaurants',
                label: 'Restaurants',
                icon: Store,
                items: [
                    { label: 'All Restaurants', href: '/users/vendors' },
                    { label: 'Menu Management', href: '/menu-management' },
                    { label: 'Performance', href: '/vendors/performance' },
                    { label: 'Business Hours', href: '/vendors/business-hours' },
                    { label: 'Online / Offline', href: '/vendors/status' },
                ],
            },
            {
                id: 'delivery',
                label: 'Delivery',
                icon: Bike,
                items: [
                    { label: 'All Partners', href: '/users/delivery' },
                    { label: 'Performance', href: '/delivery/performance' },
                    { label: 'COD Tracking', href: '/delivery/cod' },
                ],
            },
            {
                id: 'customers',
                label: 'Customers',
                icon: Users,
                items: [
                    { label: 'All Customers', href: '/users/customers' },
                    { label: 'Referral & Rewards', href: '/referral-settings' },
                    { label: 'Coins', href: '/coins' },
                ],
            },
        ],
    },
    {
        caption: 'Growth',
        sections: [
            {
                id: 'marketing',
                label: 'Marketing',
                icon: Megaphone,
                items: [
                    { label: 'Co-funded Offers', href: '/campaigns' },
                    { label: 'Special Offers', href: '/special-offers' },
                    { label: 'Hero Banners', href: '/hero-banners' },
                    { label: 'Push Notifications', href: '/push-notifications' },
                ],
            },
        ],
    },
    {
        caption: 'Money',
        sections: [
            {
                id: 'finance',
                label: 'Finance',
                icon: Wallet,
                items: [
                    { label: 'Cashflow', href: '/cashflow' },
                    { label: 'Restaurant Payouts', href: '/vendors/payouts' },
                    { label: 'Rider Payouts', href: '/delivery/payouts' },
                    { label: 'Payout Disputes', href: '/payouts/disputes' },
                    { label: 'Commission', href: '/vendors/commission' },
                    { label: 'Commission Invoices', href: '/vendors/commission-invoices' },
                    { label: 'Order Invoices', href: '/invoices' },
                ],
            },
            {
                id: 'reports',
                label: 'Reports',
                icon: BarChart3,
                items: [
                    { label: 'Overview', href: '/reports' },
                    { label: 'GST Report', href: '/reports/gst' },
                    { label: 'TDS Report', href: '/reports/tds' },
                    { label: 'HSN Summary', href: '/reports/hsn' },
                    { label: 'Refund Report', href: '/reports/refunds' },
                    { label: 'Advanced Analytics', href: '/reports/advanced' },
                ],
            },
        ],
    },
];

/** Pinned to the bottom of the sidebar. */
export const NAV_FOOTER: NavSection = {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    href: '/settings',
};

/* ── Route matching ─────────────────────────────────────────── */

interface FlatEntry {
    href: string;
    label: string;
    section: NavSection;
    caption?: string;
}

const FLAT: FlatEntry[] = [...NAV, { sections: [NAV_FOOTER] }].flatMap((cat) =>
    cat.sections.flatMap((section) =>
        section.items
            ? section.items.map((i) => ({ href: i.href, label: i.label, section, caption: cat.caption }))
            : section.href
                ? [{ href: section.href, label: section.label, section, caption: cat.caption }]
                : []
    )
);

function matches(pathname: string, href: string) {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
}

/**
 * The single nav entry that owns the current route — the longest matching
 * href wins, so /reports/gst highlights "GST Report" and not "Overview".
 */
export function findActive(pathname: string): FlatEntry | null {
    let best: FlatEntry | null = null;
    for (const entry of FLAT) {
        if (matches(pathname, entry.href) && (!best || entry.href.length > best.href.length)) {
            best = entry;
        }
    }
    return best;
}
