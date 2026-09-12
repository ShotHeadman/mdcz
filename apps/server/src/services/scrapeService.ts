import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { type MediaRoot, resolveRootRelativePath, toRootRelativePath } from "@mdcz/media-store";
import type { ScrapeItemOutcomeRecord, ScrapeRunItemRecord, ScrapeRunManifest } from "@mdcz/persistence";
import type { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { mediaPathOwnership } from "@mdcz/runtime/library";
import { buildMovieTags, LocalScanService } from "@mdcz/runtime/maintenance";
import type { NetworkClient } from "@mdcz/runtime/network";
import {
  commitPublishedMedia,
  commitScrapeTerminalResult,
  createPublicationPlan,
  registeredMediaLocations,
  type ScrapeFileTransitions,
  type ScrapeSuccessPublicationFacts,
} from "@mdcz/runtime/publication";
import {
  applyScrapeNetworkPolicy,
  buildScrapePublicationKey,
  buildUncensoredRevision,
  confirmUncensoredOutputs,
  createScrapeExecutionPolicy,
  FileOrganizer,
  type MountedRootScrapeRuntime,
  type MountedRootScrapeRuntimeItemSuccess,
  NfoGenerator,
  PosterCropService,
  type PreparedMountedRootScrape,
  validatePreparedScrapeFiles,
} from "@mdcz/runtime/scrape";
import { runtimeLoggerService } from "@mdcz/runtime/shared";
import {
  resolveScrapeAttempts,
  resolveScrapeRetry,
  ScrapeCoordinator,
  type ScrapeHostExecution,
  type ScrapeHostPort,
  type ScrapePreparationResult,
  type ScrapeRunItem,
  type ScrapeRunItemInitialState,
  type ScrapeRunSnapshot,
  type ScrapeWorkflowReporter,
  toFinalizedScrapeRunSnapshot,
  toScrapeResultFromOutcome,
  toScrapeRunSnapshotDto,
} from "@mdcz/runtime/tasks";
import type { Configuration } from "@mdcz/shared/config";
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
  type ScrapeResultDetailResponse,
  type ScrapeResultDto,
  type ScrapeRunSnapshotDto,
  type ScrapeStartInput,
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
  prepareScrapeItem?: <T extends { relativePath: string; caseId?: string }>(item: T) => T;
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
    this.imageHostCooldownStore.clear();
    runtimeLoggerService.getLogger("ScrapeService").info("Cleared image host cooldowns for user-initiated retry");
    const workflow = await this.coordinator();
    const snapshot = await workflow.retry(input.taskId, input.itemIds);
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
    const itemById = new Map(manifest.items.map((item) => [item.id, item]));
    const selectedItems = input.items;
    const selected = selectedItems.map((selection) => {
      const item = itemById.get(selection.itemId);
      if (!item) throw new Error(`Item does not belong to scrape task: ${selection.itemId}`);
      const outcome = outcomeByItem.get(item.id);
      if (!outcome || outcome.outcome !== "success" || !outcome.outputRootId || !outcome.outputRelativePath) {
        throw new Error(`Item does not belong to successful scrape output: ${selection.itemId}`);
      }
      return { selection, item, outcome };
    });

    const configuration = await this.config.get();
    const roots = new Map<string, MediaRoot>(
      (await state.repositories.mediaRoots.list()).map((root) => [root.id, root]),
    );
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
    const locations = await registeredMediaLocations(
      state.repositories.library,
      (id) => this.mediaRoots.get(id),
      resolvedSelected.map(({ outputRoot, outputRelativePath }) =>
        resolveRootRelativePath(outputRoot, outputRelativePath),
      ),
    );
    const confirmation = await confirmUncensoredOutputs(
      resolvedSelected.map(({ selection, item, outcome, outputRelativePath, outputRoot, nfoRoot }) => ({
        fileId: item.id,
        videoPath: resolveRootRelativePath(outputRoot, outputRelativePath),
        nfoPath: outcome.nfoRelativePath ? resolveRootRelativePath(nfoRoot, outcome.nfoRelativePath) : undefined,
        crawlerData: outcome.crawlerDataJson ? crawlerDataSchema.parse(JSON.parse(outcome.crawlerDataJson)) : undefined,
        groupId: locations.get(resolveRootRelativePath(outputRoot, outputRelativePath))?.groupId,
        registeredAssets: locations.get(resolveRootRelativePath(outputRoot, outputRelativePath))?.assets,
        metadataVideoPath: locations.get(resolveRootRelativePath(outputRoot, outputRelativePath))?.strmPath,
        choice: selection.choice,
      })),
      configuration,
      {
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
        publish: async ({ operationId, plan, updates }) => {
          const revisions = await Promise.all(
            updates.map(async (update) => {
              const selected = resolvedSelected.find(({ item }) => item.id === update.fileId);
              if (!selected) throw new Error(`Uncensored confirmation item disappeared: ${update.fileId}`);
              const { outcome, outputRootId, outputRelativePath } = selected;
              const [entry, fileStats] = await Promise.all([
                state.repositories.library.getEntry(outputRootId, outputRelativePath),
                stat(update.sourceVideoPath),
              ]);
              return buildUncensoredRevision({
                roots: [...roots.values()],
                update,
                outcome,
                entry,
                size: fileStats.size,
                modifiedAt: fileStats.mtime,
              });
            }),
          );
          const publicationPlan = createPublicationPlan(operationId, "maintenance", plan, [...roots.values()]);
          await commitPublishedMedia(publicationPlan, {
            journal: state.repositories.publicationJournal,
            outputs: state.repositories.library,
            repairIssues: state.repositories.libraryRepairIssues,
            resolveRoot: async (rootId) => {
              const root = roots.get(rootId);
              if (!root) throw new Error(`Publication root not found: ${rootId}`);
              return root;
            },
            commit: () => state.repositories.scrapeRuns.reviseSuccess(revisions),
          });
        },
      },
    );
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
    state.repositories.library.deleteEntry(entry.id);
    this.taskEvents.invalidate("scrape-history", "pending-confirmation");
    return { ok: true, ...target };
  }

  async deleteFile(input: FileActionInput): Promise<FileActionResponse> {
    const [target] = await this.mediaRoots.canonicalizeFileRefs([input]);
    if (!target) throw new Error("File ref is required");
    const state = await this.persistence.getState();
    const entry = await state.repositories.library
      .getEntry(target.rootId, target.relativePath)
      .catch((error: unknown) => {
        if (error instanceof Error && error.message.startsWith("Library entry not found:")) return null;
        throw error;
      });
    const deleteFiles = [
      target,
      ...(entry?.files.map((file) => ({ rootId: file.rootId, relativePath: file.rootRelativePath })) ?? []),
    ];
    await commitPublishedMedia(
      {
        operationId: `delete:${target.rootId}:${target.relativePath}`,
        operationType: "maintenance",
        artifacts: [],
        assets: [],
        obsolete: [],
        deleteFiles,
      },
      {
        resolveRoot: async (rootId) => await this.mediaRoots.get(rootId),
        journal: state.repositories.publicationJournal,
        outputs: state.repositories.library,
        commit: () => {
          if (entry) state.repositories.library.deleteEntry(entry.id);
        },
        repairIssues: state.repositories.libraryRepairIssues,
      },
    );
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
    if (input.refs.length === 0) throw new Error("Scrape run requires at least one file");
    if (input.executionMode === "batch" && !input.outputRootId) {
      throw new Error("Batch scrapes require outputRootId");
    }
    if (!input.executionMode) throw new Error("Scrape executionMode is required");
    const refs = await this.mediaRoots.canonicalizeFileRefs(input.refs);
    const rootId = refs[0]?.rootId;
    if (!rootId) throw new Error("Scrape run requires at least one file");
    return await (await this.persistence.getState()).repositories.scrapeRuns.create({
      rootId,
      outputRootId: input.outputRootId ?? null,
      outputRelativeDirectory: input.outputRelativeDirectory || null,
      executionMode: input.executionMode,
      items: refs.map((ref, ordinal) => ({
        ordinal,
        rootId: ref.rootId,
        relativePath: ref.relativePath,
        manualUrl: input.manualUrl ?? null,
        uncensoredChoice: input.uncensoredConfirmed ? "uncensored" : null,
      })),
    });
  }

  private async createExecution(
    manifest: ScrapeRunManifest,
    reporter: ScrapeWorkflowReporter,
  ): Promise<ScrapeHostExecution<ServerManualScrape, PreparedMountedRootScrape>> {
    const runtime = this.runtime.createExecution(manifest.executionMode);
    const roots = new Map<string, MediaRoot>();
    for (const item of manifest.items) {
      if (!roots.has(item.rootId)) roots.set(item.rootId, await this.mediaRoots.get(item.rootId));
    }
    const requestedOutputRoot = manifest.requestedOutputRootId
      ? await this.mediaRoots.get(manifest.requestedOutputRootId)
      : undefined;
    if (requestedOutputRoot) roots.set(requestedOutputRoot.id, requestedOutputRoot);
    const configuration = await this.config.get();
    applyScrapeNetworkPolicy(this.networkClient, configuration);
    const policy = createScrapeExecutionPolicy(configuration, { logger: console });
    const repository = (await this.persistence.getState()).repositories.scrapeRuns;
    const { openAttemptByItemId, latestOutcomeByItemId } = resolveScrapeAttempts(manifest);
    const initialItems: ScrapeRunItemInitialState<ServerManualScrape>[] = manifest.items.map((item) => {
      const outcome = latestOutcomeByItemId.get(item.id);
      if (openAttemptByItemId.has(item.id) || !outcome) return { id: item.id, status: "pending", error: null };
      return {
        id: item.id,
        status: outcome.outcome,
        error: outcome.error,
        result: toScrapeResultFromOutcome(item, outcome),
      };
    });
    const items = await Promise.all(
      manifest.items.map(async (item) => {
        const root = roots.get(item.rootId);
        if (!root) throw new Error(`Scrape root disappeared before session creation: ${item.rootId}`);
        const retrying = openAttemptByItemId.has(item.id);
        const execution = await resolveScrapeRetry({
          item,
          retrying,
          latestOutcome: latestOutcomeByItemId.get(item.id),
          outputRoot: requestedOutputRoot ?? root,
          outputRelativeDirectory: manifest.requestedOutputRelativeDirectory ?? "",
          failedOutputFolder: configuration.paths.failedOutputFolder,
          resolveRoot: async (id) => {
            const resolved = roots.get(id) ?? (await this.mediaRoots.get(id));
            roots.set(id, resolved);
            return resolved;
          },
        });
        return this.prepareScrapeItem({
          id: item.id,
          rootId: item.rootId,
          relativePath: item.relativePath,
          ...execution,
          manualScrape: { manualUrl: item.manualUrl, uncensoredChoice: item.uncensoredChoice },
        });
      }),
    );
    return {
      items,
      initialItems,
      executionGeneration: manifest.executionGeneration,
      concurrency: manifest.executionMode === "single" ? 1 : policy.concurrency,
      admitItem: async (item: ScrapeRunItem<ServerManualScrape>) => {
        const existing = openAttemptByItemId.get(item.id);
        if (existing) return existing;
        const attempt = repository.admitAttempt(item.id);
        openAttemptByItemId.set(item.id, attempt.id);
        return attempt.id;
      },
      acquireItem: (item: ScrapeRunItem<ServerManualScrape>) =>
        mediaPathOwnership.acquire(
          item.executionSource?.rootId ?? item.rootId,
          item.executionSource?.relativePath ?? item.relativePath,
          item.id,
        ),
      getPublicationKey: (_item: ScrapeRunItem<ServerManualScrape>, prepared: PreparedMountedRootScrape) =>
        buildScrapePublicationKey(prepared.fileScrape.outputPlan),
      prepareItem: async (item: ScrapeRunItem<ServerManualScrape>, signal: AbortSignal, attemptId: string) =>
        await this.prepareItem(
          manifest,
          item,
          configuration,
          signal,
          attemptId,
          policy.restGate ?? undefined,
          reporter,
          runtime,
        ),
      validatePrepared: async (
        prepared: readonly {
          item: ScrapeRunItem<ServerManualScrape>;
          prepared: PreparedMountedRootScrape;
        }[],
        failedItems: readonly ScrapeRunItem<ServerManualScrape>[],
      ) =>
        await validatePreparedScrapeFiles([
          ...prepared.map(({ item, prepared }) => ({
            itemId: item.id,
            sourcePath: prepared.fileScrape.sourcePath,
            outputPlan: prepared.fileScrape.outputPlan,
          })),
          ...(configuration.behavior.failedFileMove
            ? failedItems.map((item) => {
                const root = requestedOutputRoot ?? roots.get(item.executionSource?.rootId ?? item.rootId);
                if (!root) throw new Error(`Scrape failure root disappeared: ${item.id}`);
                return {
                  itemId: item.id,
                  sourcePath: item.sourcePath,
                  outputPlan: {
                    targetVideoPath: this.fileOrganizer.resolveFailedVideoPath(
                      item.sourcePath,
                      root.hostPath,
                      configuration,
                    ),
                  },
                };
              })
            : []),
        ]),
      executePreparedItem: async (
        item: ScrapeRunItem<ServerManualScrape>,
        prepared: PreparedMountedRootScrape,
        signal: AbortSignal,
      ) => await this.executePreparedItem(manifest, item, prepared, signal),
      commitPreparationItem: async (
        item: ScrapeRunItem<ServerManualScrape>,
        result: ScrapeResult,
        attemptId: string,
      ) => {
        if (result.status !== "failed" && result.status !== "skipped") {
          throw new Error("Preparation can only commit failed or skipped results");
        }
        const outcome =
          result.status === "failed"
            ? repository.commitOutcome({
                outcome: "failed",
                attemptId,
                error: result.error?.trim() || "刮削预检失败",
              })
            : repository.commitOutcome({
                outcome: "skipped",
                attemptId,
                error: result.error ?? null,
              });
        const committed = { ...result, resultId: outcome.id };
        this.addEvent(
          manifest.id,
          committed.status === "failed" ? "item-failed" : "item-skipped",
          committed.error ? `${item.relativePath}: ${committed.error}` : item.relativePath,
          item.id,
        );
        return committed;
      },
      commitItem: async (item: ScrapeRunItem<ServerManualScrape>, result: ScrapeResult, attemptId: string) => {
        const sourceRoot = roots.get(item.executionSource?.rootId ?? item.rootId);
        if (!sourceRoot) throw new Error(`Scrape root disappeared before item commit: ${item.rootId}`);
        const outputRoot = requestedOutputRoot ?? sourceRoot;
        const runConfiguration: Configuration = {
          ...configuration,
          paths: {
            ...configuration.paths,
            mediaPath: outputRoot.hostPath,
            ...(requestedOutputRoot ? { successOutputFolder: manifest.requestedOutputRelativeDirectory ?? "" } : {}),
          },
        };
        return await this.commitItem(
          manifest,
          item,
          result,
          attemptId,
          this.fileOrganizer.createScrapeFileTransitions({
            configuration: runConfiguration,
            failureRootPath: outputRoot.hostPath,
            sourcePath: item.sourcePath,
            sourceRootPath: sourceRoot.hostPath,
          }),
        );
      },
    };
  }

  private async prepareItem(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItem<ServerManualScrape>,
    configuration: Configuration,
    signal: AbortSignal,
    attemptId: string,
    restGate: { waitBeforeStart(signal?: AbortSignal): Promise<void> } | undefined,
    reporter: ScrapeWorkflowReporter,
    runtime: MountedRootScrapeRuntime,
  ): Promise<ScrapePreparationResult<PreparedMountedRootScrape>> {
    try {
      await restGate?.waitBeforeStart(signal);
      const sourceRef = item.executionSource ?? { rootId: item.rootId, relativePath: item.relativePath };
      const root = await this.mediaRoots.get(sourceRef.rootId);
      const outputRoot = manifest.requestedOutputRootId
        ? await this.mediaRoots.get(manifest.requestedOutputRootId)
        : root;
      const metadataRoot = await this.resolveMetadataRoot(outputRoot);
      const runtimeResult = await runtime.prepare({
        configuration,
        root,
        outputRoot: manifest.requestedOutputRootId ? outputRoot : undefined,
        outputRelativeDirectory: manifest.requestedOutputRelativeDirectory ?? undefined,
        executionMode: manifest.executionMode,
        relativePath: sourceRef.relativePath,
        scrapeSessionId: manifest.id,
        operationId: `${manifest.id}:${attemptId}`,
        publicationRoots: Array.from(
          new Map([root, outputRoot, metadataRoot].map((entry) => [entry.id, entry])).values(),
        ),
        manualScrape: resolveManualScrapeRoute(item.manualScrape?.manualUrl),
        progress: {
          fileIndex: (manifest.items.find((candidate) => candidate.id === item.id)?.ordinal ?? 0) + 1,
          totalFiles: manifest.items.length,
        },
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
        onProgress: ({ value }) => {
          reporter.progress(item.id, value);
        },
        onStage: (stage, message) => {
          reporter.stage({ stage, message, itemId: item.id });
        },
      });
      if (runtimeResult.status === "prepared") return runtimeResult;
      return {
        status: runtimeResult.status,
        result: {
          ...runtimeResult.result,
          fileId: item.id,
          rootId: item.rootId,
          relativePath: item.relativePath,
        },
      };
    } catch (error) {
      if (signal.aborted) throw error;
      return { status: "failed" as const, result: createFailedResult(item, errorMessage(error)) };
    }
  }

  private async executePreparedItem(
    manifest: ScrapeRunManifest,
    item: ScrapeRunItem<ServerManualScrape>,
    prepared: PreparedMountedRootScrape,
    signal: AbortSignal,
  ): Promise<ScrapeResult> {
    try {
      const runtimeResult = await this.runtime.executePrepared(
        prepared,
        {
          fileIndex: (manifest.items.find((candidate) => candidate.id === item.id)?.ordinal ?? 0) + 1,
          totalFiles: manifest.items.length,
        },
        signal,
      );
      return {
        ...runtimeResult.result,
        fileId: item.id,
        rootId: item.rootId,
        relativePath: item.relativePath,
        ...(runtimeResult.status === "success" ? { publication: runtimeResult } : {}),
      } satisfies PlannedScrapeResult;
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
    fileTransitions: ScrapeFileTransitions,
  ): Promise<ScrapeResult> {
    const state = await this.persistence.getState();
    const publication = (result as PlannedScrapeResult).publication;
    let nfoRelativePath: string | null = null;
    let success: ScrapeSuccessPublicationFacts | undefined;
    if (result.status === "success") {
      if (!publication) throw new Error(`Missing successful scrape publication for item ${item.id}`);
      const outputRef = publication.plan.media?.[0]?.target;
      if (!outputRef) throw new Error(`Successful scrape has no video publication target: ${item.id}`);
      const outputRoot = await this.mediaRoots.get(outputRef.rootId);
      const metadataRoot = result.nfo
        ? await this.mediaRoots.get(result.nfo.rootId)
        : await this.resolveMetadataRoot(outputRoot);
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
      resolveRoot: async (rootId) => await this.mediaRoots.get(rootId),
      acquireAll: (refs) => mediaPathOwnership.acquireAll(refs, item.id),
      journal: state.repositories.publicationJournal,
      outputs: state.repositories.library,
      repairIssues: state.repositories.libraryRepairIssues,
      fileTransitions,
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

  private async resolveMetadataRoot(primaryRoot: MediaRoot): Promise<MediaRoot> {
    const metadataPath = (await this.config.get()).paths.metadataPath.trim();
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
