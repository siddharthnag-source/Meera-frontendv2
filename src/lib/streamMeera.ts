// src/lib/streamMeera.ts

type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatRequestAttachment = {
  name: string;
  url?: string;
  publicUrl?: string;
  mimeType?: string;
  type?: string;
  size?: number;
  bucket?: string;
  storagePath?: string;
};

type GeminiPart = {
  text?: string;
  thought?: boolean;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
};

type GeminiSseChunk = {
  // Meta event from our edge wrapper: { type: "meta", assistantMessageId: "..." }
  type?: string;
  assistantMessageId?: string;
  sessionId?: string;
  webSearchEnabled?: boolean;
  webSearchTriggerReason?: string;

  // Gemini SSE payload
  candidates?: GeminiCandidate[];
};

const STREAM_IDLE_TIMEOUT_MS = 35000;

export async function streamMeera({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  message,
  messages,
  attachments,
  userId,
  sessionId,
  userMessageId,
  assistantMessageId,
  onAnswerDelta,
  onMeta,
  onDone,
  onError,
  signal,
  idleTimeoutMs,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  accessToken?: string | null;
  message?: string;
  messages: LLMHistoryMessage[];
  attachments?: ChatRequestAttachment[];
  userId: string;
  sessionId?: string;

  // NEW: deterministic IDs
  userMessageId: string;
  assistantMessageId: string;

  onAnswerDelta: (t: string) => void;
  onMeta?: (meta: GeminiSseChunk) => void;
  onDone?: () => void;
  onError?: (e: unknown) => void;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
}) {
  const requestController = new AbortController();
  const timeoutMs =
    typeof idleTimeoutMs === 'number' && Number.isFinite(idleTimeoutMs) && idleTimeoutMs >= 1000
      ? Math.round(idleTimeoutMs)
      : STREAM_IDLE_TIMEOUT_MS;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let parseErrorCount = 0;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      requestController.abort(new Error(`Stream idle timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  };
  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const abortFromExternalSignal = () => {
    requestController.abort(signal?.reason);
  };
  if (signal) {
    if (signal.aborted) {
      requestController.abort(signal.reason);
    } else {
      signal.addEventListener('abort', abortFromExternalSignal, { once: true });
    }
  }
  try {
    resetIdleTimer();
    const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken || supabaseAnonKey}`,
      },
      body: JSON.stringify({
        message,
        messages,
        attachments,
        userId,
        sessionId,
        stream: true,

        // NEW: send both IDs
        userMessageId,
        assistantMessageId,

        // Back-compat (optional)
        messageId: assistantMessageId,
      }),
      signal: requestController.signal,
    });
    resetIdleTimer();

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as {
        reply?: string;
        assistantMessageId?: string;
        sessionId?: string;
        webSearchEnabled?: boolean;
        webSearchTriggerReason?: string;
      };
      if (json?.sessionId || json?.assistantMessageId) {
        onMeta?.({
          type: 'meta',
          assistantMessageId: json.assistantMessageId,
          sessionId: json.sessionId,
          webSearchEnabled: json.webSearchEnabled,
          webSearchTriggerReason: json.webSearchTriggerReason,
        });
      }
      const reply = String(json?.reply || '').trim();
      if (reply) onAnswerDelta(reply);
      onDone?.();
      return;
    }

    if (!res.body) {
      throw new Error('Missing response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let lastAnswer = '';

    while (true) {
      resetIdleTimer();
      const { value, done } = await reader.read();
      if (done) break;
      resetIdleTimer();

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';

      for (const evt of events) {
        const dataLines = evt
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice('data:'.length).trim());
        if (!dataLines.length) continue;

        const dataStr = dataLines.join('\n').trim();
        if (!dataStr) continue;

        // Some streams may send [DONE]
        if (dataStr === '[DONE]') continue;

        let json: GeminiSseChunk | null = null;
        try {
          json = JSON.parse(dataStr) as GeminiSseChunk;
        } catch (parseError) {
          parseErrorCount += 1;
          if (parseErrorCount <= 3) {
            console.warn('streamMeera parse error, skipping malformed SSE payload', {
              parseErrorCount,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
          }
          continue;
        }
        if (!json) continue;

        // Handle meta event injected by edge wrapper
        if (json.type === 'meta') {
          onMeta?.(json);
          continue;
        }

        const parts = json?.candidates?.[0]?.content?.parts ?? [];

        for (const p of parts) {
          const text = p?.text ?? '';
          if (!text) continue;

          // skip thought tokens
          if (p?.thought) continue;

          // Gemini sometimes re-sends the full answer; diff it
          const delta = text.startsWith(lastAnswer) ? text.slice(lastAnswer.length) : text;

          lastAnswer = text;
          if (delta) {
            onAnswerDelta(delta);
          }
        }
      }
    }

    onDone?.();
  } catch (e: unknown) {
    console.error('streamMeera error:', e);
    onError?.(e);
    throw e;
  } finally {
    clearIdleTimer();
    if (signal) signal.removeEventListener('abort', abortFromExternalSignal);
  }
}
