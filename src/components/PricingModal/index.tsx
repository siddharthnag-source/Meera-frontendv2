'use client';

import { paymentService } from '@/app/api/services/payment';
import { trackingService } from '@/app/api/services/tracking';
import { SUBSCRIPTION_QUERY_KEY } from '@/hooks/useSubscriptionStatus';
import type { CashfreeInstance, PlanType, PricingModalProps, PricingModalSource } from '@/types/pricing';
import { load } from '@cashfreepayments/cashfree-js';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { HiArrowLeft } from 'react-icons/hi2';
import meeraLogo from '../../../public/icons/meera.svg';
import starBg from '../../../public/images/star.png';
import { COUPON_CODES, PLAN_PRICES } from './constants';

// Helper functions
const calculateDiscountedPrice = (price: number, discountPercentage: number): number => {
  const discount = (price * discountPercentage) / 100;
  return Math.round(price - discount);
};

const getPriceDisplay = (plan: PlanType, basePrice: number, discountedPrice: number | null): ReactNode => {
  if (discountedPrice !== null) {
    return (
      <div className="flex items-center gap-2">
        <span className="line-through text-white/60">₹{basePrice}</span>
        <span className="text-green-400 font-semibold">₹{discountedPrice}</span>
        {discountedPrice === 0 && <span className="text-green-400 text-xs font-medium">(Free)</span>}
      </div>
    );
  }
  return `₹${basePrice}`;
};

export const PricingModal = ({ isOpen, onClose, isClosable, source }: PricingModalProps) => {
  const [showEntryCode, setShowEntryCode] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('lifetime');
  const [entryCode, setEntryCode] = useState('');
  const [cashfree, setCashfree] = useState<CashfreeInstance | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [discountedPrices, setDiscountedPrices] = useState<{
    monthly: number | null;
    lifetime: number | null;
  }>({ monthly: null, lifetime: null });

  const queryClient = useQueryClient();
  const router = useRouter();
  const hasTrackedOpenRef = useRef(false);
  const { data: session } = useSession();

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
    const initializeCashfree = async () => {
      const cfInstance = await load({
        mode: 'production',
      });
      setCashfree(cfInstance);
    };
    initializeCashfree();
  }, []);

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
    if (entryCode.length > 0) {
      const discountPercentage = COUPON_CODES[entryCode as keyof typeof COUPON_CODES];

      if (discountPercentage) {
        setAppliedCoupon(entryCode);
        updatePricesWithCoupon(entryCode);
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

  const handleSubscribe = async () => {
    try {
      setIsPaymentLoading(true);

      const response = await paymentService.createPayment({
        plan_type: selectedPlan,
        amount: getCurrentPrice(selectedPlan),
        order_currency: 'INR',
        ...(appliedCoupon && { coupon_code: appliedCoupon }),
      });

      const data = response as {
        payment_session_id?: unknown;
        payment_status?: string;
        order_id?: string;
        data?: {
          payment_session_id?: unknown;
          payment_status?: string;
          order_id?: string;
          data?: {
            payment_session_id?: unknown;
          };
        };
      };
      console.log('Backend Response:', data);

      const paymentStatus = data.payment_status || data.data?.payment_status;
      const sessionId =
        (typeof data.payment_session_id === 'string' && data.payment_session_id.trim()) ||
        (typeof data.data?.payment_session_id === 'string' && data.data.payment_session_id.trim()) ||
        (typeof data.data?.data?.payment_session_id === 'string' &&
          data.data.data.payment_session_id.trim()) ||
        '';
      const orderId = data.order_id || data.data?.order_id;

      // Handle 100% discount or BYPASS coupon case
      if (paymentStatus === 'paid') {
        toast.success('Subscription activated successfully!');

        // Force refresh subscription data
        queryClient.invalidateQueries({
          queryKey: SUBSCRIPTION_QUERY_KEY,
        });

        if (!session?.user?.email) {
          router.push('/sign-in?success=true');
        }

        onClose();
        return;
      }

      // Regular payment flow
      if (!sessionId) {
        const fullResponse = JSON.stringify(data, null, 2);
        alert(`Payment session ID is missing.\n\nBackend response:\n${fullResponse}`);
        toast.error('Unable to start payment. Please try again.');
        return;
      }

      if (!cashfree || typeof cashfree.checkout !== 'function') {
        toast.error('Payment gateway is not ready. Please try again in a moment.');
        return;
      }

      if (!orderId) {
        const fullResponse = JSON.stringify(data, null, 2);
        alert(`Order ID is missing.\n\nBackend response:\n${fullResponse}`);
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
              verifyData.data?.subscription_end_date ??
              verifyData.subscription?.subscription_end_date ??
              null;

            queryClient.setQueryData(SUBSCRIPTION_QUERY_KEY, {
              plan_type: 'paid',
              status: 'active',
              is_pro: true,
              subscription_end_date:
                typeof resolvedSubscriptionEndDate === 'string' ? resolvedSubscriptionEndDate : null,
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
                subscription_end_date:
                  typeof resolvedSubscriptionEndDate === 'string' ? resolvedSubscriptionEndDate : null,
                talktime_left: currentTalktime,
                tokens_left: currentTokens > 0 ? currentTokens : 100,
                message: 'PRO activated',
              };
            });

            queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY });

            toast.success('Your PRO is activated 🚀', { duration: 5000 });
            onClose();

            if (!session?.user?.email) {
              router.push('/sign-in?success=true');
            }
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
      toast.error('Payment failed. Please try again.');
    } finally {
      setIsPaymentLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[9998]"
            onClick={isClosable ? onClose : undefined}
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed z-[9999] bottom-0 left-0 right-0 h-[91%] rounded-t-3xl
                       sm:fixed sm:inset-0 sm:m-auto sm:w-[580px] sm:h-[700px] sm:rounded-3xl
                       px-8 py-8 md:px-20 md:py-12"
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
              overflow: 'hidden',
            }}
          >
            {/* Close Button - Fixed at top-right */}
            {isClosable && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors z-10
                           w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10"
              >
                ✕
              </button>
            )}

            {!showEntryCode ? (
              /* Main Pricing View */
              <div className="h-full flex flex-col">
                {/* Header Section */}
                <div className="flex-shrink-0 mb-6">
                  <div className="flex items-center gap-2">
                    <Image
                      src={meeraLogo}
                      alt={`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()}`}
                      height={24}
                      className="h-5 w-auto sm:h-6"
                    />
                    <span className="text-white font-serif italic text-lg sm:text-xl">
                      {`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()} os`}
                    </span>
                  </div>
                </div>

                {/* Main Title */}
                <div className="flex-shrink-0 mb-4">
                  <h1 className="text-3xl sm:text-4xl text-white font-serif leading-tight">India&apos;s AI</h1>
                </div>

                {/* Description */}
                <div className="flex-shrink-0 mb-6">
                  <p className="text-white text-sm sm:text-base italic font-sans font-semibold leading-relaxed">
                    Conscious AI Companion that works, understands
                    <br />
                    &amp; grows with you.
                  </p>
                </div>

                {/* Content Section */}
                <div className="flex-grow flex flex-col justify-end min-h-0">
                  {/* Models Available */}
                  <div className="mb-6 ">
                    <p className="text-white text-sm sm:text-base font-semibold">Living Śrīmad Bhagavad Gītā</p>
                  </div>

                  {/* Pricing Plan */}
                  <div className="mb-4">
                    <button
                      onClick={() => setSelectedPlan('lifetime')}
                      className="w-full bg-white/10 backdrop-blur-sm border border-white rounded-xl
                                 p-4 flex items-center justify-between
                                 hover:bg-white/15 transition-colors"
                    >
                      <div className="flex flex-col items-start">
                        <span className="text-white text-lg sm:text-xl font-medium mb-1">Lifetime</span>
                        <div className="text-white/80 text-base sm:text-lg">
                          {getPriceDisplay('lifetime', PLAN_PRICES.lifetime, discountedPrices.lifetime)}
                        </div>
                      </div>

                      {selectedPlan === 'lifetime' && (
                        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-3 w-3 sm:h-4 sm:w-4 text-[#741942]"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      )}
                    </button>
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

                {/* Bottom Section */}
                <div className="flex-shrink-0 space-y-6">
                  {/* Enter Code Button */}
                  <button
                    onClick={() => setShowEntryCode(true)}
                    className="w-full  text-white/60 py-4 rounded-full 
                               text-base sm:text-lg font-medium hover:opacity-90 
                               transition-opacity"
                  >
                    Enter Code
                  </button>

                  {/* Subscribe Button */}
                  <button
                    onClick={handleSubscribe}
                    disabled={isPaymentLoading}
                    className="w-full bg-[#FDF6F1] text-[#1A0B14] py-4 rounded-full 
                               text-base sm:text-lg font-medium hover:opacity-90 
                               transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPaymentLoading
                      ? 'Processing...'
                      : getCurrentPrice(selectedPlan) === 0
                        ? 'Continue Our Journey'
                        : 'Continue Our Journey'}
                  </button>

                  {/* Footer Links */}
                  <div className="flex justify-center items-center gap-2 pt-2 text-xs text-white/40">
                    <Link
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white/60 transition-colors"
                    >
                      Terms
                    </Link>
                    <span>•</span>
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white/60 transition-colors"
                    >
                      Privacy
                    </Link>
                    <span>•</span>
                    <span>v1.0 (BETA)</span>
                  </div>
                </div>
              </div>
            ) : (
              /* Entry Code View */
              <div className="h-full flex flex-col">
                {/* Header with Back Button */}
                <div className="flex-shrink-0 mb-8">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowEntryCode(false)}
                      aria-label="Go back"
                      className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 
                                 flex items-center justify-center transition-colors border border-white/20"
                    >
                      <HiArrowLeft className="text-white text-lg" />
                    </button>

                    <div className="flex items-center gap-2">
                      <Image
                        src={meeraLogo}
                        alt={`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()}`}
                        height={24}
                        className="h-5 w-auto sm:h-6"
                      />
                      <span className="text-white font-serif italic text-lg sm:text-xl">
                        {`${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase()} os`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-grow flex flex-col min-h-0">
                  <div className="max-w-sm mx-auto w-full mt-10">
                    <h2 className="text-xl sm:text-2xl text-white font-serif mb-8 text-center">Enter Coupon Code</h2>

                    <div className="space-y-4">
                      <input
                        type="text"
                        value={entryCode}
                        onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                        placeholder="Enter Code"
                        className="w-full bg-white text-[#1A0B14] px-5 py-4 rounded-full 
                                   text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 
                                   focus:ring-white/20 transition-shadow"
                      />

                      <button
                        onClick={handleCouponCode}
                        disabled={isPaymentLoading || entryCode.length === 0}
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

                {/* Footer Links */}
                <div className="flex-shrink-0 flex justify-center items-center gap-2 pt-4 text-xs text-white/40">
                  <Link
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white/60 transition-colors"
                  >
                    Terms
                  </Link>
                  <span>•</span>
                  <Link
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white/60 transition-colors"
                  >
                    Privacy
                  </Link>
                  <span>•</span>
                  <span>v1.0 (BETA)</span>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
