# Meera-owned Meta tracking release - 23 October 2026

Source: codex/bejb69csl-baseline, commit 32c5bd6. Canonical frontend and Vercel project IDs verified before promotion.

Production deployment dpl_GjzgkMYTc3XdbpZh33HVzD6qcn63 promoted to himeera.com from the tested production staging URL https://meera-frontendv2-re62dzfhd-ss-projects-147424ea.vercel.app.

Dataset 933654956266333 belongs to Meera Labs Inc. (1093693949700802), connected to ad account 1628584825378260. Replaces unknown-owner ID 1037759044913931. Domain allow list: himeera.com and subdomains. Category: Health & wellness - other; Core setup On. Automatic advanced matching, code-free event detection and optional CAPI connection remain off.

Checks passed: five focused Node tests; TypeScript noEmit; focused lint for all five changed TS/TSX files; Vercel production build Ready; staging and live homepage HTTP 200; live layout includes new pixel and CompleteRegistration and excludes old pixel; unauthenticated POST returns 401 with eligible:false. SQL unique-index concurrency test rolled back successfully, RLS/service-only insert policy preserved.

Standard Next lint is blocked by the existing @typescript-eslint/no-empty-function plugin configuration; the repository's existing ESLint 8 workaround passed with zero errors.

Runtime DOM confirms fbevents.js and the new dataset's signals/config script load. Events Manager has not yet displayed a received event in this session. No extra campaign or budget changes were made.

Follow-up live signup verification: marketing@getmeera.space did not exist in auth.users before the test. Completed normal Google signup through the live website at 2026-10-22 21:11:26 UTC (23 October IST). Email confirmed; the real callback created exactly one meta_registration_claimed row. Signed out and signed in again at 21:12:32 UTC; the count remained exactly one. No synthetic Meta event was injected. This is internal QA, not a campaign-acquired signup, and must be excluded from acquisition results. Events Manager date range corrected to 23 October Asia/Kolkata; Diagnostics says no active errors. Meta receipt of PageView and CompleteRegistration is still unverified, despite successful live first-party signup/duplicate checks.
