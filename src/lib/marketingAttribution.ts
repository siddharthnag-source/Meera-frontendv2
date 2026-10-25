export const MARKETING_PATHS = new Set(['/', '/sign-in', '/labs', '/pricing', '/payment']);

export function isCampaignValue(value: string): boolean {
  // Human-readable campaign labels are supported; contact details, URLs and
  // arbitrary free text are not valid campaign identifiers.
  return /^[\p{L}\p{N}][\p{L}\p{N} ._()+-]{0,159}$/u.test(value);
}

export function isClickId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,500}$/.test(value);
}

export type CampaignTouch = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
};

export function campaignTouch(search: string): CampaignTouch | null {
  const params = new URLSearchParams(search);
  const touch = {
    utm_source: params.get('utm_source')?.trim() ?? '',
    utm_medium: params.get('utm_medium')?.trim() ?? '',
    utm_campaign: params.get('utm_campaign')?.trim() ?? '',
  };
  return Object.values(touch).every(isCampaignValue) ? touch : null;
}

export function marketingDestination(origin: string, path: string, touch: CampaignTouch, slug: string, search: string) {
  const destination = new URL(path, origin);
  // An internal destination must never become an open redirect through //host.
  if (destination.origin !== origin) throw new Error('Invalid campaign destination');
  for (const [key, value] of Object.entries(touch)) destination.searchParams.set(key, value);
  destination.searchParams.set('gl', slug);
  const incoming = new URLSearchParams(search);
  for (const key of ['fbclid', 'gclid', 'msclkid', 'ttclid']) {
    const value = incoming.get(key);
    if (value && isClickId(value)) destination.searchParams.set(key, value);
  }
  for (const key of ['utm_content', 'utm_term', 'utm_id']) {
    const value = incoming.get(key);
    if (value && isCampaignValue(value)) destination.searchParams.set(key, value);
  }
  return destination;
}

export function preserveMarketingParams(target: string, search: string): string {
  const destination = new URL(target, 'https://www.himeera.com');
  if (!MARKETING_PATHS.has(destination.pathname)) return target;
  for (const [key, value] of new URLSearchParams(search)) {
    const campaignKey = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].includes(key);
    const clickKey = ['fbclid', 'gclid', 'msclkid', 'ttclid', 'gl', 'utm_id', 'gad_source', 'gad_campaignid'].includes(key);
    if ((campaignKey && isCampaignValue(value)) || (clickKey && isClickId(value))) destination.searchParams.set(key, value);
  }
  return destination.pathname + destination.search + destination.hash;
}
