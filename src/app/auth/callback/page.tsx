'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearAuthRedirectTrace, clearGuestTokenState, logAuthRedirectEvent } from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handle = async () => {
      try {
        // Touch auth so Supabase reads the #access_token from the URL
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          clearGuestTokenState('auth_callback');
          clearAuthRedirectTrace();
          logAuthRedirectEvent('auth_callback_session_restored', {
            pathname: window.location.pathname,
          });
        }
      } catch (error) {
        console.error('Supabase auth callback error:', error);
      } finally {
        // After processing, send user to main Meera page
        router.replace('/');
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
