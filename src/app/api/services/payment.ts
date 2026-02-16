import type {
  CreatePaymentRequest,
  PaymentCustomerDetails,
  CreatePaymentResponse,
  DeductTalktimeRequest,
  DeductTalktimeResponse,
  SubscriptionStatusResponse,
  VerifyPaymentRequest,
  VerifyPaymentResponse,
} from '@/types/api';
import { supabase } from '@/lib/supabaseClient';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';

const PLAN_AMOUNT_MAP: Record<CreatePaymentRequest['plan_type'], number> = {
  monthly: 99,
  lifetime: 499,
};

const DEFAULT_ORDER_CURRENCY = 'INR';
const DEFAULT_CUSTOMER_NAME = 'Guest User';
const DEFAULT_CUSTOMER_EMAIL = 'guest@example.com';
const DEFAULT_CUSTOMER_PHONE = '9999999999';

const getGuestToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('guest_token');
};

const normalizeAmount = (amount?: number): number | null => {
  if (typeof amount !== 'number' || Number.isNaN(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
};

const normalizePhone = (value?: string): string => {
  if (!value) return DEFAULT_CUSTOMER_PHONE;
  const digitsOnly = value.replace(/\D/g, '');
  if (!digitsOnly) return DEFAULT_CUSTOMER_PHONE;
  if (digitsOnly.length >= 10) return digitsOnly.slice(-10);
  return digitsOnly.padEnd(10, '0');
};

const getMetadataString = (metadata: Record<string, unknown>, key: string): string | undefined => {
  const rawValue = metadata[key];
  return typeof rawValue === 'string' && rawValue.trim() ? rawValue.trim() : undefined;
};

const buildCustomerDetails = async (
  customerDetails?: Partial<PaymentCustomerDetails>,
): Promise<PaymentCustomerDetails> => {
  let sessionUserId: string | undefined;
  let sessionUserEmail: string | undefined;
  let metadata: Record<string, unknown> = {};

  try {
    const { data } = await supabase.auth.getSession();
    sessionUserId = data.session?.user?.id;
    sessionUserEmail = data.session?.user?.email;
    metadata = (data.session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  } catch (error) {
    console.warn('Unable to fetch Supabase session for payment details:', error);
  }

  const metadataName = getMetadataString(metadata, 'full_name') ?? getMetadataString(metadata, 'name');
  const metadataPhone = getMetadataString(metadata, 'phone');

  const customerEmail = customerDetails?.customer_email?.trim() || sessionUserEmail || DEFAULT_CUSTOMER_EMAIL;
  const emailAlias = customerEmail.includes('@') ? customerEmail.split('@')[0] : customerEmail;
  const customerName = customerDetails?.customer_name?.trim() || metadataName || emailAlias || DEFAULT_CUSTOMER_NAME;

  const guestToken = getGuestToken();
  const fallbackCustomerId = guestToken ? `guest_${guestToken.slice(0, 24)}` : `guest_${Date.now()}`;
  const customerId = customerDetails?.customer_id?.trim() || sessionUserId || fallbackCustomerId;

  const customerPhone = normalizePhone(customerDetails?.customer_phone || metadataPhone);

  return {
    customer_id: customerId,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
  };
};

export const paymentService = {
  async createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    try {
      const customerDetails = await buildCustomerDetails(data.customer_details);
      const orderAmount = normalizeAmount(data.amount) ?? PLAN_AMOUNT_MAP[data.plan_type];
      const orderCurrency = (data.order_currency || DEFAULT_ORDER_CURRENCY).toUpperCase();

      const payload = {
        order_amount: orderAmount,
        order_currency: orderCurrency,
        customer_details: customerDetails,
        plan_type: data.plan_type,
        ...(data.coupon_code ? { coupon_code: data.coupon_code } : {}),

        // Backward compatibility for older payment handlers that still read top-level customer fields.
        customer_id: customerDetails.customer_id,
        customer_name: customerDetails.customer_name,
        customer_email: customerDetails.customer_email,
        customer_phone: customerDetails.customer_phone,
      };

      return await api.post<CreatePaymentResponse>(API_ENDPOINTS.PAYMENT.CREATE, payload);
    } catch (error) {
      console.error('Error in createPayment:', error);

      throw error;
    }
  },

  async verifyPayment(data: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    try {
      return await api.post<VerifyPaymentResponse>(API_ENDPOINTS.PAYMENT.VERIFY, data);
    } catch (error) {
      console.error('Error in verifyPayment:', error);

      throw error;
    }
  },

  async getSubscriptionStatus(): Promise<SubscriptionStatusResponse> {
    try {
      return await api.get<SubscriptionStatusResponse>(API_ENDPOINTS.PAYMENT.SUBSCRIPTION_STATUS);
    } catch (error) {
      console.error('Error in getSubscriptionStatus:', error);

      throw error;
    }
  },

  async deductTalktime(data: DeductTalktimeRequest): Promise<DeductTalktimeResponse> {
    try {
      return await api.post<DeductTalktimeResponse>(API_ENDPOINTS.PAYMENT.DEDUCT_TALKTIME, data);
    } catch (error) {
      console.error('Error in deductTalktime:', error);

      throw error;
    }
  },
};
