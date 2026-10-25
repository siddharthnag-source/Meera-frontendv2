'use client';

import { paymentService } from '@/app/api/services/payment';
import { trackingService } from '@/app/api/services/tracking';
import { SUBSCRIPTION_QUERY_KEY } from '@/hooks/useSubscriptionStatus';
import { supabase } from '@/lib/supabaseClient';
import { queueMarketingEvent } from '@/lib/marketingEvents';
import { isUSPurchaseIntent } from '@/lib/purchaseIntent';
import type { CashfreeInstance, PlanType, PricingModalProps, PricingModalSource } from '@/types/pricing';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { toast, Toaster } from 'react-hot-toast';
import { HiArrowLeft } from 'react-icons/hi2';
import meeraLogo from '../../../public/icons/meera.svg';
import starBg from '../../../public/images/star.png';
import { COUPON_CODES, INTERNATIONAL_LIFETIME_PRICE_USD, PLAN_PRICES } from './constants';

// Helper functions
const calculateDiscountedPrice = (price: number, discountPercentage: number): number => {
  const discount = (price * discountPercentage) / 100;
  return Math.round(price - discount);
};

const getPriceDisplay = (basePrice: number, discountedPrice: number | null, currency = '₹'): ReactNode => {
  const currentPrice = discountedPrice ?? basePrice;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-white font-semibold">
        {currency}
        {currentPrice}
      </span>
      {currentPrice < basePrice && <span className="text-green-200 text-xs font-medium">Coupon applied</span>}
      {currentPrice === 0 && <span className="text-green-300 text-xs font-medium">(Free)</span>}
    </div>
  );
};

const CONFETTI_COLORS = [
  '#F59E0B',
  '#34D399',
  '#60A5FA',
  '#F472B6',
  '#F97316',
  '#A78BFA',
] as const;
const CONFETTI_PIECES = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  left: `${Math.round((index / 28) * 100)}%`,
  delay: (index % 7) * 0.08,
  duration: 1.8 + (index % 5) * 0.18,
  drift: index % 2 === 0 ? 16 : -16,
  spin: index % 2 === 0 ? 220 : -220,
}));

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  if ('status' in error && typeof error.status === 'number') return error.status;
  return null;
};

export const PricingModal = ({ isOpen, onClose, isClosable, source }: PricingModalProps) => {
  const [showEntryCode, setShowEntryCode] = useState(false);
  const [market, setMarket] = useState<'india' | 'international' | null>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const [offerError, setOfferError] = useState(false);
  const selectedPlan: PlanType = 'lifetime';
  const [entryCode, setEntryCode] = useState('');
  const [cashfree, setCashfree] = useState<CashfreeInstance | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [showSuccessCelebration, setShowSuccessCelebration] = useState(false);
  const [discountedPrices, setDiscountedPrices] = useState<{
    monthly: number | null;
    lifetime: number | null;
  }>({ monthly: null, lifetime: null });

  const queryClient = useQueryClient();
  const hasTrackedOpenRef = useRef(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripeRequestKey = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isClosable && !isPaymentLoading) onClose();
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      previousFocus?.focus();
    };
  }, [
    isOpen,
    isClosable,
    isPaymentLoading,
    showEntryCode,
    onClose,
  ]);

  useEffect(() => {
    if (!isOpen || market) return;
    const controller = new AbortController();
    fetch('/api/payment/offer', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Offer unavailable');
        return response.json();
      })
      .then((offer) => {
        setMarket(isUSPurchaseIntent(new URLSearchParams(window.location.search)) ? 'international' : offer.market === 'india' ? 'india' : 'international');
        setStripeReady(offer.stripeReady === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOfferError(true);
      });
    return () => controller.abort();
  }, [isOpen, market]);

  useEffect(() => {
    if (isOpen && source) {
      if (!hasTrackedOpenRef.current) {
        trackingService.trackModalOpen(source as PricingModalSource);
        hasTrackedOpenRef.current = true;
      }
    } else {
      hasTrackedOpenRef.current = false;
    }
  }, [isOpen, source]);

  useEffect(() => {
    if (!isOpen || market !== 'india') return;
    let cancelled = false;
    const initializeCashfree = async () => {
      const { load } = await import('@cashfreepayments/cashfree-js');
      const rawMode = process.env.NEXT_PUBLIC_CASHFREE_MODE?.toLowerCase();
      const cashfreeMode: 'sandbox' | 'production' = rawMode === 'production' ? 'production' : 'sandbox';
      const cfInstance = await load({
        mode: cashfreeMode,
      });
      if (!cancelled) setCashfree(cfInstance);
    };
    void initializeCashfree().catch(() => console.warn('Unable to load Cashfree checkout'));
    return () => {
      cancelled = true;
    };
  }, [isOpen, market]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setShowSuccessCelebration(false);
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
    }
  }, [isOpen]);

  // Update both plan prices when coupon is applied/removed
  const updatePricesWithCoupon = (couponCode: string | null) => {
    if (!couponCode) {
      setDiscountedPrices({ monthly: null, lifetime: null });
      return;
    }

    const discountPercentage = COUPON_CODES[couponCode as keyof typeof COUPON_CODES];
    if (discountPercentage) {
      setDiscountedPrices({
        monthly: calculateDiscountedPrice(PLAN_PRICES.monthly, discountPercentage),
        lifetime: calculateDiscountedPrice(PLAN_PRICES.lifetime, discountPercentage),
      });
    }
  };

  const handleCouponCode = () => {
    const normalizedEntryCode = entryCode.trim().toUpperCase();
    if (normalizedEntryCode.length > 0) {
      const discountPercentage = COUPON_CODES[normalizedEntryCode as keyof typeof COUPON_CODES];

      if (discountPercentage) {
        setAppliedCoupon(normalizedEntryCode);
        updatePricesWithCoupon(normalizedEntryCode);
        setEntryCode(normalizedEntryCode);
        toast.success('Coupon applied successfully!');
        setShowEntryCode(false);
      } else {
        toast.error('Invalid coupon code');
      }
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon('');
    updatePricesWithCoupon(null);
    setEntryCode('');
  };

  // Get current price based on plan and discount
  const getCurrentPrice = (plan: PlanType) => {
    return discountedPrices[plan] ?? PLAN_PRICES[plan];
  };

  const setPaidSubscriptionState = (subscriptionEndDate: string | null) => {
    const resolvedSubscriptionEndDate = typeof subscriptionEndDate === 'string' ? subscriptionEndDate : null;

    queryClient.setQueryData(SUBSCRIPTION_QUERY_KEY, {
      plan_type: 'paid',
      status: 'active',
      is_pro: true,
      subscription_end_date: resolvedSubscriptionEndDate,
      talktime_left: 0,
      tokens_left: 100,
      message: 'PRO activated',
    });

    queryClient.setQueriesData({ queryKey: SUBSCRIPTION_QUERY_KEY }, (existing) => {
      const current = (existing as Record<string, unknown> | undefined) ?? {};
      const currentTalktime = typeof current.talktime_left === 'number' ? current.talktime_left : 0;
      const currentTokens = typeof current.tokens_left === 'number' ? current.tokens_left : 0;

      return {
        ...current,
        plan_type: 'paid',
        status: 'active',
        is_pro: true,
        subscription_end_date: resolvedSubscriptionEndDate,
        talktime_left: currentTalktime,
        tokens_left: currentTokens > 0 ? currentTokens : 100,
        message: 'PRO activated',
      };
    });
  };

  const refreshSubscriptionState = async () => {
    try {
      const response = await paymentService.getSubscriptionStatus(true);
      if (response.plan_type === 'paid') {
        setPaidSubscriptionState(
          typeof response.subscription_end_date === 'string' ? response.subscription_end_date : null,
        );
      }
    } catch (error) {
      console.warn('Unable to refresh subscription after payment:', error);
    }

    await queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY });
    await queryClient.refetchQueries({ queryKey: SUBSCRIPTION_QUERY_KEY, type: 'active' });
  };

  const finishWithCelebration = () => {
    setShowSuccessCelebration(true);
    toast.success('Your PRO is activated 🚀', { duration: 5000 });

    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => {
      setShowSuccessCelebration(false);
      onClose();
    }, 2200);
  };

  const handleSubscribe = async () => {
    if (isPaymentLoading || !market) return;
    if (market === 'india' && !cashfree) {
      toast.error('Secure checkout is loading. Please try again in a moment.');
      return;
    }
    try {
      setIsPaymentLoading(true);

      if (market === 'international') {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          toast.error('Please sign in again to continue.');
          return;
        }
        stripeRequestKey.current ??= crypto.randomUUID();
        const checkout = await fetch('/api/payment/stripe/checkout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Idempotency-Key': stripeRequestKey.current },
        });
        const result = await checkout.json();
        if (!checkout.ok) throw new Error(result.error || 'Unable to start checkout.');
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com')
          throw new Error('Invalid checkout URL.');
        if (result.marketingEvent) queueMarketingEvent(result.marketingEvent);
        window.location.assign(url.toString());
        return;
      }

      const response = await paymentService.createPayment({
        plan_type: selectedPlan,
        amount: getCurrentPrice(selectedPlan),
        order_currency: 'INR',
        ...(appliedCoupon && { coupon_code: appliedCoupon }),
      });

      const data = response as {
        payment_session_id?: string;
        payment_status?: string;
        order_id?: string;
        data?: {
          payment_session_id?: string;
          payment_status?: string;
          order_id?: string;
        };
      };

      const paymentStatus = data.payment_status || data.data?.payment_status;
      const sessionId = data.payment_session_id || data.data?.payment_session_id;
      const orderId = data.order_id || data.data?.order_id;

      // Handle 100% discount or BYPASS coupon case
      if (typeof paymentStatus === 'string' && paymentStatus.toLowerCase() === 'paid') {
        await refreshSubscriptionState();
        finishWithCelebration();
        return;
      }

      // Regular payment flow
      if (!sessionId) {
        toast.error('Unable to start payment. Please try again.');
        return;
      }

      if (!cashfree || typeof cashfree.checkout !== 'function') {
        toast.error('Payment gateway is not ready. Please try again in a moment.');
        return;
      }

      if (!orderId) {
        toast.error('Payment verification could not start. Please try again.');
        return;
      }

      let verificationHandled = false;

      console.log('[DEBUG] Calling cashfree.checkout...');

      await cashfree
        .checkout({
          paymentSessionId: sessionId,
          redirectTarget: '_modal',
        })
        .then(async (result) => {
          console.log('[DEBUG] Checkout promise RESOLVED:', result);
          if (result && typeof result === 'object' && 'paymentDetails' in result && result.paymentDetails) {
            verificationHandled = true;

            let verifyResponse:
              | {
                  success?: boolean;
                  status?: string;
                  payment_status?: string;
                  subscription?: {
                    status?: string;
                    subscription_end_date?: string | null;
                  };
                  data?: {
                    payment_status?: string;
                    subscription_end_date?: string | null;
                  };
                }
              | undefined;

            try {
              verifyResponse = await paymentService.verifyPayment({
                order_id: orderId,
                plan_type: selectedPlan,
              });
            } catch (verifyError) {
              console.error('Payment verification request failed:', verifyError);
              toast.error('Payment verification failed. Please contact support.');
              return;
            }

            const verifyData = verifyResponse || {};
            console.log('Verify Response:', verifyData);

            const verifyStatus =
              verifyData.data?.payment_status ||
              verifyData.payment_status ||
              verifyData.subscription?.status ||
              verifyData.status ||
              '';
            const normalizedVerifyStatus = String(verifyStatus).toLowerCase();
            const isPaid =
              normalizedVerifyStatus === 'paid' ||
              normalizedVerifyStatus === 'active' ||
              (verifyData.success === true && normalizedVerifyStatus.length === 0);

            if (!isPaid) {
              toast.error('Payment verification failed. Please contact support.');
              return;
            }

            const resolvedSubscriptionEndDate =
              verifyData.data?.subscription_end_date ?? verifyData.subscription?.subscription_end_date ?? null;

            setPaidSubscriptionState(
              typeof resolvedSubscriptionEndDate === 'string' ? resolvedSubscriptionEndDate : null,
            );
            await refreshSubscriptionState();
            finishWithCelebration();
          }
        })
        .catch((error) => {
          console.error('[DEBUG] Checkout promise REJECTED:', error);
        })
        .finally(() => {
          console.log('[DEBUG] Checkout promise SETTLED (finished)');
        });

      if (!verificationHandled) {
        toast.error('Payment was not completed. Please try again.');
        return;
      }
    } catch (error) {
      console.error('Payment failed:', error);
      if (getErrorStatus(error) === 401) {
        toast.error('Session expired. Please sign in again to complete payment.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Payment failed. Please try again.');
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      localStorage.clear();
      await supabase.auth.signOut();
      window.location.href = '/sign-in';
    } catch (error) {
      console.error('Logout failed:', error);
      toast.error('Unable to log out. Please try again.');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <Toaster position="top-center" containerStyle={{ zIndex: 10001 }} />
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[9998]"
            onClick={isClosable ? onClose : undefined}
          />

          {/* Modal Container */}
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="meera-lifetime-title"
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed z-[9999] bottom-0 left-0 right-0 h-[calc(100dvh-8px)] rounded-t-3xl
                       sm:fixed sm:inset-0 sm:m-auto sm:w-[580px] sm:h-[calc(100dvh-8px)] sm:rounded-[24px]
                       px-5 py-4 sm:px-11 sm:py-7 md:px-12 md:py-9
                       [@media(max-height:760px)]:!py-4
                       [@media(max-height:700px)]:!py-3"
            style={{
              backgroundImage: `
                url(${starBg.src}),
                linear-gradient(to bottom,
                  #741942 0%,
                  #741942 30%,
                  #4E0228 70%,
                  #2D0117 100%
                )
              `,
              backgroundPosition: 'right top, center',
              backgroundRepeat: 'no-repeat, no-repeat',
              backgroundSize: '150px, cover',
              overflowY: 'auto',
            }}
          >
            {/* Close Button - Fixed at top-right */}
            {isClosable && (
              <button
                onClick={onClose}
                aria-label="Close pricing"
                className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors z-10
                           w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
              >
                ✕
              </button>
            )}
            <AnimatePresence>
              {showSuccessCelebration && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 bg-[#2D0117]/90 backdrop-blur-sm flex items-center justify-center"
                >
                  <div className="text-center px-8">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0, y: 16 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                      className="rounded-2xl border border-white/20 bg-white/10 px-8 py-6"
                    >
                      <p className="text-sm text-green-300 font-semibold mb-2">Payment Successful</p>
                      <h2 className="text-white text-2xl font-serif">Your PRO is activated</h2>
                      <p className="text-white/70 text-sm mt-3">Redirecting you to chat...</p>
                    </motion.div>
                  </div>
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {CONFETTI_PIECES.map((piece) => (
                      <motion.span
                        key={piece.id}
                        className="absolute top-[-12%] h-3 w-2 rounded-sm"
                        style={{
                          left: piece.left,
                          backgroundColor: CONFETTI_COLORS[piece.id % CONFETTI_COLORS.length],
                        }}
                        initial={{ opacity: 0, y: '-8%' }}
                        animate={{
                          opacity: [
                            0,
                            1,
                            1,
                            0.9,
                          ],
                          y: ['-8%', '118%'],
                          x: [
                            0,
                            piece.drift,
                            0,
                          ],
                          rotate: [0, piece.spin],
                        }}
                        transition={{
                          duration: piece.duration,
                          delay: piece.delay,
                          ease: 'easeIn',
                        }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!showEntryCode ? (
              /* Main Pricing View */
              <div className="h-full flex flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {/* Header Section */}
                  <div className="flex-shrink-0 mb-6 [@media(max-height:760px)]:!mb-3">
                    <div className="flex items-center gap-2">
                      <Image src={meeraLogo} alt="Meera" height={24} className="h-5 w-auto sm:h-6" />
                      <span className="text-white font-serif italic text-lg sm:text-xl">Meera</span>
                    </div>
                  </div>

                  {/* Main Title */}
                  <div className="flex-shrink-0 mb-4 [@media(max-height:760px)]:!mb-2">
                    <h1
                      id="meera-lifetime-title"
                      className="text-3xl sm:text-[32px] text-white font-serif font-semibold leading-[1.12] sm:leading-[1.08]
                                 [@media(max-height:760px)]:!text-[28px] [@media(max-height:700px)]:!text-[26px]"
                    >
                      <span className="block">Your companion.</span>
                      <span className="block">For life.</span>
                    </h1>
                  </div>

                  {/* Description */}
                  <div className="flex-shrink-0 mb-5 sm:mb-8 md:mb-10 [@media(max-height:760px)]:!mb-4 [@media(max-height:700px)]:!mb-3">
                    <p
                      className="text-white text-sm sm:text-base italic font-sans font-semibold leading-relaxed
                                [@media(max-height:760px)]:!text-sm"
                    >
                      A companion for conversations, fresh ideas, and everything you want to explore.
                    </p>
                  </div>

                  <div className="flex-grow min-h-0 md:min-h-8 [@media(max-height:760px)]:!min-h-0" />

                  {/* Content Section */}
                  <div className="flex-shrink-0">
                    {/* Models Available */}
                    <div className="mb-3 sm:mb-4 md:mb-5 [@media(max-height:760px)]:!mb-2">
                      <p className="text-white text-sm sm:text-base font-semibold">
                        One lifetime offer. Everything below included.
                      </p>
                    </div>

                    {/* Pricing Plan */}
                    <div className="mb-2 sm:mb-3 md:mb-4 space-y-3 [@media(max-height:760px)]:!mb-2 [@media(max-height:760px)]:!space-y-2">
                      <section
                        aria-label="Lifetime access"
                        className="rounded-2xl border border-white/30 bg-white/10 p-5 sm:p-6"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="text-lg font-semibold text-white">Meera for life</h2>
                          <span className="rounded-full bg-[#e9efce] px-3 py-1 text-xs font-semibold text-[#31412a]">
                            One payment
                          </span>
                        </div>
                        <div className="mt-4 text-5xl tracking-tight">
                          {market === 'india' ? (
                            getPriceDisplay(PLAN_PRICES.lifetime, discountedPrices.lifetime)
                          ) : market === 'international' ? (
                            getPriceDisplay(INTERNATIONAL_LIFETIME_PRICE_USD, null, 'US$')
                          ) : (
                            <span className="text-lg text-white/70">Loading your offer…</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-white/75">
                          Lifetime access. No monthly bills. No auto-renewal.
                        </p>
                        <label className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-white/80">
                          Payment region
                          <select
                            aria-label="Payment region"
                            value={market ?? ''}
                            disabled={isPaymentLoading}
                            onChange={(event) => {
                              setMarket(event.target.value as 'india' | 'international');
                              removeCoupon();
                              stripeRequestKey.current = null;
                            }}
                            className="rounded-lg border border-white/30 bg-[#4E0228] px-3 py-2 text-white"
                          >
                            <option value="" disabled>
                              Select your region
                            </option>
                            <option value="india">India · INR</option>
                            <option value="international">International · USD</option>
                          </select>
                        </label>
                        {offerError && (
                          <p className="mt-2 text-xs text-white/75">Choose your payment region to see your offer.</p>
                        )}
                        <ul className="mt-5 space-y-2.5 text-sm text-white/90">
                          <li>✓ A companion for your everyday conversations</li>
                          <li>✓ Explore ideas with web information</li>
                          <li>✓ Create and share with images</li>
                          <li>✓ Access opens after payment confirmation</li>
                        </ul>
                      </section>
                    </div>

                    {/* Applied Coupon */}
                    {appliedCoupon && (
                      <div
                        className="mb-4 flex items-center justify-between bg-white/10 border border-green-400/30
                                    px-4 py-3 rounded-lg"
                      >
                        <div className="text-white text-sm">
                          <span>Coupon: {appliedCoupon}</span>
                          <span className="ml-2 text-green-400 font-medium">
                            ({COUPON_CODES[appliedCoupon as keyof typeof COUPON_CODES]}% off)
                          </span>
                        </div>
                        <button
                          onClick={removeCoupon}
                          className="text-red-400 text-sm hover:text-red-300 transition-colors font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {/* Bottom Section */}
                <div className="flex-shrink-0 space-y-2 border-t border-white/15 pt-3 mt-3">
                  {/* Enter Code Button */}
                  {market === 'india' && (
                    <button
                      onClick={() => setShowEntryCode(true)}
                      disabled={isPaymentLoading || showSuccessCelebration}
                      className="w-full text-white/70 py-1 rounded-full
                               text-sm font-medium hover:opacity-90
                               transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Have a coupon code?
                    </button>
                  )}

                  {/* Subscribe Button */}
                  <button
                    onClick={handleSubscribe}
                    disabled={
                      isPaymentLoading ||
                      showSuccessCelebration ||
                      !market ||
                      (market === 'international' && !stripeReady)
                    }
                    className="w-full bg-[#FDF6F1] text-[#1A0B14] py-3 md:py-3.5 rounded-full
                               text-base sm:text-lg font-medium hover:opacity-90
                               transition-opacity disabled:opacity-50 disabled:cursor-not-allowed
                               [@media(max-height:760px)]:!py-2.5 [@media(max-height:760px)]:!text-base"
                  >
                    {isPaymentLoading
                      ? 'Opening secure checkout…'
                      : market === 'international' && !stripeReady
                        ? 'International checkout coming soon'
                        : market === 'international'
                          ? 'Get lifetime access · US$99'
                          : getCurrentPrice(selectedPlan) === 0
                            ? 'Activate lifetime access'
                            : `Get lifetime access · ₹${getCurrentPrice(selectedPlan)}`}
                  </button>
                  <p className="text-center text-xs text-white/75">
                    {market === 'india'
                      ? 'Secure payment with Cashfree · UPI & cards'
                      : market === 'international'
                        ? 'Secure payment with Stripe · US$99 or local equivalent'
                        : 'Choose your payment region above'}
                  </p>
                  <a
                    href="mailto:siddharth.nag@himeera.com"
                    className="block text-center text-xs text-white/70 underline underline-offset-4"
                  >
                    Questions before you buy? Talk to us
                  </a>
                  <p className="text-center text-[11px] leading-5 text-white/60">
                    Meera Labs Inc. ·{' '}
                    <Link href="/terms" target="_blank" className="underline">
                      Terms
                    </Link>{' '}
                    ·{' '}
                    <Link href="/refund-policy" target="_blank" className="underline">
                      Refunds
                    </Link>{' '}
                    ·{' '}
                    <Link href="/privacy" target="_blank" className="underline">
                      Privacy
                    </Link>
                  </p>

                  {/* Logout */}
                  <div className="flex justify-center items-center gap-2 pt-0 text-xs text-white/40">
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={isPaymentLoading || showSuccessCelebration}
                      className="font-medium tracking-wide text-white/45 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Entry Code View */
              <div className="min-h-full flex flex-col">
                {/* Header with Back Button */}
                <div className="flex-shrink-0 mb-8">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowEntryCode(false)}
                      disabled={isPaymentLoading || showSuccessCelebration}
                      aria-label="Go back"
                      className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20
                                 flex items-center justify-center transition-colors border border-white/20
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <HiArrowLeft className="text-white text-lg" />
                    </button>

                    <div className="flex items-center gap-2">
                      <Image src={meeraLogo} alt="Meera" height={24} className="h-5 w-auto sm:h-6" />
                      <span className="text-white font-serif italic text-lg sm:text-xl">Meera</span>
                    </div>
                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-grow flex flex-col min-h-0">
                  <div className="max-w-sm mx-auto w-full mt-10">
                    <h2
                      id="meera-lifetime-title"
                      className="text-xl sm:text-2xl text-white font-serif mb-8 text-center"
                    >
                      Enter Coupon Code
                    </h2>

                    <div className="space-y-4">
                      <input
                        type="text"
                        value={entryCode}
                        onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                        disabled={isPaymentLoading || showSuccessCelebration}
                        placeholder="Enter Code"
                        className="w-full bg-white text-[#1A0B14] px-5 py-4 rounded-full
                                   text-base placeholder:text-gray-400 focus:outline-none focus:ring-2
                                   focus:ring-white/20 transition-shadow disabled:opacity-50"
                      />

                      <button
                        onClick={handleCouponCode}
                        disabled={isPaymentLoading || showSuccessCelebration || entryCode.length === 0}
                        className={`w-full py-4 rounded-full text-base font-medium transition-all
                                   ${
                                     entryCode.length > 0
                                       ? 'bg-[#491f33] text-white hover:bg-[#5a2640]'
                                       : 'bg-[#491f33]/50 text-white/60 cursor-not-allowed'
                                   } disabled:opacity-50`}
                      >
                        {isPaymentLoading ? 'Verifying...' : 'Apply Coupon'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Logout */}
                <div className="flex-shrink-0 flex justify-center items-center gap-2 pt-4 text-xs text-white/40">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isPaymentLoading || showSuccessCelebration}
                    className="font-medium tracking-wide text-white/45 transition-colors hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
