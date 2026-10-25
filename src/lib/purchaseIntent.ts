// Navigation intent only. Prices, identity and paid access remain server-verified.
export const US_CHECKOUT_PATH = '/payment?offer=us-lifetime';
export const US_SIGN_IN_PATH = '/sign-in?offer=us-lifetime';
const KEY = 'meera_purchase_intent_v1';
const MAX_AGE = 30 * 60 * 1000;

export function isUSPurchaseIntent(params: Pick<URLSearchParams, 'get'>): boolean {
  return params.get('offer') === 'us-lifetime' ||
    (params.get('utm_source') === 'meta' && params.get('utm_campaign') === 'us_lifetime_99_oct2026');
}

export function rememberPurchaseIntent(enabled: boolean): void {
  try {
    if (enabled) window.sessionStorage.setItem(KEY, String(Date.now()));
    else window.sessionStorage.removeItem(KEY);
  } catch { /* Navigation still works when browser storage is unavailable. */ }
}

export function consumePurchaseIntent(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!value) return null;
    const age = Date.now() - Number(value);
    return Number.isFinite(age) && age >= 0 && age <= MAX_AGE ? US_CHECKOUT_PATH : null;
  } catch { return null; }
}
