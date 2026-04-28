import type {
  ActiveCooldown,
  CooldownFailurePolicy,
  PersistentCooldownStore,
} from "@main/services/cooldown/PersistentCooldownStore";

interface DownloadLogger {
  info(message: string): void;
  warn(message: string): void;
}

const IMAGE_HOST_COOLDOWN_MS = 5 * 60 * 1000;
const IMAGE_HOST_FAILURE_POLICY: CooldownFailurePolicy = {
  threshold: 2,
  windowMs: IMAGE_HOST_COOLDOWN_MS,
  cooldownMs: IMAGE_HOST_COOLDOWN_MS,
};
const IMAGE_HOST_COOLDOWN_STATUS_CODES = new Set([408, 429]);

const formatCooldownDetails = (cooldownUntil: number, remainingMs: number): string =>
  `${remainingMs}ms remaining until ${new Date(cooldownUntil).toISOString()}`;

const parseHttpStatus = (message?: string): number | null => {
  const match = message?.match(/\bHTTP (\d{3})\b/u);
  if (!match) {
    return null;
  }

  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
};

const shouldRecordImageHostFailure = (status?: number, reason?: string): boolean => {
  const resolvedStatus = typeof status === "number" && status > 0 ? status : parseHttpStatus(reason);
  if (resolvedStatus === null) {
    return true;
  }

  return IMAGE_HOST_COOLDOWN_STATUS_CODES.has(resolvedStatus) || resolvedStatus >= 500;
};

export const normalizeUrl = (input?: string): string | null => {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return null;
};

export const getUrlHost = (url: string): string | null => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

export class ImageHostCooldownTracker {
  private readonly loggedCooldownUntilByImageHost = new Map<string, number>();

  constructor(
    private readonly store: PersistentCooldownStore,
    private readonly logger: DownloadLogger,
  ) {}

  filterUrls(urls: string[]): string[] {
    return urls.filter((url) => !this.shouldSkipUrl(url));
  }

  shouldSkipUrl(url: string): boolean {
    const cooldownState = this.getActiveCooldown(url);
    if (!cooldownState) {
      const host = getUrlHost(url);
      if (host) {
        this.clearLoggedCooldown(host);
      }
      return false;
    }

    this.logCooldownSkip(url, cooldownState.host, cooldownState.activeCooldown);
    return true;
  }

  reset(url: string): void {
    const host = getUrlHost(url);
    if (!host) {
      return;
    }

    this.clearLoggedCooldown(host);
    this.store.reset(host);
  }

  recordFailure(url: string, reason?: string, status?: number): void {
    const host = getUrlHost(url);
    if (!host || this.store.isCoolingDown(host) || !shouldRecordImageHostFailure(status, reason)) {
      return;
    }

    const state = this.store.recordFailure(host, IMAGE_HOST_FAILURE_POLICY);
    if (state?.cooldownUntil) {
      this.logger.warn(
        `Image host cooldown opened for ${host} for ${IMAGE_HOST_COOLDOWN_MS}ms (${formatCooldownDetails(
          state.cooldownUntil,
          Math.max(0, state.cooldownUntil - Date.now()),
        )}) after ${state.failureCount} failures (${reason ?? "request failed"})`,
      );
    }
  }

  private getActiveCooldown(url: string): { host: string; activeCooldown: ActiveCooldown } | null {
    const host = getUrlHost(url);
    if (!host) {
      return null;
    }

    const activeCooldown = this.store.getActiveCooldown(host);
    return activeCooldown ? { host, activeCooldown } : null;
  }

  private logCooldownSkip(url: string, host: string, activeCooldown: ActiveCooldown): void {
    if (this.loggedCooldownUntilByImageHost.get(host) === activeCooldown.cooldownUntil) {
      return;
    }

    this.loggedCooldownUntilByImageHost.set(host, activeCooldown.cooldownUntil);
    this.logger.info(
      `Skipping ${url}: image host cooldown active for ${host} (${formatCooldownDetails(
        activeCooldown.cooldownUntil,
        activeCooldown.remainingMs,
      )})`,
    );
  }

  private clearLoggedCooldown(host: string): void {
    this.loggedCooldownUntilByImageHost.delete(host);
  }
}
