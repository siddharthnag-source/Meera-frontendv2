# Meera voice onboarding — OpenRouter

Onboarding uses **OpenRouter**, the existing **Google sign-in through Supabase**, and the existing **Meera/Supabase database**. It does not use Gemini Live, Turnstile, Cloudflare, or another service. Google authentication is unchanged; the main Meera voice/chat implementation outside onboarding is outside this migration.

## User flow

Open `/onboarding` and continue with Google. A verified, non-anonymous Google/Supabase user is required before any paid provider call or profile write. The verified Google name is reused and remains editable. Choose Sarah (default) or Brian and English or Hindi/Hinglish; fixed prompts/previews use the 28 existing MP3 assets. Recording is explicit and bounded to 30 seconds per answer; recording pauses playback, Stop/interrupt cancels pending responses, and typing/manual editing remain available.

OpenRouter transcribes recordings and extracts all explicitly stated details in a single bounded extraction call per answer. Proposed corrections are validated before saving as an owned draft. The user reviews one editable profile card and chooses **Save and begin**. The save is idempotent, reads back the persisted values, and shows the Open Meera handoff. Completed accounts see their saved status rather than setup questions. Community/caste is optional, never inferred, never solicited by voice, and may be left blank. Birthday is optional; age is derived from a validated full date.

A 90-second prompt offers more time; it does not discard data. Persisted drafts resume after reload. Manual edits must be saved with Save draft or Save and begin; leaving with unsaved edits triggers the browser's warning. Audio is transient; this feature does not persist recordings or transcripts. Confirmed profile fields and explicitly saved drafts are stored under the authenticated account.

## Required staging database migration

Apply `supabase/migrations/20261104140000_openrouter_onboarding.sql` to the existing **clean staging** Supabase project, not production. The runtime uses only the public Supabase URL/anon key and the user's verified bearer token. It needs no service-role key.

The migration creates:

- `meera_onboarding_drafts`, with owner-only RLS reads and RPC-only writes.
- `onboarding_read_draft` and `onboarding_write_draft`, deriving ownership from `auth.uid()`, checking revision numbers to reject stale writes, and supporting idempotent completed saves with the same UUID.
- A private quota table and `onboarding_claim_quota`, atomically checking/incrementing shared counters before **each** paid request: 12 calls per user/minute, 60 per user/day, and 600 project-wide/day. The global daily counter is a request cap, not a currency budget. Failed provider requests still consume quota; there is no automatic retry loop.

An unapplied/missing migration returns HTTP 503 before provider access. Quota denial returns HTTP 429 and leaves the editable form available. Neither in-memory counters nor an optional paid Vercel WAF plan are needed. Database transactions/RLS need live acceptance in staging after the migration; mocked tests do not establish real database isolation or concurrency.

## Preview environment variables

Dedicated Vercel project: `marketing-1785/meera-onboarding-staging` (`prj_h2wZ6OUirvZULBfLmVXeGxNmS5I9`). Use **Preview**, with no Git-branch filter if the project has no Git connection.

| Variable                        | Purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OPENROUTER_API_KEY`            | Server-only, capped staging key; never a public variable                                                     |
| `ONBOARDING_STT_MODEL`          | `openai/gpt-4o-mini-transcribe`                                                                              |
| `ONBOARDING_LLM_MODEL`          | `openai/gpt-4.1-mini`                                                                                        |
| `ONBOARDING_TTS_MODEL`          | `elevenlabs/eleven-flash-v2.5`                                                                               |
| `ONBOARDING_ALLOWED_VOICES`     | `sarah,brian`                                                                                                |
| `NEXT_PUBLIC_SUPABASE_URL`      | Existing clean staging database URL                                                                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing clean staging public anon key                                                                       |
| `ONBOARDING_ALLOWED_ORIGIN`     | Exact protected staging origin, normally `https://meera-onboarding-staging.vercel.app`                       |
| `ONBOARDING_WORKSPACE_URL`      | Optional existing Meera workspace URL; otherwise the existing `ONBOARDING_SIGN_IN_URL` origin or `/` is used |

No `GEMINI_*` or `TURNSTILE_*` settings are read by onboarding. Existing unrelated Meera features may still use Google SDK dependencies. Old Gemini variables in the dedicated staging project are unused by this implementation; no credential values are copied or exposed.

The provided brief states that the installed OpenRouter key has a $10 total cap with no reset and expires on 11 November 2026. That billing setting has not been independently verified by this implementation. The account owner should confirm the limit/expiry before live use.

## Google sign-in and return paths

The standalone app now performs the existing Supabase Google OAuth flow itself, with callback `/auth/callback?onboarding=1`, so the verified session belongs to the onboarding origin. Add the exact staging callback to the existing clean Supabase Auth redirect allowlist if it is not already permitted. Do not replace the provider configuration, Google credentials, production callback URLs, or existing redirects.

The main Meera callback recognizes `onboarding=1` only after handling existing connector and purchase returns. Those returns retain priority. Onboarding does not collect a password or claim to send verification emails or create accounts by itself.

## Build and verification

From the repository root:

```sh
node verification/onboarding-session.test.cjs
node verification/auth-callback-lifecycle.test.cjs
npx tsc --noEmit --incremental false
npx next build onboarding-staging
```

The standalone project imports shared onboarding code but has no Meera database-admin or payment providers. Its package replaces the Gemini/event-emitter dependencies with the already-used Supabase client. CSP permits the existing Supabase authentication connection and same-origin onboarding routes; the browser does not connect directly to OpenRouter. Fixed audio files are explicitly traced into the Next.js server output.

For simulated browser checks, run the standalone app with dummy public Supabase settings and `ONBOARDING_ALLOWED_ORIGIN=http://127.0.0.1:3223`. Run `verification/onboarding-browser.cjs` with Playwright and Chromium available in the testing environment; `MEERA_PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE_PATH` may select existing installations. The harness intercepts identity and API responses; it does not perform a real OAuth login, paid model call, or database write.

Verified locally: 14 onboarding API tests, five OAuth return/lifecycle tests, root/standalone TypeScript checks, targeted ESLint, standalone build, and mobile simulated browser checks. Coverage includes multi-fact extraction, corrections, skipped fields, invalid dates, missing storage, fail-closed configuration, quota/provider errors, duplicate saves/readback, microphone denial, mute/interrupt/cleanup, and late-response isolation after sign-out.

## Live acceptance still required

After the clean staging migration and callback allowlist are ready, rebuild the protected preview using its existing Preview settings. Exercise actual Google sign-in, English/Hindi speech and both voices, correction, save and matching values after reload, two-account isolation, denied microphone, provider failure, duplicate save and a real shared-database HTTP 429. Check human completion time and speech quality. No real-provider demo or real database verification is claimed by the mocked checks.

Production release and migrations are not performed by this staging change.
