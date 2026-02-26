'use client';

import { Conversation } from '@/components/Conversation';
import { PricingModalProvider } from '@/contexts/PricingModalContext';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';
const SESSION_INIT_TIMEOUT_MS = 8000;

export default function Home() {
  const { data: subscriptionData, isLoading: isLoadingSubscription } = useSubscriptionStatus();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const router = useRouter();

  // Track Supabase session
  useEffect(() => {
    let mounted = true;

    const getSessionWithTimeout = async () => {
      let timeoutId: number | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error(`Supabase getSession timed out after ${SESSION_INIT_TIMEOUT_MS}ms`));
          }, SESSION_INIT_TIMEOUT_MS);
        });

        return await Promise.race([supabase.auth.getSession(), timeoutPromise]);
      } finally {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      }
    };

    const resolveInitialSession = async () => {
      try {
        const { data, error } = await getSessionWithTimeout();
        if (!mounted) return;

        if (error) {
          console.error('Supabase getSession error:', error);
          setSessionStatus('unauthenticated');
          return;
        }

        setSessionStatus(data.session ? 'authenticated' : 'unauthenticated');
      } catch (error) {
        if (!mounted) return;
        console.error('Supabase initial session lookup failed:', error);
        setSessionStatus('unauthenticated');
      }
    };

    void resolveInitialSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
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

  // Main rule: if not logged in, go to sign-in
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.replace('/sign-in');
    }
  }, [sessionStatus, router]);

  // While checking session, show loader
  if (sessionStatus !== 'authenticated') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
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
