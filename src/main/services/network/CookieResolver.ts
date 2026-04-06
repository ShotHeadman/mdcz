import { BrowserWindow, type Cookie, type Event } from "electron";
import { filterCookiesForUrl, normalizeCookieDomain, normalizeCookiePath } from "./cookieUtils";

export interface ResolvedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export type CookieResolver = (url: string) => Promise<ResolvedCookie[]>;

export interface ElectronCookieResolverOptions {
  timeoutMs?: number;
  expectedCookieNames?: string[];
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const COOKIE_POLL_INTERVAL_MS = 250;

let resolverSequence = 0;

const toResolvedCookie = (cookie: Cookie): ResolvedCookie => ({
  name: cookie.name,
  value: cookie.value,
  domain: normalizeCookieDomain(cookie.domain ?? ""),
  path: normalizeCookiePath(cookie.path),
});

const createResolverPartition = (): string => {
  resolverSequence += 1;
  return `mdcz-cookie-resolver-${process.pid}-${Date.now()}-${resolverSequence}`;
};

const closeWindow = (browserWindow: BrowserWindow): void => {
  if (browserWindow.isDestroyed()) {
    return;
  }
  browserWindow.destroy();
};

const waitForResolvedCookies = (
  browserWindow: BrowserWindow,
  url: string,
  options: Required<Pick<ElectronCookieResolverOptions, "timeoutMs">> &
    Pick<ElectronCookieResolverOptions, "expectedCookieNames">,
): Promise<ResolvedCookie[]> => {
  const targetUrl = new URL(url);
  const cookieLookupUrl = new URL(url);
  cookieLookupUrl.hash = "";
  const expectedCookieNames = new Set((options.expectedCookieNames ?? []).map((name) => name.trim()).filter(Boolean));

  return new Promise<ResolvedCookie[]>((resolve, reject) => {
    let settled = false;
    let pollInFlight = false;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      clearInterval(intervalHandle);
      browserWindow.webContents.removeListener("did-fail-load", handleLoadFailure);
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const pollCookies = async () => {
      if (pollInFlight || settled) {
        return;
      }
      pollInFlight = true;

      try {
        const cookies = await browserWindow.webContents.session.cookies.get({ url: cookieLookupUrl.toString() });
        const resolvedCookies = filterCookiesForUrl(cookies.map(toResolvedCookie), targetUrl);
        const hasExpectedCookie =
          expectedCookieNames.size > 0 && resolvedCookies.some((cookie) => expectedCookieNames.has(cookie.name));

        if (resolvedCookies.length > 0 && (expectedCookieNames.size === 0 || hasExpectedCookie)) {
          finish(() => resolve(resolvedCookies));
        }
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      } finally {
        pollInFlight = false;
      }
    };

    const handleLoadFailure = (
      _event: Event,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) {
        return;
      }
      finish(() =>
        reject(
          new Error(
            `Cookie resolver failed for ${validatedUrl || url}: ${errorDescription || "unknown error"} (${errorCode})`,
          ),
        ),
      );
    };

    const timeoutHandle = setTimeout(() => {
      const expectation =
        expectedCookieNames.size > 0 ? `expected cookies ${Array.from(expectedCookieNames).join(", ")}` : "cookies";
      finish(() => reject(new Error(`Timed out waiting for ${expectation} at ${url}`)));
    }, options.timeoutMs);

    const intervalHandle = setInterval(() => {
      void pollCookies();
    }, COOKIE_POLL_INTERVAL_MS);

    browserWindow.webContents.on("did-fail-load", handleLoadFailure);

    void pollCookies();
  });
};

export const createElectronCookieResolver = (options: ElectronCookieResolverOptions = {}): CookieResolver => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (url: string): Promise<ResolvedCookie[]> => {
    const browserWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: createResolverPartition(),
        backgroundThrottling: false,
        contextIsolation: true,
        javascript: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    try {
      void browserWindow.webContents
        .loadURL(url, options.userAgent ? { userAgent: options.userAgent } : undefined)
        .catch(() => undefined);

      return await waitForResolvedCookies(browserWindow, url, {
        timeoutMs,
        expectedCookieNames: options.expectedCookieNames,
      });
    } finally {
      closeWindow(browserWindow);
    }
  };
};
