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

type OutgoingAttachment = {
  name: string;
  url?: string;
  publicUrl?: string;
  mimeType?: string;
  type?: 'image' | 'document' | 'file' | string;
  size?: number;
  bucket?: string;
  storagePath?: string;
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
  sessionId?: string;
  webSearchEnabled?: boolean;
  webSearchTriggerReason?: string;
  reply?: string;
  thoughts?: string;
  images?: { mimeType?: string; data: string; dataUrl?: string }[];
  model?: string;
  attachments?: ImageAttachment[];
};

/* ---------- Constants ---------- */
const CONTEXT_WINDOW = 40;
const CLIENT_SESSION_NAMESPACE = (process.env.NEXT_PUBLIC_SESSION_NAMESPACE || 'r20260329f1').trim();
const CLIENT_SESSION_PREFIX = `sess_${CLIENT_SESSION_NAMESPACE}_`;
const CLIENT_SESSION_STORAGE_KEY_PREFIX = `meera:chat_session_id:${CLIENT_SESSION_NAMESPACE}:`;

/* ---------- Env Vars ---------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Public Supabase env vars missing, streaming will fail.');
}

function normalizeSessionId(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLegacySessionId(value: string): boolean {
  return value === 'sess_1';
}

function isCurrentSessionNamespace(value: string): boolean {
  return value.startsWith(CLIENT_SESSION_PREFIX);
}

function getOrCreateClientSessionId(userId: string, preferredSessionId?: string): string {
  const explicitSessionId = normalizeSessionId(preferredSessionId);
  if (explicitSessionId && !isLegacySessionId(explicitSessionId) && isCurrentSessionNamespace(explicitSessionId)) {
    return explicitSessionId;
  }

  const storageKey = `${CLIENT_SESSION_STORAGE_KEY_PREFIX}${userId}`;

  try {
    const existing = normalizeSessionId(globalThis?.localStorage?.getItem(storageKey));
    if (existing && !isLegacySessionId(existing) && isCurrentSessionNamespace(existing)) return existing;
    if (existing && (!isCurrentSessionNamespace(existing) || isLegacySessionId(existing))) {
      globalThis?.localStorage?.removeItem(storageKey);
    }
  } catch {
    // Ignore storage read failures and fall back to ephemeral generation.
  }

  const generated = `${CLIENT_SESSION_PREFIX}${crypto.randomUUID()}`;

  try {
    globalThis?.localStorage?.setItem(storageKey, generated);
  } catch {
    // Ignore storage write failures; the generated session id is still valid for this request.
  }

  return generated;
}

function persistClientSessionId(userId: string, sessionId?: string | null): string | null {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized || isLegacySessionId(normalized) || !isCurrentSessionNamespace(normalized)) return null;
  const storageKey = `${CLIENT_SESSION_STORAGE_KEY_PREFIX}${userId}`;
  try {
    globalThis?.localStorage?.setItem(storageKey, normalized);
  } catch {
    // Ignore storage write failures; caller can still continue with this session id.
  }
  return normalized;
}

/* ---------- Image helpers ---------- */

const IMAGE_TRIGGER_WORDS = ['image', 'photo', 'picture', 'img', 'pic'];
const IMAGE_FILE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)(\?|#|$)/i;

function isImagePrompt(text: string): boolean {
  const t = text.toLowerCase();
  const hasImageNoun = IMAGE_TRIGGER_WORDS.some((w) => t.includes(w));
  const hasGenerateVerb =
    /\b(generate|create|draw|make|render|illustrate|paint|sketch|design)\b/.test(t);
  const hasShowOrSendImage = /\b(show|send|give)\b.*\b(image|picture|photo|pic)\b/.test(t);
  return hasShowOrSendImage || (hasGenerateVerb && hasImageNoun);
}

function hasImageAttachment(attachments: OutgoingAttachment[]): boolean {
  return attachments.some((att) => {
    const mime = String(att.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    if (String(att.type || '').toLowerCase() === 'image') return true;
    const name = String(att.name || '').toLowerCase();
    const url = String(att.url || att.publicUrl || '').toLowerCase();
    return IMAGE_FILE_EXT_RE.test(name) || IMAGE_FILE_EXT_RE.test(url);
  });
}

function isLikelyImageEditPrompt(text: string): boolean {
  const t = text.toLowerCase();
  const hasEditVerb =
    /\b(change|edit|modify|remove|replace|swap|erase|add|crop|blur|sharpen|resize|rotate|flip|brighten|darken|fix|retouch|enhance|improve|adjust|tweak|beautify|stylize|style|transform|restyle|convert|makeover)\b/.test(
      t,
    );
  const hasTarget =
    /\b(background|bg|colour|color|logo|text|font|watermark|person|people|object|sky|shirt|hair|eyes|face|layout|button|banner)\b/.test(
      t,
    );
  if (hasEditVerb && hasTarget) return true;
  if (/\b(change|set)\b.*\b(background|bg)\b.*\b(colou?r)\b/.test(t)) return true;
  if (/\b(make|turn|set)\b.*\b(red|green|blue|black|white|gray|grey|purple|pink|orange|yellow|brown|teal|navy|beige|cream)\b/.test(t)) {
    return true;
  }
  const hasStyleCue =
    /\b(look|style|vibe|theme|aesthetic|avatar|character|costume|outfit|filter)\b/.test(t);
  const hasSubjectRef =
    /\b(him|her|them|me|my|our|it|this|that|face|selfie|portrait)\b/.test(t);
  if (/\b(give|make|turn|transform|restyle|convert|style)\b/.test(t) && hasStyleCue && hasSubjectRef) return true;
  if (/\b(make|turn)\b.*\binto\b/.test(t) && hasSubjectRef) return true;
  return false;
}

function isLikelyAttachmentEditCue(text: string): boolean {
  const t = text.toLowerCase();
  const hasTransformVerb =
    /\b(edit|change|modify|remove|replace|add|improve|enhance|retouch|stylize|upscale|restore|clean|fix|make|turn|set|adjust|tweak|transform|restyle|convert|give)\b/.test(
      t,
    );
  const hasImageRef = /\b(image|photo|picture|pic|portrait|selfie)\b/.test(t);
  const hasStyleCue =
    /\b(look|style|vibe|theme|aesthetic|avatar|character|costume|outfit|filter)\b/.test(t);
  const hasSubjectRef = /\b(him|her|them|me|my|our|it|this|that|face)\b/.test(t);
  return hasTransformVerb && (hasImageRef || hasStyleCue || hasSubjectRef || t.length <= 180);
}

function isLikelyAttachmentReadCue(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(read|describe|analy[sz]e|analy[sz]ing|explain|identify|ocr|transcribe|extract|summari[sz]e|caption|what(?:'s| is) in)\b/.test(
    t,
  );
}

function normalizeOutgoingAttachments(attachments: OutgoingAttachment[]): OutgoingAttachment[] {
  const out: OutgoingAttachment[] = [];
  for (const att of attachments) {
    const url = String(att.url || att.publicUrl || '').trim();
    const storagePath = String(att.storagePath || '').trim();
    if (!url && !storagePath) continue;
    out.push({
      name: String(att.name || 'attachment'),
      url: url || undefined,
      mimeType: att.mimeType ? String(att.mimeType) : undefined,
      type: att.type ? String(att.type) : undefined,
      size: typeof att.size === 'number' ? att.size : undefined,
      bucket: att.bucket ? String(att.bucket) : undefined,
      storagePath: storagePath || undefined,
    });
  }
  return out;
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
    attachments = [],
    sessionId,
    onDelta,
    onDone,
    onError,
    signal,
  }: {
    message: string;
    attachments?: OutgoingAttachment[];
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
      const accessToken = session.access_token;
      const effectiveSessionId = getOrCreateClientSessionId(userId, sessionId);

      // Deterministic IDs for this interaction (fixes system_prompt + attachment updates)
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = crypto.randomUUID();

      /* ---------- Fetch context history ---------- */
      let historyRows: DbMessageRow[] = [];

      try {
        const { data: page1 } = await supabase
          .from('messages')
          .select('content_type, content, timestamp, session_id')
          .eq('user_id', userId)
          .eq('session_id', effectiveSessionId)
          .order('timestamp', { ascending: false })
          .limit(CONTEXT_WINDOW);

        historyRows = (page1 ?? []) as DbMessageRow[];
      } catch (e) {
        console.error('History load failed:', e);
      }

      const sortedHistory = historyRows.slice().reverse();
      const normalizedAttachments = normalizeOutgoingAttachments(attachments);

      const historyForModel: LLMHistoryMessage[] = sortedHistory
        .filter((r) => r.content?.trim())
        .map((r) => ({
          role: r.content_type === 'assistant' ? 'assistant' : 'user',
          content: r.content,
        }));

      historyForModel.push({ role: 'user', content: message });

      const hasIncomingImageAttachment = hasImageAttachment(normalizedAttachments);
      const hasLikelyImageGenerateIntent = isImagePrompt(message);
      const hasLikelyImageEditIntent = isLikelyImageEditPrompt(message);
      const hasAttachmentEditCue = isLikelyAttachmentEditCue(message);
      const hasAttachmentReadCue = isLikelyAttachmentReadCue(message);
      const isImage =
        hasLikelyImageGenerateIntent ||
        (hasIncomingImageAttachment &&
          (hasLikelyImageEditIntent || hasAttachmentEditCue) &&
          !hasAttachmentReadCue);

      /* ---------- Save user message WITH message_id ---------- */
      await supabase.from('messages').insert([
        {
          message_id: userMessageId,
          user_id: userId,
          session_id: effectiveSessionId,
          content_type: 'user',
          content: message,
          timestamp: new Date().toISOString(),
          message_type: 'text',
          attachments: normalizedAttachments.length > 0 ? normalizedAttachments : null,
          is_call: false,
        },
      ]);

      /* ---------- Create assistant placeholder WITH message_id ---------- */
      await supabase.from('messages').insert([
        {
          message_id: assistantMessageId,
          user_id: userId,
          session_id: effectiveSessionId,
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
              Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY!}`,
            },
            body: JSON.stringify({
              message,
              messages: historyForModel,
              attachments: normalizedAttachments,
              userId,
              sessionId: effectiveSessionId,
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
          persistClientSessionId(userId, json.sessionId);

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
      let streamError: unknown = null;

      try {
        await streamMeera({
          supabaseUrl: SUPABASE_URL!,
          supabaseAnonKey: SUPABASE_ANON_KEY!,
          accessToken,
          message,
          messages: historyForModel,
          attachments: normalizedAttachments,
          userId,
          sessionId: effectiveSessionId,
          userMessageId,
          assistantMessageId,
          onMeta: (meta) => {
            persistClientSessionId(userId, meta?.sessionId);
          },
          signal,
          idleTimeoutMs: 30000,
          onAnswerDelta: (d) => {
            finalText += d;
            onDelta(d);
          },
        });
      } catch (err) {
        streamError = err;
        console.warn('streamMessage: streaming path failed, retrying non-stream fallback', err);
      }

      if (streamError) {
        const fallbackRes = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY!}`,
          },
          body: JSON.stringify({
            message,
            messages: historyForModel,
            attachments: normalizedAttachments,
            userId,
            sessionId: effectiveSessionId,
            stream: false,
            userMessageId,
            assistantMessageId,
            messageId: assistantMessageId,
          }),
          signal,
        });

        if (!fallbackRes.ok) {
          throw streamError;
        }

        const fallbackJson = (await fallbackRes.json()) as MeeraImageResponse;
        persistClientSessionId(userId, fallbackJson.sessionId);
        const fallbackReply = String(fallbackJson?.reply || '').trim();

        if (fallbackReply) {
          if (!finalText.trim()) {
            finalText = fallbackReply;
            onDelta(fallbackReply);
          } else if (fallbackReply.startsWith(finalText)) {
            const delta = fallbackReply.slice(finalText.length);
            if (delta) onDelta(delta);
            finalText = fallbackReply;
          } else {
            const stitchedDelta = `\n\n${fallbackReply}`;
            onDelta(stitchedDelta);
            finalText += stitchedDelta;
          }
        }
      }

      let resolvedFinalText = finalText.trim();
      const now = new Date().toISOString();
      let row: DbMessageRow | undefined;
      const assistantRowSelect =
        'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments';
      const readAssistantRow = async (): Promise<DbMessageRow | undefined> => {
        const { data, error } = await supabase
          .from('messages')
          .select(assistantRowSelect)
          .eq('message_id', assistantMessageId)
          .limit(1);

        if (error) {
          console.error('Assistant final row fetch error', error);
          return undefined;
        }
        return (data as DbMessageRow[] | null)?.[0] ?? undefined;
      };

      // Backend is the single writer for final assistant content.
      // Poll briefly so we don't race and overwrite finalized backend replies with partial deltas.
      const readDelaysMs = [0, 120, 250, 500, 900, 1400, 2200];
      for (const delayMs of readDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const candidate = await readAssistantRow();
        if (!candidate) continue;
        row = candidate;
        if (typeof candidate.content === 'string' && candidate.content.trim()) {
          resolvedFinalText = candidate.content.trim();
          break;
        }
      }

      if (!resolvedFinalText) {
        resolvedFinalText = 'Sorry, I could not generate a response. Please try again.';
      }

      const assistantMsg: AssistantMsg = {
        message_id: row?.message_id ?? assistantMessageId,
        content_type: 'assistant',
        content: (typeof row?.content === 'string' && row.content.trim()) ? row.content : resolvedFinalText,
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
