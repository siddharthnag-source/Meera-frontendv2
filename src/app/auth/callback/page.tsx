'use client';

import { finishGoogleAgentConnection } from '@/lib/auth/startGoogleAgentConnection';
import { clearAuthRedirectTrace, clearGuestTokenState, logAuthRedirectEvent } from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { queueMarketingEvent } from '@/lib/marketingEvents';
import { captureMarketingTouch } from '@/lib/captureMarketingTouch';
import { consumePurchaseIntent, US_SIGN_IN_PATH } from '@/lib/purchaseIntent';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

export default function AuthCallbackPage() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
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

        if (data.session) {
          const headers = { Authorization: `Bearer ${data.session.access_token}` };
          await captureMarketingTouch();
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
          let returnTo: string | null = null;
          try {
            returnTo = await finishGoogleAgentConnection();
          } catch (connectionError) {
            console.error('Google agent connection error:', connectionError);
            router.replace('/?connection_error=google');
            return;
          }
          clearGuestTokenState('auth_callback');
          clearAuthRedirectTrace();
          logAuthRedirectEvent('auth_callback_session_restored', {
            pathname: window.location.pathname,
          });
          const purchaseTarget = consumePurchaseIntent();
          router.replace(returnTo || purchaseTarget || '/');
          return;
        }

        logAuthRedirectEvent('auth_callback_session_missing', {
          message: providerError || error?.message || 'No session returned',
          pathname: window.location.pathname,
        });
        router.replace(consumePurchaseIntent() ? `${US_SIGN_IN_PATH}&auth_error=google` : '/sign-in?auth_error=google');
      } catch (error) {
        console.error('Supabase auth callback error:', error);
        router.replace(consumePurchaseIntent() ? `${US_SIGN_IN_PATH}&auth_error=google` : '/sign-in?auth_error=google');
      }
    };

    handle();
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-primary text-base">Signing you in…</p>
    </div>
  );
}
