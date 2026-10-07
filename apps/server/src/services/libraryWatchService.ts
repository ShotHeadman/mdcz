import { type FSWatcher, watch } from "node:fs";
import path from "node:path";
import { filesystemPathKey, isPathInside } from "@mdcz/media-store";
import type { MediaLibrary, MediaLibraryService } from "@mdcz/runtime/library";
import { ACTIVE_MAINTENANCE_STATUSES } from "@mdcz/runtime/maintenance";
import { createDirectoryScope, discoverDirectoryFiles } from "@mdcz/runtime/scrape";
import { cloudPathCovers, normalizeCloudPath } from "@mdcz/shared/mediaLibrary";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ServerConfigService } from "./configService";
import type { MaintenanceService } from "./maintenanceService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import type { RuntimeLogService } from "./runtimeLogService";
import type { ScrapeService } from "./scrapeService";

/**
 * A file counts as complete once its size and modification time hold this long. Moving a file a torrent client is
 * still writing breaks the download, so this errs long; a downloader callback is the precise signal.
 */
const STABILITY_DELAY_MS = 120_000;
/** Downloads and cloud uploads arrive as bursts of events; one scan covers the burst. */
const EVENT_DEBOUNCE_MS = 5_000;

export interface CloudDriveChange {
  action: "create" | "delete" | "rename";
  isDir: boolean;
  sourceFile: string;
  destinationFile: string;
}

interface WatchDependencies {
  config: Pick<ServerConfigService, "get">;
  libraries: Pick<MediaLibraryService, "list" | "get" | "findBySourcePath">;
  mediaRoots: MediaRootService;
  scrape: Pick<ScrapeService, "start" | "liveRuns">;
  maintenance: Pick<MaintenanceService, "getActiveSession">;
  persistence: Pick<ServerPersistenceService, "getState">;
  logger: ReturnType<RuntimeLogService["getLogger"]>;
  onPending?: (count: number) => void;
}

/**
 * Sources whose scrape was submitted and has not finished. Whoever submitted them (a scan or a downloader callback),
 * and whether or not the library is watched, none may be submitted again until their task ends: the second
 * submission would race the first to the same destination.
 */
class InFlightSources {
  // The task id arrives once the submission is accepted; until then the source is only reserved.
  private readonly tasks = new Map<string, string | undefined>();

  constructor(private readonly isLive: (taskId: string) => Promise<boolean>) {}

  has(key: string): boolean {
    return this.tasks.has(key);
  }

  reserve(keys: readonly string[]): void {
    for (const key of keys) this.tasks.set(key, undefined);
  }

  settle(keys: readonly string[], taskId: string): void {
    for (const key of keys) this.tasks.set(key, taskId);
  }

  release(keys: readonly string[]): void {
    for (const key of keys) this.tasks.delete(key);
  }

  /** Forgets the sources of tasks that ended: they are published (owned) or parked in the pending list. */
  async prune(): Promise<void> {
    const taskIds = new Set([...this.tasks.values()].filter((taskId) => taskId !== undefined));
    for (const taskId of taskIds) {
      if (await this.isLive(taskId)) continue;
      for (const [key, owner] of this.tasks) if (owner === taskId) this.tasks.delete(key);
    }
  }
}

/** One library's discovery: change events or CloudDrive2 webhooks wake a scan early, and polling catches the rest. */
class LibraryWatcher {
  // Undefined until the persisted snapshot is loaded; the first scan of a new library only records a baseline.
  private known?: Set<string>;
  private readonly unstable = new Map<string, { signature: string; since: number }>();
  private readonly dirtyScopes = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private fsWatcher?: FSWatcher;
  private controller?: AbortController;
  private inFlight?: Promise<void>;
  private closed = false;

  constructor(
    public library: MediaLibrary,
    private readonly deps: WatchDependencies,
    private readonly sources: InFlightSources,
  ) {}

  start(): void {
    if (this.library.discovery === "events") {
      try {
        this.fsWatcher = watch(this.library.sourcePath, { recursive: true, persistent: false }, () =>
          this.wake(this.library.sourcePath, EVENT_DEBOUNCE_MS),
        );
        this.fsWatcher.on("error", (error) => {
          this.deps.logger.warn(`Change events stopped for ${this.library.sourcePath}; polling continues: ${error}`);
          this.fsWatcher?.close();
          this.fsWatcher = undefined;
        });
      } catch (error) {
        this.deps.logger.warn(`Change events unavailable for ${this.library.sourcePath}; polling only: ${error}`);
      }
    }
    this.wake(this.library.sourcePath, 0);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    this.fsWatcher?.close();
    this.controller?.abort();
    await this.inFlight;
  }

  /** Scans `scope` (the source directory or a subtree of it) after `delayMs`, merging with any scan already due. */
  wake(scope: string, delayMs: number): void {
    if (this.closed) return;
    this.dirtyScopes.add(scope);
    if (this.inFlight) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), delayMs);
    this.timer.unref();
  }

  /** Records files a downloader callback submitted, so no scan submits them again. */
  async acknowledge(keys: readonly string[]): Promise<void> {
    const { repositories } = await this.deps.persistence.getState();
    const known = this.known ?? repositories.mediaLibraries.loadWatchSnapshot(this.library.id) ?? new Set<string>();
    for (const key of keys) {
      known.add(key);
      this.unstable.delete(key);
    }
    this.known = known;
    repositories.mediaLibraries.saveWatchSnapshot(this.library.id, known);
  }

  private run(): void {
    const scopes = [...this.dirtyScopes];
    this.dirtyScopes.clear();
    // A scan of the whole source directory covers every subtree.
    const fullScan = scopes.includes(this.library.sourcePath);
    const scanScopes = fullScan ? [this.library.sourcePath] : scopes;
    const controller = new AbortController();
    this.controller = controller;
    this.inFlight = (async () => {
      for (const scope of scanScopes) await this.tick(scope, controller.signal);
    })()
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          this.deps.logger.error(`Library scan failed for ${this.library.name}: ${error}`);
      })
      .finally(() => {
        this.inFlight = undefined;
        if (this.closed) return;
        if (this.dirtyScopes.size) {
          this.wake([...this.dirtyScopes][0] ?? this.library.sourcePath, EVENT_DEBOUNCE_MS);
          return;
        }
        if (!this.unstable.size) {
          this.wake(this.library.sourcePath, this.library.scanIntervalMinutes * 60_000);
          return;
        }
        for (const scope of scanScopes) this.wake(scope, STABILITY_DELAY_MS);
      });
  }

  private async tick(scanDir: string, signal: AbortSignal): Promise<void> {
    const configuration = await this.deps.config.get();
    await this.sources.prune();
    const library = this.library;
    const targetDir = library.placement === "inPlace" ? library.sourcePath : library.outputPath;
    const { refs, discovery, inventory } = await discoverDirectoryFiles({
      scope: createDirectoryScope({ scanDir, recursive: true }, targetDir, configuration),
      configuration,
      mediaRoots: this.deps.mediaRoots,
      signal,
      platform: "server",
      onProgress: () => {},
    });
    const roots = new Map((await this.deps.mediaRoots.listRoots()).map((root) => [root.id, root]));
    signal.throwIfAborted();
    const locate = (ref: RootFileRef) => {
      const root = roots.get(ref.rootId);
      if (!root) throw new Error(`Media root not found: ${ref.rootId}`);
      return filesystemPathKey(path.resolve(root.realPath ?? root.hostPath, ref.relativePath));
    };
    const current = new Map<string, { ref: RootFileRef; signature: string }>();
    for (const ref of refs) {
      const root = roots.get(ref.rootId);
      if (!root) continue;
      // Files that failed to stat were already counted as skipped by discovery.
      const stats = await inventory.stats(path.join(root.hostPath, ref.relativePath)).catch((error: unknown) => {
        if (discovery.skipped) return undefined;
        throw error;
      });
      if (stats) current.set(locate(ref), { ref, signature: `${stats.size}:${stats.mtimeMs}` });
    }
    signal.throwIfAborted();
    const { repositories } = await this.deps.persistence.getState();
    const known = this.known ?? repositories.mediaLibraries.loadWatchSnapshot(library.id);
    if (!known) {
      this.known = new Set(current.keys());
      repositories.mediaLibraries.saveWatchSnapshot(library.id, this.known);
      return;
    }
    this.known = known;
    const scopeKey = filesystemPathKey(path.resolve(scanDir));
    const inScope = (key: string) => key === scopeKey || key.startsWith(`${scopeKey}${path.sep}`);
    let changed = false;
    try {
      for (const key of known) {
        if (!inScope(key) || current.has(key)) continue;
        // Filters, exclusions and unreadable directories also hide files. Without extra I/O on slow network mounts,
        // a file is gone only when the closest directory this scan listed lacks the next segment of its path.
        let child = key;
        let parent = path.dirname(child);
        while (parent !== child && !inventory.listedEntries(parent)) {
          child = parent;
          parent = path.dirname(parent);
        }
        const listing = inventory.listedEntries(parent);
        if (!listing || (await listing).some((entry) => filesystemPathKey(path.join(parent, entry.name)) === child)) {
          continue;
        }
        known.delete(key);
        changed = true;
      }
      for (const key of this.unstable.keys()) if (inScope(key) && !current.has(key)) this.unstable.delete(key);
      const stable: Array<{ key: string; ref: RootFileRef }> = [];
      const now = Date.now();
      for (const [key, { ref, signature }] of current) {
        if (known.has(key) || this.sources.has(key)) continue;
        const seen = this.unstable.get(key);
        if (seen?.signature !== signature) this.unstable.set(key, { signature, since: now });
        else if (now - seen.since >= STABILITY_DELAY_MS) stable.push({ key, ref });
      }
      if (!stable.length) return;
      const maintenance = await this.deps.maintenance.getActiveSession();
      if (maintenance && ACTIVE_MAINTENANCE_STATUSES.includes(maintenance.status)) return;
      signal.throwIfAborted();
      // Files already in the library, and the sources of hardlinked or copied ones, are not new.
      const owned = repositories.library.knownMediaIdentities(stable.map(({ key }) => key));
      const submitted = stable.filter(({ key }) => !owned.has(key) && !this.sources.has(key));
      // A file is acknowledged only after its submission is accepted; a rejected one stays unstable and is retried.
      const acknowledge = (entries: typeof stable) => {
        for (const { key } of entries) {
          known.add(key);
          this.unstable.delete(key);
        }
        if (entries.length) changed = true;
      };
      acknowledge(stable.filter(({ key }) => owned.has(key)));
      if (!submitted.length) return;
      if (library.automation === "register") {
        let added = 0;
        for (const { ref } of submitted)
          if (repositories.pending.upsert({ kind: "new_file", ...ref, libraryId: library.id })) added += 1;
        acknowledge(submitted);
        if (added) this.deps.onPending?.(added);
        this.deps.logger.info(`Registered ${submitted.length} new files in library ${library.name}`);
        return;
      }
      const keys = submitted.map(({ key }) => key);
      this.sources.reserve(keys);
      let snapshot: Awaited<ReturnType<typeof this.deps.scrape.start>>;
      try {
        snapshot = await this.deps.scrape.start({
          executionMode: "batch",
          libraryId: library.id,
          refs: submitted.map(({ ref }) => ref),
        });
      } catch (error) {
        this.sources.release(keys);
        throw error;
      }
      this.sources.settle(keys, snapshot.task.id);
      acknowledge(submitted);
      this.deps.logger.info(
        `Submitted ${submitted.length} files from library ${library.name}: taskId=${snapshot.task.id}`,
      );
    } finally {
      if (changed) repositories.mediaLibraries.saveWatchSnapshot(library.id, known);
    }
  }
}

export class LibraryWatchService {
  private readonly watchers = new Map<string, LibraryWatcher>();
  private refreshing: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly inFlight: InFlightSources;

  constructor(private readonly deps: WatchDependencies) {
    this.inFlight = new InFlightSources(async (taskId) =>
      (await deps.scrape.liveRuns()).runs.some((run) => run.task.id === taskId),
    );
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  /** Brings watchers in line with the stored libraries; call after any library changes. */
  async refresh(): Promise<void> {
    this.refreshing = this.refreshing.then(async () => {
      if (this.closed) return;
      const libraries = (await this.deps.libraries.list()).filter((library) => library.automation !== "off");
      const wanted = new Map(libraries.map((library) => [library.id, library]));
      for (const [id, watcher] of this.watchers) {
        const library = wanted.get(id);
        if (library && JSON.stringify(library) === JSON.stringify(watcher.library)) continue;
        await watcher.close();
        this.watchers.delete(id);
      }
      for (const library of libraries) {
        if (this.watchers.has(library.id)) continue;
        const watcher = new LibraryWatcher(library, this.deps, this.inFlight);
        this.watchers.set(library.id, watcher);
        watcher.start();
      }
    });
    await this.refreshing;
  }

  /**
   * CloudDrive2 reports changes by virtual path. The library with the longest matching `cloudPath` rescans just the
   * directory the change touched, after a pause so CloudDrive's directory cache lists the new files.
   */
  submitCloudDriveChanges(changes: readonly CloudDriveChange[]): void {
    const routes = [...this.watchers.values()]
      .filter((watcher) => watcher.library.discovery === "clouddrive")
      .map((watcher) => ({ watcher, cloudPath: normalizeCloudPath(watcher.library.cloudPath) }))
      .sort((left, right) => right.cloudPath.length - left.cloudPath.length);
    for (const change of changes) {
      for (const virtualPath of [change.sourceFile, change.destinationFile]) {
        if (!virtualPath.trim()) continue;
        let normalized: string;
        try {
          normalized = normalizeCloudPath(virtualPath);
        } catch {
          continue;
        }
        const route = routes.find((candidate) => cloudPathCovers(candidate.cloudPath, normalized));
        if (!route) continue;
        const relative = normalized.slice(route.cloudPath.length).split("/").filter(Boolean);
        const local = path.join(route.watcher.library.sourcePath, ...relative);
        // A deleted or renamed-away path no longer exists; scanning its parent records the removal.
        const scope =
          change.isDir && !(change.action !== "create" && virtualPath === change.sourceFile)
            ? local
            : path.dirname(local);
        route.watcher.wake(
          isPathInside(route.watcher.library.sourcePath, scope) ? scope : route.watcher.library.sourcePath,
          EVENT_DEBOUNCE_MS,
        );
      }
    }
  }

  /**
   * Runs a downloader callback's submission so the library's scans neither repeat nor lose its files. A source the
   * library already holds, or one whose scrape is still running, is dropped: a repeated callback is a no-op and
   * returns `null` rather than publishing the source a second time.
   */
  async submitExternal<T extends { task: { id: string } }>(
    libraryId: string,
    refs: readonly RootFileRef[],
    submit: (refs: readonly RootFileRef[]) => Promise<T>,
  ): Promise<T | null> {
    const roots = new Map((await this.deps.mediaRoots.listRoots()).map((root) => [root.id, root]));
    const keys = refs.map((ref) => {
      const root = roots.get(ref.rootId);
      return root ? filesystemPathKey(path.resolve(root.realPath ?? root.hostPath, ref.relativePath)) : undefined;
    });
    const { repositories } = await this.deps.persistence.getState();
    const owned = repositories.library.knownMediaIdentities(keys.filter((key): key is string => key !== undefined));
    await this.inFlight.prune();
    const acceptedRefs: RootFileRef[] = [];
    const acceptedKeys: string[] = [];
    refs.forEach((ref, index) => {
      const key = keys[index];
      if (key !== undefined && (owned.has(key) || this.inFlight.has(key))) return;
      acceptedRefs.push(ref);
      if (key !== undefined) acceptedKeys.push(key);
    });
    if (!acceptedRefs.length) return null;
    this.inFlight.reserve(acceptedKeys);
    let result: T;
    try {
      result = await submit(acceptedRefs);
    } catch (error) {
      this.inFlight.release(acceptedKeys);
      throw error;
    }
    this.inFlight.settle(acceptedKeys, result.task.id);
    await this.watchers.get(libraryId)?.acknowledge(acceptedKeys);
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.refreshing;
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.close()));
    this.watchers.clear();
  }
}
