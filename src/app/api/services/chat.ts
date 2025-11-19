/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';
import { supabase } from '@/lib/supabaseClient';

// Supabase Edge Function endpoint for the `chat` function
const SUPABASE_CHAT_URL =
  process.env.NEXT_PUBLIC_SUPABASE_CHAT_URL ??
  'https://xilapyewazpzlvqbbtgl.supabase.co/functions/v1/chat';

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  status: number;
  body: { detail?: string; error?: string };

  constructor(message: string, status: number, body: { detail?: string; error?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export const chatService = {
  /**
   * Load chat history directly from Supabase for the logged-in user.
   * We fetch up to (page * 1000) messages, ordered oldest → newest.
   * The Conversation component will then scroll to the bottom so
   * you see November first and can scroll UP for October, September, etc.
   */
  async getChatHistory(
    page: number = 1,
  ): Promise<{ message: string; data: ChatMessageFromServer[] }> {
    const basePageSize = 1000;
    const limit = Math.max(1, page) * basePageSize;

    try {
      // 1) Get current Supabase session
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        console.error('getChatHistory: no valid Supabase session', sessionError);
        return { message: 'unauthorized', data: [] };
      }

      const userId = session.user.id;

      // 2) Fetch messages for this user from Supabase
      const { data, error } = await supabase
        .from('messages')
        .select(
          // IMPORTANT: only columns that actually exist in your table
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model',
        )
        .eq('user_id', userId)
        .order('timestamp', { ascending: true }) // oldest → newest
        .limit(limit);

      if (error) {
        console.error('getChatHistory: Supabase error', error);
        return { message: 'error', data: [] };
      }

      // 3) Map raw rows into ChatMessageFromServer shape
      const mapped: ChatMessageFromServer[] = (data ?? []).map((row: any) => ({
        message_id: row.message_id,
        // user_id is not part of ChatMessageFromServer type, so we ignore it on the client
        content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
        content: row.content,
        timestamp: row.timestamp,
        session_id: row.session_id || undefined,
        is_call: row.is_call ?? false,
        attachments: [], // no attachments column in DB, keep empty on client
        failed: false,
        finish_reason: null, // no column in DB, keep null on client
      }));

      return {
        message: 'ok',
        data: mapped,
      };
    } catch (error) {
      console.error('getChatHistory: unexpected error', error);
      return { message: 'error', data: [] };
    }
  },

  /**
   * Simple non-streaming sendMessage → Supabase Edge Function → JSON → ChatMessageResponse
   */
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
    const message = (formData.get('message') as string) || '';

    try {
      const response = await fetch(SUPABASE_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };

        throw new ApiError(
          errorBody.error || errorBody.detail || 'Failed to get reply from Meera',
          response.status,
          errorBody,
        );
      }

      const body = (await response.json()) as { reply: string };

      const assistantMessage: ChatMessageFromServer = {
        message_id: crypto.randomUUID(),
        content_type: 'assistant',
        content: body.reply,
        timestamp: new Date().toISOString(),
        attachments: [],
        is_call: false,
        failed: false,
        finish_reason: null,
      };

      const chatResponse: ChatMessageResponse = {
        message: 'ok',
        data: {
          response: body.reply,
          message: assistantMessage,
        } as ChatMessageResponse['data'],
      };

      return chatResponse;
    } catch (error) {
      console.error('Error in sendMessage:', error);
      throw error;
    }
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
