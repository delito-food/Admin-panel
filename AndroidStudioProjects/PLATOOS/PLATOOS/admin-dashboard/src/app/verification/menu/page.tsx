'use client';

import Link from 'next/link';

export default function MenuVerificationDisabled() {
    return (
        <div style={{ padding: 40 }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Menu Verification Disabled</h1>
            <p style={{ color: 'var(--foreground-secondary)', marginBottom: 16 }}>
                The menu verification feature has been temporarily disabled. 
                If you need to re-enable it, contact the development team.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
                <Link href="/verification/vendors" className="btn btn-outline">
                    Back to Vendor Verification
                </Link>
                <Link href="/" className="btn btn-primary">
                    Go to Dashboard
                </Link>
            </div>
        </div>
    );
}
