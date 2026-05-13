import { useRef, useCallback } from 'react';

/**
 * Returns a debounced version of `fn` that only fires after `delay` ms have
 * passed since the last call.  Trailing-edge semantics: the function fires
 * after the user stops triggering it.
 *
 * The returned callback is stable and always calls the latest version of `fn`.
 */
export function useDebouncedCallback(fn, delay) {
  const timerRef = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay],
  );
}
