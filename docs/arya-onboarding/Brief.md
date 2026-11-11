# Meera voice onboarding execution brief

Arya  |  From Sid  |  4 November 2026  |  Staging MVP within 24 hours

Decision  Replace Google Gemini voice inference with OpenRouter. Keep Meera's Google sign-in and existing Supabase stack. Use Codex to build; add no Cloudflare or new service.

## The experience

Target a warm welcome in 60 seconds, with a 90 second path for corrections. Measure Start to saved profile and Google signup separately. One screen, a natural conversation and one final confirmation.

Choose  Offer Sarah and Brian with short previews, Sarah selected. English or Hindi and Hinglish. Start asks for microphone consent once; typing stays available.

Talk  Welcome to Meera. What fills most of your day? Reuse the Google name, with an edit option. Collect work or study and DOB; derive age. Accept several facts together and ask only for missing details. Show answers appearing as the user speaks. Keep caste or community voluntary and skippable in review.

Review  One editable profile card and one Save and begin button. Save to the verified account, then open Meera. Support interruptions and corrections without restarting. At 90 seconds, offer typing or resume; never discard the draft or rush the user.

## Build on what is ready

Replace the old Gemini and Turnstile route with authenticated Next.js routes, verified Supabase identity, origin checks and shared quotas before paid calls. Add owned drafts, stale-write protection, idempotent save and readback. Preserve purchase and connector returns; completed users bypass setup.

Runtime models  openai/gpt-4o-mini-transcribe for speech recognition; openai/gpt-4.1-mini for extraction; elevenlabs/eleven-flash-v2.5 for speech. Keep the selected sarah or brian voice throughout.

Access  Use marketing@getmeera.space for Codex and Vercel; aryaratan@himeera.com for Supabase. Repository Write and service memberships are verified. meera-onboarding-staging / Preview holds OPENROUTER_API_KEY, model and voice settings, and clean public database bindings. Key limit: $10 total, no reset, expiry 11 November. Rebuild to use the settings.

Open: source and supplied assets  |  staging configuration  |  clean database

## Keep cost low and quality intact

Reuse the 28 English and Hindi clips for fixed prompts and previews. Generate custom speech only for clarification. Extract all stated facts in one bounded call per answer, with minimal context. Limit retries, enforce quotas, keep audio transient and secrets server side. Measure cost per completed session before reducing the allowance.

## Deliver and prove it

Return a PR, protected staging link and 60 to 90 second customer demo: Google signup, voice choice, speech, correction, save and matching values after reload. Test mobile, English and Hindi or Hinglish, denied microphone, provider failure, skipped fields, duplicate save, account isolation and a real 429. Work on a codex/ branch; production release stays with Sid.

Evidence  Eleven local test groups pass; synthetic speech loops took 2.8 to 4.9 seconds. Human completion time, natural interruptions, spelling, OAuth and saved profiles still need acceptance.

Source and assets: https://github.com/siddharthnag-source/Meera-frontendv2/tree/codex/arya-independent-staging/tools/voice-onboarding

Staging configuration: https://vercel.com/marketing-1785/meera-onboarding-staging/settings/environment-variables

Clean database: https://supabase.com/dashboard/project/wyitdnwftdxlibdnldfe
