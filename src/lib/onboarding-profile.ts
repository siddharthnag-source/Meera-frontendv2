export type Voice = "sarah" | "brian";
export type Language = "en" | "hi";
export type Profile = {
  name?: string;
  job_details?: string | null;
  dob?: string | null;
  caste?: string | null;
};
export const PROFILE_FIELDS = ["name", "job_details", "dob", "caste"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export function ageFromDob(
  dob: string,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob))
    throw new Error("Use YYYY-MM-DD for your birthday.");
  const value = new Date(`${dob}T00:00:00Z`);
  const age =
    Number(today.slice(0, 4)) -
    Number(dob.slice(0, 4)) -
    Number(today.slice(5) < dob.slice(5));
  if (
    !Number.isFinite(+value) ||
    value.toISOString().slice(0, 10) !== dob ||
    dob > today ||
    age > 120
  )
    throw new Error("Please check your birthday.");
  return age;
}
export function validateProfile(value: unknown): Profile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid profile.");
  const profile: Profile = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!PROFILE_FIELDS.includes(field as ProfileField))
      throw new Error("Unknown profile field.");
    if (raw === null && field !== "name") {
      profile[field as Exclude<ProfileField, "name">] = null;
      continue;
    }
    if (typeof raw !== "string" || !raw.trim() || raw.length > 500)
      throw new Error("Please give a short answer.");
    if (field === "dob") ageFromDob(raw);
    profile[field as ProfileField] = raw.trim();
  }
  return profile;
}
export function nextPrompt(profile: Profile, language: Language) {
  if (!profile.name)
    return {
      clip: null,
      text:
        language === "hi"
          ? "मैं आपको किस नाम से बुलाऊँ?"
          : "What would you like me to call you?",
    };
  if (profile.job_details === undefined)
    return {
      clip: "work",
      text:
        language === "hi"
          ? "आप काम करते हैं, पढ़ाई करते हैं, या कुछ और?"
          : "What fills most of your day—work, study, or something else?",
    };
  if (profile.dob === undefined)
    return {
      clip: "birthday",
      text:
        language === "hi"
          ? "आपकी जन्म तारीख क्या है? दिन, महीना और साल बताइए। आप चाहें तो इसे छोड़ सकते हैं।"
          : "When is your birthday, including the year? You can skip this if you prefer.",
    };
  // Sensitive community information is never solicited by voice; it is optional in review.
  return {
    clip: "review",
    text:
      language === "hi"
        ? "अपनी जानकारी देखें। आप कुछ भी बदल सकते हैं, या सेव करके शुरू कर सकते हैं।"
        : "Here is your profile. You can change anything, or save and begin.",
  };
}
