import {
  ChatMessageFromServer,
  ChatMessageResponse,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';
import { supabase } from '@/lib/supabaseClient';
import { streamMeera } from '@/lib/streamMeera';

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

const CONTEXT_WINDOW = 80;

// Read Supabase URL + anon key for calling the edge function directly
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. ' +
      'Streaming chat via Supabase edge function will fail.',
  );
}

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
   * Currently not used; keep explicit to avoid silent misuse.
   */
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
    // Use param to satisfy ESLint and make it obvious this path is deprecated
    console.warn('sendMessage is deprecated, use streamMessage instead.', formData);
    throw new Error('sendMessage is not supported; use streamMessage instead.');
  },

  /**
   * Streaming chat via Supabase edge function (`functions/v1/chat`).
   * - Saves user message to DB
   * - Streams assistant tokens into the UI
   * - On completion, saves full assistant message to DB and returns it via onDone
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
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error(
          'Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY',
        );
      }

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        console.error('streamMessage: no valid Supabase session', sessionError);
        throw new SessionExpiredError('Your session has expired, please sign in again.');
      }

      const userId = session.user.id;

      // Fetch last N messages for context
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

      // Add the new user message as the last item
      historyForModel.push({ role: 'user', content: message });

      // Save user message to DB immediately
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

      // Accumulate full assistant response while streaming
      let fullAssistantText = '';

      await streamMeera({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        messages: historyForModel,
        signal,
        onAnswerDelta: (delta) => {
          fullAssistantText += delta;
          onDelta(delta);
        },
        onDone: () => {
          // Persistence + onDone handled after SSE completes
        },
        onError: (err) => {
          console.error('streamMeera error:', err);
          onError?.(err);
        },
      });

      const assistantNowIso = new Date().toISOString();

      // Save assistant message to DB for history
      const { data: insertedRows, error: assistantInsertError } = await supabase
        .from('messages')
        .insert([
          {
            user_id: userId,
            content_type: 'assistant',
            content: fullAssistantText,
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
            content: fullAssistantText,
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
