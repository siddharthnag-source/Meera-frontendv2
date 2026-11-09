"use client";
import { useEffect, useState } from "react";
import { ONBOARDING_RETURN_PATH } from "@/lib/onboarding-redirect";
import { onboardingAuth } from "@/lib/onboarding-auth-client";
export default function Callback() {
  const [error, setError] = useState("");
  useEffect(() => {
    const auth = onboardingAuth();
    if (!auth) {
      setError("Staging Google sign-in is not configured.");
      return;
    }
    let cancelled = false;
    void auth.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data.session) {
          setError("Google sign-in did not complete. Please try again.");
          return;
        }
        // This dedicated app is the explicit voice onboarding flow. A completed
        // draft must not silently send its Google return to another site's chat
        // or payment route. Workspace navigation requires the user's action.
        window.location.replace(ONBOARDING_RETURN_PATH);
      })
      .catch(() => {
        if (!cancelled)
          setError("Google sign-in did not complete. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main className="p-10">
      <p role="status">{error || "Completing Google sign-in…"}</p>
      {error && <a href="/onboarding">Return to onboarding</a>}
    </main>
  );
}
