import type { SupabaseClient } from "@supabase/supabase-js";
import { ONBOARDING_PROMPT } from "./onboarding-agent";
import { Profile, PROFILE_FIELDS, validateProfile } from "./onboarding-profile";
import { OnboardingError, quota } from "./onboarding-server";

export function provider(db: SupabaseClient) {
  const key = process.env.OPENROUTER_API_KEY;
  const models = {
    stt: process.env.ONBOARDING_STT_MODEL,
    llm: process.env.ONBOARDING_LLM_MODEL,
    tts: process.env.ONBOARDING_TTS_MODEL,
  };
  async function request(
    path: string,
    kind: keyof typeof models,
    payload: object,
  ) {
    const model = models[kind];
    if (!key || !model || model.startsWith("google/"))
      throw new OnboardingError(
        503,
        "OpenRouter voice is not configured. You can still edit your profile.",
      );
    await quota(db); // Shared, atomic Supabase quota BEFORE each paid request. Never an in-memory counter.
    const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, model }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new OnboardingError(
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "Voice is busy. Please type your answer or try later."
          : "Voice is temporarily unavailable. You can type instead.",
      );
    return response;
  }
  return {
    async transcribe(audio: unknown, format: unknown) {
      if (
        typeof audio !== "string" ||
        audio.length > 2_800_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(audio) ||
        !["webm", "m4a", "wav", "mp3", "ogg"].includes(String(format))
      )
        throw new OnboardingError(400, "Unsupported or oversized recording.");
      const result = await (
        await request("audio/transcriptions", "stt", {
          input_audio: { data: audio, format },
        })
      ).json();
      if (
        typeof result.text !== "string" ||
        !result.text.trim() ||
        result.text.length > 2000
      )
        throw new OnboardingError(
          422,
          "No clear speech detected. Please try again or type.",
        );
      return result.text as string;
    },
    async extract(text: unknown, profile: Profile, language: string) {
      if (typeof text !== "string" || !text.trim() || text.length > 2000)
        throw new OnboardingError(400, "Please give a short answer.");
      const result = await (
        await request("chat/completions", "llm", {
          max_tokens: 450,
          temperature: 0,
          provider: { require_parameters: true },
          messages: [
            { role: "system", content: ONBOARDING_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                language,
                existingDraft: profile,
                answer: text,
              }),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "onboarding_answer",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  updates: {
                    type: "object",
                    additionalProperties: false,
                    properties: Object.fromEntries(
                      PROFILE_FIELDS.map((field) => [
                        field,
                        { type: ["string", "null"] },
                      ]),
                    ),
                    required: [...PROFILE_FIELDS],
                  },
                  skipped: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: [...PROFILE_FIELDS],
                    },
                  },
                  clarification: { type: ["string", "null"] },
                },
                required: ["updates", "skipped", "clarification"],
              },
            },
          },
        })
      ).json();
      try {
        const parsed = JSON.parse(result.choices?.[0]?.message?.content);
        if (
          !parsed.updates ||
          !Array.isArray(parsed.skipped) ||
          !(
            parsed.clarification === null ||
            typeof parsed.clarification === "string"
          )
        )
          throw Error();
        const updates: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(parsed.updates)) {
          if (
            !PROFILE_FIELDS.includes(field as (typeof PROFILE_FIELDS)[number])
          )
            throw Error();
          if (value !== null) updates[field] = value;
        }
        for (const field of parsed.skipped) {
          if (!PROFILE_FIELDS.includes(field)) throw Error();
          updates[field] = null;
        }
        return {
          updates: validateProfile(updates),
          clarification: parsed.clarification?.slice(0, 240) as
            | string
            | undefined,
        };
      } catch {
        throw new OnboardingError(
          422,
          "Please clarify that answer, or edit your profile directly.",
        );
      }
    },
    async speak(text: string, voice: string) {
      if (!text || text.length > 300)
        throw new OnboardingError(400, "Speech is too long.");
      const response = await request("audio/speech", "tts", {
        input: text,
        voice,
        response_format: "mp3",
      });
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 2_000_000)
        throw new OnboardingError(502, "Speech is unavailable.");
      return bytes;
    },
  };
}
