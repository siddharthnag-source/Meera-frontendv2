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
  system_prompt?: string | null;
};

type UserEssenceRow = {
  user_essence: Record<string, unknown> | null;
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
  assistantMessageId?: string;
  reply?: string;
  thoughts?: string;
  images?: { mimeType?: string; data: string; dataUrl?: string }[];
  model?: string;
  attachments?: ImageAttachment[];
};

/* ---------- Constants ---------- */
const CONTEXT_WINDOW = 40;

/* ---------- Env Vars ---------- */
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

function mapDbRowToChatMessage(row: DbMessageRow) {
  return {
    message_id: row.message_id,
    content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    timestamp: row.timestamp,
    session_id: row.session_id || undefined,
    is_call: row.is_call ?? false,
    attachments: (row.attachments as ImageAttachment[] | null) ?? [],
    message_type: row.message_type ?? 'text',
    image_url: row.image_url ?? undefined,
    failed: false,
    finish_reason: null,
  };
}

function normalizeStarredMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  value.forEach((item) => {
    if (typeof item !== 'string') return;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });

  return result;
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
      const mapped = rows.map(mapDbRowToChatMessage);

      return { message: 'ok', data: mapped };
    } catch (e) {
      console.error('getChatHistory outer error', e);
      return { message: 'error', data: [] };
    }
  },

  /* ---------- Starred Messages ---------- */
  async getStarredMessages() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [] };
      const userId = session.user.id;

      const { data: essenceRow, error: essenceError } = await supabase
        .from('user_essence')
        .select('user_essence')
        .eq('user_id', userId)
        .maybeSingle();

      if (essenceError) {
        console.error('getStarredMessages essence fetch error', essenceError);
        return { message: 'error', data: [] };
      }

      const essence = ((essenceRow as UserEssenceRow | null)?.user_essence ?? {}) as Record<string, unknown>;
      const orderedIds = normalizeStarredMessageIds(essence.starred_message_ids);

      const messageIds = Array.from(
        new Set(orderedIds),
      );

      if (messageIds.length === 0) return { message: 'ok', data: [] };

      const { data: messageRows, error: messagesError } = await supabase
        .from('messages')
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
        )
        .eq('user_id', userId)
        .in('message_id', messageIds);

      if (messagesError) {
        console.error('getStarredMessages messages lookup error', messagesError);
        return { message: 'error', data: [] };
      }

      const mappedById = new Map(
        ((messageRows ?? []) as DbMessageRow[]).map((row) => [row.message_id, mapDbRowToChatMessage(row)]),
      );

      const orderedMessages = orderedIds
        .map((messageId) => mappedById.get(messageId))
        .filter((msg): msg is ReturnType<typeof mapDbRowToChatMessage> => Boolean(msg));

      return { message: 'ok', data: orderedMessages };
    } catch (e) {
      console.error('getStarredMessages outer error', e);
      return { message: 'error', data: [] };
    }
  },

  async setMessageStar(messageId: string, shouldStar: boolean) {
    try {
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) return { message: 'error' };

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) throw new SessionExpiredError('Session expired');
      const userId = session.user.id;
      const { data: essenceRow, error: essenceError } = await supabase
        .from('user_essence')
        .select('user_essence')
        .eq('user_id', userId)
        .maybeSingle();

      if (essenceError) throw essenceError;

      const existingEssence = ((essenceRow as UserEssenceRow | null)?.user_essence ?? {}) as Record<string, unknown>;
      const currentIds = normalizeStarredMessageIds(existingEssence.starred_message_ids);

      const nextIds = shouldStar
        ? [normalizedMessageId, ...currentIds.filter((id) => id !== normalizedMessageId)]
        : currentIds.filter((id) => id !== normalizedMessageId);

      const dedupedNextIds = normalizeStarredMessageIds(nextIds);

      const nextEssence: Record<string, unknown> = {
        ...existingEssence,
        starred_message_ids: dedupedNextIds,
      };

      const { error: upsertError } = await supabase.from('user_essence').upsert(
        [
          {
            user_id: userId,
            user_essence: nextEssence,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'user_id' },
      );

      if (upsertError) throw upsertError;

      return { message: 'ok' };
    } catch (e) {
      console.error('setMessageStar error', e);
      return { message: 'error' };
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

      // Deterministic IDs for this interaction (fixes system_prompt + attachment updates)
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();

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

      const isImage = isImagePrompt(message);

      /* ---------- Save user message WITH message_id ---------- */
      await supabase.from('messages').insert([
        {
          message_id: userMessageId,
          user_id: userId,
          session_id: sessionId,
          content_type: 'user',
          content: message,
          timestamp: new Date().toISOString(),
          message_type: 'text',
          is_call: false,
        },
      ]);

      /* ---------- Create assistant placeholder WITH message_id ---------- */
      await supabase.from('messages').insert([
        {
          message_id: assistantMessageId,
          user_id: userId,
          session_id: sessionId,
          content_type: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          message_type: isImage ? 'image' : 'text',
          is_call: false,
        },
      ]);

      /* ---------------------------------------------------------------------- */
      /*                               IMAGE MODE                               */
      /* ---------------------------------------------------------------------- */

      if (isImage) {
        let finalText = '';
        let liveAttachments: ImageAttachment[] = [];

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

              // NEW: send both IDs
              userMessageId,
              assistantMessageId,

              // Back-compat (optional)
              messageId: assistantMessageId,
            }),
            signal,
          });

          if (!res.ok) throw new Error(`Image call failed: ${res.status}`);

          const json = (await res.json()) as MeeraImageResponse;

          finalText = json.reply?.trim() || 'Here is your image.';

          if (json.attachments && json.attachments.length > 0) {
            liveAttachments = json.attachments;
          } else {
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

        // Update assistant placeholder content (Edge has already updated system_prompt + attachments)
        const now = new Date().toISOString();
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

        if (updateError) console.error('Assistant content update error', updateError);

        const finalRow = (updatedRows as DbMessageRow[] | null)?.[0] ?? null;
        const dbAttachments = (finalRow?.attachments as ImageAttachment[] | null) ?? [];
        const attachmentsToUse = dbAttachments.length > 0 ? dbAttachments : liveAttachments;

        const assistantMsg: AssistantMsg = {
          message_id: finalRow?.message_id ?? assistantMessageId,
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
        userMessageId,
        assistantMessageId,
        signal,
        onAnswerDelta: (d) => {
          finalText += d;
          onDelta(d);
        },
      });

      const now = new Date().toISOString();

      // Update assistant placeholder (do not insert a new assistant row)
      const { data: saved, error: saveErr } = await supabase
        .from('messages')
        .update({
          content: finalText,
          timestamp: now,
        })
        .eq('message_id', assistantMessageId)
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
        );

      if (saveErr) console.error('Assistant final update error', saveErr);

      const row = (saved as DbMessageRow[] | null)?.[0];

      const assistantMsg: AssistantMsg = {
        message_id: row?.message_id ?? assistantMessageId,
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
