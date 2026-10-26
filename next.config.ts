import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.MEERA_BUILD_DIR || '.next',
  ...(process.env.MEERA_BUILD_CPUS ? {
    experimental: { cpus: Math.max(1, Math.min(4, Number(process.env.MEERA_BUILD_CPUS) || 2)) },
  } : {}),
  eslint: {
    // Temporary production safeguard: local lint still runs via npm scripts.
    // Keep lint as a separate check while existing lint issues are resolved.
    ignoreDuringBuilds: true,
  },
  env: {
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY:
      process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
