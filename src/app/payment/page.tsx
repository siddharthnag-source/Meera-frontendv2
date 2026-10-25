'use client';

import { PricingModalProvider, usePricingModal } from '@/contexts/PricingModalContext';
import { SUBSCRIPTION_QUERY_KEY, useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import {
  clearAuthRedirectTrace,
  logAuthRedirectEvent,
  resolvePaymentRouteDecision,
  type SessionStatus,
} from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { queueMarketingEvent } from '@/lib/marketingEvents';
import { isUSPurchaseIntent, US_SIGN_IN_PATH } from '@/lib/purchaseIntent';
import { isPaidPlanActive } from '@/lib/subscriptionUtils';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useRef, useState } from 'react';

function PaymentRouteContent() {
  const { data: subscriptionData, isLoading: isLoadingSubscription, isError: subscriptionError, refetch: retrySubscription } = useSubscriptionStatus();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [sessionUserId, setSessionUserId] = useState<string>('');
  const [sessionAccessToken, setSessionAccessToken] = useState<string>('');
  const { openModal } = usePricingModal();
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutSessionId = searchParams.get('checkout_session_id');
  const isUSOffer = isUSPurchaseIntent(searchParams);
  const [checkoutStatus, setCheckoutStatus] = useState<'checking' | 'pending' | 'expired' | 'error'>('checking');
  const [checkAttempt, setCheckAttempt] = useState(0);
  const queryClient = useQueryClient();
  const modalOpenedRef = useRef(false);

  useEffect(() => {
    if (!checkoutSessionId || !sessionAccessToken) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    setCheckoutStatus('checking');
    const checkPayment = async () => {
      try {
        const response = await fetch(`/api/payment/stripe/status?session_id=${encodeURIComponent(checkoutSessionId)}`, {
          headers: { Authorization: `Bearer ${sessionAccessToken}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Payment check failed');
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (result.status === 'paid') {
          if (result.marketingEvent) queueMarketingEvent(result.marketingEvent);
          await queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY });
          router.replace('/');
          return;
        }
        if (result.status === 'expired') {
          setCheckoutStatus('expired');
          return;
        }
        attempts += 1;
        if (attempts >= 20) {
          setCheckoutStatus('pending');
          return;
        }
        timer = setTimeout(checkPayment, 3000);
      } catch {
        if (!controller.signal.aborted) setCheckoutStatus('error');
      }
    };
    void checkPayment();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    checkoutSessionId,
    sessionAccessToken,
    checkAttempt,
    queryClient,
    router,
  ]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionStatus(data.session ? 'authenticated' : 'unauthenticated');
      setSessionUserId(data.session?.user?.id ?? '');
      setSessionAccessToken(data.session?.access_token ?? '');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionStatus(session ? 'authenticated' : 'unauthenticated');
      setSessionUserId(session?.user?.id ?? '');
      setSessionAccessToken(session?.access_token ?? '');
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (checkoutSessionId && sessionStatus !== 'unauthenticated') return;
    if (sessionStatus === 'authenticated' && subscriptionError) return;
    const decision = resolvePaymentRouteDecision({
      sessionStatus,
      isSubscriptionLoading: isLoadingSubscription,
      subscriptionData,
    });

    // Explicit purchase intent also applies to legacy free accounts.
    // An existing paid account still follows the normal access decision.
    if (isUSOffer && sessionStatus === 'unauthenticated') {
      router.replace(US_SIGN_IN_PATH);
      return;
    }
    if (isUSOffer && sessionStatus === 'authenticated' && !isLoadingSubscription && subscriptionData && !isPaidPlanActive(subscriptionData)) {
      decision.target = null;
      decision.reason = 'payment_required';
    }

    const currentRoute = `${window.location.pathname}${window.location.search}`;

    if (decision.target && decision.target !== currentRoute) {
      logAuthRedirectEvent('redirect_decision', {
        from: window.location.pathname,
        reason: decision.reason,
        sessionStatus,
        target: decision.target,
        requiresPaymentForChat: subscriptionData?.requires_payment_for_chat ?? null,
      });
      router.replace(decision.target);
      return;
    }

    if (decision.reason === 'payment_required' && !modalOpenedRef.current) {
      modalOpenedRef.current = true;
      void fetch('/api/analytics/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionAccessToken ? { Authorization: `Bearer ${sessionAccessToken}` } : {}),
        },
        body: JSON.stringify({
          event_name: 'payment_page_opened',
          user_id: sessionUserId || null,
          source: 'payment_route',
          metadata: {
            route: window.location.pathname,
            requires_payment_for_chat: subscriptionData?.requires_payment_for_chat ?? null,
          },
        }),
      }).catch(() => {
        // Best-effort telemetry: do not block checkout UI.
      });
      openModal('paywall_route', false);
    }

    if (sessionStatus === 'authenticated' && decision.reason !== 'payment_required') {
      clearAuthRedirectTrace();
    }
  }, [
    checkoutSessionId,
    isUSOffer,
    isLoadingSubscription,
    openModal,
    router,
    sessionAccessToken,
    sessionStatus,
    sessionUserId,
    subscriptionData,
    subscriptionError,
  ]);

  if (checkoutSessionId) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-center text-primary">
        <section className="max-w-md rounded-3xl border border-primary/15 bg-white p-8" aria-live="polite">
          <h1 className="font-serif text-3xl">
            {checkoutStatus === 'checking'
              ? 'Confirming your payment…'
              : checkoutStatus === 'expired'
                ? 'Checkout expired'
                : 'Your payment confirmation'}
          </h1>
          <p className="mt-4 text-primary/75">
            {checkoutStatus === 'checking'
              ? 'We’re securely checking your payment. Your lifetime access opens as soon as it’s confirmed.'
              : checkoutStatus === 'expired'
                ? 'This checkout session has expired. You can return to the payment page to try again.'
                : 'Your confirmation may take a moment. If you completed payment, please don’t pay again. Check the status or contact us for help.'}
          </p>
          {checkoutStatus !== 'checking' && (
            <button
              className="mt-6 rounded-full bg-primary px-6 py-3 text-background"
              onClick={() => {
                if (checkoutStatus === 'expired') router.replace('/payment');
                else setCheckAttempt((value) => value + 1);
              }}
            >
              {checkoutStatus === 'expired' ? 'Back to checkout' : 'Check payment status'}
            </button>
          )}
          <a className="mt-5 block text-sm underline" href="mailto:siddharth.nag@himeera.com">
            Contact support
          </a>
        </section>
      </main>
    );
  }

  if (subscriptionError && sessionStatus === 'authenticated') {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-center text-primary">
        <section className="max-w-md">
          <h1 className="font-serif text-3xl">Let’s reconnect to checkout</h1>
          <p className="mt-4">We couldn’t check your account. You haven’t been charged. Please try again.</p>
          <button className="mt-6 rounded-full bg-primary px-6 py-3 text-background" onClick={() => void retrySubscription()}>Try again</button>
          <a className="mt-5 block underline" href="mailto:siddharth.nag@himeera.com">Contact support</a>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-6 text-center">
      <div>
        <div className="w-8 h-8 mx-auto border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="mt-4 text-sm text-primary/80">Preparing secure checkout…</p>
      </div>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <PricingModalProvider>
      <Suspense
        fallback={
          <div className="min-h-[100dvh] flex items-center justify-center bg-background">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        }
      >
        <PaymentRouteContent />
      </Suspense>
    </PricingModalProvider>
  );
}
