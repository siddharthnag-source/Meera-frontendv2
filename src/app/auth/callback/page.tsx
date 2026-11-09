'use client';

import { isOnboardingSignIn, ONBOARDING_RETURN_PATH } from '@/lib/onboarding-redirect';
import { finishGoogleAgentConnection } from '@/lib/auth/startGoogleAgentConnection';
import { clearAuthRedirectTrace, clearGuestTokenState, logAuthRedirectEvent } from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { queueMarketingEvent } from '@/lib/marketingEvents';
import { captureMarketingTouch } from '@/lib/captureMarketingTouch';
import { consumePurchaseIntent, US_SIGN_IN_PATH } from '@/lib/purchaseIntent';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AuthCallbackPage() {
  const router = useRouter();
  useEffect(() => {
    // A remount or router transition can leave an earlier async callback alive.
    // It must not consume purchase intent or redirect the new page a second time.
    let cancelled = false;
    const isCurrent = () => !cancelled && window.location.pathname === '/auth/callback';
    const handle = async () => {
      try {
        // Touch auth so Supabase reads the #access_token from the URL
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const providerError =
          searchParams.get('error_description') ||
          searchParams.get('error') ||
          hashParams.get('error_description') ||
          hashParams.get('error');
        const { data, error } = await supabase.auth.getSession();
        if (!isCurrent()) return;

        if (data.session) {
          const headers = { Authorization: `Bearer ${data.session.access_token}` };
          await captureMarketingTouch();
          if (!isCurrent()) return;
          await Promise.allSettled([
            fetch('/api/analytics/growth-links/attribute', {
              method: 'POST', headers, signal: AbortSignal.timeout(3000),
            }),
            fetch('/api/analytics/meta-registration', {
              method: 'POST', headers, signal: AbortSignal.timeout(3000),
            }).then(async (response) => {
              if (!response.ok) return;
              const result = await response.json();
              if (result.eligible && typeof result.eventId === 'string') {
                queueMarketingEvent({ name: 'CompleteRegistration', eventId: result.eventId });
              }
            }),
          ]);
          if (!isCurrent()) return;
          let returnTo: string | null = null;
          try {
            returnTo = await finishGoogleAgentConnection();
          } catch (connectionError) {
            if (!isCurrent()) return;
            console.error('Google agent connection error:', connectionError);
            router.replace('/?connection_error=google');
            return;
          }
          if (!isCurrent()) return;
          clearGuestTokenState('auth_callback');
          clearAuthRedirectTrace();
          logAuthRedirectEvent('auth_callback_session_restored', {
            pathname: window.location.pathname,
          });
          const onboardingTarget = isOnboardingSignIn(window.location.search) ? ONBOARDING_RETURN_PATH : null;
          const purchaseTarget = consumePurchaseIntent();
          if (returnTo || onboardingTarget || purchaseTarget) {
            router.replace(returnTo || onboardingTarget || purchaseTarget!);
          } else {
            // Google signup enters optional setup. Completed accounts bypass it.
            const response = await fetch('/api/onboarding/session', {
              headers, signal: AbortSignal.timeout(5000), cache: 'no-store',
            }).catch(() => null);
            const setup = response?.ok ? await response.json().catch(() => null) : null;
            if (!isCurrent()) return;
            router.replace(setup?.draft?.complete ? '/' : ONBOARDING_RETURN_PATH);
          }
          return;
        }

        logAuthRedirectEvent('auth_callback_session_missing', {
          message: providerError || error?.message || 'No session returned',
          pathname: window.location.pathname,
        });
        router.replace(consumePurchaseIntent() ? `${US_SIGN_IN_PATH}&auth_error=google` : '/sign-in?auth_error=google');
      } catch (error) {
        if (!isCurrent()) return;
        console.error('Supabase auth callback error:', error);
        router.replace(consumePurchaseIntent() ? `${US_SIGN_IN_PATH}&auth_error=google` : '/sign-in?auth_error=google');
      }
    };

    handle();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-primary text-base">Signing you in…</p>
    </div>
  );
}
