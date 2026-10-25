import { isNewRegistration } from '@/lib/marketingRegistration';
import { requireAuthenticatedUser } from '@/lib/meeraServer';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  });
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return reply({ eligible: false }, auth.status);
  if (!isNewRegistration(auth.user)) return reply({ eligible: false });

  // A partial unique index makes this atomic across tabs, retries and devices.
  // Only the opaque event ID leaves this first-party endpoint, never the user ID.
  const { data, error } = await auth.supabase
    .from('analytics_events')
    .insert({ event_name: 'meta_registration_claimed', user_id: auth.user.id, source: 'meta_pixel', metadata: {} })
    .select('id')
    .single();

  if (error) {
    if (error.code !== '23505') return reply({ eligible: false }, 503);
    // A timeout can happen after the database committed. Recover the same ID
    // rather than losing the conversion or creating a second one on retry.
    const existing = await auth.supabase.from('analytics_events').select('id')
      .eq('event_name', 'meta_registration_claimed').eq('user_id', auth.user.id).single();
    if (existing.error || !existing.data) return reply({ eligible: false }, 503);
    return reply({ eligible: true, eventId: existing.data.id });
  }
  return reply({ eligible: true, eventId: data.id });
}
