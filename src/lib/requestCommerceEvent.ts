import { queueMarketingEvent } from './marketingEvents';
import { supabase } from './supabaseClient';

export async function requestCommerceEvent(orderId: string, eventName: 'InitiateCheckout' | 'Purchase') {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const response = await fetch('/api/analytics/meta-commerce', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ order_id: orderId, event_name: eventName }),
      keepalive: true, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.event) queueMarketingEvent(result.event);
  } catch { /* Measurement must not interrupt payment or access. */ }
}
