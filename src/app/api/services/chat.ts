import { SaveInteractionPayload } from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';
import { supabase } from '@/lib/supabaseClient';
import { streamMeera } from '@/lib/streamMeera';

/* ---------- Errors ---------- */

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

/* ---------- Types ---------- */

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

type ImageAttachment = {
  type: 'image';
  url: string;
  name: string;
};

type AssistantMsg = {
  message_id: string;
  content_type: 'assistant';
  content: string;
  timestamp: string;
  attachments: ImageAttachment[];
  is_call: false;
  failed: false;
  finish_reason: null;
};

/* ---------- Constants ---------- */
const CONTEXT_WINDOW = 100;

/* ---------- Env Vars ---------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Supabase env vars missing, streaming will fail.');
}

/* ---------- Image helpers ---------- */

const IMAGE_TRIGGER_WORDS = ['image', 'photo', 'picture', 'img', 'pic'];

function isImagePrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return IMAGE_TRIGGER_WORDS.some((w) => lower.includes(w));
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

type MeeraImageResponse = {
  reply?: string;
  thoughts?: string;
  images?: { mimeType?: string; data: string }[];
  model?: string;
};

/* -------------------------------------------------------------------------- */
/*                             CHAT SERVICE                                   */
/* -------------------------------------------------------------------------- */

export const chatService = {
  /* ---------- Load Chat History ---------- */
  async getChatHistory(page: number = 1) {
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [] };
      const userId = session.user.id;

      const { data, error } = await supabase
        .from('messages')
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model',
        )
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) return { message: 'error', data: [] };

      const rows = ((data ?? []) as DbMessageRow[]).slice().reverse();

      const mapped = rows.map((row) => ({
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
    } catch {
      return { message: 'error', data: [] };
    }
  },

  /* ---------- sendMessage (unused) ---------- */
  async sendMessage() {
    throw new Error('Use streamMessage instead.');
  },

  /* ---------- Streaming Chat ---------- */
  async streamMessage({
    message,
    sessionId = 'sess_1',
    onDelta,
    onDone,
    onError,
    signal,
  }: {
    message: string;
    sessionId?: string;
    onDelta: (delta: string) => void;
    onDone?: (finalMsg: AssistantMsg) => void;
    onError?: (err: unknown) => void;
    signal?: AbortSignal;
  }) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) throw new SessionExpiredError('Session expired');
      const userId = session.user.id;

      /* ---------- Fetch context history ---------- */
      let historyRows: DbMessageRow[] = [];

      try {
        const { data: page1 } = await supabase
          .from('messages')
          .select('content_type, content, timestamp')
          .eq('user_id', userId)
          .order('timestamp', { ascending: false })
          .limit(CONTEXT_WINDOW);

        historyRows = (page1 ?? []) as DbMessageRow[];
      } catch (e) {
        console.error('History load failed:', e);
      }

      const sortedHistory = historyRows.slice().reverse();

      const historyForModel: LLMHistoryMessage[] = sortedHistory
        .filter((r) => r.content?.trim())
        .map((r) => ({
          role: r.content_type === 'assistant' ? 'assistant' : 'user',
          content: r.content,
        }));

      historyForModel.push({ role: 'user', content: message });

      /* ---------- Save user message ---------- */
      await supabase.from('messages').insert([
        {
          user_id: userId,
          session_id: sessionId,
          content_type: 'user',
          content: message,
          timestamp: new Date().toISOString(),
        },
      ]);

      const isImage = isImagePrompt(message);

      /* ---------------------------------------------------------------------- */
      /*                               IMAGE MODE                               */
      /* ---------------------------------------------------------------------- */

      if (isImage) {
        let finalText = '';
        const attachments: ImageAttachment[] = [];

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY!,
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

          if (!res.ok) throw new Error(`Image call failed: ${res.status}`);
          const json = (await res.json()) as MeeraImageResponse;

          finalText = json.reply?.trim() || 'Here is your image.';

          (json.images ?? []).forEach((img, index) => {
            const mime = img.mimeType || 'image/png';
            const url = base64ToBlobUrl(img.data, mime);
            const name = `generated-${index + 1}.png`;

            attachments.push({ type: 'image', url, name });

            if (index === 0) {
              finalText += `\n\n![Generated image](data:${mime};base64,${img.data})`;
            }
          });

          onDelta(finalText);
        } catch (err) {
          onError?.(err);
          throw err;
        }

        const now = new Date().toISOString();

        const { data: saved } = await supabase
          .from('messages')
          .insert([
            {
              user_id: userId,
              session_id: sessionId,
              content_type: 'assistant',
              content: finalText,
              timestamp: now,
            },
          ])
          .select();

        const row = (saved as DbMessageRow[] | null)?.[0];

        const assistantMsg: AssistantMsg = {
          message_id: row?.message_id ?? crypto.randomUUID(),
          content_type: 'assistant',
          content: row?.content ?? finalText,
          timestamp: row?.timestamp ?? now,
          attachments,
          is_call: false,
          failed: false,
          finish_reason: null,
        };

        onDone?.(assistantMsg);
        return;
      }

      /* ---------------------------------------------------------------------- */
      /*                                 TEXT MODE                              */
      /* ---------------------------------------------------------------------- */

      let finalText = '';

      await streamMeera({
        supabaseUrl: SUPABASE_URL!,
        supabaseAnonKey: SUPABASE_ANON_KEY!,
        messages: historyForModel,
        userId,
        sessionId,
        signal,
        onAnswerDelta: (d) => {
          finalText += d;
          onDelta(d);
        },
      });

      const now = new Date().toISOString();

      const { data: saved } = await supabase
        .from('messages')
        .insert([
          {
            user_id: userId,
            session_id: sessionId,
            content_type: 'assistant',
            content: finalText,
            timestamp: now,
          },
        ])
        .select();

      const row = (saved as DbMessageRow[] | null)?.[0];

      const assistantMsg: AssistantMsg = {
        message_id: row?.message_id ?? crypto.randomUUID(),
        content_type: 'assistant',
        content: row?.content ?? finalText,
        timestamp: row?.timestamp ?? now,
        attachments: [],
        is_call: false,
        failed: false,
        finish_reason: null,
      };

      onDone?.(assistantMsg);
    } catch (err) {
      onError?.(err);
      throw err;
    }
  },
};

/* ---------- Save Interaction ---------- */

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
