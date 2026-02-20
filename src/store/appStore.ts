'use client';

import { chatService } from '@/app/api/services/chat';
import { supabase } from '@/lib/supabaseClient';
import type { ChatMessageFromServer } from '@/types/chat';
import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';

type AppStoreState = {
  user: User | null;
  starredMessages: ChatMessageFromServer[];
  isAppStateInitialized: boolean;
  isInitializingAppState: boolean;
  appStateError: string | null;
  initializeAppState: () => Promise<void>;
  setUser: (user: User | null) => void;
  setStarredMessages: (messages: ChatMessageFromServer[]) => void;
  upsertStarredMessage: (message: ChatMessageFromServer) => void;
  removeStarredMessage: (messageId: string) => void;
  clearAppState: () => void;
};

const normalizeStarredMessages = (messages: ChatMessageFromServer[]): ChatMessageFromServer[] => {
  const deduped = new Map<string, ChatMessageFromServer>();

  messages.forEach((message) => {
    if (!message?.message_id) return;
    deduped.set(message.message_id, message);
  });

  return Array.from(deduped.values());
};

export const useAppStore = create<AppStoreState>((set, get) => ({
  user: null,
  starredMessages: [],
  isAppStateInitialized: false,
  isInitializingAppState: false,
  appStateError: null,

  initializeAppState: async () => {
    const state = get();
    if (state.isInitializingAppState || state.isAppStateInitialized) return;

    set({
      isInitializingAppState: true,
      appStateError: null,
    });

    try {
      const [{ data: userData, error: userError }, starredResponse] = await Promise.all([
        supabase.auth.getUser(),
        chatService.getStarredMessages(),
      ]);

      if (userError) {
        throw userError;
      }

      const starredMessages =
        starredResponse.message === 'ok'
          ? normalizeStarredMessages(starredResponse.data as ChatMessageFromServer[])
          : [];

      set({
        user: userData.user ?? null,
        starredMessages,
        isAppStateInitialized: true,
        isInitializingAppState: false,
        appStateError: null,
      });
    } catch (error) {
      console.error('Failed to initialize app state:', error);
      set({
        user: null,
        starredMessages: [],
        isAppStateInitialized: true,
        isInitializingAppState: false,
        appStateError: error instanceof Error ? error.message : 'Failed to initialize app state',
      });
    }
  },

  setUser: (user) => set({ user }),
  setStarredMessages: (messages) => set({ starredMessages: normalizeStarredMessages(messages) }),
  upsertStarredMessage: (message) =>
    set((state) => ({
      starredMessages: [message, ...state.starredMessages.filter((item) => item.message_id !== message.message_id)],
    })),
  removeStarredMessage: (messageId) =>
    set((state) => ({
      starredMessages: state.starredMessages.filter((message) => message.message_id !== messageId),
    })),
  clearAppState: () =>
    set({
      user: null,
      starredMessages: [],
      appStateError: null,
    }),
}));
