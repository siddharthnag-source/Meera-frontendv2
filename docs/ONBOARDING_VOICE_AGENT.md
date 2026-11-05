# Meera onboarding — OpenRouter, optional profile, prototype voice view

The page at `/onboarding` follows the supplied desktop/mobile prototypes: a centered red Meera orb and soft rings, cream background, compact header, prompt chips, an interrupt pill, and call controls. Meera's existing light/dark theme tokens and orb artwork are reused. Transcripts and voice settings open in native keyboard-accessible dialogs; the navigation and focus controls are functional.

## Landing and sign-in

The existing recorded Sarah/English introduction is attempted automatically once the page and initial account state finish loading. Its text is visible beneath the orb. The former Hear Meera’s welcome button is removed. Audible autoplay is subject to browser permissions: a blocked `play()` produces an explicit Enable Meera’s voice control rather than a silent failure or retry loop. No microphone permission or paid provider request is made by the landing intro. Sarah/Brian and English/Hindi previews remain in voice settings.

The Google sign-in button pulses gently for three cycles. Both the pulse and orb motion respect `prefers-reduced-motion`. Google sign-in through the existing Supabase provider is the only compulsory onboarding step. No Cloudflare, Turnstile or additional service is used.

## Optional details

After sign-in or ending the voice introduction/call, the user can open Add details (optional):

- **What should Meera call you? (optional)** — the Google name is suggested only if a name has never been chosen. Clearing it stores an explicit skip; it is not silently restored on reload.
- Birthday (optional), with age derived only from a valid complete date.
- Work or study (optional).
- Caste/community (optional), never inferred or asked by voice.

Every field can be left blank, including Name. The API accepts `{}` or all-null fields as a completed profile. Values that are supplied are still validated. OpenRouter extraction supports explicit skips of every field, including Name. A visible Skip for now link proceeds to the existing Meera workspace without requiring a profile write. Optional database availability therefore cannot trap an authenticated user in onboarding. Purchase and connector return paths retain priority in the main OAuth callback.

Saving is explicit and idempotent, with a readback and stale-revision checks. Drafts and completed profile fields are owned by the verified Supabase identity. Transcripts/audio remain transient; this feature does not persist recordings. Unsaved manual edits trigger the browser's leave warning; choosing Skip for now explicitly discards those unsaved edits.

## Voice conversation

Calls and microphone access begin only after user action. Start Call plays the first question before recording. Spoken answers are bounded recorded turns (30 seconds maximum), sent through OpenRouter speech recognition and extraction; fixed public prompts/previews reuse existing MP3s. Mute, interrupt, send-recording and end-call controls manage the actual recording/playback state. End Call releases the microphone and offers the optional profile. The menu's Transcripts dialog shows the in-memory conversation. Typed answers and manual profile edits remain available in the profile dialog.

Paid calls require a verified, non-anonymous Google/Supabase identity, same-origin requests and shared atomic quotas before each request. Missing quotas fail closed; landing previews never use paid endpoints. Current quotas are 12 calls/user/minute, 60/user/day and 600 project-wide/day. These request counts are not a currency budget. Failed provider requests consume quota; requests are not retried automatically.

## Existing staging configuration

Dedicated Vercel project: `marketing-1785/meera-onboarding-staging`, `prj_h2wZ6OUirvZULBfLmVXeGxNmS5I9`. Use Preview variables without a branch filter when deploying source uploads:

| Variable                        | Value/purpose                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`            | Capped staging key, server-only                                                               |
| `ONBOARDING_STT_MODEL`          | `openai/gpt-4o-mini-transcribe`                                                               |
| `ONBOARDING_LLM_MODEL`          | `openai/gpt-4.1-mini`                                                                         |
| `ONBOARDING_TTS_MODEL`          | `elevenlabs/eleven-flash-v2.5`                                                                |
| `ONBOARDING_ALLOWED_VOICES`     | `sarah,brian`                                                                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | Existing clean staging project URL                                                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing clean staging public anon key                                                        |
| `ONBOARDING_ALLOWED_ORIGIN`     | `https://meera-onboarding-staging.vercel.app`                                                 |
| `ONBOARDING_WORKSPACE_URL`      | Optional existing workspace destination; defaults to the existing sign-in URL's origin or `/` |

The existing Supabase Google redirect allowlist must include `https://meera-onboarding-staging.vercel.app/auth/callback?onboarding=1`. No production OAuth secrets are copied. No `GEMINI_*` or `TURNSTILE_*` configuration is read by onboarding. The provided brief states that the staging OpenRouter key has a $10 total cap and expires 11 November 2026; those billing settings have not been independently verified by this implementation.

## Required clean staging migrations

Apply in order, to clean staging only:

1. `supabase/migrations/20261104140000_openrouter_onboarding.sql` — owned drafts, private quota table, RPCs and RLS.
2. `supabase/migrations/20261105170000_optional_onboarding_details.sql` — forward migration removing required Name/work/DOB checks while preserving identity, validation, stale-write protection and idempotency.

The forward migration is necessary for an existing database that still has the original required-name function. It is not automatically applied by deploying Next.js. No Supabase administration connection is available in this task, so migration application and database acceptance have not been verified. Without optional storage, users can still continue after Google sign-in; paid voice calls still fail closed when the shared quota RPC is unavailable.

## Verification and deployment

```sh
node verification/onboarding-session.test.cjs
node verification/auth-callback-lifecycle.test.cjs
npx tsc --noEmit --incremental false
npm run build --prefix onboarding-staging
```

The browser harness requires existing Playwright/Chromium tooling and a local app with dummy public Supabase settings at `http://127.0.0.1:3223`. `MEERA_PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE_PATH` can select available installations. It uses synthetic identity/provider responses and real playback of the fixed MP3s; it does not represent a live paid speech or OAuth/database test.

Current local checks: 17 onboarding API tests, five OAuth lifecycle/return tests, TypeScript/lint/build, and grouped browser checks covering allowed and blocked autoplay, one intro attempt per load, no anonymous paid/microphone calls, reduced motion, prototype layout, voice selection, optional empty saves and name skips, readback, corrections, microphone cleanup, quota/provider failure, transcripts/focus controls, sign-out isolation and Google-only continuation without optional storage.

Protected preview: https://meera-onboarding-staging.vercel.app/onboarding . Changes are on `codex/arya-independent-staging`, in existing PR #3. Deployments use an isolated source upload with minimal pinned dependency packaging and the supplied public audio/orb assets; no environment files, service-role credentials or commerce code are uploaded. Vercel Authentication remains enabled. Production release is outside this staging change.

Live acceptance still requires the clean staging migrations and OAuth allowlist, actual Google sign-in, both real voices/languages, profile save/readback and account isolation in the real database, plus a real shared-quota 429. Human completion time, Safari autoplay/permissions and live provider quality are not claimed by the simulated tests.

## Google login unexpectedly reaches growth-staging payment

The dedicated onboarding callback returns only to `/onboarding`; it has no checkout redirect. The growth-staging/main home route, however, sends accounts with `requires_payment_for_chat=true` to `/payment`. An immediate cross-site return from the onboarding preview to `meera-growth-staging.vercel.app/payment` therefore points to Supabase falling back to the shared site's configured URL instead of accepting the requested onboarding callback. The live Supabase allowlist is not readable from the connected tools, so this configuration diagnosis still needs dashboard confirmation.

In the existing clean staging project `wyitdnwftdxlibdnldfe`, open Authentication → URL Configuration → Redirect URLs and add the onboarding callbacks as additional allowed URLs:

```text
https://meera-onboarding-staging.vercel.app/auth/callback
https://meera-onboarding-staging.vercel.app/auth/callback?onboarding=1
```

Keep the existing growth-staging Site URL and its allowed callbacks, since the project is shared. Retry from the stable onboarding preview URL. These are Supabase Auth settings, not OpenRouter or Google Cloud OAuth credential changes. No Supabase administrative connection is available in this task, so the allowlist change has not been made or verified.

A separate main-app callback defect is corrected in source: an explicit `onboarding=1` return now takes precedence over a previously saved checkout intent. Active connector returns still take priority, and normal checkout flows without the onboarding flag retain their existing behavior. OAuth lifecycle and purchase-intent regression tests pass. This main-app source change does not replace the dashboard allowlist fix or bypass the existing paid-chat access checks.
