import {
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';
import { supabase } from '@/lib/supabaseClient';

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

type DbMessageRow = {
  message_id: string;
  user_id: string;
  content_type: string;
  content: string;
  timestamp: string;
  session_id?: string | null;
  is_call?: boolean | null;
  model?: string | null;
};

export const chatService = {
  /**
   * Load chat history directly from Supabase for the logged-in user.
   * Fetches newest messages first, then reverses each page so UI sees oldest → newest.
   */
  async getChatHistory(
    page: number = 1,
  ): Promise<{ message: string; data: ChatMessageFromServer[] }> {
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        console.error('getChatHistory: no valid Supabase session', sessionError);
        return { message: 'unauthorized', data: [] };
      }

      const userId = session.user.id;

      const { data, error } = await supabase
        .from('messages')
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model',
        )
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('getChatHistory: Supabase error', error);
        return { message: 'error', data: [] };
      }

      const rows = ((data ?? []) as DbMessageRow[]).slice().reverse();

      const mapped: ChatMessageFromServer[] = rows.map((row) => ({
        message_id: row.message_id,
        content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
        content: row.content,
        timestamp: row.timestamp,
        session_id: row.session_id || undefined,
        is_call: row.is_call ?? false,
        attachments: [],
        failed: false,
        finish_reason: null,
      }));

      return { message: 'ok', data: mapped };
    } catch (err) {
      console.error('getChatHistory: unexpected error', err);
      return { message: 'error', data: [] };
    }
  },

  /**
   * Non-streaming sendMessage.
   * Calls Supabase Edge Function and persists both user and assistant messages.
   * Passes through model thoughts.
   */
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
    const message = (formData.get('message') as string) || '';

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        console.error('sendMessage: no valid Supabase session', sessionError);
        throw new SessionExpiredError('Your session has expired, please sign in again.');
      }

      const userId = session.user.id;

      const response = await fetch(SUPABASE_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      // Edge function returns { reply, thoughts }
      const body = (await response.json()) as {
        reply: string;
        thoughts?: string;
        model?: string;
      };

      const nowIso = new Date().toISOString();

      const { data: insertedRows, error: insertError } = await supabase
        .from('messages')
        .insert([
          {
            user_id: userId,
            content_type: 'user',
            content: message,
            timestamp: nowIso,
            is_call: false,
            model: body.model ?? null,
          },
          {
            user_id: userId,
            content_type: 'assistant',
            content: body.reply,
            timestamp: nowIso,
            is_call: false,
            model: body.model ?? null,
          },
        ])
        .select('message_id, content_type, content, timestamp, model');

      if (insertError) {
        console.error('sendMessage: failed to save messages to DB', insertError);
      }

      const dbAssistantRow = (insertedRows as DbMessageRow[] | null)?.find(
        (row) => row.content_type === 'assistant',
      );

      const assistantMessage: ChatMessageFromServer = dbAssistantRow
        ? {
            message_id: dbAssistantRow.message_id,
            content_type: 'assistant',
            content: dbAssistantRow.content,
            timestamp: dbAssistantRow.timestamp,
            attachments: [],
            is_call: false,
            failed: false,
            finish_reason: null,
            thoughts: body.thoughts ?? '',
          }
        : {
            message_id: crypto.randomUUID(),
            content_type: 'assistant',
            content: body.reply,
            timestamp: nowIso,
            attachments: [],
            is_call: false,
            failed: false,
            finish_reason: null,
            thoughts: body.thoughts ?? '',
          };

      const chatResponse: ChatMessageResponse = {
        message: 'ok',
        data: {
          response: body.reply,
          thoughts: body.thoughts ?? '',
          message: assistantMessage,
        } as ChatMessageResponse['data'],
      };

      return chatResponse;
    } catch (err) {
      console.error('Error in sendMessage:', err);
      throw err;
    }
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
