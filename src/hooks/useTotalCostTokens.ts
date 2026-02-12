'use client';

import { supabase } from '@/lib/supabaseClient';
import { useEffect, useMemo, useState } from 'react';

const coercePostgresInt = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    return trimmed;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString(10);
  }

  if (typeof value === 'bigint') return value.toString(10);

  return null;
};

const formatIntStringWithCommas = (value: string): string => {
  const sign = value.startsWith('-') ? '-' : '';
  const digits = sign ? value.slice(1) : value;
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const useTotalCostTokens = (userId?: string | null) => {
  const [totalCostTokens, setTotalCostTokens] = useState<string>('0');
  const [isLoadingTotalCostTokens, setIsLoadingTotalCostTokens] = useState(false);

  useEffect(() => {
    if (!userId) {
      setTotalCostTokens('0');
      setIsLoadingTotalCostTokens(false);
      return;
    }

    let cancelled = false;
    setIsLoadingTotalCostTokens(true);

    const load = async () => {
      const { data, error } = await supabase
        .from('user_token_ledger')
        .select('total_tokens')
        .eq('user_id', userId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('Failed to load user_token_ledger:', error);
        setIsLoadingTotalCostTokens(false);
        return;
      }

      setTotalCostTokens(coercePostgresInt(data?.total_tokens) ?? '0');
      setIsLoadingTotalCostTokens(false);
    };

    load();

    const channel = supabase
      .channel(`user-token-ledger:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_token_ledger',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = coercePostgresInt(
            (payload.new as { total_tokens?: unknown } | null)?.total_tokens,
          );

          if (next != null) setTotalCostTokens(next);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const formattedTotalCostTokens = useMemo(
    () => formatIntStringWithCommas(totalCostTokens),
    [totalCostTokens],
  );

  return {
    totalCostTokens,
    formattedTotalCostTokens,
    isLoadingTotalCostTokens,
  };
};
