'use client';

import { guestService } from '@/app/api/services/guest';
import { Conversation } from '@/components/Conversation';
import { PricingModalProvider } from '@/contexts/PricingModalContext';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import React, { Suspense, useEffect, useState } from 'react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export default function Home() {
  const { data: subscriptionData, isLoading: isLoadingSubscription } = useSubscriptionStatus();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');

  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const router = useRouter();

  // 1) Track Supabase session state (replaces NextAuth useSession)
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

  // 2) If user bought paid plan as guest, force sign-in success flow
  useEffect(() => {
    const guestToken = localStorage.getItem('guest_token');
    if (guestToken && !isLoadingSubscription && subscriptionData?.plan_type === 'paid') {
      router.push('/sign-in?success=true');
    }
  }, [isLoadingSubscription, subscriptionData, router]);

  // 3) Clean guest_token from URL if present
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    if (queryParams.has('guest_token')) {
      queryParams.delete('guest_token');
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  // 4) Decide whether to use logged-in session or guest token
  useEffect(() => {
    const checkAndSetToken = async () => {
      if (authChecked) return;

      if (sessionStatus === 'loading') {
        setIsLoadingAuth(true);
        return;
      }

      if (sessionStatus === 'authenticated') {
        localStorage.removeItem('guest_token');
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      const guestToken = localStorage.getItem('guest_token');
      if (guestToken) {
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      try {
        const queryParams = new URLSearchParams(window.location.search);
        const referralIdFromQuery = queryParams.get('referral_id');

        const response = await guestService.getGuestToken(referralIdFromQuery || undefined);
        if (response && response.guest_token) {
          localStorage.setItem('guest_token', response.guest_token);
        }
      } catch (error) {
        console.error('Error fetching guest token:', error);
        setAuthError('Something went wrong. Please try again.');
      } finally {
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    };

    checkAndSetToken();
  }, [sessionStatus, authChecked]);

  if (authError) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background text-center">
        <p className="text-red-500 mb-4">{authError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-background rounded-md hover:bg-primary/90"
        >
          Try Again
        </button>
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
        {!isLoadingAuth || authChecked ? <Conversation /> : null}
      </Suspense>
    </PricingModalProvider>
  );
}
