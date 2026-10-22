import { isNewRegistration } from '@/lib/marketingRegistration';
import { requireAuthenticatedUser } from '@/lib/meeraServer';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return NextResponse.json({ eligible: false }, { status: auth.status });
  if (!isNewRegistration(auth.user)) return NextResponse.json({ eligible: false });

  // A partial unique index makes this atomic across tabs, retries and devices.
  // Only the opaque event ID leaves this first-party endpoint, never the user ID.
  const { data, error } = await auth.supabase
    .from('analytics_events')
    .insert({ event_name: 'meta_registration_claimed', user_id: auth.user.id, source: 'meta_pixel', metadata: {} })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ eligible: false }, { status: error.code === '23505' ? 200 : 503 });
  }
  return NextResponse.json({ eligible: true, eventId: data.id });
}
