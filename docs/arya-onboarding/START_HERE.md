# Arya onboarding handoff

Start with [the one-page brief](Brief.pdf), then [the access and build checklist](../../tools/voice-onboarding/ACCESS_AND_BUILD_CHECKLIST.md). Use [CODEX_PROMPT.md](../../tools/voice-onboarding/CODEX_PROMPT.md) in the approved cloud checkout. Download the branch to hear both voices with tools/voice-onboarding/Preview.html.

This handoff targets 60 seconds from Start to saved profile and a 90-second completion path, using the existing Meera stack and no Cloudflare. The OpenRouter runtime key is already a Preview-only Secret in the dedicated onboarding project. See the checklist for exact resource identities, environment bindings, test limits and remaining integration. Secrets are never included in this folder or the pack.

The controller and provider adapters are supplied; they are not the integrated app. Arya still owns implementation, authenticated persistence, the protected staging rebuild and real-device acceptance. Production release stays with Sid.
