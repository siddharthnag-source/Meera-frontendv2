# US sales release — 26 October 2026

This update supersedes the proposed website changes and account-access uncertainty in the October 25 sales audit.

## Published website

Production: `dpl_5YBw8GJt9mRJKc5ZNVTnzvoTcyQS`, verified by resolving www.himeera.com after promotion. Built from the canonical `_deploy_meera_frontend` on `codex/bejb69csl-baseline`; V1.1.1 remains the stable recovery reference.

- `/sign-in?offer=us-lifetime` displays $99 one-time lifetime access, included capabilities, Stripe checkout, and refund policy before authentication.
- The existing registered Meta campaign tuple also activates the US offer, so its current destination gains the offer presentation without an ad edit.
- Google sign-in preserves this fixed internal purchase destination for 30 minutes. Ordinary sign-in clears old purchase intent. No arbitrary return URL is accepted.
- Explicit US purchase intent opens the USD paywall for unpaid legacy accounts as well as new accounts. Already-paid accounts retain normal access.
- Stripe cancellation returns to the US offer. Account lookup errors show a retry/support screen.
- Pricing includes a dedicated US$99 purchase link.

Live browser verification reached `/payment?offer=us-lifetime` with International/USD selected and the US$99 checkout button. The subsequent checkout-click verification was interrupted; do not claim a new successful Stripe navigation for this release. The prior checkout repair did open live Stripe at $99 without charging.

Validation: 18 purchase-intent, checkout, marketing and pixel tests passed; 3 additional mocked fulfillment tests passed. These establish idempotency, refund preservation, ownership/amount checks, rejection of unpaid/sandbox production grants, and persistence errors. TypeScript noEmit passed. Vercel production build passed with 49 pages. Protected staging HTTP checks passed checkout 401, unsigned webhook 400, payment page 200 and sign-in 200. Query-specific offer copy was verified after hydration in the browser, including a 390px mobile screenshot. The full older HTTP script was not completed; a local PowerShell out-of-memory crash interrupted it.

## Meta account and draft state

The in-app browser reached the correct Instagram-linked account `1628584825378260`; no new login was required. Maximum reporting through Oct 26 showed active campaign `52551687836258`, 22 landing-page views at approximately $0.41 each. Actual audience control is United States, and campaign objective is Sales. Campaign budget is $19 lifetime, with explicit UI confirmation it will spend no more than $19. The optimization goal is landing-page views and is locked on the published ad set.

A duplicate ad set `52552196394658` with ad `52552196394858` was created as an unpublished draft inside that campaign. Conversion optimization, company pixel `933654956266333`, and Purchase were selected. Meta rejected mixing optimization goals in this campaign: error `#1885760`. Initiate checkout is now listed as Active; Purchase was listed as Inactive and selectable. No real Purchase receipt has been established.

Duplication into a separate Sales campaign named `Meera | US | $99 lifetime | Purchase | Oct 26` was submitted. The UI showed duplication in progress; creation, IDs and resulting settings have NOT been verified. Browser control was subsequently disabled in Work settings. No replacement was published, no original campaign was paused, and no budget was increased.

## Required continuation

1. Re-enable browser use in Work settings, inspect the in-app Meta tab, and reconcile both drafts before creating anything else. Do not publish the incompatible draft.
2. Read exact spend on the original campaign and pause/reallocate only after a concrete replacement is ready. A new campaign must use the unspent remainder of the existing $19 cap; never duplicate the full budget on top of existing spend.
3. Confirm Purchase eligibility and understand its inactive status. Do not fabricate events to activate it. Verify product destination, offer copy, country, dataset, schedule and final total budget in preview before publishing.
4. Complete one legitimate payment and reconcile Stripe, payment persistence, lifetime access, and Meta Purchase receipt. No charge was made in this work. A live payment remains required to prove full fulfillment.
5. Embedded Instagram Google-login friction and CAPI remain unresolved. Browser guards are intentional and should not be disabled to bypass Google's restrictions.

Evidence: `verification/us-sales-mobile-2026-10-25.png` and `verification/us-purchase-intent-live-2026-10-26.png` (both saved successfully). Earlier PDF alone is incomplete. No message was sent to Arya.
