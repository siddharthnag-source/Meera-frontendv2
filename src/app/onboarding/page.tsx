"use client";

import { GoogleGenAI, Session } from "@google/genai";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import {
  AudioRecorder,
  AudioStreamer,
  base64ToArrayBuffer,
} from "@/lib/voice-engine";
import { onboardingConfig } from "@/lib/onboarding-agent";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
const turnstile = () =>
  (window as unknown as { turnstile?: Turnstile }).turnstile;

export default function Onboarding() {
  const [status, setStatus] = useState("Ready when you are");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<
    Array<{ role: string; text: string }>
  >([]);
  const [challenge, setChallenge] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const session = useRef<Session | null>(null);
  const recorder = useRef<AudioRecorder | null>(null);
  const player = useRef<AudioStreamer | null>(null);
  const context = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const speaking = useRef(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  function clearSilence() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function stop() {
    generation.current += 1;
    reminderUsed.current = true;
    speaking.current = true;
    clearSilence();
    if (deadline.current) clearTimeout(deadline.current);
    session.current?.close();
    session.current = null;
    recorder.current?.stop();
    recorder.current = null;
    player.current?.stop();
    player.current = null;
    void context.current?.close();
    context.current = null;
    setActive(false);
    setBusy(false);
    setMuted(false);
    setStatus("Session ended");
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current(), []);
  useEffect(() => {
    if (!scriptReady || !siteKey || !widget.current || !turnstile()) return;
    widgetId.current = turnstile()!.render(widget.current, {
      sitekey: siteKey,
      action: "onboarding",
      callback: (token: string) => setChallenge(token),
      "expired-callback": () => setChallenge(""),
      "error-callback": () => {
        setChallenge("");
        setError(
          "Verification could not load. Please retry or continue with Google.",
        );
      },
    });
    return () => {
      if (widgetId.current) turnstile()?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [scriptReady, siteKey]);

  function append(role: string, text: string) {
    setTranscript((previous) => {
      const last = previous[previous.length - 1];
      return last?.role === role
        ? [...previous.slice(0, -1), { role, text: last.text + text }]
        : [...previous, { role, text }];
    });
  }
  function waitForUser() {
    clearSilence();
    timer.current = setTimeout(() => {
      if (!session.current || recorder.current?.isMuted || speaking.current)
        return;
      reminderUsed.current = true;
      session.current.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [
              {
                text: "Application silence reminder: gently prompt me once to take my time.",
              },
            ],
          },
        ],
        turnComplete: true,
      });
      // A reminder does not arm another reminder until the user speaks again.
    }, 5000);
  }
  const reminderUsed = useRef(false);
  async function start() {
    if (busy || active) return;
    setBusy(true);
    setError("");
    setTranscript([]);
    setStatus("Connecting…");
    const attempt = ++generation.current;
    try {
      const audio = new AudioContext({ sampleRate: 24000 });
      context.current = audio;
      await audio.resume();
      player.current = new AudioStreamer(audio);
      player.current.onComplete = () => {
        speaking.current = false;
        if (!reminderUsed.current) waitForUser();
      };
      const mic = new AudioRecorder(16000);
      recorder.current = mic;
      // Request microphone permission during the user's explicit start action.
      await mic.start();
      if (attempt !== generation.current) {
        mic.stop();
        return;
      }
      const response = await fetch("/api/onboarding/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await response.json();
      setChallenge("");
      if (widgetId.current) turnstile()?.reset(widgetId.current);
      if (!response.ok) throw new Error(data.error || "Could not start voice.");
      if (attempt !== generation.current) return;
      const ai = new GoogleGenAI({
        apiKey: data.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const connected = await ai.live.connect({
        model: data.model,
        config: onboardingConfig(),
        callbacks: {
          onmessage: (message) => {
            if (attempt !== generation.current) return;
            const content = message.serverContent;
            if (!content) return;
            if (content.interrupted) {
              player.current?.stop();
              speaking.current = false;
              clearSilence();
            }
            if (content.inputTranscription?.text) {
              clearSilence();
              reminderUsed.current = false;
              append("You", content.inputTranscription.text);
            }
            if (content.outputTranscription?.text)
              append("Meera", content.outputTranscription.text);
            for (const part of content.modelTurn?.parts || []) {
              if (
                part.inlineData?.mimeType?.startsWith("audio/pcm") &&
                part.inlineData.data
              ) {
                clearSilence();
                speaking.current = true;
                void player.current?.addPCM16(
                  new Uint8Array(base64ToArrayBuffer(part.inlineData.data)),
                );
              }
            }
          },
          onerror: () => {
            if (attempt === generation.current) {
              stop();
              setError("Voice connection failed. Please try again.");
            }
          },
          onclose: () => {
            if (attempt === generation.current) stop();
          },
        },
      });
      if (attempt !== generation.current) {
        connected.close();
        return;
      }
      session.current = connected;
      mic.on("data", (data: string) => {
        if (!mic.isMuted)
          connected.sendRealtimeInput({
            audio: { data, mimeType: "audio/pcm;rate=16000" },
          });
      });
      mic.on("volume", (volume: number) => {
        if (!mic.isMuted && volume > 0.03) clearSilence();
      });
      reminderUsed.current = false;
      connected.sendClientContent({
        turns: [
          {
            role: "user",
            parts: [{ text: "Please welcome me and start onboarding." }],
          },
        ],
        turnComplete: true,
      });
      setActive(true);
      setBusy(false);
      setStatus("Meera is listening");
      deadline.current = setTimeout(() => stopRef.current(), 5 * 60 * 1000);
    } catch (reason) {
      if (attempt !== generation.current) return;
      stop();
      setError(
        reason instanceof Error ? reason.message : "Could not start voice.",
      );
    }
  }

  return (
    <main className="min-h-screen bg-background text-primary px-6 py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <Link href="/sign-in" className="text-sm underline">
          Back to Himeera
        </Link>
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-widest">
            Your personal welcome
          </p>
          <h1 className="text-4xl font-semibold">Get started with Meera</h1>
          <p>
            Meet your AI voice guide. Ask questions, explore voice and text
            chat, and get help creating your account.
          </p>
        </header>
        <section
          className="rounded-3xl border border-current/20 p-6 space-y-5"
          aria-label="Onboarding voice assistant"
        >
          <p role="status" aria-live="polite">
            {status}
          </p>
          <p className="text-sm opacity-75">
            Starting voice shares microphone audio with Google Gemini.
            Transcripts stay on this page until you leave. Never say passwords
            or verification codes aloud.
          </p>
          {siteKey && (
            <>
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                onReady={() => setScriptReady(true)}
                onError={() =>
                  setError(
                    "Verification unavailable. You can still continue with Google.",
                  )
                }
              />
              <div ref={widget} />
            </>
          )}
          {!siteKey && (
            <p>
              Voice setup is pending. You can still create your account below.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {!active && !busy && (
              <button
                className="rounded-full bg-red-600 text-white px-6 py-3 disabled:opacity-50"
                disabled={!challenge}
                onClick={() => void start()}
              >
                Talk to Meera
              </button>
            )}
            {(active || busy) && (
              <button className="rounded-full border px-6 py-3" onClick={stop}>
                {busy ? "Cancel" : "End conversation"}
              </button>
            )}
            {active && (
              <button
                className="rounded-full border px-6 py-3"
                aria-pressed={muted}
                onClick={() => {
                  recorder.current?.toggleMute();
                  setMuted(!!recorder.current?.isMuted);
                  clearSilence();
                }}
              >
                {muted ? "Unmute microphone" : "Mute microphone"}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-red-600">
              {error}
            </p>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Ready to create your account?
          </h2>
          <p>
            Continue with Google to securely share your name and email and open
            your workspace.
          </p>
          <Link
            className="inline-block rounded-full border px-6 py-3"
            href="/sign-in"
          >
            Continue to Google sign-up
          </Link>
        </section>
        {transcript.length > 0 && (
          <section className="space-y-3" aria-label="Conversation transcript">
            <h2 className="text-xl font-semibold">Your conversation</h2>
            {transcript.map((line, index) => (
              <p key={index}>
                <strong>{line.role}: </strong>
                {line.text}
              </p>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
