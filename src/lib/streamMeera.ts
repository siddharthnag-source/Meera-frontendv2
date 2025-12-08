type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ---------- Gemini Types ----------
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

// ---------- OpenRouter Types ----------
type ORDelta = {
  content?: string; // streamed token
};

type ORChoice = {
  delta?: ORDelta;
};

type OpenRouterChunk = {
  choices?: ORChoice[];
};

// ----------------------------------------------------

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
        // Skip colon-only heartbeats like: ": OPENROUTER PROCESSING"
        if (evt.startsWith(":")) continue;

        const dataLine = evt.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;

        const dataStr = dataLine.replace("data:", "").trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let json: any;
        try {
          json = JSON.parse(dataStr);
        } catch {
          continue;
        }

        // ---------- 1) OPENROUTER FORMAT ----------
        const orChoices: OpenRouterChunk["choices"] = json?.choices;
        if (orChoices && orChoices.length > 0) {
          const delta = orChoices[0]?.delta;
          if (delta?.content) {
            onAnswerDelta(delta.content);
          }
        }

        // ---------- 2) GEMINI FORMAT ----------
        const gemCandidates: GeminiCandidate[] | undefined = json?.candidates;
        if (gemCandidates && gemCandidates.length > 0) {
          const parts = gemCandidates[0]?.content?.parts ?? [];
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
