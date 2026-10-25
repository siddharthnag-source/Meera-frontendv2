'use client';

import { SuccessDialog } from '@/components/SuccessDialog';
import { PublicSiteFallback } from '@/components/PublicSiteFallback';
import { OpenInBrowserDialog } from '@/components/auth/OpenInBrowserDialog';
import {
  breakAuthRedirectLoop,
  clearAuthRedirectTrace,
  clearGuestTokenState,
  GUEST_TOKEN_COOKIE_KEY,
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
import { startGoogleOAuth } from '@/lib/auth/startGoogleOAuth';
import { isUSPurchaseIntent, rememberPurchaseIntent, US_CHECKOUT_PATH } from '@/lib/purchaseIntent';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
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

const testimonials = [
  {
    quote:
      "I chatted with her for ten minutes and didn't even realise the time had passed. I honestly needed that conversation—and she helped a lot.",
    name: 'Ananya',
    city: 'Bengaluru',
    code: 'BLR',
    country: 'India',
    coordinates: '12.97° N  ·  77.59° E',
  },
  {
    quote: 'The way she understands what I write and asks questions feels very real.',
    name: 'Rhea',
    city: 'Berlin',
    code: 'BER',
    country: 'Germany',
    coordinates: '52.52° N  ·  13.40° E',
  },
  {
    quote: 'It felt like someone genuinely understood what I was trying to say.',
    name: 'Ishaan',
    city: 'Toronto',
    code: 'YYZ',
    country: 'Canada',
    coordinates: '43.65° N  ·  79.38° W',
  },
  {
    quote: "She responds like a companion and tries to understand how I feel. I'd definitely come back whenever I feel low.",
    name: 'Mehak',
    city: 'Singapore',
    code: 'SIN',
    country: 'Singapore',
    coordinates: '1.35° N  ·  103.82° E',
  },
  {
    quote: 'I had quite a deep chat with Meera.',
    name: 'Nikhil',
    city: 'London',
    code: 'LDN',
    country: 'United Kingdom',
    coordinates: '51.51° N  ·  0.13° W',
  },
  {
    quote:
      "Mind-blowing conversation fluidity. I chatted for 30 minutes, and it was one of the most natural AI conversations I've had. Pretty convincing so far.",
    name: 'Aditya Tiwari',
    city: 'New Delhi',
    code: 'DEL',
    country: 'India',
    coordinates: '28.61° N  ·  77.21° E',
  },
] as const;

function SignInClient() {
  const searchParams = useSearchParams();
  const isUSOffer = isUSPurchaseIntent(searchParams);
  const [signInError, setSignInError] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const referralId = searchParams.get('referral_id');
  const hasGoogleAuthError = searchParams.get('auth_error') === 'google';
  const router = useRouter();
  const testimonialRailRef = useRef<HTMLDivElement>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [openInBrowserState, setOpenInBrowserState] = useState<{
    isOpen: boolean;
    openUrl: string;
    browserHint: 'Safari' | 'Chrome';
  }>({
    isOpen: false,
    openUrl: '',
    browserHint: 'Safari',
  });

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
      router.replace(isUSOffer ? US_CHECKOUT_PATH : decision.target);
      return;
    }

    if (sessionStatus === 'unauthenticated') {
      clearAuthRedirectTrace();
    }
  }, [router, sessionStatus, isUSOffer]);

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setSignInError(false);
    rememberPurchaseIntent(isUSOffer);
    try {
      if (referralId) {
        document.cookie = `referral_id=${referralId}; path=/; max-age=3600; SameSite=Lax`;
      }

      const guestToken = getGuestToken();
      if (guestToken) {
        document.cookie = `${GUEST_TOKEN_COOKIE_KEY}=${guestToken}; path=/; max-age=3600; SameSite=Lax`;
      }

      const result = await startGoogleOAuth();
      if (result.status === 'blocked_in_embedded_browser') {
        setOpenInBrowserState({
          isOpen: true,
          openUrl: result.openUrl,
          browserHint: result.browserHint,
        });
      } else if (result.status === 'failed') {
        setSignInError(true);
        console.error('Error signing in with Google:', result.message);
      }
    } catch (error) {
      setSignInError(true);
      console.error('Error signing in with Google:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const moveTestimonials = (direction: -1 | 1) => {
    const rail = testimonialRailRef.current;
    if (!rail) return;

    const firstSlide = rail.firstElementChild as HTMLElement | null;
    const railStyles = window.getComputedStyle(rail);
    const railGap = Number.parseFloat(railStyles.columnGap || railStyles.gap) || 0;
    rail.scrollBy({
      left: direction * ((firstSlide?.offsetWidth ?? rail.clientWidth * 0.78) + railGap),
      behavior: 'smooth',
    });
  };

  // The public landing content must render before session restoration finishes.
  // Only an already confirmed session needs the neutral redirect placeholder.
  if (sessionStatus === 'authenticated') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="bg-background text-primary">
      <section className="relative min-h-[100dvh] overflow-hidden">
        <div className="pointer-events-none absolute -right-36 -top-44 h-[28rem] w-[28rem] rounded-full bg-[#ed1c24]/[0.07] blur-3xl" />

        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[90rem] flex-col px-5 sm:px-9 lg:px-16 xl:px-20">
          <header className="flex h-20 items-center justify-between sm:h-24">
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Meera home">
              <Image src="/icons/meera.svg" alt="" width={34} height={34} className="h-8 w-8 sm:h-9 sm:w-9" priority />
              <span className="font-serif text-[22px] italic tracking-tight sm:text-2xl">
                {(process.env.NEXT_PUBLIC_APP_NAME || 'meera').toLowerCase()}
              </span>
            </Link>

            <a
              href="#intelligence"
              className="text-xs font-medium tracking-wide text-primary/75 transition-colors hover:text-primary sm:text-sm"
            >
              About Meera
            </a>
          </header>

          <div className="grid flex-1 items-center gap-8 pb-10 pt-3 sm:gap-12 sm:pb-14 lg:grid-cols-[46fr_54fr] lg:gap-12 lg:pb-16 lg:pt-0 xl:gap-20">
            <div className="mx-auto w-full max-w-[37rem] text-center lg:mx-0 lg:text-left">
              <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/75 sm:text-xs">
                Meet Meera
              </p>

              <h1 className="text-balance font-serif text-[clamp(3.25rem,7vw,6rem)] font-normal leading-[0.9] tracking-[-0.045em]">
                <span className="lg:block">Your personal</span>{' '}
                <span className="lg:block">companion.</span>
              </h1>

              <p className="mx-auto mt-7 max-w-lg text-base leading-7 text-primary/75 sm:text-lg sm:leading-8 lg:mx-0">
                Talk through bad days, learn something new, or simply have someone to talk to.
              </p>

              <button
                onClick={handleGoogleSignIn}
                disabled={isSigningIn}
                className={cn(
                  'group relative mx-auto mt-8 flex h-14 w-full max-w-sm cursor-pointer items-center justify-center rounded-full bg-primary px-8 text-[15px] font-medium text-background transition-all duration-300 lg:mx-0',
                  'shadow-[0_16px_40px_rgba(12,60,38,0.16)] hover:-translate-y-0.5 hover:shadow-[0_20px_46px_rgba(12,60,38,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background',
                )}
              >
                <FcGoogle className="absolute left-5 rounded-full bg-white p-1 text-[28px]" aria-hidden="true" />
                <span>{isSigningIn ? 'Connecting…' : isUSOffer ? 'Continue to $99 lifetime access' : 'Talk to Meera'}</span>
                <span className="ml-2 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                  →
                </span>
              </button>

              {isUSOffer && (
                <div className="mx-auto mt-4 max-w-sm text-sm leading-6 lg:mx-0">
                  <p className="font-semibold">$99 once. Lifetime access. No recurring subscription.</p>
                  <p className="text-primary/75">Text conversations, web information, and image creation. Sign in, then pay securely with Stripe.</p>
                  <Link href="/refund-policy" className="underline underline-offset-4">Read our refund policy</Link>
                </div>
              )}

              {(hasGoogleAuthError || signInError) && (
                <p role="alert" className="mx-auto mt-3 max-w-sm text-sm text-[#a30d13] lg:mx-0">
                  Google sign-in could not be completed. Please try again from this page.
                </p>
              )}

              <p className={cn('text-[11px] tracking-wide text-primary/75', hasGoogleAuthError ? 'mt-2' : 'mt-3')}>
                Continue securely with Google
              </p>
            </div>

            <div className="relative -mx-4 flex items-center justify-center sm:mx-auto sm:w-full">
              <div className="pointer-events-none absolute inset-[18%] rounded-full bg-white/70 blur-3xl" />
              <Image
                src="/images/home.svg?v=raw-meera-orb-v1"
                alt="People sharing thoughts, questions, and feelings with Meera"
                width={636}
                height={700}
                priority
                unoptimized
                sizes="(max-width: 1024px) 92vw, 54vw"
                className="relative mx-auto h-auto w-full max-w-[540px] drop-shadow-[0_28px_50px_rgba(12,60,38,0.08)] sm:max-w-[590px] lg:w-[92%] lg:max-w-[580px] xl:w-full xl:max-w-[600px]"
              />
            </div>
          </div>

          <a
            href="#intelligence"
            aria-label="Discover more about Meera"
            className="mb-6 hidden self-center text-[10px] uppercase tracking-[0.3em] text-primary/75 transition-colors hover:text-primary/70 lg:block"
          >
            Discover ↓
          </a>
        </div>
      </section>

      <section id="intelligence" className="relative overflow-hidden border-t border-primary/[0.07] bg-[#f4ede3]">
        <div className="pointer-events-none absolute -bottom-40 -left-36 h-[30rem] w-[30rem] rounded-full bg-[#49d8cf]/[0.08] blur-3xl" />

        <div className="relative mx-auto w-full max-w-7xl px-5 pb-20 pt-16 sm:px-9 sm:pb-24 sm:pt-20 lg:px-14 lg:pb-28 lg:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/75 sm:text-xs">
              Whatever the day brings
            </p>
            <h2 className="mt-5 text-balance font-serif text-[clamp(2.5rem,6vw,5.25rem)] font-normal leading-[0.98] tracking-[-0.04em]">
              A conversation can change how a moment feels.
            </h2>
          </div>

          <div className="mx-auto mt-16 grid max-w-6xl border-y border-primary/10 sm:grid-cols-3 sm:divide-x sm:divide-primary/10 lg:mt-20">
            {[
              ['01', 'On difficult days', 'Talk things through, honestly and at your own pace.'],
              ['02', 'When curiosity strikes', 'Ask, explore, and learn something you did not know before.'],
              ['03', 'In quiet moments', 'Share what is on your mind, even when you do not know where to begin.'],
            ].map(([number, title, description]) => (
              <article
                key={number}
                className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-primary/10 py-8 last:border-b-0 sm:block sm:border-b-0 sm:px-8 sm:py-10 lg:px-12 lg:py-14"
              >
                <span className="font-serif text-sm italic text-primary/75">{number}</span>
                <div>
                  <h3 className="font-serif text-2xl leading-tight sm:mt-8 sm:text-[1.7rem]">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-primary/75">{description}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mx-auto mt-16 max-w-6xl sm:mt-20 lg:mt-20">
            <div className="grid items-end gap-7 border-b border-primary/10 pb-8 sm:pb-10 lg:grid-cols-2 lg:gap-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-primary/75 sm:text-xs">
                  Messages across cities
                </p>
                <p className="mt-4 text-xs leading-5 text-primary/75">Swipe or drag to explore</p>
              </div>
              <h2 className="max-w-3xl text-balance font-serif text-[clamp(2.35rem,5vw,4.5rem)] font-normal leading-[0.94] tracking-[-0.04em]">
                Different places. The same feeling of being understood.
              </h2>
            </div>

            <div className="mt-4 flex items-center justify-between gap-6 sm:mt-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-primary/75">01 — 06</p>
              <div className="flex gap-2" aria-label="Testimonial controls">
                <button
                  type="button"
                  onClick={() => moveTestimonials(-1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/12 text-xs text-primary/75 transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Previous testimonial"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveTestimonials(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/12 text-xs text-primary/75 transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Next testimonial"
                >
                  →
                </button>
              </div>
            </div>

            <div
              ref={testimonialRailRef}
              className="hide-scrollbar -mx-5 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:-mx-9 sm:mt-4 sm:px-9 lg:mx-0 lg:gap-5 lg:px-0"
              aria-label="What people say about Meera"
              tabIndex={0}
            >
              {testimonials.map((testimonial, index) => (
                <article
                  key={testimonial.name}
                  className={cn(
                    'relative flex min-h-[21rem] w-[calc(100vw-4rem)] max-w-[36rem] shrink-0 snap-start snap-always flex-col justify-between overflow-hidden rounded-[1.6rem] border p-6 sm:min-h-[23rem] sm:w-[58vw] sm:max-w-[30rem] sm:rounded-[2rem] sm:p-7 lg:w-[38%] lg:max-w-none',
                    index === 3
                      ? 'border-primary bg-primary text-background'
                      : 'border-primary/10 bg-background/60 text-primary',
                  )}
                >
                  <div
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-0 opacity-[0.045]',
                      index === 3
                        ? 'bg-[linear-gradient(rgba(255,255,255,0.75)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.75)_1px,transparent_1px)]'
                        : 'bg-[linear-gradient(rgba(12,60,38,0.85)_1px,transparent_1px),linear-gradient(90deg,rgba(12,60,38,0.85)_1px,transparent_1px)]',
                    )}
                    style={{ backgroundSize: '30px 30px' }}
                  />

                  <div className="relative flex items-start justify-between gap-6">
                    <div>
                      <p
                        className={cn(
                          'text-[10px] font-semibold uppercase tracking-[0.28em]',
                          index === 3 ? 'text-background/75' : 'text-primary/75',
                        )}
                      >
                        Message {String(index + 1).padStart(2, '0')}
                      </p>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] opacity-80">{testimonial.country}</p>
                    </div>
                    <span aria-hidden="true" className="font-serif text-[2.6rem] leading-none tracking-[-0.06em] opacity-[0.1] sm:text-[3rem]">
                      {testimonial.code}
                    </span>
                  </div>

                  <blockquote className="relative my-7 max-w-[30rem] font-serif text-[clamp(1.45rem,2.35vw,2.35rem)] leading-[1.08] tracking-[-0.03em] sm:my-8">
                    “{testimonial.quote}”
                  </blockquote>

                  <div
                    className={cn(
                      'relative flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-end sm:justify-between',
                      index === 3 ? 'border-background/15' : 'border-primary/10',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 rounded-full bg-[#ed1c24]" aria-hidden="true" />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em]">
                        {testimonial.name} <span className="mx-1.5 opacity-35">·</span> {testimonial.city}
                      </p>
                    </div>
                    <p className="text-[9px] uppercase tracking-[0.18em] opacity-80">{testimonial.coordinates}</p>
                  </div>
                </article>
              ))}
            </div>

            <p className="mt-4 text-[10px] tracking-[0.16em] text-primary/75">
              Names and locations changed for privacy · Responses lightly edited for clarity
            </p>
          </div>

          <div className="relative mx-auto mt-20 max-w-6xl overflow-hidden rounded-[2rem] bg-primary text-background sm:mt-24 sm:rounded-[3rem] lg:mt-24">
            <div
              aria-hidden="true"
              className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ff6568_0%,#ed1c24_34%,#6d0005_66%,#080000_100%)] opacity-90 shadow-[0_0_70px_rgba(237,28,36,0.24)] sm:-right-6 sm:-top-8 sm:h-40 sm:w-40 lg:right-10 lg:top-8 lg:h-44 lg:w-44"
            />
            <div aria-hidden="true" className="absolute bottom-0 left-1/2 h-px w-[82%] -translate-x-1/2 bg-background/12" />

            <div className="relative px-7 py-10 sm:px-12 sm:py-12 lg:px-14 lg:py-14">
              <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-background/75 sm:text-xs">
                Experience
              </p>

              <h2 className="mt-8 max-w-3xl font-serif text-[clamp(2.8rem,6vw,5.25rem)] font-normal leading-[0.92] tracking-[-0.045em] sm:mt-10">
                Conscious companionship.
              </h2>

              <p className="mt-5 flex items-center gap-3 text-xs font-medium tracking-[0.08em] text-background/75 sm:mt-6 sm:gap-4 sm:text-sm">
                <span>Text</span>
                <span aria-hidden="true" className="font-normal text-background/30">|</span>
                <span>Web</span>
                <span aria-hidden="true" className="font-normal text-background/30">|</span>
                <span>Image</span>
              </p>

              <div className="mt-10 flex flex-col gap-7 border-t border-background/15 pt-6 sm:mt-12 sm:flex-row sm:items-center sm:justify-between sm:pt-7">
                <p className="font-serif text-xl tracking-[-0.02em] text-background/72 sm:text-2xl">
                  7,850+ Minds <span className="mx-1.5 text-background/28">·</span> One Hive Mind
                </p>

                <button
                  onClick={handleGoogleSignIn}
                  className="group flex h-12 w-full items-center justify-center rounded-full bg-background px-7 text-sm font-semibold text-primary transition-transform duration-300 hover:-translate-y-0.5 sm:w-48"
                >
                  Talk to Meera
                  <span className="ml-2 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                    →
                  </span>
                </button>
              </div>
            </div>
          </div>

          <footer className="mx-auto mt-14 flex w-full max-w-6xl flex-col items-center justify-between gap-5 border-t border-primary/10 pt-7 text-xs text-primary/75 sm:mt-16 sm:flex-row">
            <div className="inline-flex items-center gap-2">
              <Image src="/icons/meera.svg" alt="" width={20} height={20} className="h-5 w-5" />
              <span>Meera · Your personal companion · By Meera Labs Inc.</span>
            </div>
            <nav className="flex items-center gap-6" aria-label="Legal">
              <Link href="/pricing" className="transition-colors hover:text-primary">
                Pricing
              </Link>
              <Link href="/whitepaper" className="transition-colors hover:text-primary">
                Whitepaper
              </Link>
              <Link href="/terms" className="transition-colors hover:text-primary">
                Terms
              </Link>
              <Link href="/privacy" className="transition-colors hover:text-primary">
                Privacy
              </Link>
              <Link href="/refund-policy" className="transition-colors hover:text-primary">
                Refunds
              </Link>
            </nav>
          </footer>
        </div>
      </section>
      <OpenInBrowserDialog
        isOpen={openInBrowserState.isOpen}
        openUrl={openInBrowserState.openUrl}
        browserHint={openInBrowserState.browserHint}
        onClose={() =>
          setOpenInBrowserState((prev) => ({
            ...prev,
            isOpen: false,
          }))
        }
      />
      <SearchParamsHandler enabled={sessionStatus === 'unauthenticated'} />
    </main>
  );
}

export default function SignIn() {
  return (
    <Suspense fallback={<PublicSiteFallback />}>
      <SignInClient />
    </Suspense>
  );
}
