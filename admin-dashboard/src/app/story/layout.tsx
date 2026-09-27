import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';

// Same typeface as the Delito landing site
const poppins = Poppins({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700', '800'],
    style: ['normal', 'italic'],
    variable: '--font-poppins',
});

export const metadata: Metadata = {
    title: 'Our Story · Sangyaan',
};

export default function StoryLayout({ children }: { children: React.ReactNode }) {
    return <div className={poppins.variable}>{children}</div>;
}
