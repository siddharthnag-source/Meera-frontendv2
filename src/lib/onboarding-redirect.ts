/** Fixed local destination; never accepts an external return URL. */
export const ONBOARDING_CALLBACK_PATH = "/auth/callback";
export const ONBOARDING_RETURN_PATH = "/onboarding?setup=1";
const key = "meera:onboarding-sign-in";
export function rememberOnboardingSignIn() {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* URL callback still works without storage. */
  }
}
export function isOnboardingSignIn(search: string) {
  if (new URLSearchParams(search).get("onboarding") === "1") return true;
  try {
    const value = sessionStorage.getItem(key);
    const age = Date.now() - Number(value);
    return value !== null && age >= 0 && age < 15 * 60_000;
  } catch {
    return false;
  }
}
export function clearOnboardingSignIn() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
}
