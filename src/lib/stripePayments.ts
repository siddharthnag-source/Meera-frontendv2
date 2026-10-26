import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export const STRIPE_LIFETIME_AMOUNT = 9900;

// Test fulfillment must target an explicitly selected nonproduction database.
// Match the URL exactly; substring checks also accept attacker-controlled hosts.
export function stripeSandboxDatabaseReady() {
  const ref = process.env.MEERA_STRIPE_SANDBOX_SUPABASE_REF ?? 'odeqnorudbdiuhweuoqv';
  if (!/^[a-z]{20}$/.test(ref) || ref === 'xilapyewazpzlvqbbtgl') return false;
  try {
    const url = new URL(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    return url.protocol === 'https:' && url.hostname === `${ref}.supabase.co` &&
      !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured');
  return new Stripe(key);
}

export function stripeCheckoutReady() {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (process.env.MEERA_PAYMENT_MODE === 'sandbox') {
    return /^(sk|rk)_test_/.test(key) && Boolean(process.env.STRIPE_WEBHOOK_SECRET) && stripeSandboxDatabaseReady();
  }
  return Boolean(
    key && process.env.STRIPE_WEBHOOK_SECRET && (process.env.VERCEL_ENV !== 'production' || /^(sk|rk)_live_/.test(key)),
  );
}

export function paymentDatabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Payment database is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function paymentIdentity(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const db = paymentDatabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile, error: profileError } = await db
    .from('users')
    .select('id')
    .eq('auth_id', user.id)
    .eq('deleted', false)
    .maybeSingle();
  if (profileError || !profile) return null;
  return { user, publicUserId: String(profile.id), token, db };
}

// Fulfillment is driven by signed events; a redirect never grants access.
export async function fulfillStripeSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') return;
  if (process.env.MEERA_PAYMENT_MODE === 'sandbox' && session.livemode) {
    throw new Error('Sandbox deployments cannot fulfill live payments');
  }
  if (
    session.mode !== 'payment' ||
    session.currency !== 'usd' ||
    session.amount_total !== STRIPE_LIFETIME_AMOUNT ||
    session.metadata?.plan_type !== 'lifetime' ||
    !session.metadata?.auth_user_id ||
    !session.metadata?.public_user_id ||
    session.client_reference_id !== session.metadata.auth_user_id
  ) {
    throw new Error('Unexpected checkout purchase');
  }
  // A sandbox payment must never grant access in the production Meera database.
  if (!session.livemode && !stripeSandboxDatabaseReady()) {
    throw new Error('Test payment fulfillment requires the Meera QA database');
  }
  const db = paymentDatabase();
  const { data: profile, error: profileError } = await db
    .from('users')
    .select('id')
    .eq('auth_id', session.metadata.auth_user_id)
    .eq('id', session.metadata.public_user_id)
    .eq('deleted', false)
    .maybeSingle();
  if (profileError || !profile) throw new Error('Checkout account is unavailable');
  const paidAt = new Date(session.created * 1000).toISOString();
  const { error } = await db.from('payments').upsert(
    {
      payment_id: session.id,
      order_id: session.id,
      user_id: String(profile.id),
      payment_date: paidAt,
      amount: STRIPE_LIFETIME_AMOUNT / 100,
      currency: 'USD',
      plan_type: 'lifetime',
      payment_method: 'stripe',
      payment_status: 'paid',
      created_at: paidAt,
      updated_at: paidAt,
    },
    { onConflict: 'payment_id', ignoreDuplicates: true },
  );
  if (error) throw new Error('Unable to record checkout payment');
}

export async function revokeStripePayment(paymentIntentId: string, status: 'refunded' | 'disputed') {
  const sessions = await getStripe().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 100 });
  const db = paymentDatabase();
  for (const session of sessions.data) {
    if (session.metadata?.plan_type !== 'lifetime') continue;
    // Insert a revocation even if it arrives before the checkout completion event.
    // The duplicate-safe grant above cannot overwrite it on a later delivery.
    if (!session.livemode && !stripeSandboxDatabaseReady()) continue;
    if (process.env.MEERA_PAYMENT_MODE === 'sandbox' && session.livemode) continue;
    const userId = session.metadata?.public_user_id;
    if (!userId) continue;
    const now = new Date().toISOString();
    const { error } = await db.from('payments').upsert(
      {
        payment_id: session.id,
        order_id: session.id,
        user_id: userId,
        payment_date: now,
        amount: 99,
        currency: 'USD',
        plan_type: 'lifetime',
        payment_method: 'stripe',
        payment_status: status,
        updated_at: now,
        created_at: new Date(session.created * 1000).toISOString(),
      },
      { onConflict: 'payment_id' },
    );
    if (error) throw new Error('Unable to update refunded payment');
  }
}

export async function restoreStripePayment(paymentIntentId: string) {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const charge =
    typeof intent.latest_charge === 'string'
      ? await stripe.charges.retrieve(intent.latest_charge)
      : intent.latest_charge;
  if (!charge || charge.refunded) return;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 100 });
  const db = paymentDatabase();
  for (const session of sessions.data) {
    if (session.metadata?.plan_type !== 'lifetime') continue;
    if (!session.livemode && !stripeSandboxDatabaseReady()) continue;
    if (process.env.MEERA_PAYMENT_MODE === 'sandbox' && session.livemode) continue;
    const now = new Date().toISOString();
    const { error } = await db
      .from('payments')
      .update({ payment_status: 'paid', payment_date: now, updated_at: now })
      .eq('payment_id', session.id)
      .eq('payment_status', 'disputed');
    if (error) throw new Error('Unable to restore resolved payment');
  }
}
