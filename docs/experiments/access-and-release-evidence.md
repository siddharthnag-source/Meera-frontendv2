# Production ownership: access and release evidence

Observed 13 November 2026. This report contains no credentials, profile values, transcripts or recordings.

| Boundary | Evidence | Result |
|---|---|---|
| Production Vercel owner | Connected identity is `siddharth.nag@himeera.com`; project `prj_vcwkcVasl0IHsZaNuCqNF362AN5Y`, team `team_GElsejSOv3JCiuXlZNgvnGT5` | Read access verified; no password login was needed or claimed |
| Rollback reference | `dpl_7Bm3z1tz5Neq2Uu7x4wUrnns18gf`, READY, production | Preserved; not promoted |
| Actual live alias | `www.himeera.com` resolves to `dpl_BDezpxMkD4rFSxKMSsdX6AfNfboB` | Newer than the supplied reference |
| Live onboarding | Authenticated Vercel fetch of `https://www.himeera.com/onboarding` returned 404, “This page could not be found” | Production entry point currently broken |
| Source inventory | Rollback: 324 source paths; newer live release: 286 | All hashes recorded in the two source manifests |
| Source delta | New live release omits 42 onboarding paths (28 clips plus page/callback, APIs and libraries), while adding/changing monthly checkout, billing and legal paths | Restore onboarding while preserving the newer billing release; no blind main deployment or whole-release rollback |
| Source recovery | 185 rollback files match main; 44 additional files recovered by exact hash from existing local assets/source. 95 complete file bodies remain unavailable | Full source baseline NOT established |
| Vercel source API | Returned base64 content is truncated at 2,000 characters, with explicit `truncated: true` | Partial strings were rejected by hash checks and never accepted as source |
| Supabase | User reports Developer access for `aryaratan@himeera.com`; connector is not connected in this session | Live schema, experiment operator/reporting role and migrations unverified; no production DB changes |
| Week 7 | Google Drive connected as `aryaratan@himeera.com`; the native Week 7 document was found | Aggregate-only tracker status recorded for this handoff; no complete production source archive was found in accessible Drive searches |
| Devices | No real Android/iPhone or real microphone route supplied | Device gates unverified; synthetic tests do not substitute |

## Current decision

**HOLD pilot activation.** Repair and version the actual production source first, preserving monthly checkout; verify the real-device and onward journeys and confirm named measurement access. No production release, migration, allocation or rollback was executed by this change. The known-good reference remains available for a deliberate rollback after billing impact is reviewed.

The additive experiment implementation is on a separate draft branch based on the existing onboarding work. It is NOT a reconciled production build and must be ported/rebased onto the recovered production baseline. Branch automatic deployments are disabled. The baseline verifier fails closed on missing/different source and extra runtime files.

## Remaining execution

1. Obtain complete source for the current live release and the rollback reference; run `tools/verify-production-baseline.cjs` and version the reconciled baseline. Review payment/entitlement deltas before a release.
2. Port the experiment integration to the current Conversation/VoiceExperience and monthly checkout paths. The candidate includes text-workspace feedback and unpaid payment arrival; complete workspace voice coverage is a required measurement gate.
3. Confirm Supabase schema and operator identity, review/apply the additive migration, and test named reporting access. Do not use the owner Vercel identity as an implicit app analytics grant.
4. Prove the 40 acceptance gates, including actual devices and response paths. Verify provider cap/remaining allowance/expiry without exposing or moving the key.
5. Deploy instrumentation dark from the verified baseline, check live guards/rollback, then activate the bounded pilot. Export only aggregate counters/timings to Week 7 and evaluate matured 24-hour outcomes.

## Candidate verification (local, not pilot results)

- 52 Node tests passed, including existing onboarding checks and experiment API/privacy/decision checks.
- Six groups passed against a disposable PostgreSQL 16 instance, including concurrent enrollment/disable and ownership isolation.
- Two browser fixture variants passed at 390/1280px: visible exposure, denied-microphone fallback, no sensitive event values, and kill-switch draft preservation. Identity, provider and microphone were mocked.
- TypeScript checking and the isolated onboarding/experiment production build passed. This is not the unrecovered production build.
- Actual speech, desktop/device microphone behavior, Android Chrome, iPhone Safari, live two-account isolation, full workspace voice outcomes and monthly checkout acceptance remain unverified.
- Pilot sample, primary outcome and conversion results: not available; allocation has never been activated by this change. Recommendation: HOLD and complete the release/device gates.
