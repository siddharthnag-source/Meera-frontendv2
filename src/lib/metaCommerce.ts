import { createHash } from 'crypto';

// Enable only after Events Manager confirms these standard events are permitted
// for this dataset. This gate does not bypass Meta's data-source restrictions.
export function verifiedCommerceEvent(name: 'InitiateCheckout' | 'Purchase', paymentId: string, value: number, currency: string) {
  if (process.env.META_COMMERCE_ENABLED !== 'true' || !paymentId || !Number.isFinite(value) || value <= 0 ||
    !['INR', 'USD'].includes(currency)) return null;
  return {
    name, eventId: createHash('sha256').update(`meera:${name}:${paymentId}`).digest('hex'),
    ...(process.env.META_COMMERCE_VALUE_ENABLED === 'true' ? { value, currency } : { countsOnly: true as const }),
  };
}
