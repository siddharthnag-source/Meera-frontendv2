# Updated product direction

This update supersedes the earlier tap-to-record and per-answer-confirmation recommendations for the target experience. Those remain fallback controls only. The new one-page brief in the handoff package is the product direction.

Aim for one user gesture and microphone consent, automatic end-of-speech detection, consistent warm voice, interruptions, multi-fact answers, corrections without restarting, live profile preview, and one final explicit confirmation. Do not infer optional sensitive fields. State validation and authenticated persistence remain mandatory.

conversation.mjs is a separately tested conversation controller, not an integrated microphone/LLM loop. It takes already extracted facts and tests the application's handling of them. Interruption tests verify stale-response invalidation; they do not test acoustic interruption detection. Integrate audio activity detection, playback cancellation, extraction, verified auth and persistence into Arya's existing app before claiming the experience works.

Run local checks: node --test tools/voice-onboarding/test.mjs tools/voice-onboarding/conversation-test.mjs

Eleven test groups passed on 4 November 2026. Existing browser evidence is for the earlier typed prototype. The new natural speech interaction has not been browser tested.

live-probe.mjs is prepared for an approved capped staging key and supported voice. It makes four paid calls: synthetic-input TTS, STT, field extraction and response TTS. It records latency, but account activity must be reconciled for cost. Synthetic generated audio is not evidence of human speech quality, Hindi/Hinglish performance, microphone UX, OAuth or database save.

Latest status: browser access now works. Sid approved $10 total and confirmed the funded OpenRouter identity. A capped key was created and synthetic live speech tests ran. See verification/voice-onboarding/FINAL_REVIEW_2026_11_04.md for results, costs and the remaining staging/OAuth/persistence gates. Keep credentials out of the handoff.
