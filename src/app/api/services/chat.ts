import {
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';
import { supabase } from '@/lib/supabaseClient';

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

type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const CONTEXT_WINDOW = 20;

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
   * Calls Hive Mind backend on Render and persists both user and assistant messages.
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

      // Optional: fetch last N messages for context (if you want to send history to backend)
      const { data: historyRows, error: historyError } = await supabase
        .from('messages')
        .select('content_type, content, timestamp')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(CONTEXT_WINDOW);

      if (historyError) {
        console.error('sendMessage: failed to fetch history', historyError);
      }

      const sortedHistory = ((historyRows ?? []) as Pick<
        DbMessageRow,
        'content_type' | 'content' | 'timestamp'
      >[])
        .slice()
        .reverse();

      const historyForModel: LLMHistoryMessage[] = sortedHistory
        .filter((row) => row.content && row.content.trim().length > 0)
        .map((row) => ({
          role: row.content_type === 'assistant' ? 'assistant' : 'user',
          content: row.content,
        }));

      historyForModel.push({ role: 'user', content: message });


      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };

        throw new ApiError(
          errorBody.error || errorBody.detail || 'Failed to get reply from Meera (Hive Mind)',
          response.status,
          errorBody,
        );
      }

      const body = (await response.json()) as {
        response: string;
        intent?: string | null;
        memory_ids?: string[] | null;
        [key: string]: unknown;
      };

      const nowIso = new Date().toISOString();

      // Persist both user and assistant messages for UI history
      const { data: insertedRows, error: insertError } = await supabase
        .from('messages')
        .insert([
          {
            user_id: userId,
            content_type: 'user',
            content: message,
            timestamp: nowIso,
            is_call: false,
            model: null,
          },
          {
            user_id: userId,
            content_type: 'assistant',
            content: body.response,
            timestamp: nowIso,
            is_call: false,
            model: null,
          },
        ])
        .select('message_id, content_type, content, timestamp, model');

      if (insertError) {
        console.error('sendMessage: failed to save messages to DB', insertError);
      }

      // We only need a minimal response for the UI here
      const chatResponse: ChatMessageResponse = {
        message: 'ok',
        data: {
          response: body.response,
        },
      };

      // (assistant row is still saved above for history)
      void insertedRows;

      return chatResponse;
    } catch (err) {
      console.error('Error in sendMessage:', err);
      throw err;
    }
  },

  /**
   * "Streaming" version for the UI, but implemented on top of the Hive Mind backend.
   * It calls the Render API once, then pushes the full reply as a single delta and onDone.
   * No Supabase Edge Function is used anymore.
   */
  async streamMessage({
    message,
    onDelta,
    onDone,
    onError,
    signal,
  }: {
    message: string;
    onDelta: (delta: string) => void;
    onDone?: (finalAssistantMessage: ChatMessageFromServer) => void;
    onError?: (err: unknown) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        console.error('streamMessage: no valid Supabase session', sessionError);
        throw new SessionExpiredError('Your session has expired, please sign in again.');
      }

      const userId = session.user.id;

      // Optional history fetch, kept in case you want to send it later
      const { data: historyRows, error: historyError } = await supabase
        .from('messages')
        .select('content_type, content, timestamp')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(CONTEXT_WINDOW);

      if (historyError) {
        console.error('streamMessage: failed to fetch history', historyError);
      }

      const sortedHistory = ((historyRows ?? []) as Pick<
        DbMessageRow,
        'content_type' | 'content' | 'timestamp'
      >[])
        .slice()
        .reverse();

      const historyForModel: LLMHistoryMessage[] = sortedHistory
        .filter((row) => row.content && row.content.trim().length > 0)
        .map((row) => ({
          role: row.content_type === 'assistant' ? 'assistant' : 'user',
          content: row.content,
        }));

      historyForModel.push({ role: 'user', content: message });

      // First save the user message to DB
      const userNowIso = new Date().toISOString();
      const { error: userInsertError } = await supabase.from('messages').insert([
        {
          user_id: userId,
          content_type: 'user',
          content: message,
          timestamp: userNowIso,
          is_call: false,
          model: null,
        },
      ]);

      if (userInsertError) {
        console.error('streamMessage: failed to save user message', userInsertError);
      }

      // Call Hive Mind backend (same as sendMessage, but we adapt to streaming callbacks)
      const response = await fetch(`${HIVE_API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          user_message: message,
          // history: historyForModel,
        }),
        signal,
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };

        throw new ApiError(
          errorBody.error || errorBody.detail || 'Failed to get reply from Meera (Hive Mind)',
          response.status,
          errorBody,
        );
      }

      const body = (await response.json()) as {
        response: string;
        intent?: string | null;
        memory_ids?: string[] | null;
        [key: string]: unknown;
      };

      const assistantText = body.response ?? '';

      // Push the whole answer as one "delta" to keep your existing UI happy
      if (assistantText) {
        onDelta(assistantText);
      }

      const assistantNowIso = new Date().toISOString();

      // Save assistant message to DB for history
      const { data: insertedRows, error: assistantInsertError } = await supabase
        .from('messages')
        .insert([
          {
            user_id: userId,
            content_type: 'assistant',
            content: assistantText,
            timestamp: assistantNowIso,
            is_call: false,
            model: null,
          },
        ])
        .select('message_id, content_type, content, timestamp, model');

      if (assistantInsertError) {
        console.error('streamMessage: failed to save assistant message', assistantInsertError);
      }

      const dbAssistantRow = (insertedRows as DbMessageRow[] | null)?.[0];

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
          }
        : {
            message_id: crypto.randomUUID(),
            content_type: 'assistant',
            content: assistantText,
            timestamp: assistantNowIso,
            attachments: [],
            is_call: false,
            failed: false,
            finish_reason: null,
          };

      onDone?.(assistantMessage);
    } catch (err) {
      console.error('Error in streamMessage:', err);
      onError?.(err);
      throw err;
    }
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
