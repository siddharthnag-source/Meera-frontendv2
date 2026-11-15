'use client';
import { useEffect, useState } from 'react';
import { MEERA_WELCOME } from '@/lib/onboarding-reflection';
/** Static greeting only. Never transfers onboarding disclosures in URLs/storage. */
export function OnboardingWelcome() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('welcome') !== 'onboarding') return;
    setVisible(true);
    url.searchParams.delete('welcome');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  if (!visible) return null;
  return <div role="status" className="mx-auto my-6 max-w-xl rounded-2xl border border-primary/10 p-6 text-primary"><p className="mb-2 text-xs uppercase tracking-widest opacity-50">Meera</p><p>{MEERA_WELCOME}</p></div>;
}
