"use client";
import {
  rememberOnboardingSignIn,
  clearOnboardingSignIn,
} from "@/lib/onboarding-redirect";
import { watchSpeech, type SpeechMonitor } from "@/lib/onboarding-listening";
import styles from "@/components/onboarding/Onboarding.module.css";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { onboardingAuth } from "@/lib/onboarding-auth-client";
import {
  ageFromDob,
  PROFILE_FIELDS,
  nextPrompt,
  type Language,
  type Profile,
  type Voice,
} from "@/lib/onboarding-profile";

type Draft = { profile: Profile; revision: number; complete: boolean };
type Prompt = { text: string; clip: string | null; review?: boolean };
const empty: Draft = { profile: {}, revision: 0, complete: false };
export default function Onboarding() {
  const [session, setSession] = useState<Session | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const autoplayAttempted = useRef(false);
  const [callActive, setCallActive] = useState(false);
  const [panel, setPanel] = useState<"voice" | "profile" | "transcript" | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [conversation, setConversation] = useState<
    Array<{ role: "Meera" | "You"; text: string }>
  >([]);
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
  const [speaking, setSpeaking] = useState(false);
  const playback = useRef(0);
  const guided = useRef(false);
  const mutedRef = useRef(false);
  const monitor = useRef<SpeechMonitor | null>(null);
  const orb = useRef<HTMLButtonElement | null>(null);
  const lastPrompt = useRef<Prompt | null>(null);
  const cachedAudio = useRef<{ key: string; blob: Blob } | null>(null);
  const [updatedFields, setUpdatedFields] = useState<string[]>([]);
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
  const menuPresentedFor = useRef<string | null>(null);
  sessionRef.current = session;
  function update(value: Draft) {
    draftRef.current = value;
    setDraft(value);
  }
  function stopSpeech() {
    playback.current++;
    setSpeaking(false);
    if (audio.current) audio.current.onended = null;
    audio.current?.pause();
    audio.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }
  function stopMic(discard = true) {
    monitor.current?.stop();
    monitor.current = null;
    mutedRef.current = false;
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
  function cancelTurn() {
    generation.current++;
    controller.current?.abort();
    stopSpeech();
    stopMic();
    setBusy(false);
  }
  function interrupt() {
    guided.current = false;
    cancelTurn();
  }
  const cleanup = useRef(interrupt);
  cleanup.current = interrupt;
  useEffect(
    () => () => {
      cleanup.current();
      cachedAudio.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!callActive) return;
    const limit = setTimeout(() => {
      cleanup.current();
      setCallActive(false);
      setStatus(
        "This call has ended after five minutes. You can start another call or continue by typing.",
      );
    }, 300_000);
    return () => clearTimeout(limit);
  }, [callActive]);
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
      setAuthResolved(true);
      setStatus("Staging Google sign-in needs configuration.");
      return;
    }
    let mounted = true;
    auth.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setAuthResolved(true);
      }
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
      setProfileChecked(false);
      setCallActive(false);
      setPanel(null);
      menuPresentedFor.current = null;
      setConversation([]);
      cachedAudio.current = null;
      lastPrompt.current = null;
      setUpdatedFields([]);
      setTranscript("");
      setText("");
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
      const storedDraft = result.draft || empty;
      const profile = { ...storedDraft.profile };
      if (profile.name === undefined && result.googleName)
        profile.name = result.googleName;
      update({ ...storedDraft, profile });
      dirty.current =
        storedDraft.profile.name === undefined && Boolean(profile.name);
      setWorkspace(result.workspace);
      setReady(Boolean(result.voiceConfigured));
      setLoaded(result.profileReady !== false && Boolean(result.draft));
      setStatus(
        storedDraft.complete
          ? "Your profile is saved. Welcome back."
          : nextPrompt(profile, language).text,
      );
    } catch (reason) {
      if (attempt === generation.current) setError((reason as Error).message);
    } finally {
      if (attempt === generation.current) {
        setBusy(false);
        setProfileChecked(true);
        const currentUser = sessionRef.current?.user.id;
        if (currentUser && menuPresentedFor.current !== currentUser) {
          menuPresentedFor.current = currentUser;
          clearOnboardingSignIn();
          if (
            !draftRef.current.complete ||
            new URLSearchParams(window.location.search).get("setup") === "1"
          )
            setPanel("profile");
          const url = new URL(window.location.href);
          url.searchParams.delete("setup");
          window.history.replaceState(
            window.history.state,
            "",
            url.pathname + url.search + url.hash,
          );
        }
      }
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
    rememberOnboardingSignIn();
    const { error } = await auth.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      clearOnboardingSignIn();
      setError("Google sign-in could not start. Please try again.");
    }
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
    onDone?: () => void,
    automatic = false,
  ) {
    stopSpeech();
    setStatus(prompt.text);
    setAutoplayBlocked(false);
    setConversation((previous) =>
      previous.at(-1)?.text === prompt.text
        ? previous
        : [...previous.slice(-39), { role: "Meera", text: prompt.text }],
    );
    lastPrompt.current = prompt;
    const attempt = generation.current;
    const playId = playback.current;
    try {
      const key = JSON.stringify([prompt, selectedVoice, selectedLanguage]);
      let blob =
        cachedAudio.current?.key === key ? cachedAudio.current.blob : null;
      if (!blob) {
        const response = prompt.clip
          ? await fetch(
              `/api/onboarding/clips/${selectedVoice}${selectedLanguage === "hi" ? "-hi" : ""}-${prompt.clip}.mp3`,
            )
          : await api("speech", { text: prompt.text, voice: selectedVoice });
        if (!response.ok) throw new Error();
        blob = await response.blob();
      }
      if (generation.current !== attempt || playback.current !== playId) return;
      cachedAudio.current = { key, blob };
      audioUrl.current = URL.createObjectURL(blob);
      const player = new Audio(audioUrl.current);
      audio.current = player;
      player.onplaying = () => {
        if (generation.current === attempt && playback.current === playId)
          setSpeaking(true);
      };
      player.onended = () => {
        if (generation.current !== attempt || playback.current !== playId)
          return;
        setSpeaking(false);
        onDone?.();
      };
      player.onerror = () => {
        if (playback.current === playId) {
          setSpeaking(false);
          guided.current = false;
          setError("Audio stopped. Replay the response or continue by typing.");
        }
      };
      await player.play();
    } catch (reason) {
      if (generation.current !== attempt || playback.current !== playId) return;
      setSpeaking(false);
      guided.current = false;
      if (
        automatic &&
        reason instanceof DOMException &&
        reason.name === "NotAllowedError"
      ) {
        setAutoplayBlocked(true);
      } else {
        setError(
          "Audio could not play. You can read the prompt and type instead.",
        );
      }
    }
  }
  const autoWelcome = useRef(() => {});
  autoWelcome.current = () => {
    void play(welcomePrompt(language), voice, language, undefined, true);
  };
  useEffect(() => {
    if (
      !authResolved ||
      (session && !profileChecked) ||
      autoplayAttempted.current
    )
      return;
    const start = () => {
      if (autoplayAttempted.current) return;
      autoplayAttempted.current = true;
      autoWelcome.current();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (document.readyState === "complete") timer = setTimeout(start, 0);
    else window.addEventListener("load", start, { once: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("load", start);
    };
  }, [authResolved, session, profileChecked]);
  useEffect(() => {
    if (panel === "profile" || panel === "voice") cleanup.current();
    if (panel && !dialog.current?.open) dialog.current?.showModal();
    if (!panel && dialog.current?.open) dialog.current.close();
  }, [panel]);

  function startVoice() {
    autoplayAttempted.current = true;
    interrupt();
    setError("");
    setStarted(true);
    setCallActive(true);
    guided.current = true;
    const prompt = nextPrompt(draftRef.current.profile, language);
    void guide(
      prompt.clip === "review"
        ? {
            text: "Your details are ready to review. What can I help you with before you continue?",
            clip: null,
          }
        : prompt,
    );
  }
  async function guide(prompt: Prompt) {
    await play(prompt, voice, language, () => {
      if (!guided.current) return;
      if (prompt.review || prompt.clip === "review") {
        guided.current = false;
        setPanel("profile");
      } else void record();
    });
  }
  function replayWelcome() {
    interrupt();
    autoplayAttempted.current = true;
    void play(welcomePrompt(language));
  }
  function repeatResponse() {
    const prompt = lastPrompt.current;
    if (!prompt) return;
    interrupt();
    void play(prompt);
  }
  function previewVoice(item: Voice) {
    interrupt();
    autoplayAttempted.current = true;
    void play(
      {
        text:
          language === "hi"
            ? "नमस्ते, मैं मीरा हूँ। चलिए, आपकी पसंद से शुरुआत करते हैं।"
            : "Hi, I'm Meera. Let's make this feel like you.",
        clip: "preview",
      },
      item,
    );
  }
  async function answer(
    value: { text: string } | { audio: string; format: string },
  ) {
    cancelTurn();
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
          {
            ...value,
            language,
            revision: draftRef.current.revision,
            question: lastPrompt.current?.text,
          },
          abort.signal,
        )
      ).json();
      if (attempt !== generation.current) return;
      setTranscript(result.transcript);
      setUpdatedFields(result.updatedFields || []);
      setConversation((previous) => [
        ...previous.slice(-39),
        { role: "You", text: result.transcript },
      ]);
      update({ ...draftRef.current, profile: result.proposal.profile });
      dirty.current = true;
      await persist(result.proposal.profile, false);
      if (attempt !== generation.current) return;
      setText("");
      await guide(result.prompt);
    } catch (reason) {
      if (attempt === generation.current) {
        guided.current = false;
        setError(
          abort.signal.aborted
            ? "The response timed out. Your draft is still available."
            : (reason as Error).message,
        );
      }
    } finally {
      clearTimeout(timeout);
      if (attempt === generation.current) setBusy(false);
    }
  }
  async function record() {
    cancelTurn();
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
        guided.current = false;
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
      setCallActive(true);
      setRecording(true);
      setBusy(false);
      setStarted(true);
      const idle = () => {
        if (attempt !== generation.current) return;
        interrupt();
        setStatus(
          "Take your time. Start recording whenever you’re ready, or type your answer.",
        );
      };
      monitor.current = watchSpeech(stream, {
        isMuted: () => mutedRef.current,
        onLevel: (level) =>
          orb.current?.style.setProperty("--input-level", String(level)),
        onFinish: () => {
          if (attempt === generation.current && capture.state !== "inactive")
            capture.stop();
        },
        onIdle: idle,
        onWaiting: () => {
          if (attempt === generation.current)
            setStatus(
              "Take your time. Let me know whenever you’re ready for the next step.",
            );
        },
        onUnsupported: () => {
          if (attempt === generation.current)
            setStatus("I’m listening. Select Send recording when you finish.");
        },
      });
      recordLimit.current = setTimeout(() => {
        if (
          mutedRef.current ||
          (monitor.current && !monitor.current.heardSpeech())
        )
          idle();
        else if (capture.state !== "inactive") capture.stop();
      }, 30_000);
    } catch {
      if (attempt === generation.current) {
        guided.current = false;
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
        name: draftRef.current.profile.name ?? null,
        job_details: draftRef.current.profile.job_details ?? null,
        dob: draftRef.current.profile.dob ?? null,
        caste: draftRef.current.profile.caste ?? null,
        phone: draftRef.current.profile.phone ?? null,
        usage: draftRef.current.profile.usage ?? null,
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
          PROFILE_FIELDS.some(
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
      setPanel(null);
      setCallActive(false);
      await play({
        text: "Your profile is saved. You can open Meera.",
        clip: "finish",
      });
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
  function endCall() {
    interrupt();
    setCallActive(false);
    setStatus(
      "Take your time. You can add a few optional details, or continue to Meera.",
    );
    if (session && !draft.complete) setPanel("profile");
  }
  const publicPrompt = conversation.length
    ? status
    : welcomePrompt(language).text;
  return (
    <main className={styles.screen} data-focused={focused}>
      <header className={styles.topbar}>
        <div className={styles.menuAnchor}>
          <button
            className={styles.iconButton}
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name="menu" />
          </button>
          {menuOpen && (
            <nav className={styles.menu} aria-label="Onboarding navigation">
              <a href="https://himeera.com">About Meera</a>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setPanel("voice");
                }}
              >
                Voice settings
              </button>
              {session && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setPanel("profile");
                  }}
                >
                  Optional profile
                </button>
              )}
            </nav>
          )}
        </div>
        <a
          className={styles.wordmark}
          href="https://himeera.com"
          aria-label="Himeera home"
        >
          Meera <Icon name="wave" />
        </a>
        <div className={styles.headerActions}>
          <button
            className={styles.iconButton}
            aria-label="Show transcripts"
            onClick={() => setPanel("transcript")}
          >
            <Icon name="transcript" />
          </button>
          <button
            className={styles.iconButton}
            aria-label={focused ? "Restore voice view" : "Expand voice view"}
            aria-pressed={focused}
            onClick={() => setFocused(!focused)}
          >
            <Icon name="expand" />
          </button>
        </div>
      </header>

      <section className={styles.stage} aria-label="Meera voice assistant">
        <button
          ref={orb}
          className={styles.orbShell}
          disabled={!speaking && !recording}
          data-speaking={speaking}
          data-listening={recording && !muted}
          aria-label={
            speaking || recording ? "Interrupt Meera" : "Meera voice assistant"
          }
          onClick={() => {
            if (speaking || recording) interrupt();
          }}
        >
          <span className={styles.orbMiddle}>
            <img
              className={styles.orb}
              src="/icons/meera.svg"
              width={184}
              height={184}
              loading="eager"
              alt=""
            />
          </span>
        </button>
        <p className={styles.voiceState} aria-live="polite">
          {speaking
            ? "Meera is speaking"
            : recording
              ? muted
                ? "Microphone muted"
                : "Meera is listening"
              : busy
                ? "One moment…"
                : "Your personal companion"}
        </p>
        <p className={styles.prompt} role="status" aria-live="polite">
          {session
            ? draft.complete
              ? "You’re all set. Welcome to Meera."
              : status
            : publicPrompt}
        </p>
        {speaking || callActive || busy ? (
          <button className={styles.interrupt} onClick={interrupt}>
            Tap to interrupt Meera
          </button>
        ) : (
          <div className={styles.suggestions} aria-label="Get to know Meera">
            <button
              onClick={() => {
                setStatus(
                  "Talk, type, and get to know Meera at your own pace. Google sign-in is the only required step.",
                );
                setConversation((previous) => [
                  ...previous,
                  {
                    role: "Meera",
                    text: "Talk, type, and get to know Meera at your own pace. Google sign-in is the only required step.",
                  },
                ]);
              }}
            >
              How it works
            </button>
            <button onClick={() => setPanel("voice")}>Choose a voice</button>
            <button
              onClick={() => {
                if (session) setPanel("profile");
                else {
                  setStatus(
                    "After Google sign-in, you can share a name, birthday or work details. Every detail is optional.",
                  );
                  setConversation((previous) => [
                    ...previous,
                    {
                      role: "Meera",
                      text: "After Google sign-in, you can share a name, birthday or work details. Every detail is optional.",
                    },
                  ]);
                }
              }}
            >
              Your optional profile
            </button>
          </div>
        )}
        <div className={styles.replayControls}>
          <button onClick={replayWelcome}>Replay welcome</button>
          {conversation.length > 0 && (
            <button onClick={repeatResponse}>Repeat last response</button>
          )}
        </div>
        {session && transcript && (
          <div className={styles.feedback} aria-live="polite">
            <p>
              <strong>You said:</strong> {transcript}
            </p>
            <button
              onClick={() => {
                interrupt();
                setText(transcript);
                setPanel("profile");
              }}
            >
              Correct this
            </button>
          </div>
        )}
        {session && loaded && (
          <div
            className={styles.draftProgress}
            aria-label="Your optional details"
          >
            {(
              [
                ["name", "Name"],
                ["job_details", "Work"],
                ["dob", "Birthday"],
              ] as const
            ).map(([field, label]) => (
              <span key={field} data-updated={updatedFields.includes(field)}>
                <strong>{label}</strong>{" "}
                {draft.profile[field] === null
                  ? "Skipped"
                  : draft.profile[field] || "Optional"}
              </span>
            ))}
          </div>
        )}
        {autoplayBlocked && (
          <div className={styles.soundFallback}>
            <p>Your browser needs a tap to enable sound.</p>
            <button onClick={() => previewVoice(voice)}>
              <Icon name="play" />
              Enable Meera’s voice
            </button>
          </div>
        )}
        {error && !panel && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </section>

      <section className={styles.dock} aria-label="Onboarding controls">
        {!session ? (
          <>
            <p className={styles.invitation}>
              Continue with Google to begin. Everything else is optional.
            </p>
            <button
              className={styles.googleButton}
              onClick={() => void signIn()}
            >
              <GoogleMark />
              Continue with Google <Icon name="arrow" />
            </button>
          </>
        ) : (
          <>
            {callActive ? (
              <div className={styles.callControls}>
                {recording ? (
                  <>
                    <button
                      className={styles.callControl}
                      aria-pressed={muted}
                      onClick={() => {
                        const next = !muted;
                        mutedRef.current = next;
                        microphone.current
                          ?.getAudioTracks()
                          .forEach((track) => {
                            track.enabled = !next;
                          });
                        setMuted(next);
                      }}
                    >
                      <span>
                        <Icon name="mic" />
                      </span>
                      {muted ? "Unmute microphone" : "Mute microphone"}
                    </button>
                    <button
                      className={styles.callControl}
                      onClick={() => recorder.current?.stop()}
                    >
                      <span>
                        <Icon name="arrow" />
                      </span>
                      Send recording
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.callControl}
                    disabled={busy || !loaded || !ready || !canRecord}
                    onClick={() => {
                      guided.current = true;
                      void record();
                    }}
                  >
                    <span>
                      <Icon name="mic" />
                    </span>
                    Record an answer
                  </button>
                )}
                <button className={styles.callControl} onClick={endCall}>
                  <span>
                    <Icon name="phone" />
                  </span>
                  End Call
                </button>
              </div>
            ) : (
              !draft.complete && (
                <button
                  className={`${styles.callControl} ${styles.startCall}`}
                  disabled={!loaded || !ready || !canRecord || busy}
                  aria-label="Start voice — allow microphone"
                  onClick={startVoice}
                >
                  <span>
                    <Icon name="phone" />
                  </span>
                  Start Call
                </button>
              )
            )}
            <div className={styles.accountLinks}>
              <button onClick={() => setPanel("profile")}>
                Add details (optional)
              </button>
              <a
                href={workspace}
                onClick={() => {
                  dirty.current = false;
                  interrupt();
                }}
              >
                {draft.complete
                  ? "Open Meera"
                  : "Skip for now — continue to Meera"}{" "}
                <Icon name="arrow" />
              </a>
            </div>
            {!loaded && !busy && (
              <p className={styles.notice}>
                Optional profile storage isn’t ready. You can continue to Meera
                without filling in any details.
              </p>
            )}
          </>
        )}
        {elapsed && session && !draft.complete && (
          <div className={styles.resumeNotice} role="status">
            <p>No rush. Take a break or finish by typing. Your saved draft stays here.</p>
            <button className={styles.textButton} onClick={() => { interrupt(); setPanel("profile"); }}>Type or save draft</button>
          </div>
        )}
        <p className={styles.disclosure}>
          {session
            ? "Microphone access starts only when you choose a call. Voice is processed through OpenRouter; recordings are not stored by this app."
            : "The introduction is recorded. Interactive voice starts after Google sign-in."}
        </p>
      </section>

      <dialog
        ref={dialog}
        className={styles.dialog}
        onCancel={() => setPanel(null)}
        onClose={() => setPanel(null)}
        aria-labelledby="panel-title"
      >
        <div className={styles.panelHeader}>
          <h2 id="panel-title">
            {panel === "voice"
              ? "Your voice, your way"
              : panel === "transcript"
                ? "Transcripts"
                : "A little about you"}
          </h2>
          <button
            className={styles.iconButton}
            aria-label="Close panel"
            onClick={() => setPanel(null)}
          >
            <Icon name="close" />
          </button>
        </div>
        {panel === "voice" && (
          <>
            <VoicePreferences
              voice={voice}
              language={language}
              disabled={busy || recording}
              onVoice={(item) => {
                stopSpeech();
                setVoice(item);
              }}
              onLanguage={(item) => {
                stopSpeech();
                setLanguage(item);
                if (!session) setStatus(welcomePrompt(item).text);
              }}
              onPreview={previewVoice}
            />
            <p className={styles.panelNote}>
              Preview Sarah or Brian, and choose English or Hindi/Hinglish.
              Every profile detail is optional.
            </p>
            {session && !draft.complete && <div className={styles.profileActions}>
              <button className={styles.primaryButton}
                disabled={busy || !loaded || !ready || !canRecord}
                onClick={() => { setPanel(null); startVoice(); }}>
                <Icon name="mic" /> Start with Meera
              </button>
              <button className={styles.textButton} onClick={() => setPanel("profile")}>I’d rather type</button>
            </div>}
            {session && <a className={styles.textButton} href={workspace} onClick={() => { dirty.current = false; interrupt(); }}>Skip for now — open Meera</a>}
          </>
        )}
        {panel === "transcript" && (
          <div className={styles.transcripts}>
            {conversation.length ? (
              conversation.map((line, index) => (
                <p key={index}>
                  <strong>{line.role}</strong>
                  <span>{line.text}</span>
                </p>
              ))
            ) : (
              <p>
                Your conversation will appear here. Transcripts stay in this
                page’s memory.
              </p>
            )}
          </div>
        )}
        {panel === "profile" && (
          <>
            {!session ? (
              <p>
                Continue with Google first. Name, birthday, work and other
                details are all optional.
              </p>
            ) : draft.complete ? (
              <>
                <p>Your saved profile has been restored.</p>
                <a className={styles.primaryButton} href={workspace}>
                  Open Meera <Icon name="arrow" />
                </a>
              </>
            ) : (
              <>
                <p className={styles.panelNote}>
                  Share only what feels right. You can skip every detail and
                  still use Meera.
                </p>
                <VoicePreferences
                  voice={voice} language={language} disabled={busy || recording}
                  onVoice={(value) => { stopSpeech(); setVoice(value); }}
                  onLanguage={(value) => { stopSpeech(); setLanguage(value); }}
                  onPreview={previewVoice}
                />
                <button
                  className={styles.primaryButton}
                  disabled={busy || !loaded || !ready || !canRecord}
                  onClick={() => {
                    setPanel(null);
                    startVoice();
                  }}
                >
                  <Icon name="mic" /> Continue with Meera’s voice
                </button>
                <p className={styles.panelNote}>
                  Meera will ask one question at a time. You can speak, type, or
                  skip. Microphone access starts when you choose voice.
                </p>
                {!loaded && (
                  <p role="status" className={styles.notice}>
                    Optional profile setup is unavailable. You can still skip
                    and continue to Meera.
                  </p>
                )}
                <div className={styles.profileFields}>
                  {(
                    [
                      {
                        key: "name",
                        title: "What should I call you? (optional)",
                        type: "text",
                      },
                      {
                        key: "dob",
                        title: "Birthday (optional)",
                        type: "date",
                      },
                      {
                        key: "job_details",
                        title: "Work or study (optional)",
                        type: "text",
                      },
                      {
                        key: "phone",
                        title: "Phone number (optional)",
                        type: "tel",
                      },
                      {
                        key: "usage",
                        title: "Personal tasks, work, or team projects? (optional)",
                        type: "text",
                      },
                      {
                        key: "caste",
                        title: "Caste or community (optional)",
                        type: "text",
                      },
                    ] as const
                  ).map((field) => (
                    <label key={field.key}>
                      {field.title}
                      <input
                        type={field.type}
                        maxLength={field.key === "phone" ? 25 : 500}
                        autoComplete={field.key === "phone" ? "tel" : field.key === "name" ? "given-name" : "off"}
                        value={draft.profile[field.key] || ""}
                        disabled={busy || recording || !loaded}
                        onChange={(event) => {
                          saveKey.current = null;
                          dirty.current = true;
                          update({
                            ...draftRef.current,
                            profile: {
                              ...draftRef.current.profile,
                              [field.key]: event.target.value || null,
                            },
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>
                {age !== null && <p className={styles.panelNote}>Age: {age}</p>}
                <div className={styles.profileActions}>
                  <button
                    className={styles.primaryButton}
                    disabled={busy || !loaded}
                    onClick={() => void finish()}
                  >
                    Save and begin <Icon name="arrow" />
                  </button>
                  <a
                    href={workspace}
                    onClick={() => {
                      dirty.current = false;
                      interrupt();
                    }}
                  >
                    Skip for now
                  </a>
                </div>
                <button
                  className={styles.textButton}
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
              </>
            )}
            <form
              className={styles.answerForm}
              onSubmit={(event) => {
                event.preventDefault();
                setStarted(true);
                void answer({ text });
              }}
            >
              <label htmlFor="onboarding-answer">
                Your answer or correction
              </label>
              <textarea
                id="onboarding-answer"
                value={text}
                maxLength={2000}
                disabled={busy || !loaded}
                onChange={(event) => setText(event.target.value)}
                placeholder="Tell Meera, or skip anything you prefer."
              />
              <button
                className={styles.textButton}
                disabled={busy || !loaded || !ready || !text.trim()}
              >
                Send answer <Icon name="arrow" />
              </button>
            </form>
            {transcript && (
              <p className={styles.panelNote}>
                <strong>You said: </strong>
                {transcript}
              </p>
            )}
            {session && (
              <button
                className={styles.textButton}
                disabled={busy}
                onClick={() => void load()}
              >
                Reload saved profile
              </button>
            )}
            {elapsed && (
              <p className={styles.panelNote}>
                No rush. Your saved draft will be here when you return.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </dialog>
    </main>
  );
}

function welcomePrompt(language: Language): Prompt {
  return {
    text:
      language === "hi"
        ? "नमस्ते, मैं मीरा हूँ। चलिए, आपकी पसंद से शुरुआत करते हैं।"
        : "Hi, I'm Meera. Let's make this feel like you.",
    clip: "preview",
  };
}
function Icon({
  name,
}: {
  name:
    | "arrow"
    | "mic"
    | "play"
    | "phone"
    | "wave"
    | "menu"
    | "transcript"
    | "expand"
    | "close";
}) {
  const paths = {
    arrow: "M4 12h15m-6-6 6 6-6 6",
    mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1M12 18v4m-3 0h6",
    play: "m9 5 10 7-10 7V5Z",
    phone: "M4 13c3-6 13-6 16 0l-3 2-3-3h-4l-3 3-3-2Z",
    wave: "M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4",
    menu: "M4 6h16M4 12h16M4 18h16",
    transcript: "M4 5h16M4 10h16M4 15h8m3-2 4 3-4 3",
    expand: "M4 4h6M4 4v6M4 4l6 6m10 10h-6m6 0v-6m0 6-6-6",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
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
function VoicePreferences({
  voice,
  language,
  disabled,
  onVoice,
  onLanguage,
  onPreview,
}: {
  voice: Voice;
  language: Language;
  disabled: boolean;
  onVoice: (value: Voice) => void;
  onLanguage: (value: Language) => void;
  onPreview: (value: Voice) => void;
}) {
  return (
    <>
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend>Choose your voice</legend>
        <div className={styles.voiceOptions}>
          {(["sarah", "brian"] as const).map((item) => (
            <div
              className={styles.voiceOption}
              data-selected={voice === item}
              key={item}
            >
              <label>
                <input
                  type="radio"
                  name="voice"
                  checked={voice === item}
                  onChange={() => onVoice(item)}
                />
                {item === "sarah" ? "Sarah" : "Brian"}
              </label>
              <button
                className={styles.textButton}
                type="button"
                onClick={() => onPreview(item)}
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
          disabled={disabled}
          onChange={(event) => onLanguage(event.target.value as Language)}
        >
          <option value="en">English</option>
          <option value="hi">Hindi / Hinglish</option>
        </select>
      </label>
    </>
  );
}
