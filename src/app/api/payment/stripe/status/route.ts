import { getStripe, paymentIdentity } from '@/lib/stripePayments';
import { NextRequest, NextResponse } from 'next/server';
import { verifiedCommerceEvent } from '@/lib/metaCommerce';

export async function GET(request: NextRequest) {
  try {
    const identity = await paymentIdentity(request);
    if (!identity) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    const sessionId = request.nextUrl.searchParams.get('session_id') ?? '';
    if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid checkout session.' }, { status: 400 });
    }
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (
      session.client_reference_id !== identity.user.id ||
      session.metadata?.public_user_id !== identity.publicUserId
    ) {
      return NextResponse.json({ error: 'Checkout session not found.' }, { status: 404 });
    }
    const { data: payment, error } = await identity.db
      .from('payments')
      .select('payment_status')
      .eq('payment_id', sessionId)
      .eq('user_id', identity.publicUserId)
      .maybeSingle();
    if (error) throw error;
    const paid = payment?.payment_status === 'paid' && session.payment_status === 'paid';
    if (paid) {
      // Refresh the existing backend's access cache after webhook fulfillment.
      const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
      if (backend)
        await fetch(`${backend}/user/balance`, {
          headers: { Authorization: `Bearer ${identity.token}`, 'Cache-Control': 'no-cache' },
          cache: 'no-store',
        });
    }
    return NextResponse.json(
      {
        status: paid ? 'paid' : session.status === 'expired' ? 'expired' : 'pending',
        marketingEvent: paid ? verifiedCommerceEvent('Purchase', session.id, Number(session.amount_total) / 100,
          String(session.currency).toUpperCase()) : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'Unable to check your payment. Please try again.' }, { status: 502 });
  }
}
