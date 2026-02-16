'use client';

import { usePWAInstall } from '@/contexts/PWAInstallContext';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiDownload, FiPlusSquare, FiShare2 } from 'react-icons/fi';

const INSTALLER_HIDE_KEY = 'meera_pwa_installed_or_accepted';

const isStandaloneMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
};

const markInstalled = (setHidden: (value: boolean) => void) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(INSTALLER_HIDE_KEY, '1');
  }
  setHidden(true);
};

export const PWAInstallEntry: React.FC = () => {
  const { installPrompt, isIOS, handleInstallClick } = usePWAInstall();
  const [isHidden, setIsHidden] = useState(true);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsStandalone(isStandaloneMode());
    setIsHidden(localStorage.getItem(INSTALLER_HIDE_KEY) === '1');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncStandalone = () => {
      const standalone = isStandaloneMode();
      setIsStandalone(standalone);
      if (standalone) {
        markInstalled(setIsHidden);
      }
    };

    const onInstalled = () => {
      markInstalled(setIsHidden);
      setIsStandalone(true);
      setShowHowTo(false);
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

  const helpText = useMemo(() => {
    if (isIOS) {
      return [
        'Tap the Share icon in Safari.',
        'Choose "Add to Home Screen".',
        'Tap "Add" to install.',
      ];
    }
    return [
      'Open your browser menu.',
      'Choose "Install app" or "Add to Home Screen".',
      'Confirm install.',
    ];
  }, [isIOS]);

  const handleInstallTap = useCallback(() => {
    if (installPrompt) {
      handleInstallClick();
      return;
    }
    setShowHowTo((prev) => !prev);
  }, [handleInstallClick, installPrompt]);

  if (isHidden || isStandalone) {
    return null;
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleInstallTap}
        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] font-semibold text-primary hover:bg-primary/10 transition-colors"
        aria-label="Install app"
      >
        <FiDownload size={17} />
        <span>Install app</span>
      </button>

      {showHowTo ? (
        <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-sm text-primary">
          <p className="font-medium">Install on your phone</p>
          <div className="mt-2 space-y-1.5 text-primary/80">
            <p className="flex items-start gap-2">
              <FiShare2 size={14} className="mt-0.5 shrink-0 text-primary/70" />
              <span>{helpText[0]}</span>
            </p>
            <p className="flex items-start gap-2">
              <FiPlusSquare size={14} className="mt-0.5 shrink-0 text-primary/70" />
              <span>{helpText[1]}</span>
            </p>
            <p className="pl-6">{helpText[2]}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

