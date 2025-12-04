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

const CONTEXT_WINDOW = 40;
const SUPABASE_PAGE_LIMIT = 20;

// Read Supabase URL + anon key for calling the edge function directly
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. ' +
      'Streaming chat via Supabase edge function will fail.',
  );
}

/* ---------- Image helpers ---------- */

const IMAGE_TRIGGER_WORDS = ['image', 'photo', 'picture', 'img', 'pic'];

function isImagePrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return IMAGE_TRIGGER_WORDS.some((word) => lower.includes(word));
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const byteCharacters = atob(base64);
  const byteNumbers: number[] = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  return URL.createObjectURL(blob);
}

type MeeraImageResponse = {
  reply?: string;
  thoughts?: string;
  images?: { mimeType?: string; data: string }[];
  model?: string;
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
    } catch (err: unknown) {
      console.error('getChatHistory: unexpected error', err);
      return { message: 'error', data: [] };
    }
  },

  /**
   * Non-streaming sendMessage.
   * Currently not used; keep explicit to avoid silent misuse.
   */
  async sendMessage(formData: FormData): Promise<ChatMessageResponse> {
    // Use formData so ESLint doesn't complain about unused parameter.
    console.warn('sendMessage is deprecated, use streamMessage instead.', formData);
    throw new Error('sendMessage is not supported; use streamMessage instead.');
  },

  /**
   * Streaming chat via Supabase edge function (`functions/v1/chat`).
   * - Saves user message to DB
   * - For normal text: streams assistant tokens into the UI
   * - For image prompts: calls Meera once, returns text + image attachment(s)
   * - On completion, saves full assistant message to DB and returns it via onDone
   */
  async streamMessage({
    message,
    sessionId = 'sess_1', // default logical session/thread id
    onDelta,
    onDone,
    onError,
    signal,
  }: {
    message: string;
    sessionId?: string;
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

      // -------- HISTORY FETCH WITH PAGINATION UP TO CONTEXT_WINDOW ROWS --------
      let historyRows: Pick<DbMessageRow, 'content_type' | 'content' | 'timestamp'>[] = [];

      try {
        const { data: page1, error: err1 } = await supabase
          .from('messages')
          .select('content_type, content, timestamp')
          .eq('user_id', userId)
          .order('timestamp', { ascending: false })
          .limit(Math.min(CONTEXT_WINDOW, SUPABASE_PAGE_LIMIT));

        if (err1) throw err1;

        historyRows = (page1 ?? []) as Pick<
          DbMessageRow,
          'content_type' | 'content' | 'timestamp'
        >[];

        if (
          CONTEXT_WINDOW > SUPABASE_PAGE_LIMIT &&
          (page1?.length ?? 0) === SUPABASE_PAGE_LIMIT
        ) {
          const { data: page2, error: err2 } = await supabase
            .from('messages')
            .select('content_type, content, timestamp')
            .eq('user_id', userId)
            .order('timestamp', { ascending: false })
            .range(
              SUPABASE_PAGE_LIMIT,
              Math.min(CONTEXT_WINDOW, SUPABASE_PAGE_LIMIT * 2) - 1,
            );

          if (err2) throw err2;

          if (page2 && page2.length > 0) {
            historyRows = historyRows.concat(
              page2 as Pick<DbMessageRow, 'content_type' | 'content' | 'timestamp'>[],
            );
          }
        }
      } catch (err: unknown) {
        console.error('streamMessage: failed to fetch history', err);
      }

      const sortedHistory = historyRows.slice().reverse();

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
          session_id: sessionId,
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

      const imageMode = isImagePrompt(message);

      // ---------- IMAGE MODE (non-stream, JSON response) ----------
      if (imageMode) {
        let fullAssistantText = '';
        const attachmentList: NonNullable<ChatMessageFromServer['attachments']> = [];

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              message,
              messages: historyForModel,
              userId,
              sessionId,
              stream: false,
            }),
            signal,
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Meera image call failed: ${res.status} ${text}`);
          }

          const json = (await res.json()) as MeeraImageResponse;

          fullAssistantText = json.reply?.trim() || 'Here is your image.';

          const images = json.images ?? [];
          images.forEach((img, index) => {
            if (!img.data) return;
            const mime = img.mimeType || 'image/png';

            const blobUrl = base64ToBlobUrl(img.data, mime);
            const dataUrl = `data:${mime};base64,${img.data}`;

            // Attach for gallery / attachment UI
            attachmentList.push({
              type: 'image',
              url: blobUrl,
              name: `generated-image-${index + 1}.png`,
            } as NonNullable<ChatMessageFromServer['attachments']>[number]);

            // For the first image, also embed directly into markdown so it always renders
            if (index === 0) {
              fullAssistantText += `\n\n![Generated image](${dataUrl})`;
            }
          });

          // Send final text once to the UI
          onDelta(fullAssistantText);
        } catch (err: unknown) {
          console.error('streamMessage (image mode) error:', err);
          onError?.(err);
          throw err;
        }

        const assistantNowIso = new Date().toISOString();

        const { data: insertedRows, error: assistantInsertError } = await supabase
          .from('messages')
          .insert([
            {
              user_id: userId,
              session_id: sessionId,
              content_type: 'assistant',
              content: fullAssistantText,
              timestamp: assistantNowIso,
              is_call: false,
              model: null,
            },
          ])
          .select('message_id, content_type, content, timestamp, model');

        if (assistantInsertError) {
          console.error(
            'streamMessage: failed to save assistant message (image mode)',
            assistantInsertError,
          );
        }

        const dbAssistantRow = (insertedRows as DbMessageRow[] | null)?.[0];

        const assistantMessage: ChatMessageFromServer = dbAssistantRow
          ? {
              message_id: dbAssistantRow.message_id,
              content_type: 'assistant',
              content: dbAssistantRow.content,
              timestamp: dbAssistantRow.timestamp,
              attachments: attachmentList,
              is_call: false,
              failed: false,
              finish_reason: null,
            }
          : {
              message_id: crypto.randomUUID(),
              content_type: 'assistant',
              content: fullAssistantText,
              timestamp: assistantNowIso,
              attachments: attachmentList,
              is_call: false,
              failed: false,
              finish_reason: null,
            };

        onDone?.(assistantMessage);
        return;
      }

      // ---------- TEXT MODE (existing SSE streaming path) ----------

      // Accumulate full assistant response while streaming
      let fullAssistantText = '';

      await streamMeera({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        messages: historyForModel,
        userId,
        sessionId,
        signal,
        onAnswerDelta: (delta) => {
          fullAssistantText += delta;
          onDelta(delta);
        },
        onDone: () => {
          // Persistence + onDone handled after SSE completes
        },
        onError: (err: unknown) => {
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
            session_id: sessionId,
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
    } catch (err: unknown) {
      console.error('Error in streamMessage:', err);
      onError?.(err);
      throw err;
    }
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
