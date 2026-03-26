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

const RUNTIME_MIGRATION_STORAGE_KEY = 'meera_runtime_migration_2026_03_26_auth_fix_v1';
const STALE_CACHE_MARKERS = ['meera-os-cache', 'workbox', '-precache-', '-runtime-'];

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

    const runRuntimeMigration = async () => {
      let changedRuntimeArtifacts = false;

      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          if (registrations.length > 0) {
            changedRuntimeArtifacts = true;
          }
          await Promise.all(registrations.map((registration) => registration.unregister()));
        } catch (error) {
          console.warn('Service worker cleanup failed:', error);
        }
      }

      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          const staleKeys = keys.filter((key) => STALE_CACHE_MARKERS.some((marker) => key.includes(marker)));
          if (staleKeys.length > 0) {
            changedRuntimeArtifacts = true;
          }
          await Promise.all(staleKeys.map((key) => caches.delete(key)));
        } catch (error) {
          console.warn('Cache cleanup failed:', error);
        }
      }

      if (!changedRuntimeArtifacts) return;

      try {
        if (window.sessionStorage.getItem(RUNTIME_MIGRATION_STORAGE_KEY) === 'done') {
          return;
        }
        window.sessionStorage.setItem(RUNTIME_MIGRATION_STORAGE_KEY, 'done');
      } catch {
        // Ignore sessionStorage errors and continue without forced refresh.
        return;
      }

      console.info('[runtime_migration] cleaned service worker artifacts, refreshing once');
      window.location.replace(window.location.href);
    };

    void runRuntimeMigration();

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
