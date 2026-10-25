import { getStripe, paymentIdentity, STRIPE_LIFETIME_AMOUNT, stripeCheckoutReady } from '@/lib/stripePayments';
import { NextRequest, NextResponse } from 'next/server';
import { verifiedCommerceEvent } from '@/lib/metaCommerce';

export async function POST(request: NextRequest) {
  try {
    const identity = await paymentIdentity(request);
    if (!identity) return NextResponse.json({ error: 'Please sign in again to continue.' }, { status: 401 });
    if (!stripeCheckoutReady()) {
      return NextResponse.json(
        { error: 'International checkout is being set up. Please contact support.' },
        { status: 503 },
      );
    }
    const { data: paid, error } = await identity.db
      .from('payments')
      .select('payment_id')
      .eq('user_id', identity.publicUserId)
      .eq('plan_type', 'lifetime')
      .in('payment_status', [
        'paid',
        'active',
        'success',
      ])
      .limit(1);
    if (error) throw error;
    if (paid?.length) return NextResponse.json({ error: 'You already have lifetime access.' }, { status: 409 });
    const origin = process.env.VERCEL_ENV === 'production' ? 'https://www.himeera.com' : request.nextUrl.origin;
    const requestKey = request.headers.get('idempotency-key') ?? '';
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestKey)) {
      return NextResponse.json({ error: 'Invalid checkout request. Please try again.' }, { status: 400 });
    }
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: identity.user.id,
        customer_email: identity.user.email,
        metadata: { auth_user_id: identity.user.id, public_user_id: identity.publicUserId, plan_type: 'lifetime' },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: STRIPE_LIFETIME_AMOUNT,
              tax_behavior: 'inclusive',
              product_data: {
                name: 'Meera Lifetime',
                description: 'One-time lifetime access to Meera text chat, web, and images.',
                tax_code: 'txcd_10105001',
              },
            },
          },
        ],
        integration_identifier: 'meera_lifetime_kqpmzvra',
        billing_address_collection: 'required',
        success_url: `${origin}/payment?checkout_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/payment?checkout=cancelled`,
        custom_text: { submit: { message: 'One payment for lifetime access. No recurring subscription.' } },
      },
      { idempotencyKey: `meera-lifetime-${identity.user.id}-${requestKey}` },
    );
    return NextResponse.json({
      url: session.url,
      marketingEvent: verifiedCommerceEvent('InitiateCheckout', session.id, STRIPE_LIFETIME_AMOUNT / 100, 'USD'),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Stripe checkout failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'Unable to start secure checkout. Please try again.' }, { status: 502 });
  }
}
