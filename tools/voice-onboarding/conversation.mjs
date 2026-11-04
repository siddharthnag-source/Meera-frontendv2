// Natural conversation controller experiment. Receives validated extraction;
// this is not a speech recognizer or an interruption detector.
import { fields, validateValue, ageFromDob } from './core.mjs';
export function createConversation() { return { draft: {}, skipped: [], revision: 0, reviewedRevision: null, finished: false, playback: null, generation: 0 }; }
export function applyAnswer(state, extraction) {
  if (state.finished) throw Error('Already completed');
  const next = { ...state.draft };
  const skipped = new Set(state.skipped);
  for (const [field, value] of Object.entries(extraction)) {
    next[field] = validateValue(field, value);
    if (value === null) skipped.add(field); else skipped.delete(field);
  }
  state.draft = next; state.skipped = [...skipped]; state.revision++; state.reviewedRevision = null;
  return nextPrompt(state);
}
export function nextPrompt(state) {
  const missing = fields.find(f => !Object.hasOwn(state.draft, f));
  return {
    name: 'Hi, I’ll help you settle in. What would you like me to call you?',
    job_details: `Nice to meet you${state.draft.name ? ', ' + state.draft.name : ''}. What fills most of your day—work, study, or something else?`,
    dob: 'And when is your birthday, including the year? You can skip that if you prefer.',
    caste: 'One optional detail: would you like to share your caste or community? It’s fine to skip.',
  }[missing] || 'Here’s what I have. Take a look, and tell me if you’d like to change anything.';
}
export function review(state) { state.reviewedRevision = state.revision; return { ...state.draft, age: state.draft.dob ? ageFromDob(state.draft.dob) : null }; }
export function complete(state, explicitConfirmation) {
  if (!explicitConfirmation || state.reviewedRevision !== state.revision || fields.some(f => !Object.hasOwn(state.draft, f))) throw Error('Review the current draft and explicitly confirm first');
  if (state.finished) throw Error('Already completed');
  state.finished = true; return { profile: review(state), handoff: 'You’re all set. Let’s begin.', persisted: false };
}
export function startResponse(state) { return ++state.generation; }
export function interrupt(state) { state.generation++; state.playback = null; }
export function acceptResponse(state, generation, text) {
  if (generation !== state.generation) return false;
  state.playback = text; return true;
}
