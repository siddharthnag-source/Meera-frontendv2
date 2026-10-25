import { logAuthRedirectEvent } from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { captureMarketingTouch } from '@/lib/captureMarketingTouch';

import { getBrowserContext } from './browserContext';

type GuardMode = 'observe' | 'enforce';

export type StartGoogleOAuthResult =
  | { status: 'redirect_started' }
  | { status: 'blocked_in_embedded_browser'; openUrl: string; browserHint: 'Safari' | 'Chrome'; reason: string | null }
  | { status: 'failed'; message: string };

const getGuardMode = (): GuardMode => {
  const raw = (process.env.NEXT_PUBLIC_AUTH_INAPP_GUARD_MODE || 'enforce').toLowerCase();
  return raw === 'observe' ? 'observe' : 'enforce';
};

const isGuardEnabled = (): boolean => process.env.NEXT_PUBLIC_AUTH_INAPP_GUARD_ENABLED !== 'false';

const isGuardKillSwitchOn = (): boolean => process.env.NEXT_PUBLIC_AUTH_INAPP_KILL_SWITCH === 'true';

export const startGoogleOAuth = async (): Promise<StartGoogleOAuthResult> => {
  const context = getBrowserContext();
  const mode = getGuardMode();
  const canGuard = isGuardEnabled() && !isGuardKillSwitchOn() && context.isEmbedded;
  const openUrl = typeof window === 'undefined' ? '' : window.location.href;
  const browserHint: 'Safari' | 'Chrome' = context.isIOS ? 'Safari' : 'Chrome';

  if (canGuard) {
    logAuthRedirectEvent('google_oauth_embedded_detected', {
      mode,
      reason: context.reason,
      isIOS: context.isIOS,
      isAndroid: context.isAndroid,
      path: typeof window !== 'undefined' ? window.location.pathname : null,
    });

    if (mode === 'enforce') {
      return {
        status: 'blocked_in_embedded_browser',
        openUrl,
        browserHint,
        reason: context.reason,
      };
    }
  }

  await captureMarketingTouch();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    logAuthRedirectEvent('google_oauth_start_failed', {
      message: error.message,
      mode,
      reason: context.reason,
    });
    return { status: 'failed', message: error.message };
  }

  return { status: 'redirect_started' };
};
