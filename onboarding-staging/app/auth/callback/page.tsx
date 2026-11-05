"use client";
import { useEffect, useState } from "react";
import { onboardingAuth } from "@/lib/onboarding-auth-client";
export default function Callback() {
  const [error, setError] = useState("");
  useEffect(() => {
    const auth = onboardingAuth();
    if (!auth) {
      setError("Staging Google sign-in is not configured.");
      return;
    }
    void auth.auth.getSession().then(({ data, error }) => {
      if (error || !data.session) {
        setError("Google sign-in did not complete. Please try again.");
        return;
      }
      window.location.replace("/onboarding");
    });
  }, []);
  return (
    <main className="p-10">
      <p role="status">{error || "Completing Google sign-in…"}</p>
      {error && <a href="/onboarding">Return to onboarding</a>}
    </main>
  );
}
