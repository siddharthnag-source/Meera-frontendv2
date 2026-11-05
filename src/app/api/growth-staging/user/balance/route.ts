import { NextResponse } from 'next/server';
import { paymentIdentity, stripeSandboxDatabaseReady } from '@/lib/stripePayments';

export const runtime = 'nodejs';

// The synthetic staging environment reads actual sandbox entitlements here.
// AI chat/voice services require their own separately approved staging backend.
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (process.env.MEERA_PAYMENT_MODE !== 'sandbox' ||
      process.env.MEERA_STRIPE_SANDBOX_SUPABASE_REF !== 'wyitdnwftdxlibdnldfe' ||
      !stripeSandboxDatabaseReady()) {
    return NextResponse.json({ error: 'Staging entitlement service is disabled' }, { status: 404, headers });
  }
  try {
    const identity = await paymentIdentity(request);
    if (!identity) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers });
    const { data, error } = await identity.db.from('payments').select('payment_id')
      .eq('user_id', identity.publicUserId).eq('plan_type', 'lifetime')
      .in('payment_status', ['paid', 'active', 'success']).limit(1);
    if (error) throw error;
    const paid = Boolean(data?.length);
    return NextResponse.json({
      plan_type: paid ? 'paid' : 'free_trial', is_paid_active: paid,
      access_type: paid ? 'lifetime' : 'free_trial', requires_payment_for_chat: !paid,
      subscription_end_date: null, talktime_left: 0, tokens_left: 0,
      is_legacy_user: false, paywall_enabled: true, cache_ttl_seconds: 0,
      message: 'Synthetic staging entitlement only; AI services are not configured.',
    }, { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to read staging entitlement' }, { status: 503, headers });
  }
}
