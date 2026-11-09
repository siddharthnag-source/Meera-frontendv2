# Meera onboarding — execution against the supplied brief

The attached *Arya Onboarding Execution Brief* structures this work. The original request remains authoritative: Google sign-in is compulsory; all personalization, including name, birthday and phone, is optional. Production release remains with Sid.

## Implementation

This branch builds on `codex/arya-independent-staging` rather than creating another app or service. The existing cream/forest-green theme, Meera orb, 28 prerecorded Sarah/Brian English/Hindi assets, OpenRouter adapters, Supabase account verification, private drafts, atomic quotas, revision checks and idempotent save/readback are retained.

This update adds optional phone and intended usage throughout validation, extraction, review, save and readback; makes voice/language selection available directly in setup; uses “What should I call you?”; surfaces the 90-second typing/resume choice outside the review panel; routes normal Google sign-in to optional setup and completed accounts home; and checks completion in the isolated callback. Purchase and connector returns keep their precedence. Preview mutations accept their own origin as well as the configured stable origin. Foreign origins remain rejected. Rate limits include Retry-After.

Recorded welcome playback is attempted once per load, with a manual playback fallback if blocked. No microphone or paid call starts on load. Voice is bounded recorded turns with silence detection and explicit interruption, not full-duplex streaming. Answers appear after transcription; real-time interim words are not implemented.

The new `tools/package-onboarding-staging.cjs` prepares a minimal credential-free deployment source under ignored `work/`, pins installed dependency versions and excludes commerce, env files and node_modules. Branch auto-deploy is disabled to prevent accidental deployment to a connected production project.

## Database and staging prerequisites

Apply the following to the existing **clean staging database only**, in order:

1. `20261104140000_openrouter_onboarding.sql`
2. `20261105170000_optional_onboarding_details.sql`
3. `20261109130000_optional_phone_and_usage.sql`

Deployment does not apply migrations. No Supabase administration tool or connection is available in this session, so application of these migrations is **unverified**. New phone/usage saves will fail against an older database function until migration 3 is applied. Optional storage failure leaves a Google-only continuation path; paid calls fail closed when shared quota storage is unavailable.

Retain the clean project's existing Site URL and allow the onboarding staging `/auth/callback` URL, including its `?onboarding=1` variant. The isolated app reads only public Supabase bindings and server-only OpenRouter settings. No Google Cloud OAuth secret is needed in this app. No production credentials were copied.

The brief states a $10 lifetime OpenRouter key cap with no reset and expiry on 11 November 2026. This session inspected variable names/scopes, not key billing configuration. Shared call quotas are not currency accounting. Actual cost per completed session must be reconciled with OpenRouter activity before changing allowances.

## Evidence and limits

- 33 focused Node checks pass, including authentication, foreign origin rejection, owned/idempotent saves, stale revisions, optional phone/usage, invalid phone, empty completed profiles, failed providers, quota 429, listening cleanup, OAuth lifecycle and return precedence.
- TypeScript passes with no errors.
- Isolated staging Next.js production build passes.
- Browser harness passes 16 grouped checks at mobile/desktop sizes: allowed/blocked autoplay, prerecorded previews, optional details, synthetic corrections, draft save/reload, microphone denial and cleanup, account-change isolation, guided speech/silence loops, provider/429 fallback and Google-only continuation without storage.
- Browser authentication, provider replies and database saves are fixtures. These do not prove live OAuth, provider quality, actual database RLS, or a real quota exhaustion.

## Staging CSP verification

Automatic approval review rejected the inherited staging config because it allowed inline scripts and eval. The staging app now creates a fresh CSP nonce per HTML request and renders dynamically, without those broad allowances. The minimal packager includes the middleware. Production CSP hydration is checked separately from the development-browser harness.

## Customer acceptance demo (60–90 seconds)

Use a fresh permitted staging Google account. Start the timer after voice/language choice, separately from Google signup. Choose Sarah or Brian and preview; choose English or Hindi/Hinglish; start and permit microphone once. Give work and DOB in one answer, correct one fact, review/edit the Google name, optionally add phone/usage, and save. Reload and compare saved values. Repeat denied-microphone, provider failure, empty details, duplicate save and second-account isolation. Trigger a real shared quota 429 in an isolated test account. Record actual elapsed time and reconcile provider cost.

No live customer demo, human completion-time result, real-device Safari acceptance or live database/provider acceptance is claimed. These remain pending the staging database/OAuth access above. No main merge or production release is included.

## Follow-up: signup handoff

The dedicated callback no longer consults profile completion or sends the Google return to the external workspace. It always returns to `/onboarding?setup=1`, which opens voice settings and previews first. Typing and profile review remain explicit alternatives. Workspace navigation occurs only through an explicit continue link. The callback path remains `/auth/callback` to preserve existing exact allowlist entries; the app's same-tab intent marker remains available for the main-app callback.

The stable `meera-onboarding-staging.vercel.app` alias was found pointing at older deployment `dpl_998CNPccCii4Q2gnFxftC2JVGR2m`, rather than the previous follow-up build. The corrected release updates that existing staging alias after successful deployment. A provider-side rejection of the stable callback still requires Supabase Auth URL Configuration access; the Supabase plugin is discoverable but not connected in this session. Do not confuse a source redirect fix with verification of the provider allowlist.

The reported live failure was from an immutable preview URL to `https://meera-growth-staging.vercel.app/#`, confirming a Supabase Site URL fallback. Immutable preview entry links now redirect to the stable onboarding origin before signup; OAuth callback responses themselves are never forwarded across origins. The stable callback to allow in clean Supabase is exactly `https://meera-onboarding-staging.vercel.app/auth/callback`. The app still cannot override a Supabase rejection if that stable URL is missing from its allowlist.
