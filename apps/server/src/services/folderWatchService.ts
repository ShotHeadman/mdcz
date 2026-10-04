import path from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";
import { ACTIVE_MAINTENANCE_STATUSES } from "@mdcz/runtime/maintenance";
import { createDirectoryScope, discoverDirectoryFiles } from "@mdcz/runtime/scrape";
import type { Configuration } from "@mdcz/shared/config";
import { resolveSuccessTargetDir } from "@mdcz/shared/mediaCandidate";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ServerConfigService } from "./configService";
import type { MaintenanceService } from "./maintenanceService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { RuntimeLogService } from "./runtimeLogService";
import type { ScrapeService } from "./scrapeService";

export class FolderWatchService {
  private readonly known = new Set<string>();
  private readonly pending = new Map<string, string>();
  private configuration?: Configuration;
  private configurationKey = "";
  private baseline = true;
  private revision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private inFlight?: Promise<void>;
  private unsubscribe?: () => void;
  private closed = false;

  constructor(
    private readonly config: Pick<ServerConfigService, "get" | "onChange">,
    private readonly mediaRoots: MediaRootService,
    private readonly scrape: Pick<ScrapeService, "start">,
    private readonly maintenance: Pick<MaintenanceService, "getActiveSession">,
    private readonly persistence: Pick<ServerPersistenceService, "getState">,
    private readonly logger: ReturnType<RuntimeLogService["getLogger"]>,
  ) {}

  async start(): Promise<void> {
    if (this.closed || this.unsubscribe) return;
    this.unsubscribe = this.config.onChange(({ configuration }) => this.configure(configuration));
    this.configure(await this.config.get());
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe?.();
    clearTimeout(this.timer);
    this.controller?.abort();
    await this.inFlight;
  }

  private configure(configuration: Configuration): void {
    if (this.closed) return;
    this.configuration = configuration;
    const key = JSON.stringify([
      configuration.watch,
      configuration.paths.mediaPath,
      configuration.paths.successOutputFolder,
      configuration.paths.defaultScanExcludeDirs,
      configuration.behavior.metadataOnly,
      configuration.paths.metadataPath,
      configuration.scrape.filenameBlacklistTokens,
      configuration.scrape.minVideoSizeMb,
    ]);
    if (key === this.configurationKey) return;
    this.configurationKey = key;
    this.revision += 1;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.known.clear();
    this.pending.clear();
    this.baseline = true;
    if (!this.inFlight) this.run();
  }

  private run(): void {
    const configuration = this.configuration;
    if (this.closed || !configuration?.watch.enabled || !configuration.paths.mediaPath.trim()) return;
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    this.inFlight = this.tick(configuration, controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) this.logger.error(`Folder watch scan failed: ${String(error)}`);
      })
      .finally(() => {
        this.inFlight = undefined;
        if (this.closed || !this.configuration?.watch.enabled || !this.configuration.paths.mediaPath.trim()) return;
        const delay = revision === this.revision ? this.configuration.watch.intervalMinutes * 60_000 : 0;
        this.timer = setTimeout(() => this.run(), delay);
        this.timer.unref();
      });
  }

  private async tick(configuration: Configuration, signal: AbortSignal): Promise<void> {
    const mediaPath = configuration.paths.mediaPath.trim();
    const targetDir = resolveSuccessTargetDir(mediaPath, configuration.paths.successOutputFolder) || mediaPath;
    const { refs, discovery, inventory } = await discoverDirectoryFiles({
      scope: createDirectoryScope({ scanDir: mediaPath, recursive: true }, targetDir, configuration),
      configuration,
      mediaRoots: this.mediaRoots,
      signal,
      platform: "server",
      onProgress: () => {},
    });
    const roots = new Map((await this.mediaRoots.listRoots()).map((root) => [root.id, root]));
    signal.throwIfAborted();
    const locate = (ref: RootFileRef) => {
      const root = roots.get(ref.rootId);
      if (!root) throw new Error(`Media root not found: ${ref.rootId}`);
      return {
        hostPath: path.join(root.hostPath, ref.relativePath),
        key: filesystemPathKey(path.resolve(root.realPath ?? root.hostPath, ref.relativePath)),
      };
    };
    const current = new Map<string, { ref: RootFileRef; signature: string }>();
    for (const ref of refs) {
      const { hostPath, key } = locate(ref);
      // Files that failed to stat were already counted as skipped by discovery.
      const stats = await inventory.stats(hostPath).catch((error: unknown) => {
        if (discovery.skipped) return undefined;
        throw error;
      });
      if (stats) current.set(key, { ref, signature: `${stats.size}:${stats.mtimeMs}` });
    }
    signal.throwIfAborted();
    if (this.baseline) {
      for (const key of current.keys()) this.known.add(key);
      this.baseline = false;
      return;
    }
    // An incomplete scan cannot prove that a known file disappeared.
    if (!discovery.skipped) {
      for (const key of this.known) if (!current.has(key)) this.known.delete(key);
    }
    for (const key of this.pending.keys()) if (!current.has(key)) this.pending.delete(key);
    const stable: Array<{ key: string; ref: RootFileRef }> = [];
    for (const [key, { ref, signature }] of current) {
      if (this.known.has(key)) continue;
      if (this.pending.get(key) === signature) stable.push({ key, ref });
      else this.pending.set(key, signature);
    }
    if (!stable.length) return;
    const maintenance = await this.maintenance.getActiveSession();
    if (maintenance && ACTIVE_MAINTENANCE_STATUSES.includes(maintenance.status)) return;
    const { repositories } = await this.persistence.getState();
    signal.throwIfAborted();
    const owned = new Set(
      repositories.library.inventoryOwnership(stable.map(({ ref }) => ref)).map((entry) => locate(entry).key),
    );
    const submitted = stable.filter(({ key }) => !owned.has(key));
    for (const { key } of stable) {
      if (!owned.has(key)) continue;
      this.known.add(key);
      this.pending.delete(key);
    }
    if (!submitted.length) return;
    const output = await this.mediaRoots.prepareOutputDirectory({ hostPath: targetDir });
    signal.throwIfAborted();
    const snapshot = await this.scrape.start({
      executionMode: "batch",
      refs: submitted.map(({ ref }) => ref),
      outputRootId: output.id,
      outputRelativeDirectory: output.relativeDirectory,
    });
    signal.throwIfAborted();
    for (const { key } of submitted) {
      this.known.add(key);
      this.pending.delete(key);
    }
    this.logger.info(`Submitted ${submitted.length} watched media files: taskId=${snapshot.task.id}`);
  }
}
