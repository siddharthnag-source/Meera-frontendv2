# US $99 lifetime sales audit — 25 October 2026

User-confirmed target: US customers buying $99 lifetime access. No ads were published, resumed, or given a higher budget during this audit.

## Critical blocker repaired and live verification

The authenticated US checkout button failed because the live Stripe account enables Managed Payments and rejects `custom_text`. The original API request reproduced that error. Removed that unsupported field while preserving Managed Payments, the $99 one-time price, payment ownership checks, and fulfillment rules.

Production deployment `dpl_FkkEbmmGvfwVH3sknz1aq475misS` is READY; resolving www.himeera.com through Vercel returned this deployment after promotion. Canonical source is `_deploy_meera_frontend`, branch `codex/bejb69csl-baseline`, project `meera-frontendv2` (`prj_vcwkcVasl0IHsZaNuCqNF362AN5Y`, team `team_GElsejSOv3JCiuXlZNgvnGT5`). V1.1.1 remains the stable recovery reference.

After reloading production, the QA account clicked Subscribe → International/USD → Get lifetime access. Stripe Checkout opened successfully. Selecting USD showed Meera Lifetime, one-time access, subtotal and total due $99.00 before billing-address entry. Stripe initially offered local currency because the testing browser is in India; this is not a US-location test. No card details or payment were submitted. Evidence: `verification/us-checkout-fixed-2026-10-25.png`.

Validation: 16 focused Node tests passed across sales-checkout, meta-pixel and marketing-integration; TypeScript noEmit passed; Vercel production build passed (49 pages). Staged homepage returned 200 and checkout rejected unauthenticated requests with 401. The broader staged HTTP script was interrupted after its homepage check; its full suite was NOT rerun successfully for this release. Earlier handoff test totals belong to the earlier release.

## Instagram boosts: fresh observed results

| Boost | Status | Spend | Views | Website visits | Link clicks |
| --- | --- | ---: | ---: | ---: | ---: |
| Founder video | Completed Oct 25 | $2.89 / $3 | 10,153 | 546 | 644 |
| Meera remembers you | Paused | $1.85 / $21 | 6,407 | 174 | 636 |
| Sum of these two boosts | Neither running | $4.74 | 16,560 | 720 | 1,280 |

Totals are not unique people and do not represent purchases. Audience name was “US | Adults 18–34 | Meera intro”, but actual delivery locations were Indian states. Founder video: Maharashtra 12.6%, Karnataka 12.5%, Tamil Nadu 9.2%, West Bengal 7.7%, Kerala 7.2%. Static creative: Uttar Pradesh 15.6%, Maharashtra 9.5%, West Bengal 7.4%. An audience label is not evidence of US targeting.

Evidence: `verification/instagram-boost-results-2026-10-25.png` and `verification/instagram-paused-boost-geography-2026-10-25.png`.

The Instagram identity reached correct ad account `1628584825378260`, business Meera Labs Inc `1093693949700802`. Ads Manager then returned table/API loading errors. This is no longer the earlier login/account-access issue. Current performance of separate campaign `52551687836258` remains unverified. Its saved Oct 23 configuration was $19 lifetime, US 18+, ending Oct 30 at 02:52 IST, Sales objective but landing-page-view optimization. Do not interpret the failed table as zero campaigns or all ads stopped.

## First-party funnel and pixel

Read-only database snapshot at 2026-10-25 10:01:03 UTC, since Oct 22 00:00 IST, excluding the marketing QA profile: 24 new profiles; 30 payment-page-open events across 10 users; 11 registration-claim events across 11 users. One paid Cashfree payment of INR499; zero USD payments. These are all-source counts, not ad-attributed acquisitions. No campaign-attributed purchase was confirmed. The registered US campaign link had zero captured clicks/signups at that snapshot; recent tracking cannot reconstruct older visits.

Dataset `933654956266333`: Today showed 406 PageView and 3 CompleteRegistration events, both Active, with no active diagnostics errors. Counts include all sources and potentially QA. Core Setup restriction remains “Health and wellness - other”; preserve counts-only commerce events and do not add restricted value/custom parameters. CAPI remains unconfigured. Stripe webhook is enabled and the account can accept charges/payouts.

Paid fulfillment and a real Meta Purchase receipt are still unverified end-to-end. An open checkout, passing route tests, or active PageView does not establish a successful sale. QA checkout sessions must be excluded from conversion analysis.

## Priorities for Arya

1. Confirm actual United States location controls and geography breakdown for the separate campaign once Meta's table recovers. Keep the India-delivering boosts off for the US goal. Use the existing budget cap; review any new spend separately.
2. Run one legitimate completed $99 purchase, then reconcile the Stripe payment, payment row, lifetime access, confirmation return, and deduplicated Meta Purchase receipt. Never manufacture a paid conversion or infer fulfillment from checkout creation.
3. Verify whether Purchase is usable as the campaign optimization event under the dataset restrictions. The inspected boosts optimize website visits; the saved separate campaign optimizes landing-page views. Neither establishes purchase optimization.
4. Put the $99 one-time offer and a concrete product demonstration before Google signup, and preserve purchase intent through authentication. The current generic sign-in page does not show $99 above the fold; public pricing leads with India pricing. This copy/flow improvement is proposed, not deployed in this repair.
5. Address Instagram's embedded-browser friction: Google login currently asks users to open Safari/Chrome. Measure that drop-off; an alternate sign-in method needs a scoped implementation and verification.
6. Give every creative a distinct registered link. Existing US link: https://www.himeera.com/r/meta-us-lifetime-99-oct2026 . Reconcile spend → visits → attributed new signups → checkout → paid USD customers by aligned timezone. Judge the campaign by paid customers and acquisition cost, not cheap clicks.

Earlier performance optimization reduced homepage first-load JS from 768 kB to 262 kB. The earlier PageSpeed report had no field data and unscored LCP/TBT, so Core Web Vitals are not proven. Existing dependency advisories remain a separate engineering follow-up in the original handoff.

No message was sent to Arya. Forward this addendum with the original handoff; the old PDF alone is incomplete.
