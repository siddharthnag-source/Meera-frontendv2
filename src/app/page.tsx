'use client';

import dynamic from 'next/dynamic';
import { PricingModalProvider } from '@/contexts/PricingModalContext';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import {
  breakAuthRedirectLoop,
  clearAuthRedirectTrace,
  clearGuestTokenState,
  getGuestToken,
  hasConsumedSuccessFlag,
  logAuthRedirectEvent,
  registerAuthRedirectVisit,
  resolveHomeRouteDecision,
  stripQueryParamsFromCurrentUrl,
  type SessionStatus,
} from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { preserveMarketingParams } from '@/lib/marketingAttribution';
import { useRouter } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';

// Public ad visitors redirect to sign-in without downloading the chat engine.
const Conversation = dynamic(() => import('@/components/Conversation').then((module) => module.Conversation), {
  ssr: false,
  loading: () => (
    <div role="status" aria-label="Loading Meera" className="min-h-[100dvh] flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  ),
});

export default function Home() {
  const { data: subscriptionData, isLoading: isLoadingSubscription } = useSubscriptionStatus();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const router = useRouter();

  // Track Supabase session
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionStatus(data.session ? 'authenticated' : 'unauthenticated');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionStatus(session ? 'authenticated' : 'unauthenticated');
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Clean guest_token from URL if present (safe to keep)
  useEffect(() => {
    stripQueryParamsFromCurrentUrl(['guest_token']);
  }, []);

  useEffect(() => {
    const pathname = window.location.pathname;
    const currentRoute = `${window.location.pathname}${window.location.search}`;
    const guestToken = getGuestToken();

    if (sessionStatus === 'authenticated' && guestToken) {
      clearGuestTokenState('authenticated_home');
    }

    const { loopDetected, visitCount } = registerAuthRedirectVisit(pathname);
    if (loopDetected) {
      const safeTarget = breakAuthRedirectLoop({ pathname, sessionStatus });
      if (safeTarget !== currentRoute) {
        router.replace(safeTarget);
      }
      return;
    }

    const decision = resolveHomeRouteDecision({
      sessionStatus,
      isSubscriptionLoading: isLoadingSubscription,
      subscriptionData,
      hasGuestToken: !!guestToken,
      hasConsumedSuccess: hasConsumedSuccessFlag(),
    });

    if (decision.target && decision.target !== currentRoute) {
      logAuthRedirectEvent('redirect_decision', {
        from: pathname,
        hasGuestToken: !!guestToken,
        isSubscriptionLoading: isLoadingSubscription,
        planType: subscriptionData?.plan_type ?? null,
        reason: decision.reason,
        sessionStatus,
        target: decision.target,
        visitCount,
      });
      router.replace(preserveMarketingParams(decision.target, window.location.search));
      return;
    }

    if (sessionStatus === 'authenticated') {
      clearAuthRedirectTrace();
    }
  }, [isLoadingSubscription, router, sessionStatus, subscriptionData]);

  // Keep the chat route neutral while restoring the session or redirecting.
  if (sessionStatus !== 'authenticated' || isLoadingSubscription || subscriptionData?.requires_payment_for_chat === true) {
    return (
      <div role="status" aria-label="Loading Meera" className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PricingModalProvider>
      <Suspense
        fallback={
          <div className="min-h-[100dvh] flex items-center justify-center bg-background">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        }
      >
        <Conversation />
      </Suspense>
    </PricingModalProvider>
  );
}
