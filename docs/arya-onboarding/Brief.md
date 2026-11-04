# Meera voice onboarding brief for Arya

From Sid to Arya  |  4 November 2026  |  Build in 24 hours after access is ready

Build a warm welcome that feels like a conversation. Target 60 seconds from Start to saved profile, with a 90 second completion path. Keep the existing Meera Google signup before it. The user chooses a voice, speaks naturally, reviews once and enters Meera.

## One screen and three moments

CHOOSE  0 to 8 seconds
Show two voice previews, Sarah and Brian, with Sarah selected. Offer English or Hindi and Hinglish. One Start button asks for microphone consent; typing and Skip are always visible.

TALK  8 to 50 seconds
“Welcome to Meera. What fills most of your day?” Use the Google name and let the user change it. Ask for DOB and derive age. Accept several facts in one answer; ask only for missing details. Keep caste or community voluntary and skippable in review. Show answers appearing as the user speaks.

REVIEW  50 to 60 seconds
“Here is what I have. You can change anything.” One editable card, one Save and begin button. Save to the verified account and open the first Meera conversation. Allow corrections through 90 seconds; then offer Finish by typing or Continue later without losing the draft.

## Make it feel effortless

Keep prompts short and use one consistent voice. Listen automatically after each prompt, stop playback on interruption and discard stale replies. No record button for every answer, repeated confirmations or forced countdown. Resume incomplete profiles; completed users bypass setup. Preserve purchase and connector returns.

## Keep quality and reduce cost

Keep the tested stack: GPT 4o mini transcribe, GPT 4.1 mini extraction and Eleven Flash v2.5 speech. Reuse the supplied audio clips for fixed questions and previews; generate speech only for a necessary custom clarification. Extract all stated facts together, never resend the full transcript, and limit retries. The $10 staging key has no reset and expires 11 November. Measure real cost per completion before setting a smaller per session allowance.

## What you receive and what proves completion

The developer pack includes source adapters, two voice sets, exact model IDs, configuration names, tests and a service access checklist. Repository Write and marketing Vercel Owner access are verified. Final credential availability is listed in the checklist; missing bindings must be resolved before a live release.

Deliver a PR, protected staging link and 90 second demo: Google signup, voice choice, spoken answers, correction, Save, reload with matching values. Test mobile, Hindi and Hinglish, microphone denial, provider failure, skips and account isolation. Use existing Google and Supabase auth plus shared quotas; no Cloudflare or new service. Keep audio transient and secrets server side. Production release stays with Sid.

Evidence  Eleven local test groups pass. Live synthetic speech loops took 2.8 to 4.9 seconds; name spelling and script still need review. Two voices and fixed prompts were generated. Human completion time, full OAuth and profile persistence are acceptance gates, not yet proven results.