'use client';

import { SuccessDialog } from '@/components/SuccessDialog';
import { H1, Italic } from '@/components/ui/Typography';
import {
  breakAuthRedirectLoop,
  clearAuthRedirectTrace,
  clearGuestTokenState,
  getGuestToken,
  hasConsumedSuccessFlag,
  hasSuccessQueryParam,
  logAuthRedirectEvent,
  markSuccessFlagConsumed,
  registerAuthRedirectVisit,
  resolveSignInRouteDecision,
  stripQueryParamsFromCurrentUrl,
  type SessionStatus,
} from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FcGoogle } from 'react-icons/fc';

function SearchParamsHandler({ enabled }: { enabled: boolean }) {
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const hasSuccess = hasSuccessQueryParam(window.location.search);
    if (!hasSuccess) return;

    if (!hasConsumedSuccessFlag()) {
      setShowSuccessDialog(true);
      markSuccessFlagConsumed();
      logAuthRedirectEvent('success_flag_consumed', {
        pathname: window.location.pathname,
      });
    }

    stripQueryParamsFromCurrentUrl(['success']);
  }, [enabled]);

  return (
    <>
      {showSuccessDialog && (
        <SuccessDialog
          title="Congratulations!"
          description={`You've upgraded to ${process.env.NEXT_PUBLIC_APP_NAME}  Pro.`}
          buttonText="Sign up to access your purchase"
          isOpen={showSuccessDialog}
          onClose={() => setShowSuccessDialog(false)}
        />
      )}
    </>
  );
}

function SignInClient() {
  const searchParams = useSearchParams();
  const referralId = searchParams.get('referral_id');
  const router = useRouter();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');

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

  useEffect(() => {
    const pathname = window.location.pathname;
    const currentRoute = `${window.location.pathname}${window.location.search}`;
    const guestToken = getGuestToken();

    if (sessionStatus === 'authenticated' && guestToken) {
      clearGuestTokenState('authenticated_sign_in');
    }

    const { loopDetected, visitCount } = registerAuthRedirectVisit(pathname);
    if (loopDetected) {
      const safeTarget = breakAuthRedirectLoop({ pathname, sessionStatus });
      if (safeTarget !== currentRoute) {
        router.replace(safeTarget);
      }
      return;
    }

    const decision = resolveSignInRouteDecision(sessionStatus);
    if (decision.target && decision.target !== currentRoute) {
      logAuthRedirectEvent('redirect_decision', {
        from: pathname,
        hasGuestToken: !!guestToken,
        reason: decision.reason,
        sessionStatus,
        target: decision.target,
        visitCount,
      });
      router.replace(decision.target);
      return;
    }

    if (sessionStatus === 'unauthenticated') {
      clearAuthRedirectTrace();
    }
  }, [router, sessionStatus]);

  const handleGoogleSignIn = async () => {
    try {
      if (referralId) {
        document.cookie = `referral_id=${referralId}; path=/; max-age=3600; SameSite=Lax`;
      }

      const guestToken = localStorage.getItem('guest_token');
      if (guestToken) {
        document.cookie = `guest_token=${guestToken}; path=/; max-age=3600; SameSite=Lax`;
      }

      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
    } catch (error) {
      console.error('Error signing in with Google:', error);
    }
  };

  if (sessionStatus !== 'unauthenticated') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="h-[100dvh] flex flex-col px-2 py-3 md:px-4 md:py-4 lg:px-0 max-w-[450px] mx-auto w-full overflow-hidden">
      <div className="flex flex-col h-full">
        <div className="flex items-center md:justify-center gap-2">
          <Link href="/" className="inline-flex items-center gap-2">
            <Image
              src="/icons/meera.svg"
              alt={process.env.NEXT_PUBLIC_APP_NAME || ''}
              width={24}
              height={24}
              className="w-6 h-6"
            />
            <H1 className="text-lg text-primary font-sans">
              <Italic>{`${(process.env.NEXT_PUBLIC_APP_NAME || 'meera')?.toLowerCase()}`}</Italic>
            </H1>
          </Link>
        </div>

        <div className="flex flex-col flex-1 justify-center">
          <div className="flex justify-center items-center flex-1">
            <Image
              src="/images/home.svg"
              alt="Welcome"
              width={400}
              height={400}
              priority
              className="w-auto h-auto max-w-[350px] md:max-w-[400px] max-h-[50vh] md:max-h-[55vh] object-contain"
            />
          </div>

          <div className="mt-auto space-y-3 mb-1">
            <div className="text-center">
<H1 className="text-2xl md:text-3xl text-center">
  World&apos;s first<br />
  Conscious Intelligence (CI)
</H1>
            </div>

            <button
              onClick={handleGoogleSignIn}
              className={cn(
                'flex items-center justify-center font-sans transition-all duration-200 font-[200] cursor-pointer',
                'w-full',
                'bg-transparent border-2 border-primary text-primary hover:bg-primary/5',
                'text-lg px-8 py-3',
                'rounded-full',
                'h-12 relative group bg-white hover:bg-white font-[400] border border-secondary/30 max-w-[400px] mx-auto',
              )}
            >
              <FcGoogle className="absolute left-6 text-2xl" />
              <span className="text-base font-[400] ml-6">Sign Up / Log In </span>
            </button>

            <div className="flex justify-center gap-4 mt-3">
              <Link href="/terms" className="text-xs font-[500] text-primary hover:underline">
                Terms
              </Link>
              <Link href="/privacy" className="text-xs font-[500] text-primary hover:underline">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </div>
      <SearchParamsHandler enabled={sessionStatus === 'unauthenticated'} />
    </main>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={null}>
      <SignInClient />
    </Suspense>
  );
}
