# Ads integration audit — 25 October 2026

This is the initial audit. See `docs/ARYA_ADS_HANDOFF_2026_10_25.md` for the subsequent repairs, production release and verified Meta event receipts.

Scope: read-only audit of canonical frontend on `codex/bejb69csl-baseline`, live www.himeera.com, and aggregate production database records. No code, campaigns, budgets, database rows, or deployments changed. Audit artifacts added only.

## Verdict

Basic Meta installation and first-party signup deduplication work. Complete ad measurement is not verified and has attribution gaps. Current campaign performance cannot be assessed until Ads Manager is signed in.

## Confirmed

- Live DOM loads `fbevents.js` and Meta's signals/config script for pixel `933654956266333`. No browser errors/warnings were returned during the homepage check. Script loading does not prove event ingestion.
- Five existing `verification/meta-pixel.test.cjs` tests pass, covering initialization, registration eligibility, private URL exclusion, client deduplication, and endpoint authentication/deduplication.
- Production database has the unique partial index `analytics_meta_registration_once_idx` on user_id for meta_registration_claimed.
- Aggregate claims by IST date: 23 October: 3; 24 October: 4; 25 October at audit: 4. All 11 claims have distinct users. The release record identifies one 23 October signup as internal QA; do not present these counts as campaign conversions or Meta-received events.
- Live unauthenticated POST to `/api/analytics/meta-registration` returns HTTP 401 and `{eligible:false}`.

## Findings

1. **Growth redirect discards Meta click ID.** `src/app/r/[slug]/route.ts:39` constructs a new destination and adds only stored UTM source/medium/campaign and gl. Incoming fbclid and other incoming campaign parameters are not forwarded. Ads pointing at the growth link can therefore lose the click identifier before the pixel loads. Preserve validated click identifiers through this redirect.

2. **Valid campaign formatting can suppress the entire pixel.** `src/lib/metaPixel.ts:9` allows only ASCII letters, digits, underscore and hyphen for every query value. Campaign names with spaces or dots fail; unknown query keys also fail. Current stored Meta campaign uses safe underscores, so this is an edge-case gap, not proof that its current ads fail. Review privacy-safe handling that avoids disabling tracking for ordinary campaign formatting. Google gclid is also excluded; no Google Ads tag was found in the audited source.

3. **Internal attribution requires growth links.** `src/app/api/analytics/growth-links/attribute/route.ts:7` only reads the meera_growth_link cookie, set by `/r/[slug]`. Direct UTM links do not create this cookie. The stored active Meta growth link `meta-us-meera-creative-test-oct-2026-9daba0`, campaign `us_meera_creative_test_oct2026`, has zero recorded clicks and zero attributions across its lifetime. This does not establish whether the ads have traffic; their actual destination must be checked in Ads Manager.

4. **Meta measurement stops at signup.** Explicit frontend events are PageView and CompleteRegistration. No Meta InitiateCheckout/Purchase events or server Conversions API integration were found in the audited frontend. Revenue/ROAS measurement is therefore not established by this integration. Any expansion should first be checked against this dataset's applicable Meta restrictions; the previous release records a Health & wellness category and Core setup On.

5. **Claimed is not delivered.** `src/app/auth/callback/page.tsx:35` claims a signup with a three-second timeout. `src/components/MetaPixel.tsx:24` then queues CompleteRegistration and immediately removes the pending key. A blocked pixel/script or an interrupted callback can leave a first-party claim without a Meta-delivered event, without an acknowledged retry path. Deduplication is verified; delivery is not.

6. **Limited route coverage is deliberate.** Tracking initializes only on `/` and `/sign-in`, with an empty fragment and allowed query. `/labs`, `/pricing`, callback and dashboard routes do not initialize the pixel on a direct visit. Check actual ad destinations before assuming coverage. Keeping sensitive app content out of marketing events remains important.

## Website performance evidence

- Homepage and sign-in return HTTP 200. Homepage was a Vercel cache HIT and HTML size was 12,970 bytes.
- Warm www homepage HTTP probe: TTFB 0.234 s, total 0.347 s. Bare-domain request including its one redirect: total 0.826 s. Earlier probes varied: homepage TTFB 2.215 s; bare-domain redirect alone 4.662 s. These are a few local network samples, not field Core Web Vitals.
- Meta loader is asynchronous. Cashfree SDK also appears in the live homepage DOM.
- Google PageSpeed mobile API returned HTTP 429 / quota exhausted. No valid Lighthouse score, mobile LCP/INP/CLS, or field performance verdict is available from this audit.

## Remaining external verification

Arc reached Meta's Ads Manager login page. User sign-in is required to check current campaign delivery, spend, CTR, CPC, landing-page views, signup CPA, actual destination/UTM values, selected dataset and optimization event, Events Manager receipts/diagnostics and applicable event restrictions. No current advertising performance numbers are claimed here.

Suggested order: inspect actual ads and Meta receipts; repair redirect/query attribution gaps; verify an ordinary eligible signup in Events Manager; then evaluate campaign results with an accurate measurement baseline.
