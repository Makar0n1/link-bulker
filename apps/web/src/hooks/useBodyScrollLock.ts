'use client';

import { useEffect } from 'react';

/**
 * Lock the document body scroll while a modal/dialog is open.
 *
 * Why we save and restore the original `overflow` value instead of just
 * setting and clearing it: another component (or the user via dev tools)
 * might have set it for their own reasons. We respect whatever was there
 * before we touched it.
 *
 * Multiple simultaneous locks are reference-counted by the
 * `data-scroll-lock-count` attribute on <body>, so closing one modal while
 * another is still open does not unlock the page.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const current = Number(body.dataset.scrollLockCount ?? '0');
    body.dataset.scrollLockCount = String(current + 1);

    if (current === 0) {
      body.dataset.scrollLockOriginalOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
    }

    return () => {
      const next = Number(body.dataset.scrollLockCount ?? '1') - 1;
      if (next <= 0) {
        delete body.dataset.scrollLockCount;
        body.style.overflow = body.dataset.scrollLockOriginalOverflow ?? '';
        delete body.dataset.scrollLockOriginalOverflow;
      } else {
        body.dataset.scrollLockCount = String(next);
      }
    };
  }, [active]);
}
