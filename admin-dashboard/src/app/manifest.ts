import type { MetadataRoute } from 'next';

// Lets the admin panel be installed / pinned with the Delito icon
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Sangyaan',
        short_name: 'Sangyaan',
        description: 'Sangyaan — the Delito admin panel',
        start_url: '/',
        display: 'standalone',
        background_color: '#0F1419',
        theme_color: '#1B7A2B',
        icons: [
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    };
}
