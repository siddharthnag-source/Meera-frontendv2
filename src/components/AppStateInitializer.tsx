'use client';

import { chatService } from '@/app/api/services/chat';
import { supabase } from '@/lib/supabaseClient';
import { useAppStore } from '@/store/appStore';
import type { ChatMessageFromServer } from '@/types/chat';
import { useEffect, useRef } from 'react';

export function AppStateInitializer() {
  const initializeAppState = useAppStore((state) => state.initializeAppState);
  const setUser = useAppStore((state) => state.setUser);
  const setStarredMessages = useAppStore((state) => state.setStarredMessages);
  const clearAppState = useAppStore((state) => state.clearAppState);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    void initializeAppState();
  }, [initializeAppState]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (!currentUser) {
        clearAppState();
        return;
      }

      void (async () => {
        const response = await chatService.getStarredMessages();
        if (response.message === 'ok') {
          setStarredMessages(response.data as ChatMessageFromServer[]);
        } else if (response.message === 'unauthorized') {
          setStarredMessages([]);
        }
      })();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [clearAppState, setStarredMessages, setUser]);

  return null;
}
