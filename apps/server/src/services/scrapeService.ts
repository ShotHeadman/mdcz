import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeItemOutcomeRecord, ScrapeRunItemRecord, ScrapeRunManifest } from "@mdcz/persistence";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { mediaPathOwnership, toLibraryAssets } from "@mdcz/runtime/library";
import { buildMovieTags, LocalScanService } from "@mdcz/runtime/maintenance";
import { MaintenanceArtifactResolver } from "@mdcz/runtime/maintenance/MaintenanceArtifactResolver";
import type { NetworkClient } from "@mdcz/runtime/network";
import {
  commitPublishedMedia,
  commitRegisteredPublication,
  commitScrapeTerminalResult,
  type ScrapeSuccessPublicationFacts,
} from "@mdcz/runtime/publication";
import {
  applyScrapeNetworkPolicy,
  confirmUncensoredOutputs,
  createScrapeExecutionPolicy,
  FileOrganizer,
  type MountedRootScrapeRuntime,
  type MountedRootScrapeRuntimeItemSuccess,
  NfoGenerator,
  PosterCropService,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import {
  ScrapeCoordinator,
  type ScrapeHostPort,
  type ScrapeRunItem,
  type ScrapeRunSnapshot,
  type ScrapeWorkflowReporter,
  toScrapeRunSnapshotDto,
} from "@mdcz/runtime/tasks";
import { validateManualScrapeUrl } from "@mdcz/shared/manualScrapeUrl";
import {
  type AmbiguousUncensoredItemDto,
  crawlerDataSchema,
  type FileActionInput,
  type FileActionResponse,
  type NfoReadInput,
  type NfoReadResponse,
  type NfoWriteInput,
  type NfoWriteResponse,
  type PosterCropSaveInput,
  type PosterCropSessionResponse,
  type ScrapeConfirmUncensoredInput,
  type ScrapeHistoryResponse,
  type ScrapeHistoryRunDto,
  type ScrapeLiveRunsResponse,
  type ScrapePendingUncensoredConfirmationResponse,
  type ScrapeResultDetailResponse,
  type ScrapeResultDto,
  type ScrapeRunSnapshotDto,
  type ScrapeStartInput,
  type ScrapeStartSelectedFilesInput,
  type ScrapeTaskControlInput,
  type TaskEventDto,
} from "@mdcz/shared/serverDtos";
import type { ScrapeResult, UncensoredChoice } from "@mdcz/shared/types";
import { toScrapeResultDto } from "../scrapeDtos";
import type { TaskEventBus } from "../taskEvents";
import type { ServerConfigService } from "./configService";
import type { MediaRootService } from "./mediaRootService";
import type { ServerPersistenceService } from "./persistenceService";
import { decorateTaskLog } from "./runtimeLogService";
import { ServerNfoAdapter, ServerPosterCropAdapter, type ServerScrapeArtifactRecord } from "./scrapeAdapters";

export const SCRAPE_BACKEND_INTERRUPTED_MESSAGE = "刮削后端已重启，任务已中断；请重新扫描磁盘并基于当前文件创建新任务";

type ServerManualScrape = {
  manualUrl: string | null;
  uncensoredChoice: UncensoredChoice | null;
};

type PlannedScrapeResult = ScrapeResult & { publication?: MountedRootScrapeRuntimeItemSuccess };

type OutcomeContext = {
  manifest: ScrapeRunManifest;
  item: ScrapeRunItemRecord;
  outcome: ScrapeItemOutcomeRecord;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface ScrapeServiceResources {
  networkClient: NetworkClient;
  runtime: MountedRootScrapeRuntime;
  imageHostCooldownStore: Pick<PersistentCooldownStore, "clear">;
}

const createFailedResult = (
  item: ScrapeRunItem<ServerManualScrape>,
  error: string,
  status: "failed" | "skipped" = "failed",
): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: path.basename(item.sourcePath),
  status,
  error,
  assets: [],
});

export class ScrapeService {
  private readonly networkClient: NetworkClient;
  private readonly fileOrganizer = new FileOrganizer();
  private readonly nfoGenerator = new NfoGenerator();
  private readonly posterCropService = new PosterCropService();
  private readonly nfoAdapter: ServerNfoAdapter;
  private readonly posterCropAdapter: ServerPosterCropAdapter;
  private readonly runtime: MountedRootScrapeRuntime;
  private readonly imageHostCooldownStore: Pick<PersistentCooldownStore, "clear">;
  private workflow: ScrapeCoordinator<ScrapeStartInput, ScrapeRunManifest, ServerManualScrape> | null = null;
  private scrapeInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly host: ScrapeHostPort<ScrapeStartInput, ScrapeRunManifest, ServerManualScrape>;

  constructor(
    private readonly persistence: ServerPersistenceService,
    private readonly mediaRoots: MediaRootService,
    private readonly config: ServerConfigService,
    private readonly taskEvents: TaskEventBus,
    resources: ScrapeServiceResources,
  ) {
    this.networkClient = resources.networkClient;
    this.runtime = resources.runtime;
    this.imageHostCooldownStore = resources.imageHostCooldownStore;
    this.nfoAdapter = new ServerNfoAdapter(this.mediaRoots, this.config, this.nfoGenerator, this.persistence);
    this.posterCropAdapter = new ServerPosterCropAdapter(
      this.mediaRoots,
      this.config,
      this.posterCropService,
      (result) => this.resolveMetadataVideoPath(result),
      this.persistence,
    );
    this.host = {
      create: async (input) => await this.createRun(input),
      runId: (run) => run.id,
      createExecution: async (run, reporter) => await this.createExecution(run, reporter),
      onInvalidate: () => this.scheduleScrapeInvalidation(),
      onTerminal: async (run, snapshot) => await this.handleTerminalRun(run, snapshot),
      onError: async (runId, error) => {
        runtimeLoggerService.getLogger(`scrape:${runId}`).error(`Scrape execution failed: ${errorMessage(error)}`);
      },
    };
  }

  async start(input: ScrapeStartInput): Promise<ScrapeRunSnapshotDto> {
    const workflow = await this.coordinator();
    const snapshot = await workflow.start(input);
    const live = workflow.liveRuns().find(({ run }) => run.id === snapshot.runId);
    if (!live) throw new Error(`Scrape run disappeared after start: ${snapshot.runId}`);
    this.addEvent(snapshot.runId, "queued", "Scrape task queued");
    return await this.liveRunSnapshotDto(live.run, live.snapshot, live.startedAt);
  }

  async startSelectedFiles(input: ScrapeStartSelectedFilesInput): Promise<ScrapeRunSnapshotDto> {
    if (!input.scanDir) throw new Error("scanDir is required when starting selected host files");
    const normalizedScanDir = path.resolve(input.scanDir);
    const configuredMediaPath = (await this.config.get()).paths.mediaPath.trim();
    if (!configuredMediaPath) throw new Error("媒体目录未配置");
    const configuredRoot = await this.mediaRoots.setPrimaryMediaRoot({
      displayName: path.basename(path.resolve(configuredMediaPath)) || path.resolve(configuredMediaPath),
      hostPath: configuredMediaPath,
      enabled: true,
    });
    const refs: ScrapeStartInput["refs"] = [];
    for (const filePath of input.filePaths) {
      const resolvedPath = path.resolve(filePath);
      const relativeToScan = path.relative(normalizedScanDir, resolvedPath);
      if (!relativeToScan || relativeToScan.startsWith("..") || path.isAbsolute(relativeToScan)) {
        throw new Error(`文件不在扫描目录内：${filePath}`);
      }
      const relativeToRoot = path.relative(configuredRoot.hostPath, resolvedPath);
      if (!relativeToRoot || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        throw new Error(`文件不在已注册媒体目录内：${filePath}`);
      }
      refs.push({ rootId: configuredRoot.id, relativePath: relativeToRoot.replace(/\\/gu, "/") });
    }
    return await this.start({
      refs,
      manualUrl: input.manualUrl,
      uncensoredConfirmed: input.uncensoredConfirmed,
    });
  }

  /**
   * The only live scrape read model.  It intentionally reads only the
   * currently running process queue; durable manifests and outcomes remain
   * available through the history endpoints instead.
   */
  async liveRuns(): Promise<ScrapeLiveRunsResponse> {
    return {
      runs: await Promise.all(
        (this.workflow?.liveRuns() ?? []).map(
          async ({ run, snapshot, startedAt }) => await this.liveRunSnapshotDto(run, snapshot, startedAt),
        ),
      ),
    };
  }

  /**
   * Uncensored confirmation is durable post-processing, not live-session
   * recovery.  Terminal outcomes remain queryable after a backend restart.
   */
  async pendingUncensoredConfirmation(): Promise<ScrapePendingUncensoredConfirmationResponse> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const manifests = await repository.list();
    const items = (
      await Promise.all(
        manifests.map(async (manifest) =>
          (await this.buildAmbiguousUncensoredItems(manifest.id)).map((item) => ({ ...item, taskId: manifest.id })),
        ),
      )
    ).flat();
    return { items };
  }

  async history(input?: ScrapeTaskControlInput): Promise<ScrapeHistoryResponse> {
    const state = await this.persistence.getState();
    const manifests = input?.taskId
      ? [await state.repositories.scrapeRuns.get(input.taskId)]
      : await (await this.persistence.getState()).repositories.scrapeRuns.list();
    const runs: ScrapeHistoryRunDto[] = [];
    const results: ScrapeResultDto[] = [];
    for (const manifest of manifests) {
      runs.push(await this.historyRunDto(manifest));
      const itemById = new Map(manifest.items.map((item) => [item.id, item]));
      for (const outcome of state.repositories.scrapeRuns.latestOutcomes(manifest)) {
        const item = itemById.get(outcome.itemId);
        if (!item) throw new Error(`Scrape outcome item is missing from manifest: ${outcome.itemId}`);
        results.push(await this.outcomeToDto({ manifest, item, outcome }));
      }
    }
    return { runs, results };
  }

  async result(id: string): Promise<ScrapeResultDetailResponse> {
    return { result: await this.outcomeToDto(await this.loadOutcomeContext(id)) };
  }

  async stop(input: ScrapeTaskControlInput): Promise<string> {
    await (await this.coordinator()).stop(input.taskId);
    return input.taskId;
  }

  async pause(input: ScrapeTaskControlInput): Promise<string> {
    await (await this.coordinator()).pause(input.taskId);
    this.addEvent(input.taskId, "paused", "Scrape task paused");
    return input.taskId;
  }

  async resume(input: ScrapeTaskControlInput): Promise<string> {
    await (await this.coordinator()).resume(input.taskId);
    this.addEvent(input.taskId, "queued", "Scrape task queued");
    return input.taskId;
  }

  async retry(input: ScrapeTaskControlInput): Promise<ScrapeRunSnapshotDto> {
    this.imageHostCooldownStore.clear();
    runtimeLoggerService.getLogger("ScrapeService").info("Cleared image host cooldowns for user-initiated retry");
    const workflow = await this.coordinator();
    const snapshot = await workflow.retry(input.taskId);
    const live = workflow.liveRuns().find(({ run }) => run.id === snapshot.runId);
    if (!live) throw new Error(`Scrape retry disappeared after start: ${snapshot.runId}`);
    this.addEvent(snapshot.runId, "queued", "Scrape retry queued");
    return await this.liveRunSnapshotDto(live.run, live.snapshot, live.startedAt);
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<string> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(input.taskId);
    const summary = state.repositories.scrapeRuns.summary(manifest);
    if (!summary) throw new Error("无码确认只允许修改已结束刮削的成功结果");
    const outcomes = state.repositories.scrapeRuns.latestOutcomes(manifest);
    const outcomeByItem = new Map(outcomes.map((outcome) => [outcome.itemId, outcome]));
    const itemByRef = new Map(manifest.items.map((item) => [`${item.rootId}:${item.relativePath}`, item]));
    const selectedItems = input.items ?? input.refs?.map((ref) => ({ ref, choice: "uncensored" as const })) ?? [];
    if (selectedItems.length === 0) throw new Error("No uncensored confirmation refs provided");
    const selected = selectedItems.map((selection) => {
      const item = itemByRef.get(`${selection.ref.rootId}:${selection.ref.relativePath}`);
      if (!item)
        throw new Error(`Ref does not belong to scrape task: ${selection.ref.rootId}:${selection.ref.relativePath}`);
      const outcome = outcomeByItem.get(item.id);
      if (!outcome || outcome.outcome !== "success" || !outcome.outputRootId || !outcome.outputRelativePath) {
        throw new Error(
          `Ref does not belong to successful scrape output: ${selection.ref.rootId}:${selection.ref.relativePath}`,
        );
      }
      return { selection, item, outcome };
    });

    const configuration = await this.config.get();
    const roots = new Map<string, MediaRoot>();
    for (const { outcome } of selected) {
      const rootIds = [outcome.outputRootId, outcome.nfoRootId ?? outcome.outputRootId];
      for (const rootId of rootIds) {
        if (rootId && !roots.has(rootId)) roots.set(rootId, await this.mediaRoots.getActiveRoot(rootId));
      }
    }
    const resolvedSelected = selected.map(({ selection, item, outcome }) => {
      const { outputRootId, outputRelativePath } = outcome;
      if (!outputRootId || !outputRelativePath) {
        throw new Error(`Successful scrape outcome is missing output facts: ${outcome.id}`);
      }
      const outputRoot = roots.get(outputRootId);
      const nfoRoot = roots.get(outcome.nfoRootId ?? outputRootId);
      if (!outputRoot || !nfoRoot) {
        throw new Error(`Scrape output root disappeared before uncensored confirmation: ${outcome.id}`);
      }
      return { selection, item, outcome, outputRootId, outputRelativePath, outputRoot, nfoRoot };
    });
    const confirmation = await confirmUncensoredOutputs(
      resolvedSelected.map(({ selection, item, outcome, outputRelativePath, outputRoot, nfoRoot }) => ({
        fileId: item.id,
        videoPath: resolveRootRelativePath(outputRoot, outputRelativePath),
        metadataVideoPath: outcome.nfoRootId
          ? resolveRootRelativePath(nfoRoot, this.resolveMetadataVideoPath(this.toArtifactRecord(item, outcome)))
          : undefined,
        nfoPath: outcome.nfoRelativePath ? resolveRootRelativePath(nfoRoot, outcome.nfoRelativePath) : undefined,
        crawlerData: outcome.crawlerDataJson ? crawlerDataSchema.parse(JSON.parse(outcome.crawlerDataJson)) : undefined,
        choice: selection.choice,
      })),
      configuration,
      {
        artifactResolver: new MaintenanceArtifactResolver(),
        fileOrganizer: this.fileOrganizer,
        localScanService: new LocalScanService(),
        logger: runtimeLoggerService.getLogger(`scrape-confirm:${manifest.id}`),
        nfoGenerator: {
          writeNfo: async (nfoPath, data, options) =>
            await this.nfoGenerator.writeNfo(nfoPath, data, {
              ...options,
              buildTags: options?.buildTags ?? buildMovieTags,
            }),
        },
        pathExists: async (filePath) =>
          await stat(filePath)
            .then((value) => value.isFile())
            .catch(() => false),
        publish: async ({
          operationId,
          sourceVideoPath,
          targetVideoPath,
          artifacts,
          obsoletePaths,
          replaceExistingArtifacts,
        }) => {
          await commitRegisteredPublication(
            {
              operationId,
              operationType: "maintenance",
              sourceVideoPath,
              targetVideoPath,
              artifacts,
              obsoletePaths,
              replaceExistingArtifacts,
            },
            {
              journal: state.repositories.publicationJournal,
              repairIssues: state.repositories.libraryRepairIssues,
              roots: [...roots.values()],
            },
          );
        },
      },
    );

    const updatedByItem = new Map(confirmation.items.map((item) => [item.fileId, item]));
    for (const {
      item,
      outcome,
      outputRootId,
      outputRelativePath: previousOutputRelativePath,
      outputRoot,
      nfoRoot,
    } of resolvedSelected) {
      const updated = updatedByItem.get(item.id);
      if (!updated) continue;
      const outputRelativePath = toRootRelativePath(outputRoot, updated.targetVideoPath);
      const nfoRelativePath = updated.targetNfoPath ? toRootRelativePath(nfoRoot, updated.targetNfoPath) : null;
      const existingEntry = await state.repositories.library.getEntry(outputRootId, previousOutputRelativePath);
      const fileStats = await stat(updated.targetVideoPath);
      const crawlerDataJson = outcome.crawlerDataJson ?? "{}";
      const crawlerData = crawlerDataSchema.parse(JSON.parse(crawlerDataJson));
      await state.repositories.scrapeRuns.reviseSuccess({
        outcomeId: outcome.id,
        crawlerDataJson,
        nfoRootId: nfoRelativePath && nfoRoot.id !== outputRoot.id ? nfoRoot.id : null,
        nfoRelativePath,
        outputRootId: outputRoot.id,
        outputRelativePath,
        uncensoredAmbiguous: false,
        size: fileStats.size,
        modifiedAt: fileStats.mtime,
        libraryEntry: {
          id: existingEntry.id,
          rootId: outputRoot.id,
          rootRelativePath: outputRelativePath,
          mediaIdentity: existingEntry.mediaIdentity,
          size: fileStats.size,
          modifiedAt: fileStats.mtime,
          title: existingEntry.title ?? crawlerData.title,
          number: existingEntry.number ?? crawlerData.number,
          actors: existingEntry.actors,
          crawlerDataJson,
          thumbnailPath:
            (updated.assets.poster ?? updated.assets.thumb)
              ? toRootRelativePath(nfoRoot, updated.assets.poster ?? updated.assets.thumb ?? "")
              : null,
          assets: toLibraryAssets(nfoRoot, { ...updated.assets, downloaded: [] }),
          lastKnownPath: outputRelativePath,
          createdAt: existingEntry.createdAt,
          lastRefreshedAt: new Date(),
        },
      });
    }
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    return manifest.id;
  }

  async nfoRead(input: NfoReadInput): Promise<NfoReadResponse> {
    return await this.nfoAdapter.read(input);
  }

  async nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse> {
    return await this.nfoAdapter.write(input);
  }

  async posterCropSession(id: string): Promise<PosterCropSessionResponse> {
    const context = await this.loadOutcomeContext(id);
    if (context.outcome.outcome !== "success" || !context.outcome.outputRelativePath) {
      throw new Error("Poster editing requires a successful scrape outcome with local output");
    }
    return await this.posterCropAdapter.session(this.toArtifactRecord(context.item, context.outcome));
  }

  async posterCropSave(input: PosterCropSaveInput): Promise<PosterCropSessionResponse> {
    const context = await this.loadOutcomeContext(input.id);
    if (context.outcome.outcome !== "success" || !context.outcome.outputRelativePath) {
      throw new Error("Poster editing requires a successful scrape outcome with local output");
    }
    return await this.posterCropAdapter.save(this.toArtifactRecord(context.item, context.outcome), input);
  }

  async deleteFile(input: FileActionInput): Promise<FileActionResponse> {
    const state = await this.persistence.getState();
    const entry = await state.repositories.library
      .getEntry(input.rootId, input.relativePath)
      .catch((error: unknown) => {
        if (error instanceof Error && error.message.startsWith("Library entry not found:")) return null;
        throw error;
      });
    const obsolete = [
      { rootId: input.rootId, relativePath: input.relativePath },
      ...(entry?.files.map((file) => ({ rootId: file.rootId, relativePath: file.rootRelativePath })) ?? []),
      ...(entry?.assets.flatMap((asset) =>
        asset.rootId && asset.relativePath ? [{ rootId: asset.rootId, relativePath: asset.relativePath }] : [],
      ) ?? []),
    ];
    await commitPublishedMedia(
      {
        operationId: `delete:${input.rootId}:${input.relativePath}`,
        operationType: "maintenance",
        artifacts: [],
        assets: [],
        obsolete,
      },
      {
        resolveRoot: async (rootId) => await this.mediaRoots.getActiveRoot(rootId),
        journal: state.repositories.publicationJournal,
        commit: () => {
          if (entry) state.repositories.library.deleteEntry(entry.id);
        },
        repairIssues: state.repositories.libraryRepairIssues,
      },
    );
    return { ok: true, rootId: input.rootId, relativePath: input.relativePath };
  }

  async close(): Promise<void> {
    if (this.scrapeInvalidationTimer) {
      clearTimeout(this.scrapeInvalidationTimer);
      this.scrapeInvalidationTimer = null;
    }
    this.closed = true;
    await this.workflow?.abortForShutdown();
  }

  private async coordinator(): Promise<ScrapeCoordinator<ScrapeStartInput, ScrapeRunManifest, ServerManualScrape>> {
    if (this.closed) throw new Error("Scrape queue is closing");
    if (this.workflow) return this.workflow;
    const state = await this.persistence.initialize();
    this.workflow = new ScrapeCoordinator(state.repositories.scrapeRuns, this.host);
    return this.workflow;
  }

  private async createRun(input: ScrapeStartInput): Promise<ScrapeRunManifest> {
    if (input.refs.length === 0) throw new Error("Scrape run requires at least one file");
    for (const ref of input.refs) await this.mediaRoots.getActiveRoot(ref.rootId);
    if (input.outputRootId) await this.mediaRoots.getActiveRoot(input.outputRootId);
    return await (await this.persistence.getState()).repositories.scrapeRuns.create({
      rootId: input.refs[0]?.rootId ?? "",
      outputRootId: input.outputRootId ?? null,
      executionMode: input.refs.length === 1 ? "single" : "batch",
      items: input.refs.map((ref, ordinal) => ({
        ordinal,
        rootId: ref.rootId,
        relativePath: ref.relativePath,
        manualUrl: input.manualUrl ?? null,
        uncensoredChoice: input.uncensoredConfirmed ? "uncensored" : null,
      })),
    });
  }

  private async createExecution(manifest: ScrapeRunManifest, reporter: ScrapeWorkflowReporter) {
    const roots = new Map<string, MediaRoot>();
    for (const item of manifest.items) {
      if (!roots.has(item.rootId)) roots.set(item.rootId, await this.mediaRoots.getActiveRoot(item.rootId));
    }
    if (manifest.requestedOutputRootId) await this.mediaRoots.getActiveRoot(manifest.requestedOutputRootId);
    const configuration = await this.config.get();
    applyScrapeNetworkPolicy(this.networkClient, configuration);
    const policy = createScrapeExecutionPolicy(configuration, { logger: console });
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const settledAttemptIds = new Set(manifest.outcomes.map((outcome) => outcome.attemptId));
    const openAttemptByItemId = new Map(
      manifest.attempts
        .filter((attempt) => !settledAttemptIds.has(attempt.id))
        .map((attempt) => [attempt.itemId, attempt.id]),
    );
    const records =
      openAttemptByItemId.size > 0 ? manifest.items.filter((item) => openAttemptByItemId.has(item.id)) : manifest.items;
    return {
      items: records.map((item) => {
        const root = roots.get(item.rootId);
        if (!root) throw new Error(`Scrape root disappeared before session creation: ${item.rootId}`);
        return {
          id: item.id,
          rootId: item.rootId,
          relativePath: item.relativePath,
          sourcePath: resolveRootRelativePath(root, item.relativePath),
          manualScrape: { manualUrl: item.manualUrl, uncensoredChoice: item.uncensoredChoice },
        };
      }),
      concurrency: policy.concurrency,
      admitItem: async (item: ScrapeRunItem<ServerManualScrape>) => {
        const existing = openAttemptByItemId.get(item.id);
        if (existing) return existing;
        const attempt = repository.admitAttempt(item.id);
        openAttemptByItemId.set(item.id, attempt.id);
        return attempt.id;
      },
      acquireItem: (item: ScrapeRunItem<ServerManualScrape>) =>
        mediaPathOwnership.acquire(item.rootId, item.relativePath, item.id),
      executeItem: async (item: ScrapeRunItem<ServerManualScrape>, signal: AbortSignal, attemptId: string) =>
        await this.executeItem(manifest, item, signal, attemptId, policy.restGate ?? undefined, reporter),
      commitItem: async (item: ScrapeRunItem<ServerManualScrape>, result: ScrapeResult, attemptId: string) =>
        await this.commitItem(manifest, item, result, attemptId),
    };
  }

  private async executeItem(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItem<ServerManualScrape>,
    signal: AbortSignal,
    attemptId: string,
    restGate: { waitBeforeStart(signal?: AbortSignal): Promise<void> } | undefined,
    reporter: ScrapeWorkflowReporter,
  ): Promise<ScrapeResult> {
    try {
      await restGate?.waitBeforeStart(signal);
      const root = await this.mediaRoots.getActiveRoot(item.rootId);
      const outputRoot = manifest.requestedOutputRootId
        ? await this.mediaRoots.getActiveRoot(manifest.requestedOutputRootId)
        : root;
      const metadataRoot = await this.resolveMetadataRoot(outputRoot);
      const runtimeResult = await this.runtime.scrape({
        root,
        outputRoot,
        relativePath: item.relativePath,
        scrapeSessionId: manifest.id,
        operationId: `${manifest.id}:${attemptId}`,
        publicationRoots: Array.from(
          new Map([root, outputRoot, metadataRoot].map((entry) => [entry.id, entry])).values(),
        ),
        manualScrape: this.resolveManualScrape(item.manualScrape?.manualUrl),
        progress: {
          fileIndex: (manifest.items.find((candidate) => candidate.id === item.id)?.ordinal ?? 0) + 1,
          totalFiles: manifest.items.length,
        },
        localState: item.manualScrape?.uncensoredChoice
          ? { uncensoredChoice: item.manualScrape.uncensoredChoice }
          : undefined,
        signal,
        onEvent: (type, message) => {
          this.addEvent(manifest.id, type, message, item.id);
        },
        onProgress: ({ value, current, total }) => {
          reporter.progress(item.id, value * total - (current - 1) * 100);
        },
        onStage: (stage, message) => {
          reporter.stage({ stage, message, itemId: item.id });
        },
      });
      const result: PlannedScrapeResult = {
        ...runtimeResult.result,
        fileId: item.id,
        ...(runtimeResult.status === "success" ? { publication: runtimeResult } : {}),
      };
      return result;
    } catch (error) {
      if (signal.aborted) throw error;
      return createFailedResult(item, errorMessage(error));
    }
  }

  private async commitItem(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItem<ServerManualScrape>,
    result: ScrapeResult,
    attemptId: string,
  ): Promise<ScrapeResult> {
    const state = await this.persistence.getState();
    const publication = (result as PlannedScrapeResult).publication;
    let nfoRelativePath: string | null = null;
    let success: ScrapeSuccessPublicationFacts | undefined;
    if (result.status === "success") {
      if (!publication) throw new Error(`Missing successful scrape publication for item ${item.id}`);
      const outputRef = publication.plan.video?.target;
      if (!outputRef) throw new Error(`Successful scrape has no video publication target: ${item.id}`);
      const metadataRoot = await this.resolveMetadataRoot(await this.mediaRoots.getActiveRoot(outputRef.rootId));
      nfoRelativePath = publication.nfoPath ? toRootRelativePath(metadataRoot, publication.nfoPath) : null;
      success = {
        plan: publication.plan,
        crawlerData: publication.crawlerData,
        identity: publication.crawlerData.number || result.fileName,
        nfo: nfoRelativePath ? { rootId: metadataRoot.id, relativePath: nfoRelativePath } : null,
        size: publication.size,
        modifiedAt: publication.modifiedAt,
        uncensoredAmbiguous: item.manualScrape?.uncensoredChoice
          ? false
          : (publication.result.uncensoredAmbiguous ?? false),
      };
    }
    const committed = await commitScrapeTerminalResult({
      result,
      attemptId,
      itemPath: item.relativePath,
      success,
      scrapeRuns: state.repositories.scrapeRuns,
      resolveRoot: async (rootId) => await this.mediaRoots.getActiveRoot(rootId),
      acquireAll: (refs) => mediaPathOwnership.acquireAll(refs, item.id),
      journal: state.repositories.publicationJournal,
      repairIssues: state.repositories.libraryRepairIssues,
    });
    this.addEvent(
      manifest.id,
      committed.status === "success" ? "item-success" : committed.status === "skipped" ? "item-skipped" : "item-failed",
      committed.status === "success"
        ? `Generated NFO: ${nfoRelativePath ?? "not generated"}`
        : committed.error
          ? `${item.relativePath}: ${committed.error}`
          : item.relativePath,
      item.id,
    );
    return committed;
  }

  private async handleTerminalRun(
    manifest: ScrapeRunManifest,
    _snapshot: ScrapeRunSnapshot<ServerManualScrape>,
  ): Promise<void> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const summary = repository.summary(manifest);
    if (!summary) throw new Error(`Scrape run finalization disappeared after update: ${manifest.id}`);
    const terminalRun = await this.historyRunDto(manifest);
    const terminalStatus = summary.disposition;
    this.addEvent(
      manifest.id,
      terminalStatus,
      terminalStatus === "completed"
        ? `Scrape completed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}`
        : `Scrape failed. Succeeded: ${summary.successCount}, Failed: ${summary.failedCount}, Skipped: ${summary.skippedCount}`,
    );
    this.taskEvents.lifecycle({
      id: terminalRun.id,
      kind: "scrape",
      rootId: terminalRun.rootId,
      rootDisplayName: terminalRun.rootDisplayName,
      status: terminalStatus,
      startedAt: terminalRun.startedAt,
      completedAt: terminalRun.completedAt,
      error: terminalRun.error,
    });
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
  }

  private addEvent(runId: string, type: string, message: string, itemId?: string): TaskEventDto {
    const createdAt = new Date();
    const event: TaskEventDto = {
      id: randomUUID(),
      taskId: runId,
      type,
      message,
      createdAt: createdAt.toISOString(),
    };
    if (this.workflow?.liveRuns().some(({ run }) => run.id === runId)) {
      this.workflow.recordLog(runId, {
        level: type.includes("failed") ? "error" : "info",
        message,
        itemId: itemId ?? null,
        timestamp: createdAt,
      });
    }
    this.taskEvents.log(decorateTaskLog(event));
    return event;
  }

  private async historyRunDto(manifest: ScrapeRunManifest): Promise<ScrapeHistoryRunDto> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const summary = repository.summary(manifest);
    const outcomes = repository.latestOutcomes(manifest);
    return {
      id: manifest.id,
      rootId: manifest.rootId,
      rootDisplayName: await this.getRootDisplayName(manifest.rootId),
      requestedOutputRootId: manifest.requestedOutputRootId,
      outputRootId: summary?.outputRootId ?? null,
      executionMode: manifest.executionMode,
      disposition: summary?.disposition ?? "interrupted",
      createdAt: manifest.createdAt.toISOString(),
      startedAt: summary?.startedAt?.toISOString() ?? null,
      completedAt: summary?.completedAt.toISOString() ?? null,
      successCount: summary?.successCount ?? outcomes.filter((outcome) => outcome.outcome === "success").length,
      failedCount: summary?.failedCount ?? outcomes.filter((outcome) => outcome.outcome === "failed").length,
      skippedCount: summary?.skippedCount ?? outcomes.filter((outcome) => outcome.outcome === "skipped").length,
      totalBytes:
        summary?.totalBytes ??
        outcomes.reduce((total, outcome) => total + (outcome.outcome === "success" ? outcome.size : 0), 0),
      error: summary?.error ?? SCRAPE_BACKEND_INTERRUPTED_MESSAGE,
    };
  }

  private async outcomeToDto(context: OutcomeContext): Promise<ScrapeResultDto> {
    const libraryEntry = await (await this.persistence.getState()).repositories.library.getEntryBySourceOutcomeId(
      context.outcome.id,
    );
    return toScrapeResultDto(context.outcome, context.item, {
      runId: context.manifest.id,
      rootDisplayName: await this.getRootDisplayName(context.item.rootId),
      runCreatedAt: context.manifest.createdAt,
      assets: libraryEntry?.assets ?? [],
    });
  }

  private async liveRunSnapshotDto(
    manifest: ScrapeRunManifest,
    snapshot: ScrapeRunSnapshot<ServerManualScrape>,
    startedAt: Date | null,
  ): Promise<ScrapeRunSnapshotDto> {
    return toScrapeRunSnapshotDto({
      manifest,
      snapshot,
      startedAt,
      rootDisplayName: await this.getRootDisplayName(manifest.rootId),
      completedAt: manifest.completedAt,
    });
  }

  private async loadOutcomeContext(outcomeId: string): Promise<OutcomeContext> {
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const manifests = await repository.list();
    const manifest = manifests.find((candidate) => candidate.outcomes.some((outcome) => outcome.id === outcomeId));
    if (!manifest) throw new Error(`Scrape outcome not found: ${outcomeId}`);
    const outcome = manifest.outcomes.find((candidate) => candidate.id === outcomeId);
    if (!outcome) throw new Error(`Scrape outcome not found: ${outcomeId}`);
    const item = manifest.items.find((candidate) => candidate.id === outcome.itemId);
    if (!item) throw new Error(`Scrape outcome item is missing from manifest: ${outcome.itemId}`);
    return { manifest, item, outcome };
  }

  private async buildAmbiguousUncensoredItems(runId: string): Promise<AmbiguousUncensoredItemDto[]> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(runId);
    const itemById = new Map(manifest.items.map((item) => [item.id, item]));
    return state.repositories.scrapeRuns
      .latestOutcomes(manifest)
      .filter((outcome) => outcome.outcome === "success" && outcome.uncensoredAmbiguous)
      .flatMap((outcome) => {
        const item = itemById.get(outcome.itemId);
        if (!item) return [];
        const crawlerData = outcome.crawlerDataJson
          ? crawlerDataSchema.parse(JSON.parse(outcome.crawlerDataJson))
          : null;
        return [
          {
            id: outcome.id,
            ref: { rootId: item.rootId, relativePath: item.relativePath },
            fileId: item.id,
            fileName: path.posix.basename(item.relativePath),
            number:
              crawlerData?.number || path.posix.basename(item.relativePath, path.posix.extname(item.relativePath)),
            title: crawlerData?.title_zh || crawlerData?.title || null,
            nfoRelativePath: outcome.nfoRelativePath,
          },
        ];
      });
  }

  private toArtifactRecord(item: ScrapeRunItemRecord, outcome: ScrapeItemOutcomeRecord): ServerScrapeArtifactRecord {
    return {
      rootId: item.rootId,
      relativePath: item.relativePath,
      nfoRootId: outcome.nfoRootId,
      outputRootId: outcome.outputRootId,
      outputRelativePath: outcome.outputRelativePath,
    };
  }

  private resolveManualScrape(
    manualUrl?: string | null,
  ): Parameters<MountedRootScrapeRuntime["scrape"]>[0]["manualScrape"] {
    const trimmed = manualUrl?.trim();
    if (!trimmed) return undefined;
    const validation = validateManualScrapeUrl(trimmed);
    if (!validation.valid) throw new Error(validation.message);
    return { site: validation.route.site, detailUrl: validation.route.detailUrl };
  }

  private async resolveMetadataRoot(primaryRoot: MediaRoot): Promise<MediaRoot> {
    const metadataPath = (await this.config.get()).paths.metadataPath.trim();
    return metadataPath ? await this.mediaRoots.ensureMetadataRoot(metadataPath) : primaryRoot;
  }

  private resolveMetadataVideoPath(result: ServerScrapeArtifactRecord): string {
    const outputRelativePath = result.outputRelativePath ?? result.relativePath;
    return result.nfoRootId
      ? path.posix.join(
          path.posix.dirname(outputRelativePath),
          `${path.posix.basename(outputRelativePath, path.posix.extname(outputRelativePath))}.strm`,
        )
      : outputRelativePath;
  }

  private async getRootDisplayName(rootId: string): Promise<string> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots
      .get(rootId, { includeDeleted: true })
      .catch(() => null);
    return root?.displayName ?? "未知媒体目录";
  }

  private scheduleScrapeInvalidation(): void {
    if (this.scrapeInvalidationTimer) return;
    this.scrapeInvalidationTimer = setTimeout(() => {
      this.scrapeInvalidationTimer = null;
      this.taskEvents.invalidate("scrape-live");
    }, 250);
  }
}
