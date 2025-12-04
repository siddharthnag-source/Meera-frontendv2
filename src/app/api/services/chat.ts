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

const CONTEXT_WINDOW = 20; // keep context small to avoid token explosion
const SUPABASE_PAGE_LIMIT = 20;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Missing Supabase env vars for chat streaming');
}

/* ---------- IMAGE DETECTION ---------- */

const IMAGE_TRIGGER_WORDS = ['image', 'photo', 'picture', 'pic', 'img'];

function isImagePrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return IMAGE_TRIGGER_WORDS.some((w) => lower.includes(w));
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  return URL.createObjectURL(blob);
}

type MeeraImageResponse = {
  reply?: string;
  thoughts?: string;
  images?: { mimeType?: string; data: string }[];
  model?: string;
};

/* -------------------------------------------------------------------------- */
/*                                  SERVICE                                   */
/* -------------------------------------------------------------------------- */

export const chatService = {
  async getChatHistory(page = 1) {
    const from = (page - 1) * 20;
    const to = from + 19;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
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
        console.error('getChatHistory error:', error);
        return { message: 'error', data: [] };
      }

      const rows = (data ?? []).reverse() as DbMessageRow[];

      const mapped = rows.map((row) => ({
        message_id: row.message_id,
        content_type: row.content_type,
        content: row.content,
        timestamp: row.timestamp,
        session_id: row.session_id ?? undefined,
        is_call: row.is_call ?? false,
        attachments: [],
        failed: false,
        finish_reason: null,
      }));

      return { message: 'ok', data: mapped };
    } catch (err) {
      console.error('getChatHistory unexpected:', err);
      return { message: 'error', data: [] };
    }
  },

  async sendMessage() {
    throw new Error('sendMessage is not supported. Use streamMessage.');
  },

  async streamMessage({ message, sessionId = 'sess_1', onDelta, onDone, onError, signal }) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        throw new SessionExpiredError('Session expired');
      }

      const userId = session.user.id;

      /* -------------------------------------------------------------------------- */
      /*                         FETCH LAST N HISTORY MESSAGES                      */
      /* -------------------------------------------------------------------------- */

      let historyRows: Pick<DbMessageRow, 'content_type' | 'content' | 'timestamp' | 'model'>[] =
        [];

      try {
        const { data: rows1 } = await supabase
          .from('messages')
          .select('content_type, content, timestamp, model')
          .eq('user_id', userId)
          .order('timestamp', { ascending: false })
          .limit(CONTEXT_WINDOW);

        historyRows = rows1 ?? [];
      } catch (err) {
        console.error('history fetch error:', err);
      }

      const sortedHistory = historyRows.reverse();

      /* -------------------------------------------------------------------------- */
      /*                    FILTER OUT IMAGE RESPONSES FROM HISTORY                 */
      /* -------------------------------------------------------------------------- */

      const historyForModel: LLMHistoryMessage[] = sortedHistory
        .filter((row) => {
          if (!row.content) return false;

          // remove any base64 / data:image
          if (row.content.startsWith('data:image')) return false;

          // remove image-mode assistant messages
          if (row.model === 'gemini-2.5-flash-image') return false;

          // remove huge content
          if (row.content.length > 4000) return false;

          return true;
        })
        .map((row) => ({
          role: row.content_type === 'assistant' ? 'assistant' : 'user',
          content: row.content,
        }));

      // append new user message to LLM context
      historyForModel.push({ role: 'user', content: message });

      /* -------------------------------------------------------------------------- */
      /*                        SAVE USER MESSAGE IMMEDIATELY                       */
      /* -------------------------------------------------------------------------- */

      await supabase.from('messages').insert([
        {
          user_id: userId,
          session_id: sessionId,
          content_type: 'user',
          content: message,
          timestamp: new Date().toISOString(),
          is_call: false,
          model: null,
        },
      ]);

      /* -------------------------------------------------------------------------- */
      /*                               IMAGE MODE                                   */
      /* -------------------------------------------------------------------------- */

      const imageMode = isImagePrompt(message);

      if (imageMode) {
        let fullAssistantText = '';
        const attachments = [];

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

          const json = (await res.json()) as MeeraImageResponse;

          fullAssistantText = json.reply?.trim() ?? 'Here is your image.';

          const imgs = json.images ?? [];

          imgs.forEach((img, idx) => {
            if (!img.data) return;

            const mime = img.mimeType || 'image/png';
            const blobUrl = base64ToBlobUrl(img.data, mime);
            const dataUrl = `data:${mime};base64,${img.data}`;

            attachments.push({
              type: 'image',
              url: blobUrl,
              name: `generated-image-${idx + 1}.png`,
            });

            if (idx === 0) {
              fullAssistantText += `\n\n![Generated image](${dataUrl})`;
            }
          });

          onDelta(fullAssistantText);

          const { data: inserted } = await supabase
            .from('messages')
            .insert([
              {
                user_id: userId,
                session_id: sessionId,
                content_type: 'assistant',
                content: fullAssistantText,
                timestamp: new Date().toISOString(),
                is_call: false,
                model: 'text-image-response',
              },
            ])
            .select();

          const row = inserted?.[0];

          onDone?.({
            message_id: row?.message_id ?? crypto.randomUUID(),
            content_type: 'assistant',
            content: fullAssistantText,
            timestamp: row?.timestamp ?? new Date().toISOString(),
            attachments,
            is_call: false,
            failed: false,
            finish_reason: null,
          });

          return;
        } catch (err) {
          console.error('image mode error:', err);
          onError?.(err);
          return;
        }
      }

      /* -------------------------------------------------------------------------- */
      /*                                TEXT MODE                                   */
      /* -------------------------------------------------------------------------- */

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
      });

      const { data: insertedRows } = await supabase
        .from('messages')
        .insert([
          {
            user_id: userId,
            session_id: sessionId,
            content_type: 'assistant',
            content: fullAssistantText,
            timestamp: new Date().toISOString(),
            is_call: false,
            model: 'text',
          },
        ])
        .select();

      const row = insertedRows?.[0];

      onDone?.({
        message_id: row?.message_id ?? crypto.randomUUID(),
        content_type: 'assistant',
        content: fullAssistantText,
        timestamp: row?.timestamp ?? new Date().toISOString(),
        attachments: [],
        is_call: false,
        failed: false,
        finish_reason: null,
      });
    } catch (err) {
      console.error('streamMessage error:', err);
      onError?.(err);
    }
  },
};

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
