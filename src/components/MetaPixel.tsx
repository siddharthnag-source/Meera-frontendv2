'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { initializeMetaPixel, isMarketingPage, META_PIXEL_ID } from '@/lib/metaPixel';
import { isNewRegistration } from '@/lib/marketingRegistration';
import { captureMarketingTouch } from '@/lib/captureMarketingTouch';
import { dispatchPendingMarketingEvents, queueMarketingEvent } from '@/lib/marketingEvents';

export default function MetaPixel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    void captureMarketingTouch();
    if (!isMarketingPage(pathname, window.location.search, window.location.hash)) return;
    const pixel = initializeMetaPixel();
    const page = pathname + window.location.search;
    if (lastPage.current !== page) {
      pixel('trackSingle', META_PIXEL_ID, 'PageView');
      lastPage.current = page;
    }
    let cancelled = false;
    let attempts = 0;
    const flush = () => {
      if (!cancelled) {
        initializeMetaPixel();
        dispatchPendingMarketingEvents();
      }
    };
    flush();
    // Wait for the actual SDK, including a slow connection. Pending events are
    // retained if the SDK is blocked; an online/navigation retry can resume.
    const timer = setInterval(() => {
      flush();
      if (++attempts >= 30) clearInterval(timer);
    }, 1000);
    window.addEventListener('online', flush);

    const controller = new AbortController();
    const recoverRegistration = async () => {
      const { supabase } = await import('@/lib/supabaseClient');
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session || !isNewRegistration(data.session.user)) return;
      const response = await fetch('/api/analytics/meta-registration', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok || cancelled) return;
      const result = await response.json();
      if (result.eligible && typeof result.eventId === 'string') {
        queueMarketingEvent({ name: 'CompleteRegistration', eventId: result.eventId });
      }
    };
    void recoverRegistration().catch(() => { /* Retry on the next eligible route. */ });
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [pathname, search]);

  return null;
}
