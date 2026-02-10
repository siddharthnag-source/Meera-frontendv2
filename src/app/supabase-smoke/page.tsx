"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabaseClient";

type Status =
  | "loading"
  | "ok: session found"
  | "ok: no session"
  | "error";

export default function SupabaseSmokePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setStatus("error");
          setMessage(error.message);
          return;
        }

        setStatus(data.session ? "ok: session found" : "ok: no session");
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Unknown error");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>
        Supabase Smoke Test
      </h1>
      <p style={{ marginTop: "0.75rem" }}>
        Status: <strong>{status}</strong>
      </p>
      {message ? <p style={{ marginTop: "0.5rem" }}>{message}</p> : null}
    </main>
  );
}
