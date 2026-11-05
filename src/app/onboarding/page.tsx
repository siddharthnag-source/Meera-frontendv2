"use client";
import Image from "next/image";
import styles from "@/components/onboarding/Onboarding.module.css";
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
    <main className={styles.shell} data-authenticated={Boolean(session)}>
      <nav className={styles.navigation} aria-label="Meera navigation">
        <a
          className={styles.brand}
          href="https://himeera.com"
          aria-label="Himeera home"
        >
          <Image src="/icons/meera.svg" width={32} height={32} alt="" />
          <span className={styles.wordmark}>meera</span>
        </a>
        <a className={styles.homeLink} href="https://himeera.com">
          Back to Himeera <Icon name="arrow" />
        </a>
      </nav>

      <div className={styles.layout}>
        <header className={styles.introduction}>
          <p className={styles.eyebrow}>Your personal companion</p>
          <h1 className={styles.title}>Let’s make this feel like you.</h1>
          <p className={styles.introText}>
            A little about your day. A few things that make you, you. Start
            wherever you feel comfortable.
          </p>
          <div className={styles.artwork}>
            <Image
              src="/images/home.svg"
              width={318}
              height={350}
              priority
              unoptimized
              alt="Meera, surrounded by everyday thoughts and conversations."
            />
          </div>
          <div className={styles.principles}>
            <span>Your pace</span>
            <span>Your voice</span>
            <span>Your choice</span>
          </div>
        </header>

        <div className={styles.content}>
          {!session ? (
            <section
              className={`${styles.card} ${styles.welcomeCard}`}
              aria-labelledby="welcome-heading"
            >
              <Image
                className={styles.welcomeMark}
                src="/icons/meera.svg"
                width={46}
                height={46}
                alt=""
              />
              <p className={styles.eyebrow}>A familiar hello</p>
              <h2 id="welcome-heading" className={styles.cardHeading}>
                Good to have you here.
              </h2>
              <p className={styles.description}>
                Continue with Google, choose a voice, and tell Meera a little
                about yourself. You can talk, type, or take your time.
              </p>
              <button
                className={`${styles.primaryButton} ${styles.googleButton}`}
                onClick={() => void signIn()}
              >
                <span>
                  <GoogleMark />
                  Continue with Google
                </span>
                <Icon name="arrow" />
              </button>
              <p className={styles.helper}>
                Use your existing Google account to save your profile and return
                to it later.
              </p>
              <div className={styles.welcomeFooter}>
                <span className={styles.dot} aria-hidden="true" />
                <span>A short welcome. Room to be yourself.</span>
              </div>
            </section>
          ) : (
            <>
              <p className={styles.account}>
                <Icon name="check" /> Signed in as {session.user.email}
              </p>
              {draft.complete ? (
                <section className={`${styles.card} ${styles.successCard}`}>
                  <div className={styles.successIcon}>
                    <Icon name="check" />
                  </div>
                  <p className={styles.eyebrow}>A lovely place to begin</p>
                  <h2 className={styles.cardHeading}>
                    You’re all set, {draft.profile.name}.
                  </h2>
                  <p className={styles.description}>
                    Your saved profile has been restored.
                  </p>
                  <a className={styles.primaryButton} href={workspace}>
                    Open Meera <Icon name="arrow" />
                  </a>
                </section>
              ) : (
                <>
                  <section
                    className={styles.card}
                    aria-labelledby="voice-heading"
                  >
                    <div className={styles.sectionHeader}>
                      <div>
                        <p className={styles.eyebrow}>Your voice, your way</p>
                        <h2 id="voice-heading" className={styles.cardHeading}>
                          Make yourself comfortable.
                        </h2>
                      </div>
                      <span className={styles.step} aria-hidden="true">
                        01
                      </span>
                    </div>
                    <fieldset
                      className={styles.fieldset}
                      disabled={busy || recording}
                    >
                      <legend className={styles.label}>
                        Choose your voice
                      </legend>
                      <div className={styles.voiceOptions}>
                        {(["sarah", "brian"] as const).map((item) => (
                          <div
                            className={styles.voiceOption}
                            data-selected={voice === item}
                            key={item}
                          >
                            <label className={styles.voiceChoice}>
                              <input
                                type="radio"
                                name="voice"
                                checked={voice === item}
                                onChange={() => {
                                  stopSpeech();
                                  setVoice(item);
                                }}
                              />
                              {item === "sarah" ? "Sarah" : "Brian"}
                            </label>
                            <button
                              type="button"
                              className={styles.previewButton}
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
                              <Icon name="play" />
                              Preview
                            </button>
                          </div>
                        ))}
                      </div>
                    </fieldset>
                    <label className={styles.language}>
                      Language
                      <select
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
                    <div className={styles.prompt}>
                      <div className={styles.promptLabel}>
                        <span className={styles.dot} aria-hidden="true" />
                        Meera
                        {(recording || busy) && (
                          <span className={styles.listening}>
                            {recording
                              ? muted
                                ? "Microphone muted"
                                : "Listening"
                              : "One moment"}
                          </span>
                        )}
                      </div>
                      <p role="status" aria-live="polite">
                        {status}
                      </p>
                    </div>
                    {!ready && loaded && (
                      <p className={styles.message}>
                        Voice is not configured yet. You can still edit and save
                        your profile.
                      </p>
                    )}
                    <div className={styles.actions}>
                      {recording ? (
                        <>
                          <button
                            className={styles.primaryButton}
                            onClick={() => recorder.current?.stop()}
                          >
                            <Icon name="arrow" />
                            Send recording
                          </button>
                          <button
                            className={styles.secondaryButton}
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
                            <Icon name="mic" />
                            {muted ? "Unmute microphone" : "Mute microphone"}
                          </button>
                        </>
                      ) : (
                        <button
                          className={styles.primaryButton}
                          disabled={!loaded || !ready || !canRecord || busy}
                          onClick={() => void record()}
                          aria-label={
                            consented.current
                              ? "Record an answer"
                              : "Start voice — allow microphone"
                          }
                        >
                          <Icon name="mic" />
                          {consented.current
                            ? "Record an answer"
                            : "Start voice"}
                        </button>
                      )}
                      <button
                        className={styles.secondaryButton}
                        onClick={interrupt}
                        aria-label="Stop / interrupt"
                      >
                        <Icon name="stop" />
                        Stop
                      </button>
                    </div>
                    <p className={styles.voiceDisclosure}>
                      Starting voice asks for microphone access. Audio is
                      processed through OpenRouter and its selected providers;
                      recordings are not saved by this app. Never say passwords
                      or verification codes.
                    </p>
                    {!canRecord && (
                      <p className={styles.message}>
                        Voice recording is unavailable in this browser. Please
                        type below.
                      </p>
                    )}
                    {elapsed && (
                      <p className={styles.message} role="status">
                        Take your time. You can keep typing or return later;
                        your stored draft will be here.
                      </p>
                    )}
                    {transcript && (
                      <p className={styles.message}>
                        <strong>You said: </strong>
                        {transcript}
                      </p>
                    )}
                    <form
                      className={styles.answerForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        setStarted(true);
                        void answer({ text });
                      }}
                    >
                      <label
                        className={styles.label}
                        htmlFor="onboarding-answer"
                      >
                        Your answer or correction
                      </label>
                      <textarea
                        id="onboarding-answer"
                        placeholder="A little about your day, in your own words…"
                        maxLength={2000}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        disabled={busy || !loaded}
                      />
                      <div className={styles.answerFooter}>
                        <p>Typing is always welcome.</p>
                        <button
                          className={styles.quietButton}
                          disabled={busy || !loaded || !ready || !text.trim()}
                        >
                          Send answer <Icon name="arrow" />
                        </button>
                      </div>
                    </form>
                  </section>

                  <section
                    className={styles.card}
                    aria-labelledby="profile-heading"
                  >
                    <div className={styles.sectionHeader}>
                      <div>
                        <p className={styles.eyebrow}>A little about you</p>
                        <h2 id="profile-heading" className={styles.cardHeading}>
                          Your profile
                        </h2>
                      </div>
                      <span className={styles.step} aria-hidden="true">
                        02
                      </span>
                    </div>
                    <p className={styles.description}>
                      Change anything you like. Only your name is needed; the
                      rest is yours to share.
                    </p>
                    <div className={styles.profileFields}>
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
                        <label className={styles.profileField} key={field.key}>
                          {field.title}
                          <input
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
                    </div>
                    {age !== null && (
                      <p className={styles.helper}>Age: {age}</p>
                    )}
                    <div className={styles.profileActions}>
                      <button
                        className={styles.primaryButton}
                        disabled={
                          busy || !loaded || !draft.profile.name?.trim()
                        }
                        onClick={() => void finish()}
                      >
                        Save and begin <Icon name="arrow" />
                      </button>
                      <button
                        className={styles.quietButton}
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
                    <p className={styles.profileNote}>
                      Not ready yet? Save a draft and pick up when it feels
                      right.
                    </p>
                  </section>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {session && !busy && (
            <button
              className={`${styles.quietButton} ${styles.reload}`}
              onClick={() => void load()}
            >
              Reload saved profile
            </button>
          )}
        </div>
      </div>
      <footer className={styles.footer}>
        <span>Meera · Your personal companion.</span>
        <span>No rush. A little hello is a lovely start.</span>
      </footer>
    </main>
  );
}

function Icon({ name }: { name: "arrow" | "mic" | "play" | "stop" | "check" }) {
  const paths = {
    arrow: "M4 12h15m-6-6 6 6-6 6",
    mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1M12 18v4m-3 0h6",
    play: "m9 5 10 7-10 7V5Z",
    stop: "M6 6h12v12H6V6Z",
    check: "m5 12 4 4L19 6",
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function GoogleMark() {
  return (
    <svg className={styles.googleMark} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.33-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.95c1.47 0 2.79.5 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.33 2.59A6 6 0 0 1 12 5.95Z"
      />
    </svg>
  );
}
