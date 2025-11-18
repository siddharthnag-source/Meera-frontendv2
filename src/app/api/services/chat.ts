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

// For now we are in single-user dev mode.
// This must match the id in `auth.users` and in `public.messages.user_id`.
const DEV_USER_ID = 'd125a2c0-94b1-47c6-a154-98392ef60c6f';

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

type DbMessageRow = {
  message_id: string;
  user_id: string;
  content_type: 'assistant' | 'user';
  content: string;
  timestamp: string;
  session_id: string | null;
  is_call: boolean | null;
  model: string | null;
  finish_reason: string | null;
  attachments: any[] | null;
};

export const chatService = {
  /**
   * Load chat history directly from Supabase for the dev user.
   * No Supabase Auth yet, just filter by DEV_USER_ID.
   */
  async getChatHistory(
    page: number = 1,
  ): Promise<{ message: string; data: ChatMessageFromServer[] }> {
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    try {
      // 1) Fetch messages for this dev user from Supabase
      const { data, error } = await supabase
        .from('messages')
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, finish_reason, attachments',
        )
        .eq('user_id', DEV_USER_ID)
        .order('timestamp', { ascending: true })
        .range(from, to);

      if (error) {
        console.error('getChatHistory: Supabase error', error);
        return { message: 'error', data: [] };
      }

      const rows: DbMessageRow[] = (data ?? []) as DbMessageRow[];

      // 2) Map raw rows into ChatMessageFromServer shape
      const mapped: ChatMessageFromServer[] = rows.map((row) => ({
        message_id: row.message_id,
        // user_id is not part of ChatMessageFromServer type on the client
        content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
        content: row.content,
        timestamp: row.timestamp,
        session_id: row.session_id ?? undefined, // ChatMessageFromServer expects string | undefined
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
---

## 3. Deploy and test

1. Commit `chat.ts` changes and push to `main`.
2. Let Vercel build again (it should pass now, only React warnings).
3. Open your app:
   - You should now see your old Meera conversation instead of “No messages found”.
   - Sending a new message still hits the Supabase Edge Function as before.

Later, when you are ready to hook up proper Supabase Auth and multi-user history, we can:

- Re-introduce `auth.getSession()`
- Switch RLS back to `auth.uid()::text = user_id`
- Insert messages with `user_id = auth.uid()` from the Edge Function.

For now, this should get your history visible and unblocked.
::contentReference[oaicite:0]{index=0}
