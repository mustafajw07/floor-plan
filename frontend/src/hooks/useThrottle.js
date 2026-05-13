import { useRef, useCallback } from 'react';

/**
 * Returns a throttled version of `fn` that fires at most once per `limit` ms.
 * Uses leading-edge semantics: fires immediately on first call, then ignores
 * subsequent calls until the limit window passes.
 *
 * The returned callback is stable (won't change on re-renders) and always
 * calls the latest version of `fn`.
 */
export function useThrottle(fn, limit) {
  const lastRanRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args) => {
      const now = Date.now();
      if (now - lastRanRef.current >= limit) {
        lastRanRef.current = now;
        fnRef.current(...args);
      }
    },
    [limit],
  );
}
