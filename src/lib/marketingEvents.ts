import { initializeMetaPixel, isMarketingPage, isMetaPixelReady, META_PIXEL_ID } from './metaPixel';

const KEY = 'meera:marketing-events:v2';
const LEGACY_KEY = 'meera:meta-registration:v1';
const MAX_AGE = 24 * 60 * 60_000;
export type MarketingEvent = {
  name: 'CompleteRegistration' | 'InitiateCheckout' | 'Purchase';
  eventId: string;
  value?: number;
  currency?: 'INR' | 'USD';
  countsOnly?: boolean;
};
type PendingEvent = MarketingEvent & { at: number; lastAttemptAt?: number };
let memory: PendingEvent[] = [];
const dispatched = new Set<string>();

function valid(event: PendingEvent): boolean {
  return ['CompleteRegistration', 'InitiateCheckout', 'Purchase'].includes(event.name) &&
    /^[a-f0-9-]{36,64}$/i.test(event.eventId) && Number.isFinite(event.at) &&
    Date.now() >= event.at && Date.now() - event.at < MAX_AGE &&
    (event.name === 'CompleteRegistration' || event.countsOnly === true ||
      (typeof event.value === 'number' && Number.isFinite(event.value) && event.value > 0 && ['INR', 'USD'].includes(event.currency ?? '')));
}

function pending(): PendingEvent[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(stored)) memory = [...memory, ...stored.filter((event) => event && valid(event))];
    const legacy = sessionStorage.getItem(LEGACY_KEY);
    if (legacy && /^[a-f0-9-]{36}$/i.test(legacy)) {
      memory.push({ name: 'CompleteRegistration', eventId: legacy, at: Date.now() });
      sessionStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* Memory fallback for storage-disabled browsers. */ }
  const unique = new Map(memory.filter(valid).map((event) => [`${event.name}:${event.eventId}`, event]));
  return [...unique.values()].slice(-20);
}

function save(events: PendingEvent[]) {
  memory = events;
  try { sessionStorage.setItem(KEY, JSON.stringify(events)); } catch { /* Memory fallback. */ }
}

export function queueMarketingEvent(event: MarketingEvent) {
  const events = pending();
  const record = { ...event, at: Date.now() };
  if (!valid(record)) return;
  if (!events.some((item) => item.name === event.name && item.eventId === event.eventId)) events.push(record);
  save(events);
  dispatchPendingMarketingEvents();
}

export function dispatchPendingMarketingEvents() {
  if (!isMarketingPage(window.location.pathname, window.location.search, window.location.hash) || !isMetaPixelReady()) return;
  const events = pending();
  for (const event of events) {
    const key = `${event.name}:${event.eventId}`;
    if (dispatched.has(key) || (event.lastAttemptAt && Date.now() - event.lastAttemptAt < 60_000)) continue;
    const data = event.name === 'CompleteRegistration' || event.countsOnly ? {} : { value: event.value, currency: event.currency };
    initializeMetaPixel()('trackSingle', META_PIXEL_ID, event.name, data, { eventID: event.eventId });
    dispatched.add(key);
    event.lastAttemptAt = Date.now();
  }
  // The browser SDK has no receipt acknowledgement. Retain events for a bounded
  // retry after reload, using the same eventID so Meta can deduplicate copies.
  save(events);
}
