'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiDownload } from 'react-icons/fi';
import { usePWAInstall } from '@/contexts/PWAInstallContext';

const INSTALLER_HIDE_KEY = 'meera_pwa_installed_or_accepted';
const PWA_INSTALL_SCRIPT_ID = 'pwa-install-script';
const PWA_INSTALL_SCRIPT_SRC = 'https://unpkg.com/@khmyznikov/pwa-install@0.6.3/dist/pwa-install.bundle.js';

type PWAInstallElement = HTMLElement & {
  showDialog?: () => void;
  install?: () => void;
  externalPromptEvent?: Event | null;
};

const isStandaloneMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
};

const loadPWAInstallScript = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.customElements.get('pwa-install')) return Promise.resolve();

  const existingScript = document.getElementById(PWA_INSTALL_SCRIPT_ID) as HTMLScriptElement | null;
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load pwa-install script')), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = PWA_INSTALL_SCRIPT_ID;
    script.src = PWA_INSTALL_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load pwa-install script'));
    document.head.appendChild(script);
  });
};

export const PWAInstallEntry: React.FC = () => {
  const { installPrompt, handleInstallClick: fallbackInstallClick } = usePWAInstall();
  const installerRef = useRef<PWAInstallElement | null>(null);
  const [isInstallerReady, setIsInstallerReady] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isHidden, setIsHidden] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsStandalone(isStandaloneMode());
    setIsHidden(localStorage.getItem(INSTALLER_HIDE_KEY) === '1');

    let active = true;
    loadPWAInstallScript()
      .then(() => {
        if (active) setIsInstallerReady(true);
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncStandalone = () => {
      setIsStandalone(isStandaloneMode());
    };

    const onInstalled = () => {
      localStorage.setItem(INSTALLER_HIDE_KEY, '1');
      setIsHidden(true);
      setIsStandalone(true);
    };

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncStandalone);
    } else {
      mediaQuery.addListener(syncStandalone);
    }

    window.addEventListener('focus', syncStandalone);
    document.addEventListener('visibilitychange', syncStandalone);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', syncStandalone);
      } else {
        mediaQuery.removeListener(syncStandalone);
      }
      window.removeEventListener('focus', syncStandalone);
      document.removeEventListener('visibilitychange', syncStandalone);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    const installer = installerRef.current;
    if (!installer) return;

    const hideOption = () => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(INSTALLER_HIDE_KEY, '1');
      }
      setIsHidden(true);
    };

    const onInstallSuccess = () => {
      hideOption();
    };

    const onChoiceResult = (event: Event) => {
      const customEvent = event as CustomEvent<{ outcome?: string; userChoiceResult?: string; message?: string }>;
      const detail = customEvent.detail || {};
      const outcome = detail.outcome || detail.userChoiceResult || '';
      const message = (detail.message || '').toLowerCase();

      if (outcome === 'accepted' || message.includes('accepted')) {
        hideOption();
      }
    };

    installer.addEventListener('pwa-install-success-event', onInstallSuccess as EventListener);
    installer.addEventListener('pwa-user-choice-result-event', onChoiceResult as EventListener);

    return () => {
      installer.removeEventListener('pwa-install-success-event', onInstallSuccess as EventListener);
      installer.removeEventListener('pwa-user-choice-result-event', onChoiceResult as EventListener);
    };
  }, [isInstallerReady]);

  useEffect(() => {
    const installer = installerRef.current;
    if (!installer || !installPrompt) return;
    installer.externalPromptEvent = installPrompt;
  }, [installPrompt, isInstallerReady]);

  const handleInstallTap = useCallback(() => {
    const installer = installerRef.current;
    if (installer?.showDialog) {
      installer.showDialog();
      return;
    }
    if (installer?.install) {
      installer.install();
      return;
    }
    fallbackInstallClick();
  }, [fallbackInstallClick]);

  if (!isInstallerReady || isStandalone || isHidden) {
    return (
      <pwa-install
        ref={installerRef}
        className="absolute w-0 h-0 overflow-hidden pointer-events-none"
        manual-apple
        manual-chrome
        use-local-storage
        manifest-url="/manifest.json"
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleInstallTap}
        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] font-semibold text-primary hover:bg-primary/10 transition-colors"
        aria-label="Install app"
      >
        <FiDownload size={17} />
        <span>Install app</span>
      </button>

      <pwa-install
        ref={installerRef}
        className="absolute w-0 h-0 overflow-hidden pointer-events-none"
        manual-apple
        manual-chrome
        use-local-storage
        manifest-url="/manifest.json"
      />
    </>
  );
};
