import type { MediaLibraryService } from "@mdcz/runtime/library";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type { IntegrationStatusResponse } from "@mdcz/shared/serverDtos";
import { type AutomationService, applyPathMappings } from "./automationService";
import type { ServerConfigService } from "./configService";
import type { ServerPersistenceService } from "./persistenceService";
import type { RuntimeLogService } from "./runtimeLogService";

const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type QbittorrentSettings = Configuration["automation"]["qbittorrent"];
type QbittorrentStatus = IntegrationStatusResponse["qbittorrent"];

interface CompletedTorrent {
  hash: string;
  name: string;
  /** qBittorrent 4.3.1+: the file of a single-file torrent, otherwise its root folder. */
  content_path?: string;
  /** Unix seconds. */
  completion_on: number;
}

const idleStatus = (): QbittorrentStatus => ({
  configured: false,
  lastPollAt: null,
  error: null,
  library: null,
  failures: [],
});

/**
 * Takes completed torrents from one qBittorrent category, the way Sonarr and MoviePilot do, so no script has to run
 * inside the downloader's container. qBittorrent's completion flag is authoritative, unlike a watched folder where a
 * stalled download looks finished. Every torrent goes through the downloader callback's path.
 */
export class QbittorrentService {
  #timer?: ReturnType<typeof setTimeout>;
  #polling?: Promise<void>;
  #pollAgain = false;
  #closed = false;
  #started = false;
  #unsubscribe?: () => void;
  #session?: { credentials: string; cookie: string };
  #status = idleStatus();
  /** Torrents that could not be scraped, by hash; they are retried on every poll and logged once per error. */
  readonly #failures = new Map<string, { name: string; error: string }>();

  constructor(
    private readonly deps: {
      config: Pick<ServerConfigService, "get" | "onChange">;
      automation: Pick<AutomationService, "scrapeStart">;
      libraries: Pick<MediaLibraryService, "findBySourcePath">;
      persistence: Pick<ServerPersistenceService, "getState">;
      logger: ReturnType<RuntimeLogService["getLogger"]>;
    },
  ) {}

  start(): void {
    this.#started = true;
    // Settings autosave per field; polling at once shows whether the connection works.
    this.#unsubscribe = this.deps.config.onChange(() => this.schedule(0));
    this.schedule(0);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#unsubscribe?.();
    clearTimeout(this.#timer);
    await this.#polling;
  }

  /** Polls again now, e.g. after the libraries changed under the category's save path. */
  refresh(): void {
    if (this.#started) this.schedule(0);
  }

  status(): QbittorrentStatus {
    return this.#status;
  }

  private schedule(delayMs: number): void {
    if (this.#closed) return;
    if (this.#polling) {
      this.#pollAgain ||= delayMs === 0;
      return;
    }
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#polling = this.poll().finally(() => {
        this.#polling = undefined;
        const again = this.#pollAgain;
        this.#pollAgain = false;
        this.schedule(again ? 0 : POLL_INTERVAL_MS);
      });
    }, delayMs);
    this.#timer.unref();
  }

  private async poll(): Promise<void> {
    const { qbittorrent: settings, pathMappings } = (await this.deps.config.get()).automation;
    if (!settings.url || !settings.category) {
      this.#status = idleStatus();
      this.#failures.clear();
      return;
    }
    const lastPollAt = new Date().toISOString();
    try {
      const categories = (await this.get(settings, "/api/v2/torrents/categories")) as Record<
        string,
        { savePath?: string }
      >;
      const category = categories[settings.category];
      if (!category) throw new Error(`qBittorrent has no category named "${settings.category}"`);
      // An empty save path means "<default save path>/<category>"; a relative one is resolved against the default.
      const savePath = /^([a-z]:)?[\\/]/iu.test(category.savePath ?? "")
        ? (category.savePath ?? "")
        : `${await this.getText(settings, "/api/v2/app/defaultSavePath")}/${category.savePath || settings.category}`;
      const hostSavePath = applyPathMappings(savePath, pathMappings);
      const library = await this.deps.libraries.findBySourcePath(hostSavePath);
      const torrents = (await this.get(
        settings,
        `/api/v2/torrents/info?filter=completed&category=${encodeURIComponent(settings.category)}`,
      )) as CompletedTorrent[];
      const { downloaders } = (await this.deps.persistence.getState()).repositories;
      const sourceKey = `${settings.url.replace(/\/+$/u, "")}#${settings.category}`;
      const since = downloaders.track(sourceKey, hostSavePath).getTime();
      const handled = downloaders.handledHashes(sourceKey);
      const current = new Set(torrents.map((torrent) => torrent.hash));
      for (const hash of this.#failures.keys()) if (!current.has(hash)) this.#failures.delete(hash);
      for (const torrent of torrents) {
        if (handled.has(torrent.hash) || torrent.completion_on * 1000 < since) continue;
        if (!torrent.content_path) throw new Error("qBittorrent 4.3.1 or newer is required");
        try {
          await this.deps.automation.scrapeStart({ path: torrent.content_path });
          downloaders.markHandled(sourceKey, torrent.hash);
          this.#failures.delete(torrent.hash);
        } catch (error) {
          const message = toErrorMessage(error);
          if (this.#failures.get(torrent.hash)?.error !== message)
            this.deps.logger.warn(`qBittorrent torrent "${torrent.name}" was not scraped: ${message}`);
          this.#failures.set(torrent.hash, { name: torrent.name, error: message });
        }
      }
      this.#status = {
        configured: true,
        lastPollAt,
        error: null,
        library: library ? { id: library.id, name: library.name } : null,
        failures: [...this.#failures.values()],
      };
    } catch (error) {
      const message = toErrorMessage(error);
      if (this.#status.error !== message) this.deps.logger.warn(`qBittorrent poll failed: ${message}`);
      this.#status = { ...this.#status, configured: true, lastPollAt, error: message };
    }
  }

  private async get(settings: QbittorrentSettings, path: string): Promise<unknown> {
    return await (await this.request(settings, path)).json();
  }

  private async getText(settings: QbittorrentSettings, path: string): Promise<string> {
    return (await (await this.request(settings, path)).text()).trim();
  }

  private async request(settings: QbittorrentSettings, path: string): Promise<Response> {
    const base = settings.url.replace(/\/+$/u, "");
    const usesLogin = !settings.apiKey && Boolean(settings.username);
    const credentials = `${base}\n${settings.username}\n${settings.password}`;
    if (usesLogin && this.#session?.credentials !== credentials) await this.login(settings, base, credentials);
    const send = async () =>
      await fetch(`${base}${path}`, {
        headers: settings.apiKey
          ? { authorization: `Bearer ${settings.apiKey}` }
          : this.#session && usesLogin
            ? { cookie: this.#session.cookie }
            : {},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    let response = await send();
    // The session cookie expires after the web UI's session timeout.
    if (response.status === 403 && usesLogin) {
      await this.login(settings, base, credentials);
      response = await send();
    }
    if (response.status === 401 || response.status === 403)
      throw new Error(`qBittorrent refused access (HTTP ${response.status}); check the API key or login`);
    if (!response.ok) throw new Error(`qBittorrent answered HTTP ${response.status} for ${path}`);
    return response;
  }

  private async login(settings: QbittorrentSettings, base: string, credentials: string): Promise<void> {
    this.#session = undefined;
    const response = await fetch(`${base}/api/v2/auth/login`, {
      method: "POST",
      body: new URLSearchParams({ username: settings.username, password: settings.password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 403) throw new Error("qBittorrent banned this address after too many failed logins");
    // The cookie name is configurable in newer versions, so the first cookie is taken whatever its name.
    const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
    if (!response.ok || (await response.text()).trim() !== "Ok." || !cookie)
      throw new Error("qBittorrent rejected the username or password");
    this.#session = { credentials, cookie };
  }
}
