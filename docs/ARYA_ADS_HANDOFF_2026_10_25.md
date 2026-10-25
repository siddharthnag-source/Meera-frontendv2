# Meera ads and product handoff - 25 October 2026

> Updated sales audit: read [US sales audit and checkout repair](US_SALES_AUDIT_2026_10_25.md) first. It supersedes the older deployment and account-access status below. The earlier PDF does not include this addendum. Live US checkout failure was found and repaired after the tracking release.

## Release

Tracking repairs are published on https://www.himeera.com.

- Canonical source: `_deploy_meera_frontend`, branch `codex/bejb69csl-baseline`.
- Production release: `dpl_73sBZ17kGjZpqyvtgMsmuJvvGN5C`.
- Tested production staging URL: https://meera-frontendv2-e87wuvf7p-ss-projects-147424ea.vercel.app.
- Vercel project: `meera-frontendv2`, `prj_vcwkcVasl0IHsZaNuCqNF362AN5Y`, team `team_GElsejSOv3JCiuXlZNgvnGT5`.
- V 1.1.1 remains the user-designated stable recovery reference. Its frontend deployment is `dpl_GjzgkMYTc3XdbpZh33HVzD6qcn63`. This repair release does not redesignate the stable recovery version.

## Verified facts

Meta Events Manager, dataset `933654956266333`, owner Meera Labs Inc. `1093693949700802`, showed both PageView and Complete registration as Active, with 652 and 9 received events in the displayed 27 September - 24 October window. Diagnostics showed no active errors. Screenshots are in `verification/meta-events-received-2026-10-25.png` and `verification/meta-diagnostics-2026-10-25.png`.

These receipts resolve the previous audit's uncertainty. They are not nine campaign-acquired customers: the date window, attribution model, internal QA and reporting timezone must be reconciled before comparing Meta receipts with first-party signup claims.

The live dataset restriction detail lists Core Setup for Health and wellness - other. It does not list an additional standard-event restriction in the inspected detail. Custom parameters and URL details after the domain are restricted. Commerce therefore uses standard event names with empty parameter objects. No value, currency, product name, email, profile data or chat content is sent in the explicit commerce payload.

## What was fixed

1. `/r/[slug]` retains validated `fbclid`, other supported click IDs and optional creative tags. It rejects external destinations and uses no-store redirects. First-touch acquisition cookies are not overwritten by later growth links.
2. Home-to-sign-in navigation retains safe campaign/click parameters; private query fields are not propagated.
3. Campaign values support spaces, dots, parentheses and ordinary labels. Private routes, OAuth fragments, email values and unknown query fields remain excluded from pixel initialization.
4. Registered direct UTM visits are captured through a same-origin first-party endpoint. The visitor cannot create campaigns or choose another user's identity. Cookies are HttpOnly; capture is bounded and cannot block sign-in indefinitely.
5. New-account eligibility is required for both signup claims and signup attribution. Returning sign-ins cannot inflate new campaign signup counts.
6. A signup claim retry retrieves the same opaque event ID after a committed database write/timeout. Pending events survive SDK blocking and reload for up to 24 hours; Meta deduplicates retries by event ID. Browser submission is not an acknowledged Meta delivery receipt.
7. Checkout and purchase event payloads are generated from server-verified payment data. Cashfree order ownership/status/amount and Stripe session ownership plus recorded paid fulfillment are checked. Client amounts, client success flags, free/bypass payments and refunded statuses cannot fabricate purchases. Event IDs are deterministic hashes, not raw provider order IDs.
8. Paywall analytics derives identity from the bearer token rather than trusting client user_id. Arbitrary client metadata is no longer stored in that paywall event.
9. The public sign-in content renders while restoring the session; the confirmed-session redirect remains. Sign-in supports zoom, a page-specific canonical URL and stronger text contrast.
10. The chat engine loads when needed, reducing homepage first-load JS from 768 kB to 262 kB in the Vercel build report (about 66%). The Cashfree SDK loads only when the Indian checkout opens. The released app rendered its chat controls with no browser errors/warnings, and Cashfree was absent from the initial live DOM.

## Configuration

Production and preview Vercel environments have:

```
META_COMMERCE_ENABLED=true
META_COMMERCE_VALUE_ENABLED=false
```

Do not turn on value/custom-parameter sharing while the current restriction applies. CAPI is not configured; no Meta access token was created, retrieved or exposed. Browser blocking can still cause undercounting. CAPI would be a separate authenticated integration and must respect the same data restrictions and event-ID deduplication.

## Campaign link for Arya

https://www.himeera.com/r/meta-us-lifetime-99-oct2026

It points to `/sign-in` and uses:

| Field | Value |
| --- | --- |
| utm_source | meta |
| utm_medium | paid_social |
| utm_campaign | us_lifetime_99_oct2026 |

This matches the direct UTM configuration in the saved 23 October ad record. It was registered in growth_links during this repair. Future direct visits using this exact tuple are supported. The running ad itself was not edited; budgets and targeting were not changed. Earlier untracked visits cannot be reconstructed.

Create new campaign links in Meera Analytics > Links before new tests. Prefer the `/r/...` link, especially for per-creative tracking. Direct UTM capture requires a registered, active, unexpired tuple. If multiple links share a tuple, the oldest eligible link is used for a direct visit; use distinct tuples or explicit `/r/...` links to distinguish creatives.

## Validation

- 14 focused Node tests passed: redirect/query preservation, sensitive URL exclusion, blocked-SDK recovery, empty commerce parameters, direct capture, cross-origin rejection, returning-user exclusion, registration deduplication and payment validation.
- TypeScript noEmit passed.
- Targeted ESLint compatibility run passed on 24 changed source files with zero errors/warnings. The repository's default ESLint 9 / older TypeScript plugin incompatibility remains; the existing ESLint 8 compatibility runner was used.
- Vercel production build passed, all 49 static pages generated, staged before promotion.
- 14 staged HTTP checks passed, including auth gates, forged paywall identity rejection, unsigned webhook rejection, first-touch cookies, same-origin capture and click-ID preservation. Results: `verification/marketing-release-check-results.json`.
- One-hour runtime error scan returned no errors for the audited analytics/payment API routes.
- Live home and sign-in returned 200. Sample live sign-in TTFB was 0.220 s / total 0.228 s; home was 0.818 s / total 0.821 s. These are HTTP samples, not field Core Web Vitals.
- Final mobile PageSpeed report: https://pagespeed.web.dev/analysis/https-www-himeera-com-sign-in/xzz0j1h329?form_factor=mobile. Accessibility 100, Best Practices 100, SEO 100. Lab FCP 1.5 s, CLS 0, Speed Index 4.4 s. Performance score/LCP/TBT remain unscored with NO_LCP despite a visibly rendered landing hero in the report screenshot. No field data was available; do not claim a Core Web Vitals pass. Structured evidence is in `verification/marketing-mobile-audit-2026-10-25.json`.
- The local build worker stalled and was stopped; the successful Vercel build is the production build evidence.
- Build installation reported existing dependency audit warnings (15 advisories, including one critical). Dependency remediation was not bundled into this tracking release; it needs a separate scoped dependency review rather than an untested forced upgrade.

HTTP-only QA used the dedicated `internal-qa-ads-integration-20261025` link with source `internal_qa`. No new signup, synthetic Meta conversion, live charge or chat message was created by those HTTP checks. The QA link expires on 27 October. Exclude it from campaign acquisition reporting. The documented earlier marketing-account QA signup must also be excluded.

## Arya's operating checklist

1. Sign in to the Instagram identity with access to ad account `1628584825378260`. The available Facebook session can access the correct dataset but did not list this ad account; Instagram was signed out with no saved profile available. Current campaign delivery/spend/CPA/ROAS could not be independently inspected in this session.
2. Recheck actual ad destination, dataset, delivery goal, schedule and cap. The saved 23 October record says campaign `52551687836258`, ad set `52551687835858`, ad `52551687836058`, USD 19 lifetime budget, ending 30 October 2026 02:52 IST, landing-page-view optimization. Treat this as a historical configured baseline, not a fresh performance report.
3. Run the next genuine new-account signup through the registered link, mark QA appropriately, and reconcile one first-party attribution with the deduplicated CompleteRegistration receipt. Meta says received events may take up to 30 minutes to appear. A repeated sign-in must not add a signup attribution.
4. Check InitiateCheckout and Purchase receipts after the next legitimate payment. The code, auth gates and server validation passed; a new live charge was not made just to manufacture a conversion.
5. Keep a daily sheet: spend; impressions; link CTR; CPC; landing-page views; campaign-attributed new signups; activation; paid customers; INR revenue; USD revenue. Record the exact activation definition. Signup CPA = spend / attributed new signups; undefined if signups are zero.
6. Align exact reporting timestamps. The saved ad account configuration uses Asia/Kolkata; Meera dashboard date boundaries are UTC. Do not compare midnight-to-midnight counts across those timezones directly.
7. Do not scale or switch to purchase optimization on event receipt alone. Verify attribution, volume and usable conversions first. Do not evade restrictions by renaming restricted events.

## Engineering references

- Tests: `node --test verification/meta-pixel.test.cjs verification/marketing-integration.test.cjs`.
- HTTP checks: set MARKETING_TEST_URL to the exact deployment origin and VERCEL_CLI_PATH to the installed Vercel JavaScript entrypoint, then run `node verification/marketing-release-check.mjs`. The dedicated QA fixture must still be active/unexpired.
- Emergency commerce switch: set META_COMMERCE_ENABLED=false and deploy a new tested production build. Environment changes do not change an already-created deployment.
- Full frontend recovery: follow `V_1_1_1.md` in the workspace root. A frontend rollback does not remove the campaign registry rows or Vercel environment flags added here; record those separately if recovering.
- Forwardable artifact: `output/pdf/Meera-Ads-Handoff-for-Arya-2026-10-25.pdf`.

No email or message was sent to Arya, and no permissions were granted to another person. The PDF is ready for Siddharth to forward.
