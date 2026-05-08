'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function UsersPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tab = searchParams.get('tab');

    useEffect(() => {
        // Redirect based on tab parameter
        if (tab === 'delivery') {
            router.replace('/users/delivery');
        } else if (tab === 'customers') {
            router.replace('/users/customers');
        } else {
            // Default to vendors
            router.replace('/users/vendors');
        }
    }, [tab, router]);

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
            <p style={{ color: 'var(--foreground-secondary)' }}>Redirecting...</p>
        </div>
    );
}
