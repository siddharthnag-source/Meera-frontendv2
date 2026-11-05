# Arya developer access and build checklist

4 November 2026. This is the technical companion to the one-page brief, not customer-facing UI.

## Start here

1. Sign into Codex as marketing@getmeera.space. Use repository https://github.com/siddharthnag-source/Meera-frontendv2 and the existing review https://github.com/siddharthnag-source/Meera-frontendv2/pull/3. Work on a codex/ branch against current main. Do not replace Arya's existing branch with this local starter.
2. Sign into Vercel as marketing@getmeera.space: https://vercel.com/marketing-1785/meera-onboarding-staging/settings/environment-variables. This is the dedicated project prj_h2wZ6OUirvZULBfLmVXeGxNmS5I9 in team_XgO6e3zkrdJNhcDZfaLqOFZR, not Meera production.
3. The capped OpenRouter key is already saved there as a Preview-only Secret named OPENROUTER_API_KEY. It has a $10 total limit, no reset, and expires 11 November 2026. Never ask for the owner's full OpenRouter account. Secrets are excluded from this pack. Use mocks for local development and the configured protected Preview for live calls. A Vercel Secret is not automatically exported to a local/Codex environment; optional local paid testing needs separate secure installation, not a copy in this pack.

## Access and credential status

| Resource | Exact target | Verified status and next step |
|---|---|---|
| GitHub | @nagsiddharthimp1-collab, siddharthnag-source/Meera-frontendv2 | Write verified live. |
| Vercel | marketing@getmeera.space, marketing-1785 | Confirmed Owner; browser sign-in works. |
| OpenRouter | OPENROUTER_API_KEY in dedicated project's Preview | Installed as Secret. Account runtime API confirms $10 total cap; no reset. New deployment required to consume variables. |
| Models | ONBOARDING_STT_MODEL, ONBOARDING_LLM_MODEL, ONBOARDING_TTS_MODEL | Configured in Preview with tested IDs below. |
| Voices | ONBOARDING_TTS_VOICE=sarah, ONBOARDING_ALLOWED_VOICES=sarah,brian | Configured in Preview. Both voices generated reusable MP3s in assets/. Server must allowlist the choice. |
| Supabase | https://supabase.com/dashboard/project/wyitdnwftdxlibdnldfe | Named aryaratan@himeera.com Developer membership verified live in the clean organization. URL and public anon configuration supplied in Preview. New schema/RLS and auth callback integration remain build tasks; this is not a fresh Arya app-login acceptance. |
| Google OAuth | Existing clean Supabase Google provider | Existing staging signup previously exercised. The standalone onboarding app currently only links to growth staging signup; it does not receive a verified session or save a profile. Wire this explicitly. Never copy production OAuth secrets. |
| Bot and spend controls | Existing Meera auth and Supabase | Sid explicitly chose no Cloudflare on 4 November. Replace the old Turnstile-dependent session route with verified Google/Supabase identity, shared atomic quotas, origin/CSRF checks and fail-closed provider access. Do not expose an anonymous paid endpoint. No Turnstile keys are needed for this approved design. |
| Google Docs | siddharth.nag@himeera.com | Local sanitized DOCX and PDF are ready. Native import requires the Google Drive plugin connection in this account. |

The required OpenRouter runtime secret, model/voice configuration and clean public Supabase bindings are in the protected Preview. Remaining integration and acceptance are explicit here; do not equate stored settings with a working funnel.

## Exact tested configuration

```text
ONBOARDING_STT_MODEL=openai/gpt-4o-mini-transcribe
ONBOARDING_LLM_MODEL=openai/gpt-4.1-mini
ONBOARDING_TTS_MODEL=elevenlabs/eleven-flash-v2.5
ONBOARDING_TTS_VOICE=sarah
ONBOARDING_ALLOWED_VOICES=sarah,brian
ONBOARDING_ALLOWED_ORIGIN=https://meera-onboarding-staging.vercel.app
ONBOARDING_SIGN_IN_URL=https://meera-growth-staging.vercel.app/sign-in
NEXT_PUBLIC_SUPABASE_URL=https://wyitdnwftdxlibdnldfe.supabase.co
```

Server-only secret: OPENROUTER_API_KEY. Public key: NEXT_PUBLIC_SUPABASE_ANON_KEY, role anon in project wyitdnwftdxlibdnldfe; RLS and verified identity are mandatory. The public anon key is not a service-role key. No service-role key is included or required for a proposed user-owned RLS design. If the chosen implementation needs privileged operations, request only clean staging credentials after reviewing the schema.

Do not leave the old Gemini Live session route active for this funnel after the OpenRouter replacement. Current reviewed application source eb93221838be0e2bd98e15906a9bf1b25984827b (documentation checkpoint d8a278b4769f1f7bf6ee1aaa00cbac6fb97ee99d) still uses Gemini and a five-minute session; credentials alone do not replace its implementation. Its standalone sign-in page explicitly has no database connection. The latest reviewed failed redeploy reported git_info_fail. Repair the Git source and build only the dedicated onboarding app; keep Vercel Authentication enabled. Keep the user in the existing Meera authenticated flow. If the separate staging origin is retained, implement verified session/callback transfer and owned save explicitly; a cross-origin sign-in link is not integration.

## Implement the simple experience

Use one screen and the supplied brief. Google signup happens first. Voice choice has two short previews, not a model/settings page. Start requests consent once. Reuse known Google name with an edit option. Collect work/study and DOB in at most two or three natural exchanges; derive age. Keep caste/community optional and skippable in final review. Explain its purpose before collecting it, and never infer it. Use one final Save and begin, resumable drafts, ownership checks and idempotent writes.

Measure Start -> successful saved-profile readback. Target 60 seconds and a path to finish by 90; measure Google signup separately. Do not force users to rush or lose answers at 90 seconds. Stop paid listening and offer typing or resume. Permission-dialog delays must be reported, not removed from a claimed end-to-end number.

Natural turns require microphone activity/end-of-speech detection, playback cancellation and stale-response invalidation; conversation.mjs is only the controller, not the full audio loop. Allow corrections without restarting. Server-verify identity before paid calls. Use same-site session protection and exact origin checks. Verify actual OAuth return/session transfer between separate origins; do not trust a query-string user ID or email.

## Lower cost without lowering the tested model quality

- Copy the fixed public MP3s into the app's static assets. assets/manifest.json maps each voice, prompt and filename. Preview.html lets you hear both voices offline. Fixed greetings/questions/review prompts need no fresh TTS call per user; personalize the visible text instead of regenerating every greeting.
- Use one structured extraction per spoken answer and extract every explicitly stated field together. Send only the current answer plus minimal missing-field context, not the growing transcript. Keep the tested models until a cheaper candidate wins equivalent speech/name/date tests.
- Reuse the cached question while extracting the previous answer only when safe; never ask for a fact already provided. Use dynamic TTS only for custom clarification. Validate browser codec support; WAV/MP3 or verified WebM/M4A with conversion as needed.
- Enforce shared per-account/session and IP limits before provider calls. Six ordinary extraction turns plus a bounded retry allowance is an initial implementation ceiling, not proven optimal. At 90 seconds offer text/resume. Prove actual 429, global $10 cap and a kill switch; logging-only Vercel rules are insufficient. The existing clean staging database can hold atomic quotas without buying a rate-limit upgrade.
- Budget for every charged operation and retry, not only LLM tokens. TTS requires separate request-cost reconciliation. The full human-session cost is not yet measured. Do not publish an invented cents-per-session promise.

## Use and verify this starter

Node 22. From this repo:

```text
node --test tools/voice-onboarding/test.mjs tools/voice-onboarding/conversation-test.mjs
node tools/voice-onboarding/server.mjs
```

The local server is a mock/adapter experiment, not the deployed app. It does not contain Google OAuth or durable save. Adapt the modules into authenticated application routes; do not upload this server to Vercel as the product.

Acceptance: desktop Chrome, Android Chrome and iPhone Safari; English and Hindi/Hinglish; chosen voice persists across prompts; signup -> speech -> correction -> final save -> reload; denied mic still finishes by text; skip sensitive fields; provider error; duplicate save; cross-user denial; real 429; microphone released on exit. Deliver PR, protected URL, two-minute technical evidence recording and a separate 60-90 second customer journey demo.

## Evidence limits

Eleven local test groups passed. Three synthetic live speech loops took 2.803-4.907 seconds to full buffered response. One extracted the synthetic name correctly; two follow-ups exposed spelling/script differences requiring review. These are not real-device completion timings. Twenty-eight fixed prompt/preview clips were generated for Sarah and Brian in English and Hindi. Their existence does not prove human voice preference or Hindi performance. Local implementation, code review and a real signup/save/reload remain required.

Official endpoint documentation:
https://openrouter.ai/docs/guides/overview/multimodal/stt
https://openrouter.ai/docs/guides/overview/multimodal/tts


Latest staging readiness: the paused clean database was resumed on its existing Free plan. Its auth health and settings endpoints both returned HTTP 200; Google is enabled and signup is allowed. The dashboard returned to the project overview. This is service readiness, not proof of a new full signup/profile save. No upgrade or production database was used.
