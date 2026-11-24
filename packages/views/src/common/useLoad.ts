import { toErrorMessage } from "@mdcz/shared/error";
import { useEffect, useRef, useState } from "react";

/**
 * Loads what a view shows for `key`, and loads again when it changes; a null key loads nothing. An answer for an older
 * key, or for a view that has gone, is ignored. `delayMs` lets a key still being typed settle first.
 */
export function useLoad<T>(load: () => Promise<T>, key: string | null, delayMs = 0) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string; latest?: T } | null>(null);
  const loadKey = key === null ? null : `${attempt}:${key}`;
  useEffect(() => {
    if (loadKey === null) return;
    let current = true;
    const timer = setTimeout(() => {
      loadRef.current().then(
        (data) => current && setState({ key: loadKey, data, latest: data }),
        (error) =>
          current && setState((previous) => ({ key: loadKey, error: toErrorMessage(error), latest: previous?.latest })),
      );
    }, delayMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [loadKey, delayMs]);
  const loaded = state?.key === loadKey ? state : null;
  return {
    /** The answer for the current key; undefined while it loads. */
    data: loaded?.data,
    /** The newest answer for any key, for a view that keeps showing it while the next one loads. */
    latest: state?.latest,
    error: loaded?.error ?? null,
    loading: loadKey !== null && !loaded,
    reload: () => setAttempt((count) => count + 1),
  };
}
