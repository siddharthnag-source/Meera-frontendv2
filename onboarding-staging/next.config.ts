import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.ONBOARDING_BUILD_DIR || ".next",
  experimental: { externalDir: true },
  outputFileTracingIncludes: {
    "/api/onboarding/clips/*": ["../tools/voice-onboarding/assets/*.mp3"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};
export default config;
