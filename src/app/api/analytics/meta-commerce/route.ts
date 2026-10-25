import { requireAuthenticatedUser } from '@/lib/meeraServer';
import { verifiedCommerceEvent } from '@/lib/metaCommerce';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  });
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) return reply({ event: null }, auth.status);
  if (process.env.META_COMMERCE_ENABLED !== 'true') return reply({ event: null, reason: 'not_enabled' });
  const body = await request.json().catch(() => null);
  const orderId = body?.order_id;
  const eventName = body?.event_name;
  if (typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(orderId) ||
    !['InitiateCheckout', 'Purchase'].includes(eventName)) return reply({ event: null }, 400);
  const { data: profile, error: profileError } = await auth.supabase.from('users').select('id')
    .eq('auth_id', auth.user.id).eq('deleted', false).maybeSingle();
  if (profileError) return reply({ event: null }, 503);
  if (!profile) return reply({ event: null }, 404);
  const { data: payment, error } = await auth.supabase.from('payments')
    .select('payment_id, order_id, amount, currency, payment_status, coupon_code')
    .eq('order_id', orderId).eq('user_id', String(profile.id)).maybeSingle();
  if (error) return reply({ event: null }, 503);
  if (!payment) return reply({ event: null }, 404);
  const status = String(payment.payment_status).toLowerCase();
  if (String(payment.coupon_code ?? '').toUpperCase() === 'BYPASS' ||
    (eventName === 'Purchase' ? !['paid', 'success', 'active'].includes(status) :
      !['pending', 'created', 'paid', 'success', 'active'].includes(status))) return reply({ event: null });
  // Only a server-recorded, owner-verified amount/status can produce a purchase.
  return reply({ event: verifiedCommerceEvent(eventName, String(payment.order_id), Number(payment.amount), String(payment.currency)) });
}
