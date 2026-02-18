'use client';

import { paymentService } from '@/app/api/services/payment';
import { SUBSCRIPTION_QUERY_KEY } from '@/hooks/useSubscriptionStatus';
import { supabase } from '@/lib/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

type VerificationPhase = 'loading' | 'success' | 'failed';

type VerifyOutcome = {
  isSuccess: boolean;
  normalizedStatus: string;
  rawResponse: unknown;
  errorMessage: string | null;
};

const SUCCESS_STATUSES = new Set(['paid', 'active', 'success', 'completed']);
const RETRYABLE_STATUSES = new Set(['', 'pending', 'not_attempted', 'processing', 'created', 'initiated']);
const FAILURE_STATUSES = new Set(['failed', 'failure', 'cancelled', 'canceled', 'expired', 'rejected']);
const VERIFY_BACKOFF_MS = [800, 1600, 3200];

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeVerifyStatus = (response: unknown): string => {
  const root = asRecord(response);
  const rootData = asRecord(root?.data);
  const subscription = asRecord(root?.subscription);
  const nestedData = asRecord(rootData?.data);

  const candidates = [
    rootData?.payment_status,
    nestedData?.payment_status,
    root?.payment_status,
    root?.status,
    subscription?.status,
    rootData?.status,
  ];

  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (value) return value.toLowerCase();
  }

  return '';
};

const verifyOrderWithRetry = async (orderId: string): Promise<VerifyOutcome> => {
  let lastResponse: unknown = null;
  let lastErrorMessage: string | null = null;

  for (let attempt = 0; attempt < VERIFY_BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await paymentService.verifyPayment({ order_id: orderId });
      lastResponse = response;

      const normalizedStatus = normalizeVerifyStatus(response);
      if (SUCCESS_STATUSES.has(normalizedStatus)) {
        return {
          isSuccess: true,
          normalizedStatus,
          rawResponse: response,
          errorMessage: null,
        };
      }

      if (FAILURE_STATUSES.has(normalizedStatus)) {
        return {
          isSuccess: false,
          normalizedStatus,
          rawResponse: response,
          errorMessage: null,
        };
      }

      if (!RETRYABLE_STATUSES.has(normalizedStatus)) {
        return {
          isSuccess: false,
          normalizedStatus,
          rawResponse: response,
          errorMessage: null,
        };
      }
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : String(error);
    }

    if (attempt < VERIFY_BACKOFF_MS.length - 1) {
      await sleep(VERIFY_BACKOFF_MS[attempt]);
    }
  }

  const finalStatus = normalizeVerifyStatus(lastResponse);
  return {
    isSuccess: SUCCESS_STATUSES.has(finalStatus),
    normalizedStatus: finalStatus,
    rawResponse: lastResponse,
    errorMessage: lastErrorMessage,
  };
};

function CheckoutResultContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const orderId = useMemo(() => {
    const primary = searchParams.get('order_id');
    const fallback = searchParams.get('cf_order_id');
    return primary?.trim() || fallback?.trim() || '';
  }, [searchParams]);

  const orderToken = useMemo(() => searchParams.get('order_token')?.trim() || '', [searchParams]);

  const [phase, setPhase] = useState<VerificationPhase>('loading');
  const [statusMessage, setStatusMessage] = useState('');
  const [redirectPath, setRedirectPath] = useState('/');
  const [redirectCountdown, setRedirectCountdown] = useState(4);
  const [showConfetti, setShowConfetti] = useState(false);

  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 30 }, (_, index) => ({
        id: index,
        left: Math.round((index / 30) * 100),
        delay: (index % 10) * 0.12,
        duration: 2.3 + (index % 5) * 0.4,
        rotate: (index * 37) % 360,
        color: ['#0c3c26', '#f97316', '#facc15', '#22c55e', '#2563eb'][index % 5],
      })),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const runVerification = async () => {
      if (!orderId) {
        setPhase('failed');
        setStatusMessage('Missing order_id in callback URL.');
        return;
      }

      setPhase('loading');
      setStatusMessage('');

      const outcome = await verifyOrderWithRetry(orderId);
      if (cancelled) return;

      if (outcome.isSuccess) {
        setPhase('success');
        setShowConfetti(true);
        void queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY });
        return;
      }

      setPhase('failed');
      if (outcome.normalizedStatus) {
        setStatusMessage(`Payment status: ${outcome.normalizedStatus}.`);
      } else if (outcome.errorMessage) {
        setStatusMessage(outcome.errorMessage);
      } else {
        setStatusMessage('Unable to verify payment status.');
      }
    };

    void runVerification();

    return () => {
      cancelled = true;
    };
  }, [orderId, queryClient]);

  useEffect(() => {
    if (phase !== 'success') return;

    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;

    const scheduleRedirect = async () => {
      const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null;
      let hasSupabaseSession = false;

      try {
        const { data } = await supabase.auth.getSession();
        hasSupabaseSession = Boolean(data.session);
      } catch (error) {
        console.error('Unable to resolve post-payment redirect session:', error);
      }

      if (cancelled) return;

      const targetPath = hasSupabaseSession ? '/' : guestToken ? '/sign-in?success=true' : '/sign-in?success=true';
      setRedirectPath(targetPath);
      setRedirectCountdown(4);

      countdownTimer = setInterval(() => {
        setRedirectCountdown((previous) => (previous > 1 ? previous - 1 : previous));
      }, 1000);

      redirectTimer = setTimeout(() => {
        router.replace(targetPath);
      }, 4000);
    };

    void scheduleRedirect();

    return () => {
      cancelled = true;
      if (redirectTimer) clearTimeout(redirectTimer);
      if (countdownTimer) clearInterval(countdownTimer);
    };
  }, [phase, router]);

  useEffect(() => {
    if (!showConfetti) return;
    const timer = setTimeout(() => {
      setShowConfetti(false);
    }, 4500);
    return () => clearTimeout(timer);
  }, [showConfetti]);

  return (
    <main className="relative min-h-[100dvh] bg-background text-primary flex items-center justify-center px-4 py-8">
      {showConfetti && phase === 'success' && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {confettiPieces.map((piece) => (
            <span
              key={piece.id}
              className="confetti-piece absolute top-[-12%] rounded-sm"
              style={{
                left: `${piece.left}%`,
                backgroundColor: piece.color,
                animationDelay: `${piece.delay}s`,
                animationDuration: `${piece.duration}s`,
                transform: `rotate(${piece.rotate}deg)`,
              }}
            />
          ))}
        </div>
      )}

      <section className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-7 sm:p-8 shadow-lg">
        <p className="text-[11px] uppercase tracking-[0.22em] text-primary/60">Payment Status</p>

        {phase === 'loading' && (
          <div className="mt-5">
            <div className="flex items-center gap-3">
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
              <h1 className="text-2xl font-semibold">Confirming Payment...</h1>
            </div>
            <p className="mt-3 text-sm text-primary/75">
              Verifying your transaction with the backend. This may take a few seconds.
            </p>
            <p className="mt-4 text-xs text-primary/60">Order ID: {orderId || 'Unavailable'}</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="mt-5">
            <h1 className="text-2xl font-semibold text-green-700">Payment Successful</h1>
            <p className="mt-3 text-sm text-primary/80">Your payment has been verified and your account is updated.</p>
            <p className="mt-4 text-xs text-primary/60">Order ID: {orderId}</p>
            {orderToken && <p className="mt-1 text-xs text-primary/50">Order Token: {orderToken}</p>}
            <button
              onClick={() => router.replace(redirectPath)}
              className="mt-6 w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-background hover:opacity-90 transition-opacity"
            >
              Continue Now
            </button>
            <p className="mt-3 text-xs text-primary/60 text-center">Redirecting in {redirectCountdown}s...</p>
          </div>
        )}

        {phase === 'failed' && (
          <div className="mt-5">
            <h1 className="text-2xl font-semibold text-red-700">Payment Failed</h1>
            <p className="mt-3 text-sm text-primary/80">
              {statusMessage || 'Payment could not be confirmed. Please retry your payment.'}
            </p>
            <p className="mt-4 text-xs text-primary/60">Order ID: {orderId || 'Unavailable'}</p>
            <button
              onClick={() => router.push('/')}
              className="mt-6 w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-background hover:opacity-90 transition-opacity"
            >
              Retry Payment
            </button>
          </div>
        )}
      </section>

      <style jsx>{`
        .confetti-piece {
          width: 8px;
          height: 16px;
          opacity: 0;
          animation-name: confetti-fall;
          animation-iteration-count: infinite;
          animation-timing-function: linear;
        }

        @keyframes confetti-fall {
          0% {
            transform: translate3d(0, -10vh, 0) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            transform: translate3d(0, 120vh, 0) rotate(720deg);
            opacity: 0;
          }
        }
      `}</style>
    </main>
  );
}

function CheckoutResultFallback() {
  return (
    <main className="relative min-h-[100dvh] bg-background text-primary flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-7 sm:p-8 shadow-lg">
        <p className="text-[11px] uppercase tracking-[0.22em] text-primary/60">Payment Status</p>
        <div className="mt-5">
          <div className="flex items-center gap-3">
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
            <h1 className="text-2xl font-semibold">Loading...</h1>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function CheckoutResultPage() {
  return (
    <Suspense fallback={<CheckoutResultFallback />}>
      <CheckoutResultContent />
    </Suspense>
  );
}
