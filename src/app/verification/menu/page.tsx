'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function MenuVerificationRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/menu-management');
    }, [router]);

    return (
        <div style={{ padding: 40, textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Redirecting...</h1>
            <p style={{ color: 'var(--foreground-secondary)', marginBottom: 16 }}>
                Menu management has been moved to a dedicated page.
            </p>
            <Link href="/menu-management" className="btn btn-primary">
                Go to Menu Management
            </Link>
        </div>
    );
}
