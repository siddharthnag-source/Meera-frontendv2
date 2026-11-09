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
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error || !data.session) {
          setError("Google sign-in did not complete. Please try again.");
          return;
        }
        const response = await fetch("/api/onboarding/session", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: AbortSignal.timeout(5000), cache: "no-store",
        }).catch(() => null);
        const setup = response?.ok ? await response.json().catch(() => null) : null;
        if (cancelled) return;
        window.location.replace(setup?.draft?.complete && setup.workspace ? setup.workspace : ONBOARDING_RETURN_PATH);
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
