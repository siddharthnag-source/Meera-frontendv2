# Repeatable experiment checks

All commands run against local fixtures. None grant production access or count as real-device acceptance.

1. `node --test verification/experiments/*.test.cjs` checks privacy, eligibility API boundaries, operator controls, provider-budget validation, small-sample decisions and source-release gates.
2. Start a disposable local PostgreSQL 16 container (no production credentials or exposed port):

   ```sh
   docker --host=unix:///var/run/docker.sock run --rm -d --name meera-experiment-db -e POSTGRES_PASSWORD=local-fixture-only postgres:16-alpine@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663
   python3 verification/experiments/postgres-onboarding.py
   docker --host=unix:///var/run/docker.sock stop meera-experiment-db
   ```

   The harness creates and drops a uniquely named database inside that local container. It proves actual PostgreSQL grants, CAS controls, assignment stability, bounded concurrent enrollment, stale-exposure rejection during a concurrent disable, owned/idempotent events, server-derived save timestamps and QA separation. Its evidence references are explicitly synthetic and never sent to production.
3. For UI fixtures, prepare the isolated source with `node tools/package-onboarding-staging.cjs`, use only dummy public Supabase settings and build with `NEXT_PUBLIC_ONBOARDING_EXPERIMENT_UI=true`. Serve it on loopback port 3231 and run `node verification/experiments/browser.cjs`. The harness mocks Google identity, assignments and microphone denial. It checks visible-before-exposure timing, mode presentation, typed fallback, privacy and kill-switch draft preservation at mobile/desktop widths. It does not prove actual Android, Safari, speech quality or paid/provider behavior.
4. `node tools/verify-production-baseline.cjs <full-recovered-source> docs/experiments/current-production-source.json` must pass before a production release baseline is accepted. Also reconcile restored onboarding against `rollback-production-source.json` and review billing/legal deltas. Missing or truncated source is not an acceptable baseline.

Default-off controls:

- `NEXT_PUBLIC_ONBOARDING_EXPERIMENT_UI` is absent/false by default: no experimental UI or client enrollment requests.
- `ONBOARDING_EXPERIMENT_READY` is absent/false by default: server does not enroll users.
- The SQL configuration starts with allocation disabled. Named operator access is a separate, initially empty table; account email or Vercel ownership is not an app authorization grant.
- Activation requires all 40 evidence gates and a live read of the existing OpenRouter key's cap, remaining allowance, reset and expiry. Disabling does not depend on provider availability.
- The SQL migration is additive and has not been applied in production. The actual live schema must be verified before application.

The current candidate still needs porting to the reconciled production Conversation/VoiceExperience and monthly checkout source. Voice-workspace outcome coverage and live entitlement/onward acceptance are explicit activation gates.
