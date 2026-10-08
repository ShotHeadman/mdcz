import { stat } from "node:fs/promises";
import path from "node:path";
import type { MediaLibraryService } from "@mdcz/runtime/library";
import { createDirectoryScope, discoverDirectoryFiles } from "@mdcz/runtime/scrape";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type {
  AutomationRecentResponse,
  AutomationScrapeStartInput,
  AutomationScrapeStartResponse,
  AutomationWebhookDeliveryStatusDto,
  AutomationWebhookDeliveryStatusResponse,
  AutomationWebhookEventDto,
} from "@mdcz/shared/serverDtos";
import type { TaskEventBus, TaskLifecycleEvent } from "../taskEvents";
import type { ActivityService } from "./activityService";
import type { ServerConfigService } from "./configService";
import type { LibraryWatchService } from "./libraryWatchService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { RuntimeLogService } from "./runtimeLogService";
import type { ScrapeService } from "./scrapeService";

const MAX_TRACKED_WEBHOOK_TASKS = 1_000;
const MAX_QUEUED_DELIVERIES = 1_000;
const DELIVERY_TIMEOUT_MS = 10_000;
const DIGEST_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const WEBHOOK_PHASE_STARTED = 1;
const WEBHOOK_PHASE_TERMINAL = 2;

/** Rewrites a downloader's path into MDCz's view: the longest matching prefix wins, separators are normalized. */
export const applyPathMappings = (
  inputPath: string,
  mappings: Configuration["automation"]["pathMappings"],
  platform: NodeJS.Platform = process.platform,
): string => {
  const slashed = (value: string) => value.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  const comparable = (value: string) => (platform === "win32" ? slashed(value).toLowerCase() : slashed(value));
  const source = slashed(inputPath);
  const mapping = [...mappings]
    .sort((left, right) => slashed(right.from).length - slashed(left.from).length)
    .find(({ from }) => {
      const prefix = comparable(from);
      return comparable(source) === prefix || comparable(source).startsWith(`${prefix}/`);
    });
  const mapped = mapping ? `${slashed(mapping.to)}${source.slice(slashed(mapping.from).length)}` : source;
  return (platform === "win32" ? path.win32 : path.posix).normalize(mapped);
};

type Message = { title: string; body: string };

/**
 * Downloader callbacks and outbound notifications. The webhook receives every task start and finish as JSON;
 * Telegram, Bark and ntfy receive a short message when a scrape finishes, plus an optional daily digest.
 */
export class AutomationService {
  #deliveryStatus: AutomationWebhookDeliveryStatusDto = {
    configured: false,
    delivered: 0,
    failed: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
  readonly #queue: Array<() => Promise<void>> = [];
  #delivering = false;
  readonly #taskDeliveryPhases = new Map<string, number>();
  #pendingSinceLastMessage = 0;
  #digestTimer?: ReturnType<typeof setInterval>;
  #lastDigestDay = "";

  constructor(
    private readonly deps: {
      activity: Pick<ActivityService, "list">;
      scrape: ScrapeService;
      config: Pick<ServerConfigService, "get">;
      libraries: Pick<MediaLibraryService, "get" | "findBySourcePath">;
      libraryWatch: Pick<LibraryWatchService, "submitExternal">;
      mediaRoots: MediaRootService;
      persistence: Pick<ServerPersistenceService, "getState">;
      taskEvents: TaskEventBus;
      logger: ReturnType<RuntimeLogService["getLogger"]>;
    },
  ) {
    deps.taskEvents.subscribeLifecycle((task) => void this.onLifecycle(task));
  }

  start(): void {
    this.#digestTimer = setInterval(() => void this.sendDigestIfDue(), DIGEST_CHECK_INTERVAL_MS);
    this.#digestTimer.unref();
  }

  close(): void {
    clearInterval(this.#digestTimer);
  }

  /** Scrapes what a downloader just finished: a file, or every video under a directory. */
  async scrapeStart(input: AutomationScrapeStartInput): Promise<AutomationScrapeStartResponse> {
    const configuration = await this.deps.config.get();
    const hostPath = applyPathMappings(input.path, configuration.automation.pathMappings);
    const library = input.libraryId
      ? await this.deps.libraries.get(input.libraryId)
      : await this.deps.libraries.findBySourcePath(hostPath);
    if (!library) throw new Error(`No library's source directory contains ${hostPath}`);
    const isDirectory = (await stat(hostPath)).isDirectory();
    const refs = isDirectory
      ? (
          await discoverDirectoryFiles({
            scope: createDirectoryScope(
              { scanDir: hostPath, recursive: true },
              library.placement === "inPlace" ? hostPath : library.outputPath,
              configuration,
            ),
            configuration,
            mediaRoots: this.deps.mediaRoots,
            signal: AbortSignal.timeout(10 * 60 * 1000),
            platform: "server",
            onProgress: () => {},
          })
        ).refs
      : await (async () => {
          const admitted = await this.deps.mediaRoots.admitDirectory({ hostPath: path.dirname(hostPath) });
          return [
            {
              rootId: admitted.root.id,
              relativePath: [admitted.relativeDirectory, path.basename(hostPath)].filter(Boolean).join("/"),
            },
          ];
        })();
    if (!refs.length) throw new Error(`No video files found at ${hostPath}`);
    const snapshot = await this.deps.libraryWatch.submitExternal(library.id, refs, (accepted) =>
      this.deps.scrape.start({ executionMode: "batch", libraryId: library.id, refs: [...accepted] }),
    );
    if (!snapshot) return { task: null, webhook: null, duplicate: true };
    return { task: snapshot.task, webhook: this.toWebhookEvent(snapshot.task), duplicate: false };
  }

  async recent(input?: { limit?: number }): Promise<AutomationRecentResponse> {
    const { entries } = await this.deps.activity.list(input?.limit);
    return {
      tasks: entries.map((entry) => ({
        taskId: entry.id,
        kind: entry.kind,
        status: entry.status,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        summary: `${entry.kind[0]?.toUpperCase()}${entry.kind.slice(1)} ${entry.target}: ${entry.status}`,
        errors: entry.error ? [entry.error] : [],
      })),
    };
  }

  async deliveryStatus(): Promise<AutomationWebhookDeliveryStatusResponse> {
    const configuration = await this.deps.config.get();
    return { webhook: { ...this.#deliveryStatus, configured: Boolean(configuration.notifications.webhookUrl) } };
  }

  /** Files entering the pending list are counted into the next scrape message. */
  notePending(count: number): void {
    this.#pendingSinceLastMessage += count;
  }

  async testNotification(): Promise<void> {
    const configuration = await this.deps.config.get();
    if (!configuration.notifications.channels.length) throw new Error("No notification channel is enabled");
    await Promise.all(
      configuration.notifications.channels.map(
        async (channel) =>
          await this.sendToChannel(configuration, channel, { title: "MDCz", body: "Test notification" }),
      ),
    );
  }

  toWebhookEvent(task: TaskLifecycleEvent): AutomationWebhookEventDto {
    const target = task.rootDisplayName || task.rootId;
    const kind = task.kind === "scan" ? "Scan" : task.kind === "scrape" ? "Scrape" : "Maintenance";
    return {
      taskId: task.id,
      kind: task.kind,
      status: task.status,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      summary: `${kind} ${target}: ${task.status}`,
      errors: task.error ? [task.error] : [],
    };
  }

  private async onLifecycle(task: TaskLifecycleEvent): Promise<void> {
    const configuration = await this.deps.config.get();
    const terminal = ["completed", "failed", "stopped", "interrupted"].includes(task.status);
    if (configuration.notifications.webhookUrl) this.enqueueWebhook(configuration, task, terminal);
    if (!terminal || task.kind !== "scrape" || !task.counts || !configuration.notifications.channels.length) return;
    const pending = this.#pendingSinceLastMessage;
    this.#pendingSinceLastMessage = 0;
    const { success, failed } = task.counts;
    const message = {
      title: "MDCz",
      body: [
        `Scrape finished: ${success} succeeded, ${failed} failed`,
        pending ? `${pending} new in the pending list` : "",
      ]
        .filter(Boolean)
        .join("; "),
    };
    for (const channel of configuration.notifications.channels)
      this.enqueue(async () => await this.sendToChannel(configuration, channel, message));
  }

  private enqueueWebhook(configuration: Configuration, task: TaskLifecycleEvent, terminal: boolean): void {
    const phase = task.status === "running" ? WEBHOOK_PHASE_STARTED : terminal ? WEBHOOK_PHASE_TERMINAL : 0;
    if (phase === 0) return;
    const deliveredPhases = this.#taskDeliveryPhases.get(task.id) ?? 0;
    if ((deliveredPhases & phase) !== 0) return;
    this.#taskDeliveryPhases.set(task.id, deliveredPhases | phase);
    // Terminal tombstones are kept until eviction so a repeated terminal event is not delivered twice.
    if (this.#taskDeliveryPhases.size > MAX_TRACKED_WEBHOOK_TASKS) {
      const oldestTaskId = this.#taskDeliveryPhases.keys().next().value;
      if (oldestTaskId !== undefined) this.#taskDeliveryPhases.delete(oldestTaskId);
    }
    const payload = this.toWebhookEvent(task);
    const { webhookUrl, webhookSecret } = configuration.notifications;
    this.enqueue(async () => {
      this.#deliveryStatus.lastAttemptAt = new Date().toISOString();
      try {
        await this.post(webhookUrl, JSON.stringify(payload), {
          "content-type": "application/json",
          ...(webhookSecret ? { "x-mdcz-webhook-secret": webhookSecret } : {}),
        });
        this.#deliveryStatus.delivered += 1;
        this.#deliveryStatus.lastSuccessAt = new Date().toISOString();
        this.#deliveryStatus.lastError = null;
      } catch (error) {
        this.#deliveryStatus.failed += 1;
        this.#deliveryStatus.lastError = toErrorMessage(error);
      }
    });
  }

  private async sendDigestIfDue(): Promise<void> {
    const configuration = await this.deps.config.get();
    const { dailyDigest, digestHour, channels } = configuration.notifications;
    const now = new Date();
    const day = now.toDateString();
    if (!dailyDigest || !channels.length || now.getHours() !== digestHour || this.#lastDigestDay === day) return;
    this.#lastDigestDay = day;
    const { repositories } = await this.deps.persistence.getState();
    const added = repositories.library.countCreatedSince(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const pending = repositories.pending.count();
    const message = { title: "MDCz daily digest", body: `${added} new movies in the last day; ${pending} pending` };
    for (const channel of channels) this.enqueue(async () => await this.sendToChannel(configuration, channel, message));
  }

  private async sendToChannel(
    configuration: Configuration,
    channel: Configuration["notifications"]["channels"][number],
    message: Message,
  ): Promise<void> {
    const settings = configuration.notifications;
    try {
      if (channel === "telegram") {
        if (!settings.telegramBotToken || !settings.telegramChatId) throw new Error("Telegram is not configured");
        await this.post(
          `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`,
          JSON.stringify({ chat_id: settings.telegramChatId, text: `${message.title}\n${message.body}` }),
          { "content-type": "application/json" },
        );
      } else if (channel === "bark") {
        if (!settings.barkUrl) throw new Error("Bark is not configured");
        await this.post(settings.barkUrl, JSON.stringify(message), { "content-type": "application/json" });
      } else {
        if (!settings.ntfyUrl) throw new Error("ntfy is not configured");
        await this.post(settings.ntfyUrl, message.body, {
          title: message.title,
          ...(settings.ntfyToken ? { authorization: `Bearer ${settings.ntfyToken}` } : {}),
        });
      }
    } catch (error) {
      this.deps.logger.warn(`Notification via ${channel} failed: ${toErrorMessage(error)}`);
      throw error;
    }
  }

  private async post(url: string, body: string, headers: Record<string, string>): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  }

  private enqueue(delivery: () => Promise<void>): void {
    if (this.#queue.length >= MAX_QUEUED_DELIVERIES) {
      this.#deliveryStatus.lastError = "Notification queue is full";
      return;
    }
    this.#queue.push(delivery);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.#delivering) return;
    this.#delivering = true;
    try {
      for (let delivery = this.#queue.shift(); delivery; delivery = this.#queue.shift())
        await delivery().catch(() => undefined);
    } finally {
      this.#delivering = false;
    }
  }
}
