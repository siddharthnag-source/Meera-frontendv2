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

/**
 * Row shape for the `messages` table we read from Supabase.
 * Keep in sync with your DB schema.
 */
type DbMessageRow = {
  message_id: string;
  user_id: string;
  content_type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  session_id: string | null;
  is_call: boolean | null;
  model?: string | null;
  finish_reason?: string | null;
  attachments?: any[] | null;
};

export const chatService = {
  /**
   * Load chat history directly from Supabase for the logged-in user.
   * Uses the browser Supabase session, no Next.js API route.
   */
  async getChatHistory(
    page: number = 1,
  ): Promise<{ message: string; data: ChatMessageFromServer[] }> {
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

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
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, finish_reason, attachments',
        )
        .eq('user_id', userId)
        .order('timestamp', { ascending: true })
        .range(from, to);

      if (error) {
        console.error('getChatHistory: Supabase error', error);
        return { message: 'error', data: [] };
      }

      const rows = (data ?? []) as DbMessageRow[];

      // 3) Map raw rows into ChatMessageFromServer shape
      const mapped: ChatMessageFromServer[] = rows.map((row) => ({
        message_id: row.message_id,
        // user_id is deliberately ignored on the client
        content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
        content: row.content,
        timestamp: row.timestamp,
        // ChatMessageFromServer expects string | undefined, not null
        session_id: row.session_id ?? undefined,
        is_call: row.is_call ?? false,
        attachments: row.attachments ?? [],
        failed: false,
        finish_reason: row.finish_reason ?? null,
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
