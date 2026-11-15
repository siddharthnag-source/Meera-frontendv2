/** This flow intentionally never converts emotional disclosures into profile fields. */
export const REFLECTIVE_QUESTIONS = {
  en: [
    "What has been weighing on you lately, if anything?",
    "When did you last feel moved enough to cry, if you feel comfortable sharing?",
    "When things feel difficult, what helps you feel understood?",
  ],
  hi: [
    "इन दिनों आपके मन पर क्या चल रहा है, अगर आप बताना चाहें?",
    "आख़िरी बार कब आपकी आँखों में आँसू आए थे, अगर आप बताने में सहज हों?",
    "मुश्किल समय में किस बात से आपको लगता है कि कोई आपको समझ रहा है?",
  ],
} as const;
export const MEERA_WELCOME = "Hi, I’m Meera. There’s no perfect place to start. We can talk about what’s on your mind, or simply begin with your day.";
export function reflectionQuestion(index: number, language: 'en' | 'hi') {
  return REFLECTIVE_QUESTIONS[language][index] ?? null;
}
export function workspaceAfterOnboarding(workspace: string, origin: string) {
  const target = new URL(workspace, origin);
  if (target.protocol !== 'https:' && target.origin !== origin) throw Error('Invalid workspace destination.');
  // A dedicated preview root redirects back to onboarding. Its /chat handoff shows
  // the same welcome, with an explicit link into the real entitled workspace.
  if (target.origin === origin && target.pathname === '/' && origin.includes('meera-onboarding-staging')) target.pathname = '/chat';
  target.searchParams.set('welcome', 'onboarding');
  return target.toString();
}
