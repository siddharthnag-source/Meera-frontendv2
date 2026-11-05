"use client";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { onboardingAuth } from "@/lib/onboarding-auth-client";
import {
  ageFromDob,
  nextPrompt,
  type Language,
  type Profile,
  type Voice,
} from "@/lib/onboarding-profile";

type Draft = { profile: Profile; revision: number; complete: boolean };
type Prompt = { text: string; clip: string | null };
const empty: Draft = { profile: {}, revision: 0, complete: false };
export default function Onboarding() {
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const draftRef = useRef(draft);
  const [voice, setVoice] = useState<Voice>("sarah");
  const [language, setLanguage] = useState<Language>("en");
  const [status, setStatus] = useState(
    "Continue with Google to keep your profile private.",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [started, setStarted] = useState(false);
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [elapsed, setElapsed] = useState(false);
  const [workspace, setWorkspace] = useState("/");
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [canRecord, setCanRecord] = useState(false);
  const [muted, setMuted] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const recordLimit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunks = useRef<Blob[]>([]);
  const consented = useRef(false);
  const saveKey = useRef<string | null>(null);
  const sessionRef = useRef(session);
  const dirty = useRef(false);
  sessionRef.current = session;
  function update(value: Draft) {
    draftRef.current = value;
    setDraft(value);
  }
  function stopSpeech() {
    audio.current?.pause();
    audio.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }
  function stopMic(discard = true) {
    if (recordLimit.current) clearTimeout(recordLimit.current);
    if (recorder.current && recorder.current.state !== "inactive") {
      if (discard) recorder.current.onstop = null;
      recorder.current.stop();
    }
    recorder.current = null;
    microphone.current?.getTracks().forEach((track) => track.stop());
    microphone.current = null;
    setRecording(false);
    setMuted(false);
  }
  function interrupt() {
    generation.current++;
    controller.current?.abort();
    stopSpeech();
    stopMic();
    setBusy(false);
  }
  const cleanup = useRef(interrupt);
  cleanup.current = interrupt;
  useEffect(() => () => cleanup.current(), []);
  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => setElapsed(true), 90_000);
    return () => clearTimeout(timer);
  }, [started]);
  useEffect(() => {
    setCanRecord(
      typeof MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
    const auth = onboardingAuth();
    if (!auth) {
      setStatus("Staging Google sign-in needs configuration.");
      return;
    }
    let mounted = true;
    auth.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const { data } = auth.auth.onAuthStateChange((_event, value) => {
      if (!mounted) return;
      if (sessionRef.current?.user.id === value?.user.id) {
        setSession(value);
        return;
      }
      cleanup.current();
      setSession(value);
      setLoaded(false);
      dirty.current = false;
      saveKey.current = null;
      update(empty);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function api(path: string, value?: object, signal?: AbortSignal) {
    const current = sessionRef.current;
    if (!current) throw new Error("Please continue with Google first.");
    const response = await fetch(`/api/onboarding/${path}`, {
      method: value ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${current.access_token}`,
        ...(value ? { "Content-Type": "application/json" } : {}),
      },
      body: value ? JSON.stringify(value) : undefined,
      signal: signal || AbortSignal.timeout(45000),
      cache: "no-store",
    });
    if (sessionRef.current?.user.id !== current.user.id)
      throw new Error("Account changed. Reload your profile.");
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(
        result.error || "This step is unavailable. Please try again.",
      );
    }
    return response;
  }
  async function load() {
    interrupt();
    const attempt = generation.current;
    setBusy(true);
    setError("");
    setLoaded(false);
    try {
      const result = await (await api("session")).json();
      if (attempt !== generation.current) return;
      const profile = { ...result.draft.profile };
      if (!profile.name && result.googleName) profile.name = result.googleName;
      update({ ...result.draft, profile });
      dirty.current = !result.draft.profile.name && Boolean(profile.name);
      setWorkspace(result.workspace);
      setReady(result.voiceConfigured);
      setLoaded(true);
      setStatus(
        result.draft.complete
          ? "Your profile is saved. Welcome back."
          : nextPrompt(profile, language).text,
      );
    } catch (reason) {
      if (attempt === generation.current) setError((reason as Error).message);
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  const loadRef = useRef(load);
  loadRef.current = load;
  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void loadRef.current();
  }, [userId]); // Account identity is the loading boundary.
  async function signIn() {
    setError("");
    const auth = onboardingAuth();
    if (!auth) {
      setError("Google sign-in is not configured in this staging environment.");
      return;
    }
    const { error } = await auth.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?onboarding=1`,
      },
    });
    if (error) setError("Google sign-in could not start. Please try again.");
  }
  async function persist(profile: Profile, complete: boolean) {
    const attempt = generation.current;
    if (!saveKey.current || !complete) saveKey.current = crypto.randomUUID();
    const result = await (
      await api("profile", {
        profile,
        revision: draftRef.current.revision,
        complete,
        saveKey: saveKey.current,
      })
    ).json();
    if (attempt !== generation.current)
      throw new Error("Operation cancelled. Reload your saved draft.");
    update(result.draft);
    dirty.current = false;
    return result.draft as Draft;
  }
  async function play(
    prompt: Prompt,
    selectedVoice = voice,
    selectedLanguage = language,
  ) {
    stopSpeech();
    setStatus(prompt.text);
    if (muted) return;
    const attempt = generation.current;
    try {
      const response = prompt.clip
        ? await fetch(
            `/api/onboarding/clips/${selectedVoice}${selectedLanguage === "hi" ? "-hi" : ""}-${prompt.clip}.mp3`,
          )
        : await api("speech", { text: prompt.text, voice: selectedVoice });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (generation.current !== attempt) return;
      audioUrl.current = URL.createObjectURL(blob);
      const player = new Audio(audioUrl.current);
      audio.current = player;
      await player.play();
    } catch {
      if (generation.current === attempt)
        setError(
          "Audio could not play. You can read the prompt and type instead.",
        );
    }
  }
  async function answer(
    value: { text: string } | { audio: string; format: string },
  ) {
    interrupt();
    const attempt = generation.current;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 45000);
    try {
      if (dirty.current) await persist(draftRef.current.profile, false);
      if (attempt !== generation.current) return;
      const result = await (
        await api(
          "answer",
          { ...value, language, revision: draftRef.current.revision },
          abort.signal,
        )
      ).json();
      if (attempt !== generation.current) return;
      setTranscript(result.transcript);
      update({ ...draftRef.current, profile: result.proposal.profile });
      dirty.current = true;
      await persist(result.proposal.profile, false);
      if (attempt !== generation.current) return;
      setText("");
      await play(result.prompt);
    } catch (reason) {
      if (attempt === generation.current)
        setError(
          abort.signal.aborted
            ? "The response timed out. Your draft is still available."
            : (reason as Error).message,
        );
    } finally {
      clearTimeout(timeout);
      if (attempt === generation.current) setBusy(false);
    }
  }
  async function record() {
    interrupt();
    const attempt = generation.current;
    setError("");
    setBusy(true);
    try {
      let stream = microphone.current;
      if (!stream)
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      if (attempt !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      microphone.current = stream;
      consented.current = true;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunks.current = [];
      recorder.current = capture;
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      capture.onerror = () => {
        stopMic();
        setError("Recording stopped. Please type your answer.");
      };
      capture.onstop = async () => {
        const blob = new Blob(chunks.current, { type: capture.mimeType });
        stopMic();
        if (attempt !== generation.current || !blob.size) return;
        if (blob.size > 2_000_000) {
          setError("Recording is too large. Please use a shorter answer.");
          return;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        if (attempt !== generation.current) return;
        void answer({
          audio: btoa(binary),
          format: capture.mimeType.includes("mp4")
            ? "m4a"
            : capture.mimeType.includes("ogg")
              ? "ogg"
              : "webm",
        });
      };
      capture.start(250);
      setRecording(true);
      setBusy(false);
      setStarted(true);
      recordLimit.current = setTimeout(() => {
        if (capture.state !== "inactive") capture.stop();
      }, 30_000);
    } catch {
      if (attempt === generation.current) {
        stopMic();
        setBusy(false);
        setError(
          "Microphone access is unavailable. You can type or edit your profile instead.",
        );
      }
    }
  }
  async function finish() {
    interrupt();
    const attempt = generation.current;
    setBusy(true);
    setError("");
    try {
      const profile = {
        ...draftRef.current.profile,
        job_details: draftRef.current.profile.job_details ?? null,
        dob: draftRef.current.profile.dob ?? null,
        caste: draftRef.current.profile.caste ?? null,
      };
      const saved = await persist(profile, true);
      const check = await (await api("session")).json();
      if (
        !check.draft.complete ||
        JSON.stringify(check.draft.profile) !== JSON.stringify(saved.profile)
      ) {
        // JSONB key order can differ: compare values, not object serialization order.
        if (
          !check.draft.complete ||
          ["name", "job_details", "dob", "caste"].some(
            (key) =>
              check.draft.profile[key] !== saved.profile[key as keyof Profile],
          )
        )
          throw new Error(
            "Save could not be verified. Please reload your saved profile.",
          );
      }
      if (attempt !== generation.current) return;
      update(check.draft);
      setStatus("Your profile is saved. You can open Meera.");
    } catch (reason) {
      if (attempt === generation.current) setError((reason as Error).message);
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  let age: number | null = null;
  try {
    if (draft.profile.dob) age = ageFromDob(draft.profile.dob);
  } catch {
    /* Show date validation on save. */
  }
  return (
    <main className="min-h-screen bg-background text-primary px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <p className="text-sm uppercase tracking-widest">Welcome to Meera</p>
          <h1 className="text-4xl font-semibold my-3">
            Let’s make this feel like you.
          </h1>
          <p>
            A short conversation, one profile to review. Typing is always
            available.
          </p>
        </header>
        {!session ? (
          <section className="rounded-3xl border p-6 space-y-4">
            <p>
              Continue with your existing Google account before using voice or
              saving a profile.
            </p>
            <button
              className="rounded-full bg-red-600 text-white px-6 py-3"
              onClick={() => void signIn()}
            >
              Continue with Google
            </button>
          </section>
        ) : (
          <>
            <p className="text-sm">Signed in as {session.user.email}</p>
            {draft.complete ? (
              <section className="rounded-3xl border p-6 space-y-4">
                <h2 className="text-2xl">
                  You’re all set, {draft.profile.name}.
                </h2>
                <p>Your saved profile has been restored.</p>
                <a className="underline" href={workspace}>
                  Open Meera
                </a>
              </section>
            ) : (
              <>
                <section className="rounded-3xl border p-6 space-y-4">
                  <fieldset disabled={busy || recording}>
                    <legend className="font-semibold mb-3">
                      Choose your voice
                    </legend>
                    <div className="flex gap-5">
                      {(["sarah", "brian"] as const).map((item) => (
                        <label key={item}>
                          <input
                            type="radio"
                            name="voice"
                            checked={voice === item}
                            onChange={() => {
                              stopSpeech();
                              setVoice(item);
                            }}
                          />{" "}
                          {item === "sarah" ? "Sarah" : "Brian"}{" "}
                          <button
                            type="button"
                            className="underline text-sm ml-2"
                            onClick={() =>
                              void play(
                                {
                                  text:
                                    item === "sarah"
                                      ? "Preview Sarah"
                                      : "Preview Brian",
                                  clip: "preview",
                                },
                                item,
                              )
                            }
                          >
                            Preview
                          </button>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block">
                    Language{" "}
                    <select
                      className="border rounded p-2 ml-3"
                      value={language}
                      disabled={busy || recording}
                      onChange={(event) => {
                        stopSpeech();
                        setLanguage(event.target.value as Language);
                      }}
                    >
                      <option value="en">English</option>
                      <option value="hi">Hindi / Hinglish</option>
                    </select>
                  </label>
                  <p role="status" aria-live="polite">
                    {status}
                  </p>
                  <p className="text-sm opacity-75">
                    Voice audio is processed through OpenRouter and its selected
                    providers. Recordings are not saved by this app. Never say
                    passwords or verification codes.
                  </p>
                  {!ready && loaded && (
                    <p>
                      Voice is not configured yet. You can still edit and save
                      your profile.
                    </p>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    {recording ? (
                      <>
                        <button
                          className="border rounded-full px-5 py-3"
                          onClick={() => recorder.current?.stop()}
                        >
                          Send recording
                        </button>
                        <button
                          className="border rounded-full px-5 py-3"
                          onClick={() => {
                            const next = !muted;
                            microphone.current
                              ?.getAudioTracks()
                              .forEach((track) => {
                                track.enabled = !next;
                              });
                            setMuted(next);
                          }}
                          aria-pressed={muted}
                        >
                          {muted ? "Unmute microphone" : "Mute microphone"}
                        </button>
                      </>
                    ) : (
                      <button
                        className="rounded-full bg-red-600 text-white px-5 py-3 disabled:opacity-50"
                        disabled={!loaded || !ready || !canRecord || busy}
                        onClick={() => void record()}
                      >
                        {consented.current
                          ? "Record an answer"
                          : "Start voice — allow microphone"}
                      </button>
                    )}
                    <button
                      className="border rounded-full px-5 py-3"
                      onClick={interrupt}
                    >
                      Stop / interrupt
                    </button>
                  </div>
                  {!canRecord && (
                    <p>
                      Voice recording is unavailable in this browser. Please
                      type below.
                    </p>
                  )}
                  {elapsed && (
                    <p role="status">
                      Take your time. You can keep typing or return later; your
                      stored draft will be here.
                    </p>
                  )}
                  {transcript && (
                    <p>
                      <strong>You said: </strong>
                      {transcript}
                    </p>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      setStarted(true);
                      void answer({ text });
                    }}
                    className="space-y-3"
                  >
                    <label className="block" htmlFor="onboarding-answer">
                      Your answer or correction
                    </label>
                    <textarea
                      id="onboarding-answer"
                      className="w-full border rounded-xl p-3"
                      maxLength={2000}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      disabled={busy || !loaded}
                    />
                    <button
                      className="border rounded-full px-5 py-2 disabled:opacity-50"
                      disabled={busy || !loaded || !ready || !text.trim()}
                    >
                      Send answer
                    </button>
                  </form>
                </section>
                <section className="rounded-3xl border p-6 space-y-4">
                  <h2 className="text-2xl font-semibold">Your profile</h2>
                  <p>
                    Review or edit anything. Work, birthday and community are
                    optional; leave them blank to skip.
                  </p>
                  {(
                    [
                      { key: "name", title: "Name", type: "text" },
                      {
                        key: "job_details",
                        title: "Work or study",
                        type: "text",
                      },
                      {
                        key: "dob",
                        title: "Birthday (optional)",
                        type: "date",
                      },
                      {
                        key: "caste",
                        title: "Caste or community (optional)",
                        type: "text",
                      },
                    ] as const
                  ).map((field) => (
                    <label className="block" key={field.key}>
                      {field.title}
                      <input
                        className="block w-full border rounded-lg p-3 mt-1"
                        type={field.type}
                        maxLength={500}
                        value={draft.profile[field.key] || ""}
                        disabled={busy || recording || !loaded}
                        onChange={(event) => {
                          saveKey.current = null;
                          dirty.current = true;
                          update({
                            ...draftRef.current,
                            profile: {
                              ...draftRef.current.profile,
                              [field.key]:
                                event.target.value ||
                                (field.key === "name" ? undefined : null),
                            },
                          });
                        }}
                      />
                    </label>
                  ))}
                  {age !== null && <p>Age: {age}</p>}
                  <div className="flex gap-3">
                    <button
                      className="rounded-full bg-red-600 text-white px-5 py-3 disabled:opacity-50"
                      disabled={busy || !loaded || !draft.profile.name?.trim()}
                      onClick={() => void finish()}
                    >
                      Save and begin
                    </button>
                    <button
                      className="border rounded-full px-5 py-3"
                      disabled={busy || !loaded}
                      onClick={() => {
                        setBusy(true);
                        void persist(draftRef.current.profile, false)
                          .then(() =>
                            setStatus(
                              "Draft saved. Come back whenever you are ready.",
                            ),
                          )
                          .catch((reason) => setError(reason.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Save draft
                    </button>
                  </div>
                </section>
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {session && !busy && (
          <button className="underline text-sm" onClick={() => void load()}>
            Reload saved profile
          </button>
        )}
      </div>
    </main>
  );
}
