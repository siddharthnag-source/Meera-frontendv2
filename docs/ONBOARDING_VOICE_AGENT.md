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

## Separate onboarding staging deployment

The dedicated Vercel project is `marketing-1785/meera-onboarding-staging` (`prj_h2wZ6OUirvZULBfLmVXeGxNmS5I9`), with Node 22, project root `onboarding-staging`, and Vercel Authentication on all deployments. It imports the shared onboarding page, prompt, API and dedicated browser audio code, without loading the main app's authentication/database/payment providers. The existing Arya launcher and growth staging project are unchanged.

Install from the repository root with `npm ci`; build with `npx next build onboarding-staging`. Local development: `ONBOARDING_ALLOWED_ORIGIN=http://127.0.0.1:3221 npx next dev onboarding-staging --hostname 127.0.0.1 --port 3221`. The standalone app requires no database or payment credentials. It adds no new runtime packages beyond those already in the repository.

Preview settings already configured: `ONBOARDING_ALLOWED_ORIGIN=https://meera-onboarding-staging.vercel.app` and `ONBOARDING_SIGN_IN_URL=https://meera-growth-staging.vercel.app/sign-in`. The sign-in handoff uses the existing separate account staging app, not production. Keep the deployment alias aligned with the allowed origin. Add the Gemini/model and Turnstile settings listed above in **Preview**, then rebuild. Use a Turnstile widget restricted to `meera-onboarding-staging.vercel.app`. Do not put server secrets in any `NEXT_PUBLIC_` variable.

A logging-only firewall rate rule was accepted for POST `/api/onboarding/session`, observing a threshold of 30 requests/IP/minute. An enforcing preview rule (10/IP/minute) was rejected by Vercel with HTTP 402, `Rate limiting is not available for this plan`. Logging is not protection. Review/resolve the plan requirement and verify an enforcing rule before allowing public, paid voice usage. Vercel Authentication remains enabled. The Google project budget and its alerts must be configured in the staging Google Cloud project; no Google Cloud billing connection is available in this task.

Verification on 3 November 2026: standalone production build, TypeScript and targeted ESLint passed; 11 API tests passed with mocked upstream services. Chromium checks with synthetic microphone input and simulated Gemini/Turnstile responses passed: SDK setup and PCM/transcript rendering, interruption, mute/unmute, one five-second silence reminder without repetition, five-minute timeout, restart, disconnect, expired challenge, cancellation, microphone denial and released microphone tracks. These checks do not prove live provider credentials, actual speech recognition/quality, or a completed OAuth login.

Re-run server tests with `node verification/onboarding-session.test.cjs`. Browser checks require Playwright and Chromium available in the test environment, a locally running app with a public test site key, and `node verification/onboarding-browser.cjs`; set `MEERA_PLAYWRIGHT_MODULE` if Playwright is installed outside this repository. The test intercepts provider network traffic and never submits real signup details. Keep test site keys and simulated provider tokens out of hosted environment settings.
