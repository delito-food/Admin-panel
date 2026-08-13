'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AuthProvider, useAuth } from '@/lib/auth';
import { patchGlobalFetch } from '@/lib/api-client';

interface DashboardLayoutProps {
    children: React.ReactNode;
}

function DashboardContent({ children }: DashboardLayoutProps) {
    const { user, isLoading } = useAuth();
    const pathname = usePathname();
    const router = useRouter();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    // Patch global fetch to auto-attach auth tokens on /api/* calls
    useEffect(() => {
        patchGlobalFetch();
    }, []);

    const isLoginPage = pathname === '/login';

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

    // Show loading state
    if (isLoading) {
        return (
            <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        className="w-10 h-10 border-3 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full"
                    />
                    <p className="text-[var(--foreground-secondary)]">Loading...</p>
                </div>
            </div>
        );
    }

    // If on login page, render without sidebar/header
    if (isLoginPage) {
        return <>{children}</>;
    }

    // If not authenticated and not on login page, show nothing (will redirect)
    if (!user) {
        return null;
    }

    return (
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
                    marginLeft: isMobile ? 0 : (sidebarCollapsed ? 80 : 280),
                }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="min-h-screen"
                style={{ paddingTop: isMobile ? 76 : 96 }}
            >
                <div style={{ padding: isMobile ? '20px 16px 24px 16px' : '32px 40px 40px 40px' }}>
                    {children}
                </div>
            </motion.main>
        </div>
    );
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <AuthProvider>
            <DashboardContent>{children}</DashboardContent>
        </AuthProvider>
    );
}
