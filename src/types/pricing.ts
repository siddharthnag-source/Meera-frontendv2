export interface CashfreeInstance {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget: string;
  }) => Promise<{ paymentDetails?: unknown } | void>;
}

// Pricing Types
export type PlanType = 'monthly' | 'lifetime';

export interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  isClosable: boolean;
  source?: PricingModalSource;
}

export interface PlanPrices {
  monthly: number;
  lifetime: number;
}

export interface DiscountedPrices {
  monthly: number | null;
  lifetime: number | null;
}

export interface CouponCodes {
  [key: string]: number;
  BYPASS: number;
}

export interface PriceDisplayProps {
  plan: PlanType;
  basePrice: number;
  discountedPrice: number | null;
}

export interface PaymentRequest {
  plan_type: PlanType;
}

export type PricingModalSource =
  | 'upgrade_button' // User clicked upgrade button in profile
  | 'free_tokens_expired' // Free trial user's tokens expired
  | 'free_talktime_expired' // Free trial user's talk time expired
  | 'free_trial_expired' // Free trial user's subscription period expired
  | 'paid_sub_expired' // Paid user's subscription expired
  | '5000_tokens_left_toast_clicked' // User has low token count warning
  | 'subscription_has_ended_renew_here_toast_clicked' // User clicked "Renew subscription" button
  | 'during_call_talktime_ended' // User's talk time ended during a call 30 seconds
  | 'plan_expired_still_messaging' // User's plan expired
  | 'plan_expired_still_calling'; // User's plan expired
