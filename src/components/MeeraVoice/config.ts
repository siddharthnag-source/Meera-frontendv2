const LIVE_MODEL_CANDIDATES = [
  process.env.NEXT_PUBLIC_GEMINI_LIVE_MODEL,
  'models/gemini-2.5-flash-native-audio-preview-12-2025',
  'models/gemini-2.5-flash-native-audio-preview-09-2025',
  'models/gemini-live-2.5-flash-preview',
  'models/gemini-2.0-flash-live-001',
].filter((model): model is string => Boolean(model));

const MODEL_FALLBACKS = Array.from(new Set(LIVE_MODEL_CANDIDATES));
const VOICE_SYSTEM_PROMPT =
  process.env.NEXT_PUBLIC_MEERA_VOICE_SYSTEM_PROMPT ??
  'You are Meera, a helpful voice assistant. Keep responses concise, clear, and safe.';

export const MEERA_VOICE_CONFIG = {
  model_name: MODEL_FALLBACKS[0] ?? 'models/gemini-2.0-flash-live-001',
  model_fallbacks: MODEL_FALLBACKS,
  temperature: 1.0,
  max_tokens: 1024,
  system_prompt: VOICE_SYSTEM_PROMPT,
  google_search: false,
};
