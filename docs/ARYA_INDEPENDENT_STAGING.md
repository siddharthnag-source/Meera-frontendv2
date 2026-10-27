# Arya independent staging workflow

## Latest checkpoint — 27 October 2026

Production Vercel settings were inspected in the signed-in dashboard after the previous interrupted chat. The service-role database key, Google client secret, NextAuth secret and public Gemini key are now scoped to Production only. Clean public Supabase bindings and sandbox/disabled commerce settings exist separately for pre-production. This verifies current settings, not removal from historical deployments; keep Arya outside the production team and use the isolated resources below. The Vercel connector and local CLI currently deny the production scope; browser inspection succeeded.

Supabase Team and Stripe Team were freshly inspected: `aryaratan@himeera.com` still has pending Developer and Sandbox User invitations respectively. Do not send duplicates or describe either as accepted. An owner session cannot complete Arya's own MFA or cloud-development acceptance.

### Local frontend workflow without a Vercel seat

Use Node 22 and the existing lockfile dependencies. Copy `docs/ARYA_STAGING_CONFIG.example.json` to ignored `.env.arya-staging.local`, replacing the public anonymous JWT with the key from clean staging only. The config is JSON despite its `.local` extension. Then run:

```sh
npm run staging:check
npm run staging:dev
```

Open `http://127.0.0.1:3218`. An optional `-- --port 3220` changes the loopback port. The launcher accepts only the fixed clean database, a local optional backend, and Stripe test bindings; it clears inherited credentials and every detected dotenv binding before Next starts. AI, Meta Pixel/commerce and live payments remain off. It does not read Vercel credentials or start a deployment. It never falls back to the older `.env.growth-staging.local` file.

Public-only configuration permits frontend development; it does not enable privileged APIs, useful AI actions, sandbox checkout or full build/start. The latter require a clean staging service-role key because some server modules initialize database clients. Obtain it through the accepted staging Developer access, then add it only to the ignored config. For payments also supply the actual authorized sandbox's test secret and webhook secret together. Provider OAuth/webhook return URLs and sandbox access still need acceptance. Do not substitute production keys. `staging:build` and `staging:start` now stop before launching Next when the staging service-role key is missing.

Fresh checks passed: 45 focused source tests before the final launcher regression was added, plus all nine deployed public/auth/origin probes. The final launcher regression separately checks public configuration and blocked full builds without credentials. The earlier deployed 52-page build is historical; the new public-only local build was stopped during compilation and is not claimed successful. No production deployment, main merge, new paid service or AI request was made.

Independent operation still requires Arya's own accepted service invitations and cloud branch/PR exercise, actual sandbox access, a compliant hosted arrangement within the no-new-spend constraint if hosting is needed, and a separately reviewed production aggregate reporting release. Meta remains deferred by user choice.

The source provides isolated payment tests and a synthetic experiment workbench. Full operational acceptance is pending; this document is an engineering runbook, not the final accepted one-page handoff.

## Scope and identities

Use `marketing@getmeera.space` or `aryaratan@himeera.com` through Google. Arya owns growth and QA/reporting; Siddharth retains main merges and production release review. Meta access is explicitly pending. New billable AI services and increased spending remain off because no new cap was specified.

Canonical Windows development remains `_deploy_meera_frontend` on `codex/bejb69csl-baseline`. Authorized marketing cloud checkouts use `siddharthnag-source/Meera-frontendv2`, Node 22 and `codex/` branches with PR review. Fetch current main before starting. This review branch disables automatic Vercel deployments through its branch-specific configuration; keep that protection while the existing generic Preview still uses production services. Manual deployments must explicitly target the separate staging project and team.

## Resources

- Staging app: https://meera-growth-staging.vercel.app
- Workbench: https://meera-growth-staging.vercel.app/growth-staging
- Clean Supabase project: `wyitdnwftdxlibdnldfe`, organization `dffhogkjqszrepajjbqe`.
- Vercel staging project: `prj_uhUeO6es1hyLELFu2Zu4LIkGtK1h`, team `team_XgO6e3zkrdJNhcDZfaLqOFZR`.
- Production and old QA credentials/data are not development fixtures. The canonical production Vercel link must remain unchanged.

## Workbench initialization and acceptance

In the clean project only, review and apply `verification/growth-staging-workbench.sql`. It creates three tables with server-only grants and RLS, seeds the two named operator emails, and starts the readiness experiment disabled with zero allocation. A trigger serializes assignment/exposure writes against configuration changes so a committed kill switch rejects stale requests too. No production role or resource membership is granted by this SQL.

Sign in through Google, open the workbench, and reconcile its aggregate paid/refunded counts with the existing Stripe test payment and database. Enable the staging experiment, load the preview twice, and verify the same variant and one assignment/exposure. Disable it, refresh the preview and verify no new exposure. Re-enable only within an approved test window; leave it disabled after acceptance. Operator controls require an enabled named record and verified Google identity. Nonoperators cannot read totals or change settings; no profile, email or chat rows are returned by the report.

The fixed experiment is a mechanics test with 50/50 variants, not a live product treatment. Enrollment allocation controls only new assignments; existing assignments remain stable. Exposure means a preview was committed to the DOM, not proof of attention or an AI response. All data in this project is QA and must be excluded from production acquisition, revenue and Meta conversions. Real experiments still require a hypothesis, eligibility rule, activation definition, guardrails, sample/decision rule and release review.

## Repeatable validation

Run the supplied handoff `RUN_FUNNEL_CHECKS.mjs --project <canonical path> --origin https://meera-growth-staging.vercel.app`, or its explicit `--cloud` mode in an approved isolated checkout. The test files in this PR cover acquisition/privacy, checkout/fulfillment, permissions, sandbox boundaries, entitlement, OAuth lifecycle, stable allocation/exposure and the kill switch. The PR workflow uses Node 22, read-only repository permission and no deployment/payment/database secrets.

Source tests and CI do not replace browser OAuth/cancel/decline, real provider test-webhook receipts, database RLS/isolation or concurrent kill-switch checks. The synthetic schema and role proposals are not production migrations approved for rollout.

## Current evidence and remaining work

Checkpoint: 27 October 2026. Draft PR #3 contains review commit `1e2bb4a0669ab0d7b25d0b24eb4f8b1a41001940`; GitHub Actions run `40373148186` passed all 40 focused cases, route type generation, TypeScript and scoped ESLint. Staging deployment `dpl_EtbXfE23xopFsHLrbaNRgvitTq4i` built 52 pages and passed nine deployed public/origin checks. Returning Google sign-in retained `/payment?offer=us-lifetime` and USD 99. Earlier sandbox success, webhook replay, one-row reconciliation, paid reload, refund/revocation and completion-after-refund checks passed.

The reviewed workbench SQL was applied in the clean project through its SQL editor. Actual authenticated operator tests showed one stable control assignment and one exposure after repeated preview loads. Disabling the experiment returned the control fallback without recording a new exposure. Temporarily revoking the operator denied report access; the operator was restored. SQL verified RLS, denied direct anon/authenticated SELECT, service-role access and rejection of a stale exposure write while disabled. This was a transactional stale-write test, not a two-session concurrency test. The last verified experiment state is disabled, allocation 100%, with one historical assignment/exposure.

The security advisor showed zero errors and one leaked-password-protection warning. The setting requires Pro; no upgrade was purchased. Email authentication was disabled and Google remained enabled. The advisor has not been rerun since that change, so do not claim the warning cleared. Evidence is retained in the workspace handoff evidence directory.

At mobile width 390, the USD 99 paywall had no horizontal overflow, and cancelling Stripe Sandbox returned to `/payment?offer=us-lifetime&checkout=cancelled`. A second sandbox checkout was submitted with the decline test card under explicit approval, but its final result was not observed. Do not claim a decline, successful retry or fresh returning paid login; reconcile the existing checkout before another submission. Its test session is `cs_test_a1tMIw75G5FuRssejzBblVtxTuVemT9yLtGHOZvdf3blJH9xjwpfh1RFA7`.

Later on 27 October, browser dashboard access to the correct clean project worked while Supabase connector project/advisor calls still returned permission denied. The security linter was rerun: zero errors, one leaked-password-protection warning and nine informational suggestions. Disabling Email auth did not clear the warning; no upgrade was purchased.

The existing test checkout above was reconciled through Stripe Workbench: unpaid, no amount received, `card_declined` / `generic_decline`. Its original hosted checkout was recovered and retried with the previously approved success test card at USD 99, saving payment information unchecked. It returned to the app, recorded exactly one paid row for that session alongside the earlier refund and showed Pro Activated. Explicit app sign-out followed by Google account selection for `marketing@getmeera.space` restored Pro Activated. No new checkout or live charge was created.

A separate synthetic experiment `concurrency_acceptance_20261027` was used for an overlapping two-session test. One transaction disabled it while holding its configuration row for 40 seconds; a writer launched during that hold failed with `P0001: Staging experiment is disabled` after commit. Final SQL showed both experiments disabled, zero assignments for the concurrency fixture and one historical readiness assignment. The readiness experiment stayed disabled throughout. This checks the disable-first ordering; no independent lock-monitor capture or reverse-ordering test is claimed. Nine deployed public/auth/origin checks passed again.

The clean staging organization's Team page showed exactly one existing owner and neither Arya email. App operator allowlisting is not service membership. No invitation was submitted. Browser control subsequently stalled with repeated timeouts; stop retrying the unresponsive browser until it recovers. Local screenshot evidence and the exact remaining plan are in the workspace's `output/facebook-ads-handoff` pack.

Remaining acceptance gates: a fresh cloud branch/PR exercise from Arya's marketing account, verified named service memberships and reviewed aggregate-only production reporting. AI activation remains unconfigured and requires approved isolated services and a cost cap. Meta stays pending by user choice. Full independent handoff remains provisional until the applicable account/release gates are demonstrated.
