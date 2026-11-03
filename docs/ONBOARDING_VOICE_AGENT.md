# Meera onboarding voice agent

Open `/onboarding`. The agent uses Gemini Live audio and the supplied onboarding flow, with one question at a time, transcripts, mute/end controls, interruption handling and one gentle reminder after five seconds of silence. Sessions end after five minutes. No new dependencies.

The current registration provider is Google OAuth at `/sign-in`. Meera guides that flow; it cannot send verification emails, create accounts itself, or persist preferences. It never claims these actions succeeded. Name/email collection is skipped when Google supplies them. Transcripts are held in page memory, not written to the database by this feature; audio and transcript processing occurs at Google.

## Explicit staging setup

Keep the independent staging launcher's AI-disabled defaults. Do not copy production credentials, change its credential allowlist, or enable live payments. To exercise this optional feature, configure a separately approved staging runtime with these dedicated settings:

- `GEMINI_API_KEY`: server-only key from a staging Google project with billing limits.
- `GEMINI_ONBOARDING_MODEL`: a Gemini Live native audio model currently enabled for that project. No hardcoded retired preview fallback.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: Cloudflare Turnstile widget site key, restricted to staging hostnames.
- `TURNSTILE_SECRET_KEY`: corresponding server-only secret.
- `ONBOARDING_ALLOWED_ORIGIN`: exact staging origin, including scheme and port. Defaults to the request origin when unset; set it explicitly on a hosted deployment.

Rebuild after setting the public site key. The session endpoint fails closed when server settings are absent. Turnstile tokens are single-use and must match the expected hostname and `onboarding` action. Gemini credentials remain server-side; browser tokens allow one new session within sixty seconds and expire within five minutes. Model and instructions are locked into the token.

Before publishing, configure platform rate limits for `POST /api/onboarding/session` and a Google project budget. Turnstile is bot protection, not a per-person spend quota. Verify CSP permits Cloudflare scripts/frames and Google Live WebSocket connections.

## Verification

Run `npx tsc --noEmit --incremental false` and ESLint on the three added TypeScript files. Live check with staging keys: complete verification, start voice, grant microphone access, hear the greeting, answer, interrupt playback, pause for the reminder, mute/unmute, end the call, and confirm the microphone indicator turns off. Test permission denial, expired challenge, network disconnect, cancellation during connection, and restarting. Follow the sign-up link and confirm the existing Google callback opens the workspace. Without credentials, confirm voice cannot start and sign-up stays available.

Do not claim a live voice session has been tested until these checks have run with the staging provider configuration.
