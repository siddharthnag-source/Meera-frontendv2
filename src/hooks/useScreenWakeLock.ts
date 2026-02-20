'use client';

import { useCallback, useEffect, useRef } from 'react';

type WakeLockApi = {
  request: (type: 'screen') => Promise<WakeLockSentinel>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: WakeLockApi;
};

export const useScreenWakeLock = (isActive: boolean): void => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isActiveRef = useRef(isActive);

  const releaseWakeLock = useCallback(async () => {
    const wakeLock = wakeLockRef.current;
    wakeLockRef.current = null;

    if (!wakeLock) return;

    try {
      if (!wakeLock.released) {
        await wakeLock.release();
      }
    } catch {
      // Wake lock release can fail in background or unsupported contexts.
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!isActiveRef.current) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;

    const wakeLockApi = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLockApi?.request) return;

    if (wakeLockRef.current && !wakeLockRef.current.released) return;

    try {
      const wakeLock = await wakeLockApi.request('screen');
      wakeLockRef.current = wakeLock;

      wakeLock.addEventListener('release', () => {
        if (wakeLockRef.current === wakeLock) {
          wakeLockRef.current = null;
        }

        if (isActiveRef.current && document.visibilityState === 'visible') {
          void requestWakeLock();
        }
      });
    } catch {
      // Unsupported/browser-policy failure (e.g. low power mode); fail silently.
    }
  }, []);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (isActive) {
      void requestWakeLock();
      return;
    }

    void releaseWakeLock();
  }, [isActive, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (isActiveRef.current) {
          void requestWakeLock();
        }
        return;
      }

      void releaseWakeLock();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [releaseWakeLock, requestWakeLock]);
};
