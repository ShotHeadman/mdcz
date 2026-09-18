import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeItemOutcomeRecord, ScrapeRunItemRecord, ScrapeRunManifest } from "@mdcz/persistence";
import { registeredOutputPaths } from "@mdcz/runtime";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import {
  applyScrapeNetworkPolicy,
  confirmUncensoredRunItems,
  createDirectoryScope,
  createScrapeExecution,
  createScrapeExecutionPolicy,
  DirectoryInventory,
  discoverDirectoryFiles,
  FileOrganizer,
  type MountedRootScrapeRuntime,
  type MountedRootScrapeRuntimeItemInput,
  NfoGenerator,
  PosterCropService,
  type PreparedMountedRootScrape,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import {
  ScrapeCoordinator,
  type ScrapeHostExecution,
  type ScrapeHostPort,
  type ScrapeRunItem,
  type ScrapeRunSnapshot,
  type ScrapeWorkflowReporter,
  toFinalizedScrapeRunSnapshot,
  toScrapeRunSnapshotDto,
} from "@mdcz/runtime/tasks";
import type { Configuration } from "@mdcz/shared/config";
import { configurationSchema } from "@mdcz/shared/config";
import { directoryTaskScopeSchema } from "@mdcz/shared/directoryTasks";
import { resolveManualScrapeRoute } from "@mdcz/shared/manualScrapeUrl";
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
  type ScrapeRerunDirectoryInput,
  type ScrapeResultDetailResponse,
  type ScrapeResultDto,
  type ScrapeRunSnapshotDto,
  type ScrapeStartInput,
  type ScrapeTaskControlInput,
  type TaskEventDto,
} from "@mdcz/shared/serverDtos";
import type { UncensoredChoice } from "@mdcz/shared/types";
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
  prepareScrapeItem?: <T extends { relativePath: string; caseId?: string }>(item: T) => T;
}

export class ScrapeService {
  private readonly discoveredInventories = new Map<string, DirectoryInventory>();
  private readonly networkClient: NetworkClient;
  private readonly fileOrganizer = new FileOrganizer();
  private readonly nfoGenerator = new NfoGenerator();
  private readonly posterCropService = new PosterCropService();
  private readonly nfoAdapter: ServerNfoAdapter;
  private readonly posterCropAdapter: ServerPosterCropAdapter;
  private readonly runtime: MountedRootScrapeRuntime;
  private readonly imageHostCooldownStore: Pick<PersistentCooldownStore, "clear">;
  private readonly prepareScrapeItem: <T extends { relativePath: string; caseId?: string }>(item: T) => T;
  private workflow: ScrapeCoordinator<
    ScrapeStartInput,
    ScrapeRunManifest,
    ServerManualScrape,
    PreparedMountedRootScrape
  > | null = null;
  private scrapeInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly host: ScrapeHostPort<
    ScrapeStartInput,
    ScrapeRunManifest,
    ServerManualScrape,
    PreparedMountedRootScrape
  >;

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
    this.prepareScrapeItem = resources.prepareScrapeItem ?? ((item) => item);
    this.nfoAdapter = new ServerNfoAdapter(this.mediaRoots, this.config, this.nfoGenerator, this.persistence);
    this.posterCropAdapter = new ServerPosterCropAdapter(
      this.mediaRoots,
      this.config,
      this.posterCropService,
      this.persistence,
    );
    this.host = {
      create: async (input) => await this.createRun(input),
      runId: (run) => run.id,
      describe: (run) => ({
        executionGeneration: run.executionGeneration,
        totalItems: run.manifestFixedAt ? run.items.length : null,
      }),
      discover: async (run, signal, onProgress) => {
        if (!run.directoryScopeJson || !run.configurationJson)
          throw new Error("Directory run is missing its scope or configuration");
        const repository = (await this.persistence.getState()).repositories;
        const generatedStrms = await registeredOutputPaths(repository.library, (id) => this.mediaRoots.get(id), "strm");
        const found = await discoverDirectoryFiles({
          scope: directoryTaskScopeSchema.parse(JSON.parse(run.directoryScopeJson)),
          configuration: configurationSchema.parse(JSON.parse(run.configurationJson)),
          mediaRoots: this.mediaRoots,
          generatedStrms,
          signal,
          onProgress,
          platform: "server",
        });
        const manifest = await repository.scrapeRuns.fixManifest({
          runId: run.id,
          signal,
          discoveryJson: JSON.stringify(found.discovery),
          items: found.refs.map((ref, ordinal) => ({ ...ref, ordinal })),
        });
        this.discoveredInventories.set(run.id, found.inventory);
        return manifest;
      },
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
    this.addEvent(snapshot.runId, "queued", "Scrape task queued");
    return await this.snapshot({ taskId: snapshot.runId });
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

  async snapshot(input: ScrapeTaskControlInput): Promise<ScrapeRunSnapshotDto> {
    const live = this.workflow?.liveRuns().find(({ run }) => run.id === input.taskId);
    if (live) return await this.liveRunSnapshotDto(live.run, live.snapshot, live.startedAt);
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(input.taskId);
    const summary = state.repositories.scrapeRuns.summary(manifest);
    const outcomes = await Promise.all(
      state.repositories.scrapeRuns.latestOutcomes(manifest).map(async (outcome) => ({
        ...outcome,
        assets: (await state.repositories.library.getEntryBySourceOutcomeId(outcome.id))?.assets ?? [],
      })),
    );
    return toScrapeRunSnapshotDto({
      manifest,
      snapshot: toFinalizedScrapeRunSnapshot({
        id: manifest.id,
        executionGeneration: manifest.executionGeneration,
        revision: manifest.revision,
        items: manifest.items,
        outcomes,
        disposition: summary?.disposition ?? "interrupted",
        error: summary ? summary.error : SCRAPE_BACKEND_INTERRUPTED_MESSAGE,
      }),
      startedAt: summary?.startedAt ?? null,
      completedAt: summary?.completedAt ?? manifest.createdAt,
      rootDisplayName: await this.getRootDisplayName(manifest.rootId),
    });
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
    return await this.relaunch((workflow) => workflow.retry(input.taskId, input.itemIds), "Scrape retry queued");
  }

  async rerunDirectory(input: ScrapeRerunDirectoryInput): Promise<ScrapeRunSnapshotDto> {
    return await this.relaunch((workflow) => workflow.rerunDirectory(input.taskId), "Directory rescan queued");
  }

  private async relaunch(
    launch: (workflow: NonNullable<ScrapeService["workflow"]>) => Promise<ScrapeRunSnapshot<ServerManualScrape>>,
    message: string,
  ): Promise<ScrapeRunSnapshotDto> {
    this.imageHostCooldownStore.clear();
    runtimeLoggerService.getLogger("ScrapeService").info("Cleared image host cooldowns for user-initiated relaunch");
    const snapshot = await launch(await this.coordinator());
    this.addEvent(snapshot.runId, "queued", message);
    return await this.snapshot({ taskId: snapshot.runId });
  }

  async confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<string> {
    const state = await this.persistence.getState();
    const manifest = await state.repositories.scrapeRuns.get(input.taskId);
    const confirmation = await confirmUncensoredRunItems({
      manifest,
      items: input.items,
      configuration: await this.config.get(),
      roots: await state.repositories.mediaRoots.list(),
      repositories: {
        library: state.repositories.library,
        scrapeRuns: state.repositories.scrapeRuns,
        journal: state.repositories.publicationJournal,
        repairIssues: state.repositories.libraryRepairIssues,
      },
      dependencies: {
        fileOrganizer: this.fileOrganizer,
        localScanService: new LocalScanService(),
        logger: runtimeLoggerService.getLogger(`scrape-confirm:${manifest.id}`),
        nfoGenerator: this.nfoGenerator,
        pathExists: async (filePath) =>
          await stat(filePath)
            .then((value) => value.isFile())
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return false;
              throw error;
            }),
      },
    });
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    if (confirmation.failures.length > 0) {
      throw new Error(confirmation.failures.map((failure) => failure.message).join("\n"));
    }
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

  async removeRecord(input: FileActionInput): Promise<FileActionResponse> {
    const [target] = await this.mediaRoots.canonicalizeFileRefs([input]);
    if (!target) throw new Error("File ref is required");
    const state = await this.persistence.getState();
    const entry = await state.repositories.library.getEntry(target.rootId, target.relativePath);
    const file = entry.files.find(
      (candidate) => candidate.rootId === target.rootId && candidate.rootRelativePath === target.relativePath,
    );
    if (!file) throw new Error("Library file not found");
    state.repositories.library.removeFile(file.id);
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    return { ok: true, ...target };
  }

  async close(): Promise<void> {
    if (this.scrapeInvalidationTimer) {
      clearTimeout(this.scrapeInvalidationTimer);
      this.scrapeInvalidationTimer = null;
    }
    this.closed = true;
    await this.workflow?.abortForShutdown();
  }

  private async coordinator(): Promise<
    ScrapeCoordinator<ScrapeStartInput, ScrapeRunManifest, ServerManualScrape, PreparedMountedRootScrape>
  > {
    if (this.closed) throw new Error("Scrape queue is closing");
    if (this.workflow) return this.workflow;
    const state = await this.persistence.initialize();
    this.workflow = new ScrapeCoordinator(state.repositories.scrapeRuns, this.host);
    return this.workflow;
  }

  private async createRun(input: ScrapeStartInput): Promise<ScrapeRunManifest> {
    const configuration = structuredClone(await this.config.get());
    if ("source" in input) {
      const scope = createDirectoryScope(input.source, input.targetDir, configuration);
      const root = await this.mediaRoots.registerPathIntent(scope.scanDir);
      const output = await this.mediaRoots.registerPathIntent(scope.targetDir);
      return await (await this.persistence.getState()).repositories.scrapeRuns.create({
        rootId: root.id,
        outputRootId: output.id,
        outputRelativeDirectory: toRootRelativePath(output, scope.targetDir),
        executionMode: "batch",
        directoryScopeJson: JSON.stringify(scope),
        configurationJson: JSON.stringify(configuration),
        items: [],
      });
    }
    if (input.refs.length === 0) throw new Error("Scrape run requires at least one file");
    if (input.executionMode === "batch" && !input.outputRootId) {
      throw new Error("Batch scrapes require outputRootId");
    }
    if (!input.executionMode) throw new Error("Scrape executionMode is required");
    const inventory = new DirectoryInventory();
    const refs = await inventory.admitRefs(await this.mediaRoots.canonicalizeFileRefs(input.refs), (id) =>
      this.mediaRoots.get(id),
    );
    const rootId = refs[0]?.rootId;
    if (!rootId) throw new Error("Scrape run requires at least one file");
    const manifest = await (await this.persistence.getState()).repositories.scrapeRuns.create({
      rootId,
      outputRootId: input.outputRootId ?? null,
      outputRelativeDirectory: input.outputRelativeDirectory || null,
      executionMode: input.executionMode,
      configurationJson: JSON.stringify(configuration),
      items: refs.map((ref, ordinal) => ({
        ordinal,
        rootId: ref.rootId,
        relativePath: ref.relativePath,
        manualUrl: input.manualUrl ?? null,
        uncensoredChoice: input.uncensoredConfirmed ? "uncensored" : null,
      })),
    });
    this.discoveredInventories.set(manifest.id, inventory);
    return manifest;
  }

  private async createExecution(
    manifest: ScrapeRunManifest,
    reporter: ScrapeWorkflowReporter,
  ): Promise<ScrapeHostExecution<ServerManualScrape, PreparedMountedRootScrape>> {
    const outputRootIds = manifest.requestedOutputRootId ? [manifest.requestedOutputRootId] : [];
    const checkRoots = this.mediaRoots.rootIntegrityGuard(
      manifest.directoryScopeJson ? [...manifest.items.map((item) => item.rootId), ...outputRootIds] : [],
    );
    await checkRoots(outputRootIds);
    for (const rootId of new Set(manifest.items.map((item) => item.rootId))) await this.mediaRoots.get(rootId);
    const requestedOutputRoot = manifest.requestedOutputRootId
      ? await this.mediaRoots.get(manifest.requestedOutputRootId)
      : undefined;
    const configuration = configurationSchema.parse(JSON.parse(manifest.configurationJson ?? "null"));
    applyScrapeNetworkPolicy(this.networkClient, configuration);
    const policy = createScrapeExecutionPolicy(configuration, { logger: console });
    const state = await this.persistence.getState();
    const inventory = this.discoveredInventories.get(manifest.id) ?? new DirectoryInventory();
    const runtime = this.runtime.createExecution(manifest.executionMode, state.repositories.library, inventory);
    this.discoveredInventories.delete(manifest.id);
    const repository = state.repositories.scrapeRuns;
    return await createScrapeExecution<ServerManualScrape, PreparedMountedRootScrape>({
      configuration,
      inventory,
      manifest,
      ownership: () => state.repositories.library.inventoryOwnership(),
      outputRoot: requestedOutputRoot,
      restGate: policy.restGate ?? undefined,
      resolveRoot: (id) => this.mediaRoots.get(id),
      enrichItem: async (item) => {
        const prepared = await this.prepareScrapeItem(item);
        await checkRoots([prepared.executionSource?.rootId ?? prepared.rootId]);
        return prepared;
      },
      manualScrape: (id) => {
        const item = manifest.items.find((item) => item.id === id);
        if (!item) throw new Error(`Scrape item not found: ${id}`);
        return { manualUrl: item.manualUrl, uncensoredChoice: item.uncensoredChoice };
      },
      fileScrape: (prepared) => prepared.fileScrape,
      admitAttempt: (id) => repository.admitAttempt(id),
      publication: {
        scrapeRuns: repository,
        journal: state.repositories.publicationJournal,
      },
      transformResult: (item, result) =>
        item.manualScrape?.uncensoredChoice ? { ...result, uncensoredAmbiguous: false } : result,
      onCommitted: (result) =>
        this.addEvent(
          manifest.id,
          result.status === "success" ? "item-success" : result.status === "skipped" ? "item-skipped" : "item-failed",
          result.status === "success"
            ? `Generated NFO: ${result.nfo?.relativePath ?? "not generated"}`
            : result.error
              ? `${result.relativePath}: ${result.error}`
              : result.relativePath,
          result.fileId,
        ),
      execution: {
        concurrency: manifest.executionMode === "single" ? 1 : policy.concurrency,
        prepareGroup: async (entries, signal) => {
          const inputs = await Promise.all(
            entries.map(({ item, attemptId }) =>
              this.prepareInput(manifest, item, configuration, signal, attemptId, reporter),
            ),
          );
          const results = await runtime.prepareGroup(inputs);
          return results.map((result, index) =>
            result.status === "prepared"
              ? result
              : {
                  status: result.status,
                  result: {
                    ...result.result,
                    fileId: entries[index].item.id,
                    rootId: entries[index].item.rootId,
                    relativePath: entries[index].item.relativePath,
                  },
                },
          );
        },
        executePreparedFiles: async (entries, signal) =>
          await runtime.executePrepared(
            entries.map(({ item, prepared, fileScrape }) => ({
              ...prepared,
              fileScrape,
              caseId: item.caseId,
            })),
            signal,
          ),
      },
    });
  }

  private async prepareInput(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItem<ServerManualScrape>,
    configuration: Configuration,
    signal: AbortSignal,
    attemptId: string,
    reporter: ScrapeWorkflowReporter,
  ): Promise<MountedRootScrapeRuntimeItemInput> {
    const sourceRef = item.executionSource ?? { rootId: item.rootId, relativePath: item.relativePath };
    const root = await this.mediaRoots.get(sourceRef.rootId);
    const outputRoot = manifest.requestedOutputRootId
      ? await this.mediaRoots.get(manifest.requestedOutputRootId)
      : root;
    const metadataRoot = await this.resolveMetadataRoot(outputRoot, configuration);
    return {
      configuration,
      root,
      outputRoot: manifest.requestedOutputRootId ? outputRoot : undefined,
      outputRelativeDirectory: manifest.requestedOutputRelativeDirectory ?? undefined,
      relativePath: sourceRef.relativePath,
      scrapeSessionId: manifest.id,
      operationId: `${manifest.id}:${attemptId}`,
      publicationRoots: Array.from(
        new Map([root, outputRoot, metadataRoot].map((entry) => [entry.id, entry])).values(),
      ),
      manualScrape: resolveManualScrapeRoute(item.manualScrape?.manualUrl),
      localState: item.manualScrape?.uncensoredChoice
        ? { uncensoredChoice: item.manualScrape.uncensoredChoice }
        : undefined,
      outputDirectory:
        item.manualScrape?.manualUrl && manifest.requestedOutputRootId
          ? resolveRootRelativePath(outputRoot, manifest.requestedOutputRelativeDirectory ?? "")
          : undefined,
      outputTemplateRoot: item.outputTemplateRoot,
      signal,
      onEvent: (type, message) => {
        this.addEvent(manifest.id, type, message, item.id);
      },
      onProgress: (value) => {
        reporter.progress(item.id, value);
      },
      onStage: (stage, message) => {
        reporter.stage({ stage, message, itemId: item.id });
      },
    };
  }

  private async handleTerminalRun(
    manifest: ScrapeRunManifest,
    _snapshot: ScrapeRunSnapshot<ServerManualScrape>,
  ): Promise<void> {
    this.discoveredInventories.delete(manifest.id);
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

  private async resolveMetadataRoot(primaryRoot: MediaRoot, configuration: Configuration): Promise<MediaRoot> {
    const metadataPath = configuration.behavior.metadataOnly ? configuration.paths.metadataPath.trim() : "";
    return metadataPath ? await this.mediaRoots.ensurePathRecord({ hostPath: metadataPath }) : primaryRoot;
  }

  private async getRootDisplayName(rootId: string): Promise<string> {
    const root = await (await this.persistence.getState()).repositories.mediaRoots.get(rootId).catch(() => null);
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
