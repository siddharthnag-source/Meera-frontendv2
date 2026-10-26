# Arya independent staging workflow

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

The OAuth fix deployed as `dpl_E7KiGBweWUh89okFb9khncrqZL1Z`; remote build/type validation generated 50 pages, and returning Google sign-in retained `/payment?offer=us-lifetime` and USD 99. Earlier sandbox success, webhook replay, one-row reconciliation, paid reload, refund/revocation and completion-after-refund checks passed.

Workbench source tests, scoped lint and local TypeScript passed. A staging workbench deployment exists, but its clean-project schema and actual authenticated operator/kill-switch behavior remain unverified because browser control failed and Supabase tools have not appeared. A fresh marketing cloud branch/PR exercise, mobile/cancel/decline coverage, named service membership and production aggregate reporting remain unaccepted. AI activation has not been configured or tested. Do not describe independent operation as A++ until the applicable gates are demonstrated.
