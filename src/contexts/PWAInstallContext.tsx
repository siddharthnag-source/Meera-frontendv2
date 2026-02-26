'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PWAInstallContextType {
  installPrompt: BeforeInstallPromptEvent | null;
  isStandalone: boolean;
  isIOS: boolean;
  handleInstallClick: () => void;
}

const PWAInstallContext = createContext<PWAInstallContextType | undefined>(undefined);
const SW_CLEANUP_RELOAD_KEY = 'sw_cleanup_reload_done_v1';

export const usePWAInstall = () => {
  const context = useContext(PWAInstallContext);
  if (context === undefined) {
    throw new Error('usePWAInstall must be used within a PWAInstallProvider');
  }
  return context;
};

export const PWAInstallProvider = ({ children }: { children: ReactNode }) => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const cleanupLegacyServiceWorkers = async () => {
      if (!('serviceWorker' in navigator)) return;

      const hadController = Boolean(navigator.serviceWorker.controller);

      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch (error) {
        console.error('Failed to unregister service workers:', error);
      }

      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        } catch (error) {
          console.error('Failed to clear caches:', error);
        }
      }

      if (!hadController) {
        try {
          sessionStorage.removeItem(SW_CLEANUP_RELOAD_KEY);
        } catch {
          // ignore storage failures
        }
        return;
      }

      try {
        const hasReloadedForCleanup = sessionStorage.getItem(SW_CLEANUP_RELOAD_KEY) === '1';
        if (!hasReloadedForCleanup) {
          sessionStorage.setItem(SW_CLEANUP_RELOAD_KEY, '1');
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    };

    void cleanupLegacyServiceWorkers();

    if (typeof window !== 'undefined') {
      setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);
      setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = () => {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the A2HS prompt');
        } else {
          console.log('User dismissed the A2HS prompt');
        }
        setInstallPrompt(null);
      });
    } else if (isIOS) {
      alert("To install, tap the share button and then 'Add to Home Screen'.");
    }
  };

  const value = {
    installPrompt,
    isStandalone,
    isIOS,
    handleInstallClick,
  };

  return <PWAInstallContext.Provider value={value}>{children}</PWAInstallContext.Provider>;
};
