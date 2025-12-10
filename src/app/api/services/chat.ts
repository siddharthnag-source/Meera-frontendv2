// src/app/api/services/chat.ts
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

type ImageAttachment = {
  type: 'image';
  url: string;
  name: string;
  // size is stored in DB, but optional for frontend
  size?: number;
};

type DbMessageRow = {
  message_id: string;
  user_id: string;
  content_type: string;
  content: string;
  timestamp: string;
  session_id?: string | null;
  is_call?: boolean | null;
  model?: string | null;

  // new columns
  message_type?: string | null;
  image_url?: string | null;
  attachments?: ImageAttachment[] | null;
};

type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
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

type MeeraImageResponse = {
  reply?: string;
  thoughts?: string;
  images?: { mimeType?: string; data: string; dataUrl?: string }[];
  model?: string;
  // Supabase Storage URLs from the Edge Function
  attachments?: ImageAttachment[];
};

/* ---------- Constants ---------- */
const CONTEXT_WINDOW = 40;

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
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
        )
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('getChatHistory error', error);
        return { message: 'error', data: [] };
      }

      const rows = ((data ?? []) as DbMessageRow[]).slice().reverse();

      const mapped = rows.map((row) => ({
        message_id: row.message_id,
        content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
        content: row.content,
        timestamp: row.timestamp,
        session_id: row.session_id || undefined,
        is_call: row.is_call ?? false,
        attachments: (row.attachments as ImageAttachment[] | null) ?? [],
        // keep these so UI can use them if needed
        message_type: row.message_type ?? 'text',
        image_url: row.image_url ?? undefined,
        failed: false,
        finish_reason: null,
      }));

      return { message: 'ok', data: mapped };
    } catch (e) {
      console.error('getChatHistory outer error', e);
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
        let liveAttachments: ImageAttachment[] = [];

        // 1) Create assistant placeholder row so Edge Function can attach images
        let assistantMessageId: string | null = null;
        const placeholderTimestamp = new Date().toISOString();

        try {
          const { data: placeholderRows, error: placeholderError } =
            await supabase
              .from('messages')
              .insert([
                {
                  user_id: userId,
                  session_id: sessionId,
                  content_type: 'assistant',
                  content: '',
                  timestamp: placeholderTimestamp,
                },
              ])
              .select(
                'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
              );

          if (placeholderError) {
            console.error('Assistant placeholder insert error', placeholderError);
          } else if (placeholderRows && placeholderRows.length > 0) {
            const row = (placeholderRows as DbMessageRow[])[0];
            assistantMessageId = row.message_id;
          }
        } catch (e) {
          console.error('Assistant placeholder insert exception', e);
        }

        try {
          // 2) Call Edge Function (non-stream) with messageId of placeholder
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
              messageId: assistantMessageId, // <- crucial for DB attachments
              stream: false,
            }),
            signal,
          });

          if (!res.ok) {
            throw new Error(`Image call failed: ${res.status}`);
          }

          const json = (await res.json()) as MeeraImageResponse;

          finalText = json.reply?.trim() || 'Here is your image.';

          // Prefer URLs from Storage (Edge Function attachments)
          if (json.attachments && json.attachments.length > 0) {
            liveAttachments = json.attachments;
          } else {
            // Fallback to local blob URLs if upload failed for some reason
            (json.images ?? []).forEach((img, index) => {
              const mime = img.mimeType || 'image/png';
              const url = base64ToBlobUrl(img.data, mime);
              const name = `generated-${index + 1}.png`;
              liveAttachments.push({ type: 'image', url, name });
            });
          }

          onDelta(finalText);
        } catch (err) {
          onError?.(err);
          throw err;
        }

        // 3) Update the same assistant row with content (attachments already set by Edge Function)
        const now = new Date().toISOString();
        let finalRow: DbMessageRow | null = null;

        try {
          if (assistantMessageId) {
            const { data: updatedRows, error: updateError } = await supabase
              .from('messages')
              .update({
                content: finalText,
                timestamp: now,
              })
              .eq('message_id', assistantMessageId)
              .select(
                'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
              );

            if (updateError) {
              console.error('Assistant content update error', updateError);
            } else if (updatedRows && updatedRows.length > 0) {
              finalRow = (updatedRows as DbMessageRow[])[0];
            }
          } else {
            // Fallback: create a fresh assistant row (no attachment linkage)
            const { data: savedFallback } = await supabase
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
              .select(
                'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
              );

            finalRow =
              (savedFallback as DbMessageRow[] | null)?.[0] ?? null;
          }
        } catch (e) {
          console.error('Assistant final save exception', e);
        }

        const dbAttachments =
          (finalRow?.attachments as ImageAttachment[] | null) ?? [];
        const attachmentsToUse =
          dbAttachments.length > 0 ? dbAttachments : liveAttachments;

        const assistantMsg: AssistantMsg = {
          message_id:
            finalRow?.message_id ??
            assistantMessageId ??
            crypto.randomUUID(),
          content_type: 'assistant',
          content: finalRow?.content ?? finalText,
          timestamp: finalRow?.timestamp ?? now,
          attachments: attachmentsToUse,
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
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
        );

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
