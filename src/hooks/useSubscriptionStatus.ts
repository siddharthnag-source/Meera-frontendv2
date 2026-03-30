import { paymentService } from '@/app/api/services/payment';
import { getGuestToken } from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { SubscriptionData } from '@/types/subscription';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export const SUBSCRIPTION_QUERY_KEY = ['subscription-status'];

export const useSubscriptionStatus = () => {
  const [sessionResolved, setSessionResolved] = useState(false);
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);
  const guestToken = getGuestToken();
  const hasGuestToken = !!guestToken;

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setHasSupabaseSession(!!data.session);
      } catch {
        if (!mounted) return;
        setHasSupabaseSession(false);
      } finally {
        if (mounted) setSessionResolved(true);
      }
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setHasSupabaseSession(!!session);
      setSessionResolved(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const queryKey = [
    ...SUBSCRIPTION_QUERY_KEY,
    hasSupabaseSession,
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
    retry: 1,
    staleTime: 0,
    // Wait until initial Supabase session read settles to avoid early unauthenticated balance fetches.
    enabled: sessionResolved && (hasSupabaseSession || hasGuestToken),
    refetchOnMount: true,
  });
};
