// Provider-independent onboarding rules. Never persist unconfirmed model output.
export const fields = ['name', 'job_details', 'dob', 'caste'];
export const questions = {
  name: 'What would you like Meera to call you?',
  job_details: 'What do you do for work or study? You can skip this.',
  dob: 'What is your date of birth? Please include the day, month and year, or skip.',
  caste: 'Would you like to share your caste or community? This is optional; you can skip.',
};
export function ageFromDob(dob, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error('Use an unambiguous date: YYYY-MM-DD.');
  const date = new Date(`${dob}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== dob || dob > today) throw new Error('Please check the date of birth.');
  const age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4)) - Number(today.slice(5) < dob.slice(5));
  if (age > 120) throw new Error('Please check the date of birth.');
  return age;
}
export function validateValue(field, value, today) {
  if (!fields.includes(field)) throw new Error('Unknown profile field.');
  if (value === null && field !== 'name') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('Please give a short answer.');
  value = value.trim();
  if (field === 'dob') ageFromDob(value, today);
  return value;
}
export function newSession() { return { profile: {}, pending: null, complete: false, turns: 0 }; }
export function nextField(s) { return fields.find(f => !Object.hasOwn(s.profile, f)); }
export function propose(s, field, value, today) {
  if (s.complete) throw new Error('This session is complete.');
  if (++s.turns > 30) throw new Error('Session turn limit reached. Start again or use the form.');
  s.pending = { field, value: validateValue(field, value, today) };
  return s;
}
export function confirm(s) {
  if (!s.pending || s.complete) throw new Error('There is no answer to confirm.');
  s.profile[s.pending.field] = s.pending.value;
  s.pending = null;
  return s;
}
export function finish(s, today) {
  if (s.pending || nextField(s)) throw new Error('Confirm or skip every question before finishing.');
  const profile = Object.fromEntries(fields.map(f => [f, validateValue(f, s.profile[f], today)]));
  s.complete = true;
  return { ...profile, age: profile.dob ? ageFromDob(profile.dob, today) : null };
}
