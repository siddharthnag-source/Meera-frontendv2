import { isPaidPlanActive } from '@/lib/subscriptionUtils';
import type { SubscriptionData } from '@/types/subscription';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export const GUEST_TOKEN_NAMESPACE = (process.env.NEXT_PUBLIC_GUEST_TOKEN_NAMESPACE || 'g20260329f1').trim();
export const GUEST_TOKEN_STORAGE_KEY = `guest_token_${GUEST_TOKEN_NAMESPACE}`;
export const LEGACY_GUEST_TOKEN_STORAGE_KEY = 'guest_token';
export const GUEST_TOKEN_COOKIE_KEY = 'guest_token';

const AUTH_SUCCESS_QUERY_KEY = 'success';
const AUTH_SUCCESS_QUERY_VALUE = 'true';
const AUTH_SUCCESS_CONSUMED_STORAGE_KEY = 'meera_auth_success_consumed_v1';
const AUTH_REDIRECT_TRACE_STORAGE_KEY = 'meera_auth_redirect_trace_v1';
const AUTH_REDIRECT_TRACE_WINDOW_MS = 4000;
const AUTH_REDIRECT_TRACE_THRESHOLD = 4;

type ManagedAuthPath = '/' | '/sign-in';

type RedirectDecision = {
  target: string | null;
  reason: string | null;
};

type RedirectTraceEntry = {
  at: number;
  path: ManagedAuthPath;
};

const canUseWindow = (): boolean => typeof window !== 'undefined';

const canUseDocument = (): boolean => typeof document !== 'undefined';

const readSessionStorage = (key: string): string | null => {
  if (!canUseWindow()) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSessionStorage = (key: string, value: string): void => {
  if (!canUseWindow()) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage errors in private mode / disabled storage environments.
  }
};

const removeSessionStorage = (key: string): void => {
  if (!canUseWindow()) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage errors in private mode / disabled storage environments.
  }
};

const removeLocalStorage = (key: string): void => {
  if (!canUseWindow()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors in private mode / disabled storage environments.
  }
};

const normalizeManagedAuthPath = (pathname: string | null | undefined): ManagedAuthPath | null => {
  if (pathname === '/') return '/';
  if (pathname === '/sign-in' || pathname?.startsWith('/sign-in?')) return '/sign-in';
  return null;
};

const readRedirectTrace = (): RedirectTraceEntry[] => {
  const raw = readSessionStorage(AUTH_REDIRECT_TRACE_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => ({
        at: Number(entry?.at),
        path: normalizeManagedAuthPath(typeof entry?.path === 'string' ? entry.path : null),
      }))
      .filter((entry): entry is RedirectTraceEntry => Number.isFinite(entry.at) && !!entry.path);
  } catch {
    return [];
  }
};

const writeRedirectTrace = (entries: RedirectTraceEntry[]): void => {
  writeSessionStorage(AUTH_REDIRECT_TRACE_STORAGE_KEY, JSON.stringify(entries));
};

export const logAuthRedirectEvent = (event: string, meta: Record<string, unknown> = {}): void => {
  console.info(
    '[auth_redirect]',
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...meta,
    }),
  );
};

const readLocalStorageValue = (key: string): string | null => {
  if (!canUseWindow()) return null;

  try {
    const value = window.localStorage.getItem(key);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

export const getGuestToken = (): string | null => {
  return readLocalStorageValue(GUEST_TOKEN_STORAGE_KEY);
};

const getLegacyGuestToken = (): string | null => readLocalStorageValue(LEGACY_GUEST_TOKEN_STORAGE_KEY);

export const setGuestToken = (token: string): string => {
  const normalized = token.trim();
  if (!normalized || !canUseWindow()) return normalized;

  try {
    window.localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, normalized);
    if (LEGACY_GUEST_TOKEN_STORAGE_KEY !== GUEST_TOKEN_STORAGE_KEY) {
      window.localStorage.removeItem(LEGACY_GUEST_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage errors in private mode / disabled storage environments.
  }

  return normalized;
};

export const hasConsumedSuccessFlag = (): boolean =>
  readSessionStorage(AUTH_SUCCESS_CONSUMED_STORAGE_KEY) === '1';

export const markSuccessFlagConsumed = (): void => {
  writeSessionStorage(AUTH_SUCCESS_CONSUMED_STORAGE_KEY, '1');
};

export const clearSuccessFlagConsumption = (): void => {
  removeSessionStorage(AUTH_SUCCESS_CONSUMED_STORAGE_KEY);
};

export const hasSuccessQueryParam = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return params.get(AUTH_SUCCESS_QUERY_KEY) === AUTH_SUCCESS_QUERY_VALUE;
};

export const stripQueryParamsFromCurrentUrl = (keys: string[]): boolean => {
  if (!canUseWindow()) return false;

  const url = new URL(window.location.href);
  let changed = false;
  for (const key of keys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (!changed) return false;

  const nextUrl = `${url.pathname}${url.search ? url.search : ''}${url.hash ? url.hash : ''}`;
  window.history.replaceState({}, '', nextUrl);
  return true;
};

export const clearGuestTokenState = (reason: string): void => {
  const hadGuestToken = !!(getGuestToken() || getLegacyGuestToken());
  removeLocalStorage(GUEST_TOKEN_STORAGE_KEY);
  removeLocalStorage(LEGACY_GUEST_TOKEN_STORAGE_KEY);
  if (canUseDocument()) {
    document.cookie = `${GUEST_TOKEN_COOKIE_KEY}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    if (GUEST_TOKEN_STORAGE_KEY !== GUEST_TOKEN_COOKIE_KEY) {
      document.cookie = `${GUEST_TOKEN_STORAGE_KEY}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    }
  }
  clearSuccessFlagConsumption();
  if (hadGuestToken) {
    logAuthRedirectEvent('guest_token_cleared', { reason });
  }
};

export const resolveHomeRouteDecision = ({
  sessionStatus,
  isSubscriptionLoading,
  subscriptionData,
  hasGuestToken,
  hasConsumedSuccess,
}: {
  sessionStatus: SessionStatus;
  isSubscriptionLoading: boolean;
  subscriptionData?: SubscriptionData | null;
  hasGuestToken: boolean;
  hasConsumedSuccess: boolean;
}): RedirectDecision => {
  if (sessionStatus === 'loading') {
    return { target: null, reason: null };
  }

  if (sessionStatus === 'authenticated') {
    return { target: null, reason: null };
  }

  if (isSubscriptionLoading) {
    return { target: null, reason: null };
  }

  if (hasGuestToken && isPaidPlanActive(subscriptionData)) {
    return {
      target: hasConsumedSuccess ? '/sign-in' : '/sign-in?success=true',
      reason: hasConsumedSuccess ? 'unauthenticated_paid_guest' : 'unauthenticated_paid_guest_success',
    };
  }

  return { target: '/sign-in', reason: 'unauthenticated_user' };
};

export const resolveSignInRouteDecision = (sessionStatus: SessionStatus): RedirectDecision => {
  if (sessionStatus !== 'authenticated') {
    return { target: null, reason: null };
  }

  return { target: '/', reason: 'authenticated_user' };
};

export const registerAuthRedirectVisit = (
  pathname: string | null | undefined,
): { loopDetected: boolean; visitCount: number } => {
  const managedPath = normalizeManagedAuthPath(pathname);
  if (!managedPath || !canUseWindow()) {
    return { loopDetected: false, visitCount: 0 };
  }

  const now = Date.now();
  const recentEntries = readRedirectTrace().filter((entry) => now - entry.at <= AUTH_REDIRECT_TRACE_WINDOW_MS);
  const lastEntry = recentEntries[recentEntries.length - 1];

  if (!lastEntry || lastEntry.path !== managedPath || now - lastEntry.at > 250) {
    recentEntries.push({ at: now, path: managedPath });
  }

  const trimmedEntries = recentEntries.slice(-6);
  writeRedirectTrace(trimmedEntries);

  const lastEntries = trimmedEntries.slice(-AUTH_REDIRECT_TRACE_THRESHOLD);
  const loopDetected =
    lastEntries.length === AUTH_REDIRECT_TRACE_THRESHOLD &&
    new Set(lastEntries.map((entry) => entry.path)).size === 2 &&
    lastEntries.every((entry, index) => index === 0 || entry.path !== lastEntries[index - 1].path);

  return { loopDetected, visitCount: trimmedEntries.length };
};

export const clearAuthRedirectTrace = (): void => {
  removeSessionStorage(AUTH_REDIRECT_TRACE_STORAGE_KEY);
};

export const breakAuthRedirectLoop = ({
  pathname,
  sessionStatus,
}: {
  pathname: string | null | undefined;
  sessionStatus: SessionStatus;
}): string => {
  const managedPath = normalizeManagedAuthPath(pathname);
  stripQueryParamsFromCurrentUrl([AUTH_SUCCESS_QUERY_KEY]);
  if (sessionStatus === 'authenticated') {
    clearGuestTokenState('authenticated_loop_break');
  }
  clearAuthRedirectTrace();

  const safeTarget = sessionStatus === 'authenticated' ? '/' : '/sign-in';
  logAuthRedirectEvent('loop_break', {
    pathname: managedPath ?? pathname ?? null,
    safeTarget,
    sessionStatus,
  });

  return safeTarget;
};
