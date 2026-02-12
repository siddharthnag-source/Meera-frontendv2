import { paymentService } from '@/app/api/services/payment';
import { SubscriptionData } from '@/types/subscription';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

export const SUBSCRIPTION_QUERY_KEY = ['subscription-status'];

export const useSubscriptionStatus = () => {
  const { status: sessionStatus } = useSession();
  // Check for guest token in localStorage only on the client-side
  const guestToken = typeof window !== 'undefined' ? localStorage.getItem('guest_token') : null;
  const hasGuestToken = !!guestToken;

  const queryKey = [
    ...SUBSCRIPTION_QUERY_KEY,
    sessionStatus,
    hasGuestToken,
  ];
  return useQuery({
    queryKey: queryKey,
    queryFn: async (): Promise<SubscriptionData> => {
      try {
        const response = await paymentService.getSubscriptionStatus();

        if (response.plan_type !== 'paid' && response.plan_type !== 'free_trial') {
          throw new Error(`Invalid plan_type received: ${response.plan_type}`);
        }

        return {
          subscription_end_date: response.subscription_end_date,
          talktime_left: response.talktime_left,
          tokens_left: response.tokens_left,
          message: response.message,
          plan_type: response.plan_type,
        };
      } catch (error) {
        console.error('Failed to fetch subscription status:', error);
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    // This app primarily authenticates with Supabase cookies; NextAuth status can be
    // unauthenticated even for valid sessions. Do not block subscription fetch on that.
    enabled: sessionStatus !== 'loading',
    refetchOnMount: false,
  });
};
