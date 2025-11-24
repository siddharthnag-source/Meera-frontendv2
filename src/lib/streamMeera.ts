// src/lib/streamMeera.ts

export type LLMHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type StreamMeeraArgs = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  messages: LLMHistoryMessage[];
  google_search?: boolean;
  onAnswerDelta: (t: string) => void;
  onDone?: () => void;
  onError?: (e: unknown) => void;
  signal?: AbortSignal;
};

export async function streamMeera({
  supabaseUrl,
  supabaseAnonKey,
  messages,
  google_search,
  onAnswerDelta,
  onDone,
  onError,
  signal,
}: StreamMeeraArgs): Promise<void> {
  const chatUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/chat`;

  try {
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        messages,
        google_search: !!google_search,
      }),
      signal,
    });

    if (!res.ok) {
      let errBody: unknown = null;
      try {
        errBody = await res.json();
      } catch {
        // ignore
      }
      throw new Error(
        `streamMeera failed: ${res.status} ${res.statusText} ${errBody ? JSON.stringify(errBody) : ''}`,
      );
    }

    if (!res.body) {
      throw new Error('streamMeera: response has no body to stream');
    }

    const contentType = res.headers.get('content-type') || '';
    const isSSE = contentType.includes('text/event-stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let doneCalled = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      if (!isSSE) {
        onAnswerDelta(chunk);
        continue;
      }

      buffer += chunk;

      // SSE frames are separated by blank lines
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';

      for (const frame of frames) {
        const lines = frame.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.replace(/^data:\s?/, '');

          if (payload === '[DONE]') {
            if (!doneCalled) {
              doneCalled = true;
              onDone?.();
            }
            continue;
          }

          // Try JSON payloads first, fallback to raw text
          let textDelta = payload;
          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            textDelta =
              (parsed.delta as string) ||
              (parsed.text as string) ||
              (parsed.reply as string) ||
              (parsed.response as string) ||
              payload;
          } catch {
            // not JSON, keep raw
          }

          if (textDelta) onAnswerDelta(textDelta);
        }
      }
    }

    if (!doneCalled) onDone?.();
  } catch (e) {
    onError?.(e);
    throw e;
  }
}
