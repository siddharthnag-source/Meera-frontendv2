import {
  ChatMessageFromServer,
  SaveInteractionPayload,
} from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';
import { supabase } from '@/lib/supabaseClient';

const CHAT_PROXY_URL = '/api/chat';

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
   * Fetches newest messages first, then reverses each page so UI sees oldest to newest.
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
   * Streaming sendMessage.
   * Fetches continuity history, then calls Next.js streaming proxy.
   * Returns the raw Response so the hook can read the stream.
   * Persist to DB after stream completes in useMessageSubmission.
   */
  async sendMessage(formData: FormData): Promise<Response> {
    const message = (formData.get('message') as string) || '';

    // 1) Get current Supabase user
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      console.error('sendMessage: no valid Supabase session', sessionError);
      throw new SessionExpiredError('Your session has expired, please sign in again.');
    }

    const userId = session.user.id;

    // 2) Fetch last CONTEXT_WINDOW messages for continuity
    const { data: historyRows, error: historyError } = await supabase
      .from('messages')
      .select('content_type, content, timestamp')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(CONTEXT_WINDOW);

    if (historyError) {
      console.error('sendMessage: failed to fetch history', historyError);
    }

    const sortedHistory = (
      (historyRows ?? []) as Pick<DbMessageRow, 'content_type' | 'content' | 'timestamp'>[]
    )
      .slice()
      .reverse();

    const historyForModel: LLMHistoryMessage[] = sortedHistory
      .filter((row) => row.content && row.content.trim().length > 0)
      .map((row) => ({
        role: row.content_type === 'assistant' ? 'assistant' : 'user',
        content: row.content,
      }));

    historyForModel.push({ role: 'user', content: message });

    // 3) Call streaming proxy with JSON payload
    const payload = {
      message,
      messages: historyForModel,
      userId,
      stream: true,
    };

    const response = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
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

    return response;
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
