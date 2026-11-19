import { setTimeout as delay } from "node:timers/promises";

const QUIT_LOCALE_TIMEOUT_MS = 300;

export const resolveQuitDialogLocale = async (
  systemLocale: string,
  readPageLocale?: () => Promise<unknown>,
): Promise<{ locale: "en" | "zh"; rendererResponded: boolean }> => {
  // The renderer may be frozen when the user tries to quit.
  let pageLocale: unknown;
  if (readPageLocale) {
    const timer = new AbortController();
    try {
      pageLocale = await Promise.race([
        Promise.resolve()
          .then(readPageLocale)
          .catch(() => undefined),
        delay(QUIT_LOCALE_TIMEOUT_MS, undefined, { ref: false, signal: timer.signal }),
      ]);
    } finally {
      timer.abort();
    }
  }
  const locale = typeof pageLocale === "string" && pageLocale ? pageLocale : systemLocale;
  return {
    locale: locale.toLowerCase().startsWith("zh") ? "zh" : "en",
    rendererResponded: typeof pageLocale === "string",
  };
};

/**
 * Holds a quit while a task is doing work until the user confirms it. `hold` answers whether the quit may go ahead
 * now; when it may not, it asks once and calls `proceed` after the user agrees, after which every later quit passes.
 */
export const createQuitGuard = ({
  taskRunning,
  confirm,
}: {
  taskRunning: () => boolean;
  confirm: () => Promise<boolean>;
}): ((proceed: () => void) => boolean) => {
  let confirmed = false;
  let asking = false;
  return (proceed) => {
    if (confirmed || !taskRunning()) return true;
    if (asking) return false;
    asking = true;
    void confirm().then((agreed) => {
      asking = false;
      if (!agreed) return;
      confirmed = true;
      proceed();
    });
    return false;
  };
};
