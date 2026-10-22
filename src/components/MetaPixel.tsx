'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { initializeMetaPixel, isMarketingPage, META_PIXEL_ID } from '@/lib/metaPixel';
import { META_REGISTRATION_PENDING_KEY } from '@/lib/marketingRegistration';

export default function MetaPixel() {
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    if (!isMarketingPage(pathname, window.location.search, window.location.hash)) return;
    const pixel = initializeMetaPixel();
    const page = pathname + window.location.search;
    if (lastPage.current !== page) {
      pixel('trackSingle', META_PIXEL_ID, 'PageView');
      lastPage.current = page;
    }
    if (pathname !== '/') return;
    try {
      const pending = sessionStorage.getItem(META_REGISTRATION_PENDING_KEY);
      if (!pending || !/^[a-f0-9-]{36}$/.test(pending)) return;
      pixel('trackSingle', META_PIXEL_ID, 'CompleteRegistration', {}, { eventID: pending });
      sessionStorage.removeItem(META_REGISTRATION_PENDING_KEY);
    } catch {
      // Storage restrictions/ad blockers must not interrupt the product.
    }
  }, [pathname]);

  return null;
}
