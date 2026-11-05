# Arya: voice onboarding starter and 24-hour build brief

Prepared 4 November 2026 (IST). This pack is an executable local experiment plus an integration brief. It is NOT a deployed onboarding funnel. No production code path is changed.

## Current product brief

Sid requests a 60-90 second warm onboarding with two voice choices and the existing Meera stack, without Cloudflare or an extra provider. Read CODEX_PROMPT.md and ACCESS_AND_BUILD_CHECKLIST.md first; they supersede historical instructions below. The capped runtime key and model/voice/public database bindings are installed in the dedicated project Preview.

## Current status

Read HER_EXPERIENCE_UPDATE.md and verification/voice-onboarding/FINAL_REVIEW_2026_11_04.md first. They supersede the historical budget/browser status and tap-to-speak target below. A $10 capped staging key and synthetic live voice proof now exist; human/device, deployed auth and persistence acceptance remain open.

## Decision

Use Codex to implement and test the feature in your existing Next.js app. Use OpenRouter for runtime speech recognition, answer extraction and speech synthesis. Keep Google OAuth for identity. A Codex subscription is the development tool, not a substitute for runtime API credentials and usage funding.

For day one, use short, turn-based recordings (tap to speak / stop), one question at a time, with typing always available. This is achievable with ordinary HTTP routes. Continuous full-duplex speech, interruption detection, natural turn-taking and a LiveKit worker are a later iteration; don't promise Gemini Live parity from this starter.

Flow: Google signup -> verified session -> new/incomplete profile -> explanation and microphone consent -> name -> job details -> DOB -> optional caste/community -> editable review -> explicit save -> existing intended destination. Returning completed users bypass onboarding. Derive age from DOB; don't store a second drifting age. If the user gives age alone, clarify or allow skipping DOB.

## What Arya's email actually requests

Read the complete four-message “Product & Growth Call Updated” thread, including both screenshots attached on 3 November at 22:30 IST. The screenshots ask for:

- GEMINI_API_KEY and GEMINI_ONBOARDING_MODEL for a Gemini Live staging model.
- NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, with meera-onboarding-staging.vercel.app allowed.
- Google Cloud budget alerts and API quotas (correctly warning that alerts do not stop spending).
- An enforced POST /api/onboarding/session limit of 10 requests/minute/IP. The screenshot says the current Vercel rule only logs and plan enforcement was rejected.
- A rebuilt preview, real voice and Google-signup testing, with Vercel Authentication retained.

Replace the two Gemini variables and Google inference budget with a capped staging OpenRouter key and explicit STT/LLM/TTS model selection. Turnstile, real rate enforcement, OAuth and provider tests still matter. Google OAuth credentials may still be needed; Google inference credentials are not.

The 28 October email confirms Arya accepted the Supabase invitation. The 23 October thread says Codex was available on marketing@getmeera.space. These are email evidence, not a fresh test of account permissions. Arya's actual onboarding branch was not available; Sid instructed us to proceed without it. Do not overwrite it with this prototype. Adapt the reusable modules to it.

## Run now, with no credentials or charges

Use Node 22+ from the canonical checkout or Arya's authorized cloud checkout:

```sh
node tools/voice-onboarding/server.mjs
# Open http://127.0.0.1:3231
node --test tools/voice-onboarding/test.mjs
```

The default UI says MOCK. It takes typed synthetic answers, confirms each one, permits corrections and skip, validates dates, derives age and explicitly reports that the profile was not saved. Sessions live in memory for 15 minutes and disappear on process exit. No dotenv files, OAuth, database, Vercel credentials, production secrets or inference calls are loaded. The HTTP server binds only to loopback and checks Host, Origin and an experiment token. Do not deploy this local server.

Files:
- core.mjs: profile validation, pending/confirmed state, correction and age calculation.
- openrouter.mjs: server-only STT, strict structured extraction and MP3 TTS adapters; no Google model IDs.
- server.mjs / index.html: local experiment with a real MediaRecorder path when configured, explicit consent and text fallback.
- test.mjs: five automated test groups, including a complete mock HTTP journey.
- browser-test.mjs: Chromium journey at 390 and 1280 pixels. Requires Playwright; set PLAYWRIGHT_PACKAGE_JSON to its installed package.json if outside this repo. BROWSER_CHANNEL defaults to msedge.

Limitations: English question copy; no real auth, durable storage, distributed limiter, automatic spoken next-turn playback, full-duplex interruption or resume after reload. The model adapter is contract-tested with mocks, not benchmarked against paid endpoints. These are explicit day-one integration tasks, not hidden completed features.

## Live experiment configuration

Provision a NEW staging OpenRouter key in the secret manager, with model restrictions and a hard credit/spend limit. Sid must choose the budget; no charge or subscription purchase was made here. Do not paste keys in chat, source, screenshots or NEXT_PUBLIC variables. The only public voice-related key is the Turnstile site key.

Required server variables:

```text
OPENROUTER_API_KEY=<new capped staging key>
ONBOARDING_STT_MODEL=openai/gpt-4o-mini-transcribe
ONBOARDING_LLM_MODEL=openai/gpt-4.1-mini
ONBOARDING_TTS_MODEL=elevenlabs/eleven-flash-v2.5
ONBOARDING_TTS_VOICE=<voice ID supported by this exact model>
VOICE_EXPERIMENT_SPEND_APPROVED=true
```

Then `node tools/voice-onboarding/server.mjs --live`. The flag is an explicit local cost acknowledgement, not a dollar-budget enforcement mechanism. The starter caps provider requests at 100 per process and recordings at 20 seconds / 2 MB, but hosted staging needs shared counters and the provider spend cap. Choose the voice in OpenRouter's model playground; never assume an OpenAI voice name is valid for ElevenLabs.

These three model IDs were present in the public OpenRouter catalogs checked on 4 November. Availability on Arya's funded account and Hindi/Hinglish quality remain untested. Whisper large v3 is an alternate STT candidate. The documentation's gpt-4o-mini-tts example was absent from the queried speech catalog, so it is not the default here. Fetch `/api/v1/models?output_modalities=speech`, `/api/v1/models?output_modalities=transcription`, and the regular models catalog before enabling. API responses include usage/cost information for supported operations; measure cost per completed profile, including retries, rather than quoting an untested total.

## Existing Meera integration points

The canonical checkout uses src/lib/auth/startGoogleOAuth.ts with Supabase Google OAuth and /auth/callback. The callback preserves Google connector return destinations and purchase intent; preserve these priorities. Add onboarding eligibility only to the ordinary post-signup path, with a validated same-origin destination remembered for completion. Don't redirect every OAuth callback indiscriminately.

The existing src/lib/voice-engine.ts uses @google/genai. Keep the onboarding adapter separate rather than replacing Meera's general voice engine. src/types/settings.ts exposes name/email/core_memory, but no structured DOB/job/caste fields were located in this checkout. Inspect Arya's branch and actual staging schema before choosing the persistence mapping; do not invent columns on users or overwrite core_memory.

Create a versioned onboarding profile in clean staging if none exists: user_id bound to verified auth identity, name, job_details, dob, optional caste, per-field skipped status, consent version/time, schema version and completed_at. Store DOB as a date; calculate age for display. Preserve explicit skips across resume. Store drafts with a version to reject stale updates. Save final confirmation transactionally/idempotently; completion is only successful after a database readback. Never let a model supply user_id, completion permission or arbitrary SQL.

Use server-side verified users, RLS with ownership predicates, and cross-user denial tests. Audio is transient; don't persist recordings or transcripts by default. Send only the current answer and required field to the extractor. Caste is voluntary, skippable and never inferred from name, voice, accent or location; keep it out of analytics and marketing events. Clarify why it is useful before asking. Name can be a preferred display name. Define the product's age-eligibility behavior before rollout; do not invent a rule inside the model.

The documented clean staging database is wyitdnwftdxlibdnldfe, not the earlier odeqnorudbdiuhweuoqv QA resource. Local `npm run staging:check` currently reports frontend READY, privileged staging backend BLOCKED, AI OFF. Do not borrow production keys to pass acceptance. Arya's separate onboarding hostname/project must be verified in his account before configuring callbacks or deployment. Don't assume it is the same as meera-growth-staging.

## 24-hour execution schedule

| Elapsed | Work | Exit evidence |
|---|---|---|
| 0-2h | Open existing branch in Codex; inspect schema and endpoints; check staging identity, key cap, model/voice availability, OAuth redirect and Turnstile hostname | One STT and TTS smoke result with synthetic audio; no production bindings |
| 2-6h | Replace Gemini onboarding session with server-only OpenRouter adapters; add bounded per-turn extraction and confirmation | Recorded answer -> validated field -> spoken next question |
| 6-10h | Google callback eligibility, profile drafts, resume and idempotent final save | Fresh Google signup -> onboarding -> persisted profile; returning user skips |
| 10-14h | Mobile UI, automatic question playback after user gesture, stop/interrupt controls, text fallback, optional fields and review edits | Android Chrome and iPhone Safari manual runs; denied mic still completes |
| 14-18h | Shared rate limit and session quotas; Turnstile server verification; timeout/cost cap; kill switch | Actual 429 under parallel calls, 401 unauthenticated, cross-user denial, switch disables new calls |
| 18-22h | Run synthetic voice matrix, measure latency/cost and correct problems | Test sheet with actual pass/fail and timings, no fabricated results |
| 22-24h | Protected staging demo, recording, setup notes and PR against current main | Reviewable PR plus evidence; no main push, merge or production deployment |

If credentials are not ready in the first two hours, deliver the mock and form integration and state real voice acceptance blocked. Do not use missing keys as a reason to stop all coding. The 24-hour goal is a reviewable staging MVP, not an assurance of production readiness.

## Real acceptance matrix (still to run)

Use synthetic profiles and consenting testers, never customer recordings. Test at least 12 sessions: English, Hindi and mixed Hinglish; unusual names; corrections; ambiguity such as 03/04/2000; impossible/future DOB; age-only answer; optional caste refusal; microphone denial; silence/noisy audio; timeout/429; refresh/resume; double save; returning login; cross-user profile access. Test Chrome desktop, Android Chrome and iPhone Safari, including WebM vs MP4 capture and blocked autoplay. Assert no audio starts without user interaction, no background microphone remains active and typed fallback always works.

Targets, not measured claims: 100% confirmed saved values match the review; zero inferred sensitive fields; zero cross-user reads/writes; zero duplicate completions; at least 10/12 test sessions complete without engineer help; aim for median end-of-speech to response playback under 3 seconds and p95 under 6 seconds. Record failures honestly; tune models only after measuring. Track signup, consent, voice start, field confirmed (field name only), review, save success, fallback and first useful Meera interaction. Never send field values, DOB, caste, transcripts or recordings to marketing analytics. Compare completion and first useful interaction with the existing form in a later controlled experiment; a small staging test cannot establish a conversion uplift.

## Evidence from this build

- Five automated groups passed: date/age edge cases, confirmation/correction, invalid fields/types, mocked provider contract/errors, full HTTP journey including consent/CSRF/cancellation.
- Browser mock journey passed at 390 and 1280 pixels with no JavaScript errors or horizontal overflow. Screenshots and JSON are in verification/voice-onboarding.
- Public model catalogs fetched and selected candidates recorded there.
- Live provider calls, microphone quality, real OAuth, durable save, distributed rate limiting and deployed staging acceptance: NOT RUN / NOT VERIFIED.
- No email sent, remote branch pushed, production deployment, database mutation or paid inference performed.

## Sources

- Arya's email: https://mail.google.com/mail/u/0/#all/1a19fe36bbaae532
- Codex cloud development: https://learn.chatgpt.com/docs/cloud
- OpenRouter STT: https://openrouter.ai/docs/guides/overview/multimodal/stt
- OpenRouter TTS: https://openrouter.ai/docs/guides/overview/multimodal/tts
- Structured output: https://openrouter.ai/docs/guides/features/structured-outputs
- Spend controls: https://openrouter.ai/docs/guides/best-practices/spend-controls
- TTS candidate / voice selection: https://openrouter.ai/elevenlabs/eleven-flash-v2.5
