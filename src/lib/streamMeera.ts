// src/lib/streamMeera.ts

type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
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

  // Gemini SSE payload
  candidates?: GeminiCandidate[];
};

export async function streamMeera({
  supabaseUrl,
  supabaseAnonKey,
  messages,
  userId,
  sessionId,
  userMessageId,
  assistantMessageId,
  onAnswerDelta,
  onDone,
  onError,
  signal,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  messages: LLMHistoryMessage[];
  userId: string;
  sessionId?: string;

  // NEW: deterministic IDs
  userMessageId: string;
  assistantMessageId: string;

  onAnswerDelta: (t: string) => void;
  onDone?: () => void;
  onError?: (e: unknown) => void;
  signal?: AbortSignal;
}) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        messages,
        userId,
        sessionId,
        stream: true,

        // NEW: send both IDs
        userMessageId,
        assistantMessageId,

        // Back-compat (optional)
        messageId: assistantMessageId,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(await res.text());
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let lastAnswer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';

      for (const evt of events) {
        const dataLine = evt.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;

        const dataStr = dataLine.replace('data:', '').trim();
        if (!dataStr) continue;

        // Some streams may send [DONE]
        if (dataStr === '[DONE]') continue;

        let json: GeminiSseChunk | null = null;
        try {
          json = JSON.parse(dataStr) as GeminiSseChunk;
        } catch {
          continue;
        }
        if (!json) continue;

        // Handle meta event injected by edge wrapper
        if (json.type === 'meta') {
          // We do not need to do anything here in this client,
          // but keeping this prevents JSON parse confusion.
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
          if (delta) onAnswerDelta(delta);
        }
      }
    }

    onDone?.();
  } catch (e: unknown) {
    console.error('streamMeera error:', e);
    onError?.(e);
  }
}
