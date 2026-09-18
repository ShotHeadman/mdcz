import { basename } from "node:path";
import type { DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { ScrapeResult, ScrapeResultStatus } from "@mdcz/shared/types";
import { runWithScrapeItem } from "../../network/networkExecution";
import type { MoviePublicationPlan } from "../../publication/types";
import { ScrapeTargetConflictError } from "../../scrape/preflightScrapeTask";
import { TaskExecutor } from "../executor";

export const MAX_LIVE_SCRAPE_LOGS = 200;

export type ScrapeRunLiveStatus =
  | "queued"
  | "discovering"
  | "running"
  | "paused"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";
export type ScrapeRunItemStatus = "pending" | "processing" | "success" | "failed" | "skipped";

export interface ScrapeRunItem<TManualScrape = unknown> {
  id: string;
  rootId: string;
  relativePath: string;
  sourcePath: string;
  manualScrape?: TManualScrape;
  executionSource?: RootFileRef;
  outputTemplateRoot?: string;
  caseId?: string;
}

export interface ScrapeRunItemSnapshot<TManualScrape = unknown> extends ScrapeRunItem<TManualScrape> {
  status: ScrapeRunItemStatus;
  error: string | null;
  result?: ScrapeResult;
}

export type ScrapeRunItemInitialState<TManualScrape = unknown> = Pick<
  ScrapeRunItemSnapshot<TManualScrape>,
  "id" | "error" | "result"
> & {
  status: Exclude<ScrapeRunItemStatus, "processing">;
};

export interface ScrapeRunProgress {
  percent: number | null;
  completedItems: number;
  totalItems: number | null;
}

export interface ScrapeRunStageSnapshot {
  stage: string;
  message: string;
  itemId: string | null;
  relativePath: string | null;
}

export interface ScrapeRunLogEntry {
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  itemId: string | null;
  relativePath: string | null;
}

export interface ScrapeRunSnapshot<TManualScrape = unknown> {
  runId: string;
  executionGeneration: number;
  generation: number;
  revision: number;
  status: ScrapeRunLiveStatus;
  progress: ScrapeRunProgress;
  discovery?: DiscoveryProgress;
  items: ScrapeRunItemSnapshot<TManualScrape>[];
  latestStage: ScrapeRunStageSnapshot | null;
  logs: ScrapeRunLogEntry[];
  error: string | null;
}

export type ScrapePreparationResult<TPrepared> =
  | { status: "prepared"; prepared: TPrepared }
  | { status: "failed" | "skipped"; result: ScrapeResult };

type ScrapeItemPreparation<TPrepared> = { attemptId: string } & (
  | { status: "admitted" }
  | ScrapePreparationResult<TPrepared>
);

export interface MovieGroup {
  itemIds: readonly string[];
  movieId?: string;
  error?: string;
}

export interface ScrapeRunExecution<TManualScrape = unknown, TPrepared = unknown> {
  executionGeneration?: number;
  items: readonly ScrapeRunItem<TManualScrape>[];
  initialItems?: readonly ScrapeRunItemInitialState<TManualScrape>[];
  concurrency: number;
  acquireItems: (items: readonly ScrapeRunItem<TManualScrape>[]) => Promise<() => void> | (() => void);
  movieGroups: readonly MovieGroup[];
  publicationKeys: (items: readonly { item: ScrapeRunItem<TManualScrape>; prepared: TPrepared }[]) => readonly string[];
  admitItem: (item: ScrapeRunItem<TManualScrape>) => Promise<string>;
  prepareGroup: (
    entries: readonly { item: ScrapeRunItem<TManualScrape>; attemptId: string }[],
    signal: AbortSignal,
  ) => Promise<readonly ScrapePreparationResult<TPrepared>[]>;
  checkTargets(items: readonly { item: ScrapeRunItem<TManualScrape>; prepared: TPrepared }[]): Promise<void>;
  executePreparedItems: (
    items: readonly {
      item: ScrapeRunItem<TManualScrape>;
      prepared: TPrepared;
      attemptId: string;
    }[],
    signal: AbortSignal,
  ) => Promise<{
    results: readonly { itemId: string; result: ScrapeResult }[];
    publicationPlan?: MoviePublicationPlan;
    release?: () => Promise<void>;
  }>;
  commitPreparationItem: (
    item: ScrapeRunItem<TManualScrape>,
    result: ScrapeResult,
    attemptId: string,
  ) => Promise<ScrapeResult>;
  commitItems: (
    items: readonly { item: ScrapeRunItem<TManualScrape>; result?: ScrapeResult; attemptId: string }[],
    publicationPlan?: MoviePublicationPlan,
  ) => Promise<readonly { itemId: string; result: ScrapeResult }[]>;
}

export interface ScrapeRunSessionOptions<TManualScrape = unknown, TPrepared = unknown> {
  runId: string;
  executionGeneration?: number;
  totalItems: number | null;
  discover?: (signal: AbortSignal, report: (progress: DiscoveryProgress) => void) => Promise<void>;
  prepare: (signal: AbortSignal) => Promise<ScrapeRunExecution<TManualScrape, TPrepared> | null>;
  onSnapshot: (snapshot: ScrapeRunSnapshot<TManualScrape>) => void;
}

interface MutableScrapeRunItem<TManualScrape> extends ScrapeRunItem<TManualScrape> {
  status: ScrapeRunItemStatus;
  error: string | null;
  result?: ScrapeResult;
}
type ScrapeExecutionGroup<TManualScrape> = {
  items: MutableScrapeRunItem<TManualScrape>[];
  publicationKeys: readonly string[];
};
type ScrapeGroupExecution<TManualScrape> = {
  publicationPlan?: MoviePublicationPlan;
  results: Array<{ item: MutableScrapeRunItem<TManualScrape>; result?: ScrapeResult; attemptId: string }>;
  release: () => Promise<void>;
};

class StaleScrapeRunGenerationError extends Error {}

const isTerminalItemStatus = (status: ScrapeRunItemStatus): boolean =>
  status === "success" || status === "failed" || status === "skipped";

const toTerminalItemStatus = (status: ScrapeResultStatus): ScrapeRunItemStatus => {
  if (status === "success" || status === "failed" || status === "skipped") return status;
  throw new Error(`Scrape commit returned non-terminal status: ${status}`);
};

const createSkippedResult = <TManualScrape>(
  item: MutableScrapeRunItem<TManualScrape>,
  error: string,
): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: basename(item.sourcePath),
  status: "skipped",
  error,
  assets: [],
});

const createFailedResult = <TManualScrape>(item: MutableScrapeRunItem<TManualScrape>, error: string): ScrapeResult => ({
  fileId: item.id,
  rootId: item.rootId,
  relativePath: item.relativePath,
  fileName: basename(item.sourcePath),
  status: "failed",
  error,
  assets: [],
});

export class ScrapeRunSession<TManualScrape = unknown, TPrepared = unknown> {
  private items: MutableScrapeRunItem<TManualScrape>[] = [];
  private itemsById = new Map<string, MutableScrapeRunItem<TManualScrape>>();
  private executionConfig: ScrapeRunExecution<TManualScrape, TPrepared> | null = null;
  private totalItems: number | null;
  private discovery?: DiscoveryProgress;
  private started = false;
  private readonly discoveryController = new AbortController();
  private readonly logs: ScrapeRunLogEntry[] = [];
  private generation = 0;
  private revision = 0;
  private status: ScrapeRunLiveStatus = "queued";
  private latestStage: ScrapeRunStageSnapshot | null = null;
  private error: string | null = null;
  private readonly progressByItemId = new Map<string, number>();
  private readonly preparationByItemId = new Map<string, ScrapeItemPreparation<TPrepared>>();
  private readonly publicationChains = new Map<string, Promise<void>>();
  private preflightPassed = false;
  private readonly shutdownController = new AbortController();
  private executor: { pause(): void; stop(): void } | null = null;
  private runPromise: Promise<void> | null = null;
  private stopPromise: Promise<ScrapeRunSnapshot<TManualScrape>> | null = null;

  constructor(private readonly options: ScrapeRunSessionOptions<TManualScrape, TPrepared>) {
    if (!options.runId.trim()) throw new Error("Scrape run ID must not be empty");
    this.totalItems = options.totalItems;
  }

  private get execution(): ScrapeRunExecution<TManualScrape, TPrepared> {
    if (!this.executionConfig) throw new Error("Scrape execution is not prepared");
    return this.executionConfig;
  }

  private mountExecution(options: ScrapeRunExecution<TManualScrape, TPrepared>): void {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("Scrape run concurrency must be a positive integer");
    }

    const ids = new Set<string>();
    const paths = new Set<string>();
    const initialItemsById = new Map<string, ScrapeRunItemInitialState<TManualScrape>>();
    for (const initialItem of options.initialItems ?? []) {
      if (initialItemsById.has(initialItem.id)) throw new Error(`Duplicate initial scrape item ID: ${initialItem.id}`);
      initialItemsById.set(initialItem.id, initialItem);
    }
    const items = options.items.map((item): MutableScrapeRunItem<TManualScrape> => {
      if (!item.id.trim()) throw new Error("Scrape item ID must not be empty");
      if (!item.rootId.trim()) throw new Error(`Scrape item root ID must not be empty: ${item.id}`);
      if (!item.relativePath.trim()) throw new Error(`Scrape item relative path must not be empty: ${item.id}`);
      if (!item.sourcePath.trim()) throw new Error(`Scrape item source path must not be empty: ${item.id}`);
      if (ids.has(item.id)) throw new Error(`Duplicate scrape item ID: ${item.id}`);
      ids.add(item.id);
      const pathKey = `${item.rootId}\u0000${item.relativePath}`;
      if (paths.has(pathKey)) throw new Error(`Duplicate scrape item path: ${item.rootId}:${item.relativePath}`);
      paths.add(pathKey);
      const initial = initialItemsById.get(item.id);
      return {
        ...item,
        status: initial?.status ?? "pending",
        error: initial?.error ?? null,
        ...(initial?.result ? { result: initial.result } : {}),
      };
    });
    for (const initialItem of initialItemsById.values()) {
      if (!ids.has(initialItem.id)) throw new Error(`Initial scrape item is not in the session: ${initialItem.id}`);
    }
    this.items = items;
    this.itemsById = new Map(items.map((item) => [item.id, item]));
    this.totalItems = items.length;
    this.executionConfig = options;
    this.emitSnapshot();
  }

  async start(): Promise<void> {
    if (this.status !== "queued") throw new Error(`Cannot start scrape run in ${this.status} state`);
    this.setStatus("running");
    this.startDrain();
  }

  async pause(): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.status === "paused") return this.snapshot();
    if (this.status === "discovering") throw new Error("目录扫描不支持暂停，请停止任务");
    if (this.status !== "queued" && this.status !== "running")
      throw new Error(`Cannot pause scrape run in ${this.status} state`);
    this.executor?.pause();
    this.setStatus("paused");
    return this.snapshot();
  }

  async resume(): Promise<void> {
    if (this.status === "queued" || this.status === "running") return;
    if (this.status !== "paused") throw new Error(`Cannot resume scrape run in ${this.status} state`);
    this.setStatus(this.runPromise ? "running" : "queued");
  }

  stop(): Promise<ScrapeRunSnapshot<TManualScrape>> {
    this.stopPromise ??= this.finishStop();
    return this.stopPromise;
  }

  private async finishStop(): Promise<ScrapeRunSnapshot<TManualScrape>> {
    if (this.isTerminalStatus()) return this.snapshot();
    this.setStatus("stopping");
    this.discoveryController.abort();
    this.executor?.stop();
    await this.waitForIdle();
    this.generation += 1;
    this.emitSnapshot();

    if (!this.started || !this.executionConfig) {
      this.setStatus("stopped");
      return this.snapshot();
    }
    try {
      await this.skipOutstandingItems("刮削已停止");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminalError = new AggregateError(
        [error],
        `Scrape interrupted because terminal outcome persistence failed: ${message}`,
      );
      this.error = terminalError.message;
      this.recordLog({ level: "error", message: terminalError.message });
      this.setStatus("interrupted");
      return this.snapshot();
    }
    this.setStatus("stopped");
    return this.snapshot();
  }

  async waitForIdle(): Promise<void> {
    while (this.runPromise) await this.runPromise;
  }
  async abortForShutdown(): Promise<void> {
    if (this.stopPromise) {
      await this.stopPromise;
      return;
    }
    if (this.isTerminalStatus()) return;
    this.setStatus("stopping");
    this.generation += 1;
    this.emitSnapshot();
    this.shutdownController.abort(new Error("Scrape run interrupted by shutdown"));
    this.discoveryController.abort(this.shutdownController.signal.reason);
    this.executor?.stop();
    await this.waitForIdle();
    this.setStatus("interrupted");
  }

  snapshot(): ScrapeRunSnapshot<TManualScrape> {
    const completedItems = this.items.filter((item) => isTerminalItemStatus(item.status)).length;
    const totalItems = this.totalItems;
    const reportedPercent = Math.round(
      ((completedItems + [...this.progressByItemId.values()].reduce((total, percent) => total + percent / 100, 0)) /
        (totalItems || 1)) *
        100,
    );
    return {
      runId: this.options.runId,
      executionGeneration: this.options.executionGeneration ?? 0,
      generation: this.generation,
      revision: this.revision,
      status: this.status,
      progress: {
        percent: totalItems === null ? null : completedItems === totalItems ? 100 : Math.min(99, reportedPercent),
        completedItems,
        totalItems,
      },
      ...(this.discovery ? { discovery: structuredClone(this.discovery) } : {}),
      items: this.items.map((item) => ({ ...item })),
      latestStage: this.latestStage ? { ...this.latestStage } : null,
      logs: this.logs.map((entry) => ({ ...entry, timestamp: new Date(entry.timestamp) })),
      error: this.error,
    };
  }

  recordDiscovery(progress: DiscoveryProgress): void {
    if (this.status !== "discovering") return;
    this.discovery = structuredClone(progress);
    this.emitSnapshot();
  }

  /**
   * The session is the sole progress authority; hosts must not maintain a
   * second counter with different units.
   */
  recordProgress(itemId: string, percent: number): void {
    const item = this.itemsById.get(itemId);
    if (!item || isTerminalItemStatus(item.status)) return;
    const nextPercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
    if (nextPercent <= (this.progressByItemId.get(itemId) ?? 0)) return;
    this.progressByItemId.set(itemId, nextPercent);
    this.emitSnapshot();
  }

  recordStage(stage: Omit<ScrapeRunStageSnapshot, "itemId" | "relativePath"> & { itemId?: string | null }): void {
    const item = stage.itemId ? this.itemsById.get(stage.itemId) : undefined;
    this.latestStage = {
      stage: stage.stage,
      message: stage.message,
      itemId: stage.itemId ?? null,
      relativePath: item?.relativePath ?? null,
    };
    this.emitSnapshot();
  }

  recordLog(
    entry: Omit<ScrapeRunLogEntry, "timestamp" | "itemId" | "relativePath"> & {
      timestamp?: Date;
      itemId?: string | null;
    },
  ): void {
    const item = entry.itemId ? this.itemsById.get(entry.itemId) : undefined;
    this.logs.push({
      timestamp: entry.timestamp ?? new Date(),
      level: entry.level,
      message: entry.message,
      itemId: entry.itemId ?? null,
      relativePath: item?.relativePath ?? null,
    });
    if (this.logs.length > MAX_LIVE_SCRAPE_LOGS) this.logs.splice(0, this.logs.length - MAX_LIVE_SCRAPE_LOGS);
    this.emitSnapshot();
  }

  private startDrain(): void {
    if (this.runPromise || this.status !== "running") return;
    const generation = this.generation;
    const run = Promise.resolve()
      .then(() => this.drain(generation))
      .catch(async (error: unknown) => {
        if (error instanceof StaleScrapeRunGenerationError) return;
        await this.handleFatalError(generation, error);
      });
    const tracked = run.finally(() => {
      if (this.runPromise === tracked) this.runPromise = null;
      if (
        this.status === "running" &&
        (this.items.some((item) => item.status === "pending") ||
          this.items.every((item) => isTerminalItemStatus(item.status)))
      ) {
        this.startDrain();
      }
    });
    this.runPromise = tracked;
  }

  private async drain(generation: number): Promise<void> {
    this.assertCurrent(generation, ["running"]);
    if (!this.started) {
      this.started = true;
      if (this.options.discover) {
        this.setStatus("discovering");
        this.recordStage({ stage: "discovering", message: "正在扫描视频文件" });
        await this.options.discover(this.discoveryController.signal, (progress) => {
          if (generation === this.generation) this.recordDiscovery(progress);
        });
        this.assertCurrent(generation, ["discovering"]);
        this.discoveryController.signal.throwIfAborted();
        this.setStatus("running");
      }
      const execution = await this.options.prepare(this.discoveryController.signal);
      this.assertCurrent(generation, ["running", "discovering", "paused", "stopping"]);
      // Stop still needs the prepared execution to settle admitted retry attempts.
      if (execution) this.mountExecution(execution);
      this.discoveryController.signal.throwIfAborted();
      if (!execution) this.totalItems = 0;
      if (this.items.length === 0) {
        this.recordStage({ stage: "completed", message: "未找到可处理视频" });
        this.setStatus("completed");
        return;
      }
      if (this.status === "discovering") this.setStatus("running");
    }
    if (this.status !== "running") return;
    if (this.items.every((item) => isTerminalItemStatus(item.status))) {
      this.completeLiveRunIfSettled(generation);
      return;
    }
    const isUnprepared = (item: MutableScrapeRunItem<TManualScrape>): boolean => {
      const preparation = this.preparationByItemId.get(item.id);
      return item.status === "pending" && (!preparation || preparation.status === "admitted");
    };
    const unprepared = this.items.filter(isUnprepared);
    if (unprepared.length > 0) {
      await this.prepareItems(unprepared, generation);
      if (this.status !== "running") return;
      if (this.items.some(isUnprepared)) return;
    }

    for (const item of this.items) {
      const preparation = this.preparationByItemId.get(item.id);
      if (
        item.status !== "pending" ||
        !preparation ||
        preparation.status === "admitted" ||
        preparation.status === "prepared"
      )
        continue;
      const committed = await this.execution.commitPreparationItem(item, preparation.result, preparation.attemptId);
      this.assertCurrent(generation, ["running", "paused", "stopping"]);
      this.applyCommittedResult(item, committed);
    }
    const pending = this.items.filter((item) => item.status === "pending");
    const prepared = pending.flatMap((item) => {
      const preparation = this.preparationByItemId.get(item.id);
      return preparation?.status === "prepared" ? [{ item, prepared: preparation.prepared }] : [];
    });
    if (!this.preflightPassed) {
      this.recordStage({ stage: "check-output", message: "冲突预检" });
      try {
        await this.execution.checkTargets(prepared);
        this.preflightPassed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const itemIds = new Set(
          error instanceof ScrapeTargetConflictError ? error.conflicts.map((conflict) => conflict.itemId) : [],
        );
        for (const group of this.execution.movieGroups) {
          if (group.itemIds.some((id) => itemIds.has(id))) for (const id of group.itemIds) itemIds.add(id);
        }
        const conflictedItems = pending.filter((item) => itemIds.has(item.id));
        const failedItems = conflictedItems.length > 0 ? conflictedItems : pending;
        if (this.status !== "running") return;
        this.assertCurrent(generation, ["running"]);
        const messages = new Set<string>();
        for (const item of failedItems) {
          if (item.status !== "pending") continue;
          const itemMessage =
            error instanceof ScrapeTargetConflictError && itemIds.has(item.id)
              ? new ScrapeTargetConflictError(error.conflicts.filter((conflict) => conflict.itemId === item.id)).message
              : message;
          if (itemMessage) messages.add(itemMessage);
          const { attemptId } = await this.admitItem(item);
          const committed = await this.execution.commitPreparationItem(
            item,
            createFailedResult(item, itemMessage),
            attemptId,
          );
          this.applyCommittedResult(item, committed);
        }
        if (conflictedItems.length === 0) {
          this.error = [...messages].join("\n\n") || message;
          this.setStatus("failed");
          return;
        }
        if (messages.size > 0) this.error = [this.error, ...messages].filter(Boolean).join("\n\n");
        this.preflightPassed = false;
        return;
      }
    }

    if (this.status !== "running") return;
    if (pending.length === 0) {
      this.completeLiveRunIfSettled(generation);
      return;
    }
    this.recordStage({ stage: "execute", message: "整理归档" });
    const groups = this.execution.movieGroups
      .map((group) => ({
        itemIds: group.itemIds.filter((id) => pending.some((item) => item.id === id)),
      }))
      .filter((group) => group.itemIds.length);
    const groupedIds = new Set<string>();
    const executionGroups = groups.map(
      ({ itemIds }): ScrapeExecutionGroup<TManualScrape> => ({
        publicationKeys: [
          ...new Set(this.execution.publicationKeys(prepared.filter(({ item }) => itemIds.includes(item.id)))),
        ].sort(),
        items: itemIds.map((id) => {
          const item = this.itemsById.get(id);
          if (!item || item.status !== "pending" || groupedIds.has(id))
            throw new Error(`Invalid scrape execution group item: ${id}`);
          groupedIds.add(id);
          return item;
        }),
      }),
    );
    if (groupedIds.size !== pending.length) throw new Error("Movie groups omitted pending items");
    const executor = new TaskExecutor<ScrapeExecutionGroup<TManualScrape>, ScrapeGroupExecution<TManualScrape>>({
      concurrency: this.execution.concurrency,
      gate: {
        beforeItem: async (group) => {
          this.assertCurrent(generation, ["running"]);
          for (const item of group.items) {
            await this.admitItem(item);
            item.status = "processing";
            item.error = null;
          }
          this.emitSnapshot();
        },
        beforeResult: async () => this.assertCurrent(generation, ["running", "paused", "stopping"]),
      },
      runItem: async (group, context) => {
        const releases = [await this.execution.acquireItems(group.items)];
        const releaseResources = async () => {
          const errors: unknown[] = [];
          for (const release of releases.splice(0).reverse()) {
            try {
              await release();
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1)
            throw new AggregateError(
              errors,
              errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; "),
            );
        };
        try {
          this.assertCurrent(generation, ["running", "paused"]);
          for (const key of group.publicationKeys) releases.push(await this.acquirePublication(key, context.signal));
          const admitted = group.items.map((item) => {
            const preparation = this.preparationByItemId.get(item.id);
            if (!preparation || preparation.status !== "prepared")
              throw new Error(`Scrape item was not prepared: ${item.id}`);
            return { item, preparation, attemptId: preparation.attemptId };
          });
          const preparedItems = admitted.map(({ item, preparation, attemptId }) => ({
            item,
            prepared: preparation.prepared,
            attemptId,
          }));
          const execution = await this.execution.executePreparedItems(preparedItems, context.signal);
          if (execution.release) releases.push(execution.release);
          const groupedResults = new Map(execution.results.map(({ itemId, result }) => [itemId, result]));
          const eligibleIds = new Set(execution.publicationPlan?.files.map((file) => file.scrape?.itemId) ?? []);
          if (
            execution.results.length + eligibleIds.size !== admitted.length ||
            groupedResults.size !== execution.results.length
          ) {
            throw new Error("Scrape group execution returned an incomplete result set");
          }
          const results = admitted.map(({ item, attemptId }) => {
            const executed = groupedResults.get(item.id);
            if (!executed && !eligibleIds.has(item.id))
              throw new Error(`Scrape group execution omitted item: ${item.id}`);
            return { item, result: executed, attemptId };
          });
          return {
            publicationPlan: execution.publicationPlan,
            results,
            release: releaseResources,
          };
        } catch (error) {
          try {
            await releaseResources();
          } catch (cleanupError) {
            const message = error instanceof Error ? error.message : String(error);
            const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
            throw new AggregateError([error, cleanupError], `${message}; resource cleanup failed: ${cleanupMessage}`);
          }
          throw error;
        }
      },
      finalizeResult: async (_group, execution) => await execution.release(),
      onFinalizeError: (group, releaseError) => {
        this.recordLog({
          level: "warn",
          message: `Staging cleanup failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
          itemId: group.items[0]?.id,
        });
      },
      applyResult: async (_group, execution) => {
        this.assertCurrent(generation, ["running", "paused", "stopping"]);
        const committed = await this.execution.commitItems(execution.results, execution.publicationPlan);
        this.assertCurrent(generation, ["running", "paused", "stopping"]);
        this.applyCommittedResults(
          execution.results.map(({ item }) => item),
          committed,
        );
      },
    });
    this.executor = executor;
    try {
      await executor.execute(executionGroups, this.shutdownController.signal);
    } finally {
      if (this.executor === executor) this.executor = null;
    }
  }

  private async prepareItems(items: MutableScrapeRunItem<TManualScrape>[], generation: number): Promise<void> {
    this.recordStage({ stage: "prepare", message: "获取信息" });
    const groups = this.execution.movieGroups
      .map((group) => ({ ...group, items: group.itemIds.flatMap((id) => items.find((item) => item.id === id) ?? []) }))
      .filter((group) => group.items.length);
    const executor = new TaskExecutor<(typeof groups)[number], readonly ScrapePreparationResult<TPrepared>[]>({
      concurrency: this.execution.concurrency,
      gate: {
        beforeItem: async (group) => {
          this.assertCurrent(generation, ["running"]);
          for (const item of group.items) {
            await this.admitItem(item);
            item.status = "processing";
            item.error = null;
          }
          this.emitSnapshot();
        },
        beforeResult: async () => this.assertCurrent(generation, ["running", "paused", "stopping"]),
      },
      runItem: async (group, context) => {
        const error = group.error;
        if (error) return group.items.map((item) => ({ status: "failed", result: createFailedResult(item, error) }));
        const entries = group.items.map((item) => {
          const preparation = this.preparationByItemId.get(item.id);
          if (!preparation) throw new Error(`Scrape item was not admitted: ${item.id}`);
          return { item, attemptId: preparation.attemptId };
        });
        const item = group.items[0];
        const results = await runWithScrapeItem(
          { itemId: item.id, relativePath: item.relativePath, caseId: item.caseId },
          async () => await this.execution.prepareGroup(entries, context.signal),
        );
        if (results.length !== group.items.length) throw new Error("Movie preparation omitted members");
        const failure = results.find((result) => result.status !== "prepared");
        if (!failure) return results;
        return group.items.map((item) => ({
          status: failure.status,
          result:
            failure.status === "skipped"
              ? createSkippedResult(item, failure.result.error ?? "Movie preparation skipped")
              : createFailedResult(item, failure.result.error ?? "Movie preparation failed"),
        }));
      },
      applyResult: async (group, results) => {
        this.assertCurrent(generation, ["running", "paused", "stopping"]);
        for (const [index, item] of group.items.entries()) {
          const result = results[index];
          const preparation = this.preparationByItemId.get(item.id);
          if (!preparation) throw new Error(`Scrape item was not admitted: ${item.id}`);
          this.preparationByItemId.set(item.id, { ...result, attemptId: preparation.attemptId });
          item.status = "pending";
        }
        this.emitSnapshot();
      },
    });
    this.executor = executor;
    try {
      await executor.execute(groups, this.shutdownController.signal);
    } finally {
      if (this.executor === executor) this.executor = null;
    }
  }

  private async acquirePublication(key: string, signal: AbortSignal): Promise<() => void> {
    const previous = this.publicationChains.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const chain = previous.then(() => current);
    this.publicationChains.set(key, chain);
    const release = () => {
      unlock();
      if (this.publicationChains.get(key) === chain) this.publicationChains.delete(key);
    };
    if (signal.aborted) {
      release();
      throw signal.reason;
    }
    let rejectAbort!: (reason: unknown) => void;
    const abort = () => rejectAbort(signal.reason);
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = reject;
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      await Promise.race([previous, cancelled]);
    } catch (error) {
      release();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    return release;
  }

  private applyCommittedResult(item: MutableScrapeRunItem<TManualScrape>, result: ScrapeResult): void {
    item.status = toTerminalItemStatus(result.status);
    this.preparationByItemId.delete(item.id);
    this.progressByItemId.delete(item.id);
    item.error = result.error?.trim() || null;
    item.result = result;
    this.emitSnapshot();
    if (this.runPromise === null && this.status === "running") this.startDrain();
  }

  private applyCommittedResults(
    items: readonly MutableScrapeRunItem<TManualScrape>[],
    committed: readonly { itemId: string; result: ScrapeResult }[],
  ): void {
    const results = new Map(committed.map(({ itemId, result }) => [itemId, result]));
    if (committed.length !== items.length || results.size !== items.length)
      throw new Error("Scrape commit returned an incomplete result set");
    for (const item of items) {
      const result = results.get(item.id);
      if (!result) throw new Error(`Scrape commit omitted item: ${item.id}`);
      this.applyCommittedResult(item, result);
    }
  }

  private async skipOutstandingItems(message: string): Promise<void> {
    const terminalInputs = [];
    for (const item of this.items) {
      if (isTerminalItemStatus(item.status)) continue;
      const { attemptId } = await this.admitItem(item);
      terminalInputs.push({ item, result: createSkippedResult(item, message), attemptId });
    }
    const committed = terminalInputs.length ? await this.execution.commitItems(terminalInputs) : [];
    this.applyCommittedResults(
      terminalInputs.map(({ item }) => item),
      committed,
    );
  }

  private async admitItem(item: MutableScrapeRunItem<TManualScrape>): Promise<ScrapeItemPreparation<TPrepared>> {
    const preparation = this.preparationByItemId.get(item.id);
    if (preparation) return preparation;
    const attemptId = await this.execution.admitItem(item);
    const admitted = { status: "admitted" as const, attemptId };
    this.preparationByItemId.set(item.id, admitted);
    return admitted;
  }

  private completeLiveRunIfSettled(generation: number): void {
    this.assertCurrent(generation, ["running"]);
    if (this.items.some((item) => !isTerminalItemStatus(item.status))) return;
    const hasSuccess = this.items.some((item) => item.status === "success");
    if (!hasSuccess && this.items.some((item) => item.status === "skipped")) {
      this.error ??= "未成功刮削任何文件";
    }
    this.setStatus(this.items.every((item) => item.status === "success") ? "completed" : "failed");
  }

  private async handleFatalError(generation: number, error: unknown): Promise<void> {
    if (generation !== this.generation || this.status === "stopping" || this.isTerminalStatus()) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.recordLog({ level: "error", message: this.error });
    if (!this.executionConfig) {
      this.setStatus("failed");
      return;
    }
    try {
      await this.skipOutstandingItems("任务发生错误已中止");
    } catch (commitError) {
      const commitMessage = commitError instanceof Error ? commitError.message : String(commitError);
      const originalMessage = error instanceof Error ? error.message : String(error);
      const terminalError = new AggregateError(
        [error, commitError],
        `${originalMessage}; terminal outcome persistence failed: ${commitMessage}`,
      );
      this.error = terminalError.message;
      this.recordLog({ level: "error", message: terminalError.message });
      this.setStatus("interrupted");
      return;
    }
    this.setStatus("failed");
  }

  private assertCurrent(generation: number, allowedStatuses: readonly ScrapeRunLiveStatus[]): void {
    if (generation !== this.generation || !allowedStatuses.includes(this.status)) {
      throw new StaleScrapeRunGenerationError(`Stale scrape result for ${this.options.runId}`);
    }
  }

  private setStatus(status: ScrapeRunLiveStatus): void {
    if (this.status === status) return;
    this.status = status;
    if (this.isTerminalStatus()) this.preparationByItemId.clear();
    this.emitSnapshot();
  }

  private isTerminalStatus(): boolean {
    return (
      this.status === "completed" ||
      this.status === "failed" ||
      this.status === "stopped" ||
      this.status === "interrupted"
    );
  }

  private emitSnapshot(): void {
    this.revision += 1;
    this.options.onSnapshot(this.snapshot());
  }
}
