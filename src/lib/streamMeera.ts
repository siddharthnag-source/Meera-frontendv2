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
  candidates?: GeminiCandidate[];
};

export async function streamMeera({
  supabaseUrl,
  supabaseAnonKey,
  messages,
  onAnswerDelta,
  onDone,
  onError,
  signal,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  messages: LLMHistoryMessage[];
  onAnswerDelta: (t: string) => void;
  onDone?: () => void;
  onError?: (e: unknown) => void;
  signal?: AbortSignal;
}) {
  try {
    // Limit to last 200 messages before sending to the edge function
    const MAX_MESSAGES = 200;
    const trimmedMessages =
      messages.length > MAX_MESSAGES
        ? messages.slice(messages.length - MAX_MESSAGES)
        : messages;

    const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ messages: trimmedMessages, stream: true }),
      signal,
    });

    if (!res.ok || !res.body) throw new Error(await res.text());

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

        const json = JSON.parse(dataStr) as GeminiSseChunk;
        const parts = json?.candidates?.[0]?.content?.parts ?? [];

        for (const p of parts) {
          const text = p?.text ?? '';
          if (!text) continue;

          // Skip internal thoughts; only stream visible text
          if (p?.thought) continue;

          const delta = text.startsWith(lastAnswer)
            ? text.slice(lastAnswer.length)
            : text;

          lastAnswer = text;
          onAnswerDelta(delta);
        }
      }
    }

    onDone?.();
  } catch (e: unknown) {
    onError?.(e);
  }
}
