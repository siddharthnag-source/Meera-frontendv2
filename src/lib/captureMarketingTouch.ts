import { campaignTouch, MARKETING_PATHS } from './marketingAttribution';

const STORAGE_KEY = 'meera:campaign-touch:v1';
const MAX_AGE = 30 * 24 * 60 * 60_000;
let inFlight: Promise<void> | null = null;
let captured = false;

// Persist synchronously before the home -> sign-in redirect. OAuth waits for
// this bounded first-party request, so the HttpOnly attribution cookie is ready.
export function captureMarketingTouch(): Promise<void> {
  if (captured) return Promise.resolve();
  if (inFlight) return inFlight;
  let touch = MARKETING_PATHS.has(window.location.pathname) ? campaignTouch(window.location.search) : null;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (stored && typeof stored.at === 'number' && Date.now() - stored.at >= 0 && Date.now() - stored.at < MAX_AGE) {
      touch = campaignTouch(new URLSearchParams(stored.touch).toString()) ?? touch;
    } else if (touch) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ touch, at: Date.now() }));
    }
  } catch {
    // Storage-disabled browsers still capture the current URL.
  }
  if (!touch) return Promise.resolve();
  inFlight = fetch('/api/analytics/growth-links/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(touch),
    keepalive: true,
    signal: AbortSignal.timeout(3000),
  }).then(async (response) => {
    if (!response.ok) return;
    const result = await response.json();
    captured = result.captured === true;
  }).catch(() => {
    // Attribution must never prevent sign-in. Retry at the next OAuth attempt.
  }).finally(() => { inFlight = null; });
  return inFlight;
}
