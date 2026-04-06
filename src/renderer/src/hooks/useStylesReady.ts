import { useEffect, useState } from "react";

export const useStylesReady = (cssVariable = "--card", timeoutMs = 2500) => {
  const [stylesReady, setStylesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = performance.now();

    const checkStyles = () => {
      if (cancelled) {
        return;
      }

      const now = performance.now();
      const computed = getComputedStyle(document.documentElement);
      const hasStyles = computed.getPropertyValue(cssVariable).trim().length > 0;

      if (hasStyles || now - start >= timeoutMs) {
        setStylesReady(true);
        return;
      }

      requestAnimationFrame(checkStyles);
    };

    checkStyles();

    return () => {
      cancelled = true;
    };
  }, [cssVariable, timeoutMs]);

  return stylesReady;
};
