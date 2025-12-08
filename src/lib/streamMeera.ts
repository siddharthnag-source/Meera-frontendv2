type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ---------- Gemini ----------
type GeminiPart = {
  text?: string;
  thought?: boolean;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
};

// ---------- OpenRouter ----------
type ORDelta = {
  content?: string;
};

type ORChoice = {
  delta?: ORDelta;
};

export async function streamMeera({
  supabaseUrl,
  supabaseAnonKey,
  messages,
  userId,
  sessionId,
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
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(await res.text());
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const evt of events) {
        if (evt.startsWith(":")) continue;

        const dataLine = evt.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;

        const dataStr = dataLine.replace("data:", "").trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue;
        }

        const json = parsed as Record<string, unknown>;

        // -------- OPENROUTER FORMAT --------
        const choices = json["choices"] as ORChoice[] | undefined;
        if (choices && choices.length > 0) {
          const delta = choices[0]?.delta;
          if (delta?.content) {
            onAnswerDelta(delta.content);
          }
        }

        // -------- GEMINI FORMAT --------
        const candidates = json["candidates"] as GeminiCandidate[] | undefined;
        if (candidates && candidates.length > 0) {
          const parts = candidates[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (p.thought) continue;
            if (p.text) onAnswerDelta(p.text);
          }
        }
      }
    }

    onDone?.();
  } catch (e) {
    console.error("streamMeera error:", e);
    onError?.(e);
  }
}
