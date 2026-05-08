import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Allow Android app to call payment APIs
        // Android HttpURLConnection doesn't send Origin header, so CORS doesn't apply to native apps
        // But we restrict for browser-based requests
        source: '/api/payments/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.NEXT_PUBLIC_BASE_URL || 'https://admin-panel-green-beta.vercel.app' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        // Payout APIs — admin dashboard only
        source: '/api/payouts/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.NEXT_PUBLIC_BASE_URL || 'https://admin-panel-green-beta.vercel.app' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        // Razorpay webhook — server-to-server, no CORS restriction needed
        source: '/api/webhooks/razorpay',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, x-razorpay-signature' },
        ],
      },
    ];
  },
};

export default nextConfig;
