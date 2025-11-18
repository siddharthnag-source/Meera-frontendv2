'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

interface UseCurrentUserResult {
  user: User | null;
  userId: string | null;
  loading: boolean;
  error: string | null;
}

export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (!isMounted) return;

        if (error) {
          setError(error.message);
          setUser(null);
        } else {
          setUser(data.user ?? null);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(String(err));
        setUser(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setUser(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    user,
    userId: user?.id ?? null,
    loading,
    error,
  };
}
