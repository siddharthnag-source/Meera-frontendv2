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

type StarredMessageRow = {
  message_id: string;
  user_id: string;
  snapshot_content: string | null;
  snapshot_content_type: 'user' | 'assistant' | string | null;
  snapshot_timestamp: string | null;
  user_context: string | null;
  summary: string | null;
  starred_at: string | null;
};

type StarredMessageSnapshotInput = {
  content?: string | null;
  content_type?: 'user' | 'assistant' | 'system';
  timestamp?: string | null;
  user_context?: string | null;
  summary?: string | null;
};

type StarredMessageSnapshot = {
  message_id: string;
  content: string;
  content_type: 'user' | 'assistant';
  timestamp: string;
  user_context: string;
  summary: string;
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

function generateSummary(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Saved Memory';

  const words = normalized.split(' ');
  const title = words.slice(0, 5).join(' ');
  return words.length > 5 ? `${title}...` : title;
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

function mapStarredRowToChatMessage(row: StarredMessageRow) {
  const timestamp =
    typeof row.snapshot_timestamp === 'string' && row.snapshot_timestamp
      ? row.snapshot_timestamp
      : typeof row.starred_at === 'string' && row.starred_at
        ? row.starred_at
        : new Date(0).toISOString();

  return {
    message_id: row.message_id,
    content_type: row.snapshot_content_type === 'user' ? 'user' : 'assistant',
    content: row.snapshot_content ?? '',
    timestamp,
    user_context: row.user_context ?? '',
    summary: row.summary ?? generateSummary((row.user_context ?? '').trim() || (row.snapshot_content ?? '').trim()),
    session_id: undefined,
    is_call: false,
    attachments: [],
    message_type: 'text',
    image_url: undefined,
    failed: false,
    finish_reason: null,
  };
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

  async getImageHistory(page: number = 1, pageSize: number = 40) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [], hasMore: false };
      const userId = session.user.id;

      const { data, error } = await supabase
        .from('messages')
        .select('message_id, content_type, content, timestamp, session_id, is_call, message_type, attachments')
        .eq('user_id', userId)
        .eq('content_type', 'assistant')
        .eq('message_type', 'image')
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('getImageHistory error', error);
        return { message: 'error', data: [], hasMore: false };
      }

      const rows = ((data ?? []) as DbMessageRow[]).slice().reverse();
      const mapped = rows.map((row) => ({
        message_id: row.message_id,
        content_type: 'assistant' as const,
        content: row.content ?? '',
        timestamp: row.timestamp,
        session_id: row.session_id || undefined,
        is_call: row.is_call ?? false,
        attachments: (row.attachments as ImageAttachment[] | null) ?? [],
        failed: false,
        finish_reason: null,
      }));

      return {
        message: 'ok',
        data: mapped,
        hasMore: rows.length === pageSize,
      };
    } catch (e) {
      console.error('getImageHistory outer error', e);
      return { message: 'error', data: [], hasMore: false };
    }
  },

  async getMessageContextWindow(
    messageId: string,
    before: number = 24,
    after: number = 24,
    aroundTimestamp?: string,
  ) {
    try {
      const messageColumns =
        'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments';
      const normalizedId = messageId.trim();
      const normalizedTimestamp = typeof aroundTimestamp === 'string' ? aroundTimestamp.trim() : '';
      if (!normalizedId && !normalizedTimestamp) return { message: 'error', data: [] };

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [] };
      const userId = session.user.id;

      const { data: anchor, error: anchorError } = normalizedId
        ? await supabase
            .from('messages')
            .select(messageColumns)
            .eq('user_id', userId)
            .eq('message_id', normalizedId)
            .maybeSingle()
        : { data: null, error: null };

      if (anchorError) {
        console.error('getMessageContextWindow anchor error', anchorError);
        return { message: 'error', data: [] };
      }

      let anchorTimestamp = '';
      let anchorRow: DbMessageRow | null = null;
      let questionRow: DbMessageRow | null = null;
      let questionMessageId: string | null = null;

      if (anchor) {
        anchorRow = anchor as DbMessageRow;
        anchorTimestamp = anchorRow.timestamp;
      } else if (normalizedTimestamp) {
        const parsedTimestamp = new Date(normalizedTimestamp).getTime();
        if (!Number.isFinite(parsedTimestamp)) {
          return { message: 'not_found', data: [] };
        }
        anchorTimestamp = normalizedTimestamp;
      } else {
        return { message: 'not_found', data: [] };
      }

      if (anchorRow?.content_type === 'assistant' || (!anchorRow && normalizedTimestamp)) {
        const queryPreviousUser = async (sessionId?: string) => {
          let query = supabase
            .from('messages')
            .select(messageColumns)
            .eq('user_id', userId)
            .eq('content_type', 'user')
            .lte('timestamp', anchorTimestamp)
            .order('timestamp', { ascending: false })
            .limit(1);

          if (sessionId) {
            query = query.eq('session_id', sessionId);
          }

          return query.maybeSingle();
        };

        const anchorSessionId =
          typeof anchorRow?.session_id === 'string' && anchorRow.session_id.trim()
            ? anchorRow.session_id
            : undefined;

        const inSessionResult = await queryPreviousUser(anchorSessionId);
        if (inSessionResult.error) {
          console.error('getMessageContextWindow question lookup (session) error', inSessionResult.error);
          return { message: 'error', data: [] };
        }

        if (inSessionResult.data) {
          questionRow = inSessionResult.data as DbMessageRow;
        } else {
          const fallbackResult = await queryPreviousUser();
          if (fallbackResult.error) {
            console.error('getMessageContextWindow question lookup (fallback) error', fallbackResult.error);
            return { message: 'error', data: [] };
          }
          if (fallbackResult.data) {
            questionRow = fallbackResult.data as DbMessageRow;
          }
        }

        if (questionRow) {
          questionMessageId = questionRow.message_id;
        }
      }

      const [olderResult, newerResult] = await Promise.all([
        supabase
          .from('messages')
          .select(messageColumns)
          .eq('user_id', userId)
          .lt('timestamp', anchorTimestamp)
          .order('timestamp', { ascending: false })
          .limit(before),
        supabase
          .from('messages')
          .select(messageColumns)
          .eq('user_id', userId)
          .gte('timestamp', anchorTimestamp)
          .order('timestamp', { ascending: true })
          .limit(after + 1),
      ]);

      if (olderResult.error) {
        console.error('getMessageContextWindow older error', olderResult.error);
        return { message: 'error', data: [] };
      }

      if (newerResult.error) {
        console.error('getMessageContextWindow newer error', newerResult.error);
        return { message: 'error', data: [] };
      }

      const olderRows = ((olderResult.data ?? []) as DbMessageRow[]).slice().reverse();
      const newerRows = (newerResult.data ?? []) as DbMessageRow[];

      const orderedMap = new Map<string, DbMessageRow>();
      [
        ...olderRows,
        ...(questionRow ? [questionRow] : []),
        ...(anchorRow ? [anchorRow] : []),
        ...newerRows,
      ].forEach((row) => {
        orderedMap.set(row.message_id, row);
      });

      const mapped = Array.from(orderedMap.values()).map(mapDbRowToChatMessage);

      return {
        message: mapped.length > 0 ? 'ok' : 'not_found',
        data: mapped,
        question_message_id: questionMessageId,
      };
    } catch (e) {
      console.error('getMessageContextWindow outer error', e);
      return { message: 'error', data: [] };
    }
  },

  /* ---------- Starred Messages ---------- */
  async getStarredMessages() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [], ids: [] as string[] };
      const userId = session.user.id;

      const { data, error } = await supabase
        .from('starred_messages')
        .select(
          'message_id,user_id,snapshot_content,snapshot_content_type,snapshot_timestamp,user_context,summary,starred_at',
        )
        .eq('user_id', userId)
        .order('starred_at', { ascending: false });

      if (error) {
        console.error('getStarredMessages error', error);
        return { message: 'error', data: [], ids: [] as string[] };
      }

      const rows = (data ?? []) as StarredMessageRow[];
      const orderedIds = rows.map((row) => row.message_id);
      const orderedMessages = rows.map(mapStarredRowToChatMessage);

      return { message: 'ok', data: orderedMessages, ids: orderedIds };
    } catch (e) {
      console.error('getStarredMessages outer error', e);
      return { message: 'error', data: [], ids: [] as string[] };
    }
  },

  async setMessageStar(
    messageId: string,
    shouldStar: boolean,
    snapshot?: StarredMessageSnapshotInput,
  ) {
    try {
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) return { message: 'error' };

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) throw new SessionExpiredError('Session expired');
      const userId = session.user.id;
      if (shouldStar) {
        const snapshotPayload: StarredMessageSnapshot = {
          message_id: normalizedMessageId,
          content: typeof snapshot?.content === 'string' ? snapshot.content : '',
          content_type: snapshot?.content_type === 'user' ? 'user' : 'assistant',
          timestamp:
            typeof snapshot?.timestamp === 'string' && snapshot.timestamp ? snapshot.timestamp : new Date().toISOString(),
          user_context:
            typeof snapshot?.user_context === 'string' ? snapshot.user_context.replace(/\s+/g, ' ').trim() : '',
          summary:
            typeof snapshot?.summary === 'string' && snapshot.summary.trim()
              ? snapshot.summary.trim()
              : generateSummary(
                  (typeof snapshot?.user_context === 'string' ? snapshot.user_context : '') ||
                    (typeof snapshot?.content === 'string' ? snapshot.content : ''),
                ),
        };

        const { error } = await supabase.from('starred_messages').upsert(
          [
            {
              user_id: userId,
              message_id: normalizedMessageId,
              snapshot_content: snapshotPayload.content,
              snapshot_content_type: snapshotPayload.content_type,
              snapshot_timestamp: snapshotPayload.timestamp,
              user_context: snapshotPayload.user_context,
              summary: snapshotPayload.summary,
              starred_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          {
            onConflict: 'user_id,message_id',
          },
        );

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('starred_messages')
          .delete()
          .eq('user_id', userId)
          .eq('message_id', normalizedMessageId);

        if (error) throw error;
      }

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
