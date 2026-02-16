'use client';

import { usePWAInstall } from '@/contexts/PWAInstallContext';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiCheckCircle,
  FiDownload,
  FiMenu,
  FiMoreHorizontal,
  FiMoreVertical,
  FiPlusSquare,
  FiShare2,
} from 'react-icons/fi';
import type { IconType } from 'react-icons';

const INSTALLER_HIDE_KEY = 'meera_pwa_installed_or_accepted';

type MobileBrowser =
  | 'ios_safari'
  | 'ios_chrome'
  | 'ios_edge'
  | 'ios_firefox'
  | 'ios_opera'
  | 'android_chrome'
  | 'android_edge'
  | 'android_firefox'
  | 'android_opera'
  | 'android_samsung'
  | 'unknown';

interface InstallStep {
  icon: IconType;
  text: string;
}

interface InstallGuide {
  title: string;
  steps: InstallStep[];
}

const detectMobileBrowser = (): MobileBrowser => {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const ua = navigator.userAgent.toLowerCase();
  const isIOSDevice = /iphone|ipad|ipod/.test(ua);
  const isAndroidDevice = /android/.test(ua);

  if (isIOSDevice) {
    if (ua.includes('crios')) return 'ios_chrome';
    if (ua.includes('edgios')) return 'ios_edge';
    if (ua.includes('fxios')) return 'ios_firefox';
    if (ua.includes('opios')) return 'ios_opera';
    if (ua.includes('safari')) return 'ios_safari';
  }

  if (isAndroidDevice) {
    if (ua.includes('samsungbrowser')) return 'android_samsung';
    if (ua.includes('edga') || ua.includes(' edg/')) return 'android_edge';
    if (ua.includes('firefox')) return 'android_firefox';
    if (ua.includes('opr') || ua.includes('opera')) return 'android_opera';
    if (ua.includes('chrome') || ua.includes('chromium')) return 'android_chrome';
  }

  return 'unknown';
};

const getInstallGuide = (browser: MobileBrowser, isIOS: boolean): InstallGuide => {
  switch (browser) {
    case 'ios_safari':
      return {
        title: 'Install in Safari',
        steps: [
          { icon: FiShare2, text: 'Tap the Share icon.' },
          { icon: FiPlusSquare, text: 'Choose "Add to Home Screen".' },
          { icon: FiCheckCircle, text: 'Tap "Add".' },
        ],
      };
    case 'ios_chrome':
      return {
        title: 'Install in Chrome',
        steps: [
          { icon: FiShare2, text: 'Tap the Share icon in Chrome.' },
          { icon: FiPlusSquare, text: 'Choose "Add to Home Screen".' },
          { icon: FiCheckCircle, text: 'Tap "Add".' },
        ],
      };
    case 'ios_edge':
      return {
        title: 'Install in Edge',
        steps: [
          { icon: FiMoreHorizontal, text: 'Tap the menu (•••).' },
          { icon: FiShare2, text: 'Tap Share, then "Add to Home Screen".' },
          { icon: FiCheckCircle, text: 'Tap "Add".' },
        ],
      };
    case 'ios_firefox':
      return {
        title: 'Install in Firefox',
        steps: [
          { icon: FiMoreHorizontal, text: 'Tap the menu (•••).' },
          { icon: FiShare2, text: 'Tap Share, then "Add to Home Screen".' },
          { icon: FiCheckCircle, text: 'Tap "Add".' },
        ],
      };
    case 'ios_opera':
      return {
        title: 'Install in Opera',
        steps: [
          { icon: FiMoreHorizontal, text: 'Tap the browser menu.' },
          { icon: FiShare2, text: 'Open Share, then tap "Add to Home Screen".' },
          { icon: FiCheckCircle, text: 'Tap "Add".' },
        ],
      };
    case 'android_chrome':
      return {
        title: 'Install in Chrome',
        steps: [
          { icon: FiMoreVertical, text: 'Tap the menu (⋮).' },
          { icon: FiDownload, text: 'Tap "Install app" or "Add to Home screen".' },
          { icon: FiCheckCircle, text: 'Confirm install.' },
        ],
      };
    case 'android_edge':
      return {
        title: 'Install in Edge',
        steps: [
          { icon: FiMoreHorizontal, text: 'Tap the menu (•••).' },
          { icon: FiDownload, text: 'Tap "Install app" or "Add to phone".' },
          { icon: FiCheckCircle, text: 'Confirm install.' },
        ],
      };
    case 'android_firefox':
      return {
        title: 'Install in Firefox',
        steps: [
          { icon: FiMoreVertical, text: 'Tap the menu (⋮).' },
          { icon: FiPlusSquare, text: 'Tap "Install" or "Add to Home screen".' },
          { icon: FiCheckCircle, text: 'Confirm install.' },
        ],
      };
    case 'android_opera':
      return {
        title: 'Install in Opera',
        steps: [
          { icon: FiMenu, text: 'Open the Opera menu.' },
          { icon: FiDownload, text: 'Tap "Install app" or "Add to Home screen".' },
          { icon: FiCheckCircle, text: 'Confirm install.' },
        ],
      };
    case 'android_samsung':
      return {
        title: 'Install in Samsung Internet',
        steps: [
          { icon: FiMenu, text: 'Tap the menu (≡).' },
          { icon: FiPlusSquare, text: 'Tap "Add page to" then "Home screen".' },
          { icon: FiCheckCircle, text: 'Confirm install.' },
        ],
      };
    default:
      if (isIOS) {
        return {
          title: 'Install on iPhone',
          steps: [
            { icon: FiShare2, text: 'Tap Share in your browser.' },
            { icon: FiPlusSquare, text: 'Choose "Add to Home Screen".' },
            { icon: FiCheckCircle, text: 'Tap "Add".' },
          ],
        };
      }
      return {
        title: 'Install on your phone',
        steps: [
          { icon: FiMenu, text: 'Open your browser menu.' },
          { icon: FiDownload, text: 'Tap "Install app" or "Add to Home screen".' },
          { icon: FiCheckCircle, text: 'Confirm install.' },
        ],
      };
  }
};

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
  const [mobileBrowser, setMobileBrowser] = useState<MobileBrowser>('unknown');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsStandalone(isStandaloneMode());
    setIsHidden(localStorage.getItem(INSTALLER_HIDE_KEY) === '1');
    setMobileBrowser(detectMobileBrowser());
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

  const installGuide = useMemo(() => getInstallGuide(mobileBrowser, isIOS), [isIOS, mobileBrowser]);

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
          <p className="text-[15px] font-semibold">{installGuide.title}</p>
          <div className="mt-2 space-y-1.5 text-primary/85">
            {installGuide.steps.map(({ icon: StepIcon, text }) => (
              <p key={text} className="flex items-start gap-2 leading-snug">
                <StepIcon size={14} className="mt-0.5 shrink-0 text-primary/70" />
                <span>{text}</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
