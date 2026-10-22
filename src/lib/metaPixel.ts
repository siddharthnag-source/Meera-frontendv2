export const META_PIXEL_ID = '933654956266333';

// Never load marketing code on OAuth callbacks, dashboards, or conversation URLs.
// Restrict campaign values too: links carrying emails or arbitrary text are excluded.
export function isMarketingPage(pathname: string, search: string, hash: string): boolean {
  if (!['/', '/sign-in'].includes(pathname) || hash) return false;
  const allowedKeys = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gl']);
  return Array.from(new URLSearchParams(search)).every(
    ([key, value]) => allowedKeys.has(key) && /^[a-zA-Z0-9_-]{1,500}$/.test(value),
  );
}

type Pixel = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Pixel;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Pixel;
    _fbq?: Pixel;
    meeraMetaPixelInitialized?: boolean;
  }
}

export function initializeMetaPixel(): Pixel {
  if (!window.fbq) {
    const pixel = function (...args: unknown[]) {
      if (pixel.callMethod) pixel.callMethod(...args);
      else pixel.queue.push(args);
    } as Pixel;
    pixel.queue = [];
    pixel.push = pixel;
    pixel.loaded = true;
    pixel.version = '2.0';
    window.fbq = pixel;
    window._fbq = pixel;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }
  if (!window.meeraMetaPixelInitialized) {
    // Disable automatic button/form detection and automatic matching. No chat,
    // email, name, or other profile fields are included in the explicit events.
    window.fbq('set', 'autoConfig', false, META_PIXEL_ID);
    window.fbq('init', META_PIXEL_ID);
    window.meeraMetaPixelInitialized = true;
  }
  return window.fbq;
}
