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

        ],
      },
    ];
  },
};
export default config;
