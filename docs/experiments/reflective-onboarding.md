# Three-question voice onboarding

After the Google session loads, attempt the first spoken prompt immediately. Speech recognition starts after each prompt. Autoplay or microphone restrictions show a visible tap-to-begin or keyboard fallback; no promise to bypass browser permission is made. There is no DOB, profession, phone or demographic form.

1. What has been weighing on you lately, if anything?
2. When did you last feel moved enough to cry, if you feel comfortable sharing?
3. When things feel difficult, what helps you feel understood?

Every question can be skipped, including the whole flow. Final recognition advances automatically after a short correction window. The user can correct the last recognized text before advancing. Hindi/Hinglish prompts are available through the language selector. Native browser speech voices replace the old demographic recordings; no new provider key, paid request or spend increase is needed by this flow. Voice quality and recognition service depend on the browser/device.

Emotional answers remain in the current page only and are cleared as the question advances. They are not written to profile fields, analytics, URLs or browser storage. The browser's recognition service may process speech. Completion writes only the existing profile and completion marker, then verifies a fresh read before navigating. A failed save offers retry or explicit continuation without saving; it never claims completion was saved. All capture is aborted on skip, correction, hidden page, account change and unmount.

The real workspace receives only `welcome=onboarding`, which renders a static Meera greeting without transferring disclosures or changing subscription/checkout behavior. The isolated preview contains onboarding and a clearly labeled welcome handoff into the actual workspace; it does not recreate the entire production chatbot. The welcome integration in the main Conversation component takes effect when that code is released.

Validation: TypeScript and isolated build passed; four mocked browser groups passed (voice, denied recognition, blocked autoplay, save failure). Actual desktop/Android/iPhone microphone acceptance and Google callback acceptance on the new preview host remain unverified. No customer experiment is activated: the previous typed-first comparison is superseded, not reused for this different flow. The production source reconciliation requirement remains in force.

## Preview release evidence

Source commit: `158a9df`. Development project: `prj_h2wZ6OUirvZULBfLmVXeGxNmS5I9`, marketing team `team_XgO6e3zkrdJNhcDZfaLqOFZR`. Preview deployment: `dpl_pX3pixdpULKWdMdyvMCxXqwWKr2i`, host `meera-onboarding-staging-jorly0njv-marketing-1785.vercel.app`. Authenticated Vercel fetch returned HTTP 200 for `/onboarding` with the new flow and `/chat` with the welcome plus explicit preview handoff label. A 24-hour deployment-specific share link was created; its bypass value is not committed. Production domains, database, experiment allocation and provider keys were unchanged.

## Logo and public-access release

Source `4f835fc` replaces the improvised brand dot with the bundled `/icons/meera.svg` orb and a properly aligned wordmark. Added a quiet background wash, orb outline and three-step progress indicator; reduced-motion preferences are respected. Isolated build and all four mocked browser groups passed again. Development deployment `dpl_12YPxp9EpdZj1CJzij46NzXjYU3F` serves the updated onboarding with HTTP 200 and the bundled logo reference.

Automatic approval review rejected both changing project-wide production SSO protection and creating a non-expiring deployment share link, citing insufficient explicit authorization for permanent access. No protection settings changed. A 24-hour deployment-specific share link was created instead; its bypass value is not committed. Permanent public access remains pending explicit user approval. Production himeera domains, customer experiment allocation and secrets remain unchanged.
