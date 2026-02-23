'use client';

import { Conversation } from '@/components/Conversation';
import { PricingModalProvider } from '@/contexts/PricingModalContext';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

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

  // If paid guest exists, force sign-in success flow (keep this if you want)
  useEffect(() => {
    const guestToken = localStorage.getItem('guest_token');
    if (guestToken && !isLoadingSubscription && subscriptionData?.plan_type === 'paid') {
      router.push('/sign-in?success=true');
    }
  }, [isLoadingSubscription, subscriptionData, router]);

  // Clean guest_token from URL if present (safe to keep)
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    if (queryParams.has('guest_token')) {
      queryParams.delete('guest_token');
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const KEYBOARD_OPEN_DELTA_PX = 150;

    // Keep the app shell pinned to the real visible viewport in mobile/PWA + keyboard transitions.
    const updateAppViewportHeight = () => {
      const viewportHeight = viewport ? viewport.height : window.innerHeight;
      const keyboardOpen = Boolean(viewport && window.innerHeight - viewportHeight > KEYBOARD_OPEN_DELTA_PX);
      const nextHeight = keyboardOpen ? viewportHeight : window.innerHeight;
      root.style.setProperty('--app-vh', `${Math.round(nextHeight)}px`);
    };

    updateAppViewportHeight();

    window.addEventListener('resize', updateAppViewportHeight);
    window.addEventListener('orientationchange', updateAppViewportHeight);
    viewport?.addEventListener('resize', updateAppViewportHeight);
    viewport?.addEventListener('scroll', updateAppViewportHeight);

    return () => {
      window.removeEventListener('resize', updateAppViewportHeight);
      window.removeEventListener('orientationchange', updateAppViewportHeight);
      viewport?.removeEventListener('resize', updateAppViewportHeight);
      viewport?.removeEventListener('scroll', updateAppViewportHeight);
    };
  }, []);

  // Main rule: if not logged in, go to sign-in
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.replace('/sign-in');
    }
  }, [sessionStatus, router]);

  // While checking session, show loader
  if (sessionStatus !== 'authenticated') {
    return (
      <div className="box-border bg-background overflow-hidden" style={{ height: 'var(--app-vh, 100vh)' }}>
        <div className="h-full flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <PricingModalProvider>
      <div className="box-border bg-background overflow-hidden" style={{ height: 'var(--app-vh, 100vh)' }}>
        <Suspense
          fallback={
            <div className="h-full flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          }
        >
          <Conversation />
        </Suspense>
      </div>
    </PricingModalProvider>
  );
}
