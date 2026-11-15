'use client';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { onboardingAuth } from '@/lib/onboarding-auth-client';
import { ONBOARDING_CALLBACK_PATH, rememberOnboardingSignIn, clearOnboardingSignIn } from '@/lib/onboarding-redirect';
import { reflectionQuestion, workspaceAfterOnboarding } from '@/lib/onboarding-reflection';
import styles from '@/components/onboarding/Reflection.module.css';

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null; start(): void; abort(): void;
};
type Draft = { profile: Record<string, string | null>; revision: number; complete: boolean };
export default function Onboarding() {
  const [session, setSession] = useState<Session | null>(null);
  const [resolved, setResolved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [phase, setPhase] = useState<'ready' | 'speaking' | 'listening' | 'saving' | 'done'>('ready');
  const [fallback, setFallback] = useState(false);
  const [answer, setAnswer] = useState('');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [workspace, setWorkspace] = useState('/');
  const identity = useRef<Session | null>(null);
  const draft = useRef<Draft | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const turn = useRef(0);
  const alive = useRef(true);
  const autoStarted = useRef<string | null>(null);
  const stepRef = useRef(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveKey = useRef<string | null>(null);
  const saving = useRef(false);
  const question = reflectionQuestion(step, language);
  identity.current = session;
  function stop() {
    turn.current++;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (voiceTimer.current) clearTimeout(voiceTimer.current);
    if (micTimer.current) clearTimeout(micTimer.current);
    if (recognition.current) {
      recognition.current.onend = null;
      recognition.current.onresult = null;
      recognition.current.onerror = null;
      recognition.current.abort();
      recognition.current = null;
    }
    window.speechSynthesis?.cancel();
  }
  async function api(path: string, data?: object) {
    const current = identity.current;
    if (!current) throw Error('Please continue with Google first.');
    const response = await fetch(`/api/onboarding/${path}`, {
      method: data ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${current.access_token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000),
    });
    if (identity.current?.user.id !== current.user.id) throw Error('Your account changed. Please try again.');
    const result = await response.json();
    if (identity.current?.user.id !== current.user.id) throw Error('Your account changed. Please try again.');
    if (!response.ok) throw Error(result.error || 'This step is temporarily unavailable.');
    return result;
  }
  useEffect(() => {
    alive.current = true;
    const auth = onboardingAuth();
    if (!auth) { setResolved(true); setError('Google sign-in is not configured for this preview.'); return; }
    let active = true;
    auth.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setResolved(true); } });
    const { data } = auth.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      if (identity.current?.user.id !== next?.user.id) {
        stop(); identity.current = next; draft.current = null; saveKey.current = null; saving.current = false;
        autoStarted.current = null; stepRef.current = 0;
        setStep(0); setLoaded(false); setAnswer(''); setHeard(''); setError(''); setPhase('ready'); setSaveFailed(false); setFallback(false);
      }
      setSession(next); setResolved(true);
    });
    return () => { active = false; alive.current = false; stop(); data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session?.user.id) return;
    let active = true;
    api('session').then(result => {
      if (!active) return;
      draft.current = result.draft;
      setWorkspace(result.workspace || '/');
      clearOnboardingSignIn();
      setLoaded(true);
      if (result.draft?.complete) setPhase('done');
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; stop(); };
  }, [session?.user.id]);
  useEffect(() => {
    if (!session || !loaded || draft.current?.complete || autoStarted.current === session.user.id) return;
    autoStarted.current = session.user.id;
    // Try immediately after the OAuth return. Browsers can require a new tap for
    // sound/microphone; retain a visible recovery control instead of pretending.
    speak(0, true);
  }, [loaded, session?.user.id]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) { stop(); setPhase(current => current === 'saving' || current === 'done' ? current : 'ready'); }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  function keyboard(message = '') {
    stop(); setPhase('ready'); setFallback(true); setNeedsTap(false); setError(message);
  }
  function listen(currentTurn: number) {
    if (currentTurn !== turn.current || !alive.current || !identity.current) return;
    const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Constructor) { keyboard('Voice recognition is unavailable in this browser. You can type instead.'); return; }
    const capture = new Constructor();
    recognition.current = capture;
    capture.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    capture.continuous = false; capture.interimResults = false;
    let received = false;
    capture.onresult = event => {
      if (currentTurn !== turn.current) return;
      const text = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim();
      if (!text) return;
      received = true;
      if (text.length > 2000) { keyboard('That answer was long. Please type a shorter version or skip.'); return; }
      stop(); setPhase('ready'); setHeard(text);
      // Brief correction window; the spoken answer is never put into profile or analytics.
      advanceTimer.current = setTimeout(() => advance(text), 1800);
    };
    capture.onerror = () => { if (currentTurn === turn.current) keyboard('I couldn’t hear you clearly. Try voice again, type, or skip.'); };
    capture.onend = () => { if (currentTurn === turn.current && !received) keyboard('No speech was detected. You can type, try again, or skip.'); };
    try {
      capture.start(); setPhase('listening'); setNeedsTap(false);
      micTimer.current = setTimeout(() => { if (currentTurn === turn.current) keyboard('Take your time. You can try voice again or type.'); }, 30000);
    } catch { keyboard('Your browser needs a tap to use voice. Try again or type below.'); }
  }
  function speak(index: number, intro = false) {
    stop(); setHeard(''); setAnswer(''); setFallback(false); setError(''); setNeedsTap(false);
    const currentTurn = turn.current;
    const prompt = reflectionQuestion(index, language);
    if (!prompt) return;
    const introText = language === 'hi' ? 'नमस्ते, मैं मीरा हूँ। तीन छोटे सवाल, और हर सवाल छोड़ना ठीक है। ' : 'Hi, I’m Meera. Three small questions, and you can skip any of them. ';
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') { keyboard('Spoken prompts are unavailable here. You can read and type your answer.'); return; }
    const utterance = new SpeechSynthesisUtterance((intro ? introText : '') + prompt);
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN'; utterance.rate = 0.9;
    const chosen = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith(language));
    if (chosen) utterance.voice = chosen;
    let began = false;
    utterance.onstart = () => { if (currentTurn === turn.current) { began = true; setPhase('speaking'); } };
    utterance.onend = () => { if (currentTurn === turn.current) { if (voiceTimer.current) clearTimeout(voiceTimer.current); listen(currentTurn); } };
    utterance.onerror = () => { if (currentTurn === turn.current) { setPhase('ready'); setNeedsTap(true); } };
    window.speechSynthesis.speak(utterance);
    voiceTimer.current = setTimeout(() => {
      if (currentTurn === turn.current && !began) { stop(); setPhase('ready'); setNeedsTap(true); }
    }, 2000);
  }
  async function finish() {
    if (saving.current) return;
    stop(); setHeard(''); setAnswer(''); setFallback(false); saving.current = true;
    setPhase('saving'); setError(''); setSaveFailed(false);
    const account = identity.current?.user.id;
    try {
      if (!draft.current) throw Error('Completion could not be saved. You can retry or continue without saving.');
      saveKey.current ||= crypto.randomUUID();
      const result = await api('profile', { profile: draft.current.profile, revision: draft.current.revision, complete: true, saveKey: saveKey.current });
      const check = await api('session');
      if (!check.draft?.complete || check.draft.revision !== result.draft.revision) throw Error('Completion could not be verified. Please retry.');
      if (account !== identity.current?.user.id || !alive.current) return;
      draft.current = check.draft;
      window.location.assign(workspaceAfterOnboarding(workspace, window.location.origin));
    } catch (reason) {
      if (account === identity.current?.user.id && alive.current) { setError((reason as Error).message); setSaveFailed(true); setPhase('ready'); }
    } finally { saving.current = false; }
  }
  function advance(value = '') {
    if (saving.current) return;
    stop(); setHeard(''); setAnswer('');
    // Do not retain emotional answers. A browser speech service may process audio;
    // Meera stores only the existing completion marker.
    if (value && /^(skip|pass|next|छोड़ो|आगे)[.!\s]*$/i.test(value)) value = '';
    const next = stepRef.current + 1;
    stepRef.current = next; setStep(next);
    if (next >= 3) void finish(); else speak(next);
  }
  async function signIn() {
    const auth = onboardingAuth();
    if (!auth) { setError('Google sign-in is unavailable.'); return; }
    rememberOnboardingSignIn();
    const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${ONBOARDING_CALLBACK_PATH}` } });
    if (error) setError(error.message);
  }
  return <main className={styles.screen}>
    <header className={styles.header}><a href="/onboarding" aria-label="Meera home">meera<span>●</span></a><span>A little space for you</span></header>
    <section className={styles.center} aria-label="A conversation with Meera">
      <p className={styles.eyebrow}>{session && loaded ? phase === 'done' ? 'WELCOME BACK' : `GETTING TO KNOW YOU · ${Math.min(step + 1, 3)} OF 3` : 'A CONVERSATION, NOT A FORM'}</p>
      <button type="button" className={`${styles.orb} ${phase === 'listening' ? styles.listening : ''}`} disabled={!session || !loaded || phase === 'saving' || phase === 'done'} aria-label={phase === 'listening' ? 'Stop listening' : 'Talk to Meera'} onClick={() => phase === 'listening' ? keyboard() : speak(stepRef.current)}><span /></button>
      {!resolved ? <h1>Just a moment…</h1> : !session ? <>
        <h1>Let’s start with<br/>how you really feel.</h1><p className={styles.description}>I’m Meera. A little room to speak, at your own pace.</p>
        <button className={styles.primary} onClick={() => void signIn()}>Continue with Google <span>↗</span></button>
        <p className={styles.note}>Three optional questions. No forms to fill.</p>
      </> : !loaded ? <h1>Making a little space for you…</h1> : phase === 'done' ? <><h1>Good to see you again.</h1><button className={styles.primary} onClick={() => window.location.assign(workspaceAfterOnboarding(workspace, window.location.origin))}>Open Meera ↗</button></> : <>
        <h1>{phase === 'saving' ? 'Let’s begin.' : question || 'You’re ready to begin.'}</h1>
        <p className={styles.description} role="status">{phase === 'speaking' ? 'Meera is speaking…' : phase === 'listening' ? 'I’m listening. Take your time.' : phase === 'saving' ? 'Saving your completion and opening Meera…' : heard ? 'Heard you. Moving on in a moment…' : needsTap ? 'Tap the circle to begin. Your browser needs permission for sound.' : 'Only share what feels comfortable.'}</p>
        {heard && <div className={styles.heard}><p>{heard}</p><button onClick={() => { stop(); setAnswer(heard); setHeard(''); setFallback(true); }}>Correct this</button></div>}
        {fallback && question && <form className={styles.form} onSubmit={event => { event.preventDefault(); if (answer.trim()) advance(answer.trim()); }}><label htmlFor="reflection-answer">Your answer</label><textarea id="reflection-answer" autoFocus maxLength={2000} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="A few words are enough…"/><button className={styles.primary} disabled={!answer.trim()}>Continue ↗</button></form>}
        {phase !== 'saving' && !saveFailed && <div className={styles.actions}>
          {question && <button onClick={() => speak(stepRef.current)}>Try voice again</button>}
          {!fallback && question && <button onClick={() => keyboard()}>Use keyboard</button>}
          {question && <button onClick={() => advance()}>Skip this question →</button>}
          <button onClick={() => { stepRef.current = 3; setStep(3); void finish(); }}>Skip to Meera ↗</button>
        </div>}
        {saveFailed && <div className={styles.actions}><button className={styles.primary} onClick={() => void finish()}>Retry save</button><button onClick={() => { stop(); window.location.assign(workspaceAfterOnboarding(workspace, window.location.origin)); }}>Continue without saving ↗</button></div>}
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
    <footer className={styles.footer}><p>All questions are optional. Emotional answers aren’t saved to your profile.<br/>Voice recognition may use your browser’s speech service.</p><label>Language <select aria-label="Language" value={language} disabled={phase === 'saving'} onChange={event => { stop(); setPhase('ready'); setLanguage(event.target.value as 'en' | 'hi'); setNeedsTap(true); }}><option value="en">English</option><option value="hi">हिन्दी / Hinglish</option></select></label></footer>
  </main>;
}
