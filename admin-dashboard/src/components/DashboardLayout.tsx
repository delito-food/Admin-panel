'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { SangyaanLoader, LOADER_TOTAL_MS } from './SangyaanLoader';
import { StoryGiftButton } from './StoryGiftButton';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AuthProvider, useAuth } from '@/lib/auth';
import { patchGlobalFetch } from '@/lib/api-client';
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED, HEADER_HEIGHT, HEADER_HEIGHT_MOBILE } from './nav-config';

interface DashboardLayoutProps {
    children: React.ReactNode;
}

function DashboardContent({ children }: DashboardLayoutProps) {
    const { user, isLoading } = useAuth();
    // The loader holds for LOADER_TOTAL_MS on every full page load (open /
    // refresh). In-app navigation never remounts this layout, so it won't
    // replay when moving between pages.
    const [introDone, setIntroDone] = useState(false);

    useEffect(() => {
        const t = window.setTimeout(() => setIntroDone(true), LOADER_TOTAL_MS);
        return () => window.clearTimeout(t);
    }, []);
    const pathname = usePathname();
    const router = useRouter();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    // Patch global fetch to auto-attach auth tokens on /api/* calls
    useEffect(() => {
        patchGlobalFetch();
    }, []);

    const isLoginPage = pathname === '/login';
    // The story page is a full-screen experience: no sidebar or top bar
    const isFullscreenPage = pathname === '/story';

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024);
            if (window.innerWidth < 1024) {
                setSidebarCollapsed(true);
            }
        };

        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // On phones the sidebar is an overlay drawer — close it after navigating
    useEffect(() => {
        if (isMobile) setSidebarCollapsed(true);
    }, [pathname, isMobile]);

    // Lock background scrolling while the drawer is open on a phone
    useEffect(() => {
        if (isMobile && !sidebarCollapsed) {
            const previous = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = previous; };
        }
    }, [isMobile, sidebarCollapsed]);

    useEffect(() => {
        if (!isLoading && !user && !isLoginPage) {
            router.push('/login');
        }
    }, [user, isLoading, isLoginPage, router]);

    const toggleSidebar = () => {
        setSidebarCollapsed(prev => !prev);
    };

    const showLoader = isLoading || !introDone;

    // The loader sits on top and fades out over whatever is ready underneath
    const loader = (
        <AnimatePresence>
            {showLoader && <SangyaanLoader key="sangyaan-loader" />}
        </AnimatePresence>
    );

    // App shell (sidebar + top bar + page) for a signed-in admin
    const shell = (
        <div className="min-h-screen bg-[var(--background)]">
            {/* Mobile overlay backdrop when sidebar is open */}
            {isMobile && !sidebarCollapsed && (
                <div
                    onClick={() => setSidebarCollapsed(true)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 40,
                        background: 'rgba(0,0,0,0.5)',
                        backdropFilter: 'blur(2px)',
                    }}
                />
            )}
            <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
            <Header sidebarCollapsed={sidebarCollapsed} onMenuClick={toggleSidebar} />

            <motion.main
                initial={false}
                animate={{
                    marginLeft: isMobile ? 0 : (sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH),
                }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="min-h-screen"
                style={{ paddingTop: isMobile ? HEADER_HEIGHT_MOBILE : HEADER_HEIGHT }}
            >
                <div style={{ padding: isMobile ? '16px 16px 24px' : '28px 32px 40px' }}>
                    {children}
                </div>
            </motion.main>

            {/* Gift in the bottom-left of the dashboard → our story */}
            {pathname === '/' && (
                <StoryGiftButton left={isMobile ? 0 : (sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH)} />
            )}
        </div>
    );

    // The loader keeps the same place in the tree in every state, so it is
    // never remounted (and its rolling text never restarts) as auth settles.
    let content: React.ReactNode = null;
    if (isLoading) {
        content = null;                 // still checking who is signed in
    } else if (isLoginPage) {
        content = children;             // login renders without sidebar/header
    } else if (user) {
        content = isFullscreenPage ? children : shell;
    }                                   // else: not signed in, redirecting to /login

    return (
        <>
            {loader}
            {content}
        </>
    );
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <AuthProvider>
            <DashboardContent>{children}</DashboardContent>
        </AuthProvider>
    );
}
