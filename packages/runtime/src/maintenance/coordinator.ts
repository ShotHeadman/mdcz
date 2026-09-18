import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  canonicalizeRootFileRefs,
  filesystemPathKey,
  type MediaRoot,
  resolveRootFile,
  resolveRootRelativePath,
} from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { DirectoryTaskScope, DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenancePreviewBatch,
  MaintenanceSessionEvent,
  MaintenanceSessionPreview,
  MaintenanceSessionRef,
  MaintenanceSessionSnapshot,
  MaintenanceSessionStatus,
  MaintenancePublicationIdentity as SharedMaintenancePublicationIdentity,
} from "@mdcz/shared/maintenanceTasks";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { CrawlerData, LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import type { RegisteredMediaLocation } from "../library/registeredMedia";
import type { PreparedMovieOutput } from "../publication/prepareMovieOutput";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor, type TaskExecutorContext } from "../tasks";
import {
  type MaintenanceBatchItem,
  MaintenanceSession,
  StaleMaintenanceGenerationError,
} from "../tasks/session/MaintenanceSession";
import { buildMaintenanceApplyData } from "./applyData";
import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";

export interface MaintenanceRootPort {
  get(rootId: string): Promise<MediaRoot>;
  list(): Promise<MediaRoot[]>;
  ensurePathRecord(input: { hostPath: string }): Promise<MediaRoot>;
  assertRootIntegrity(rootIds: Iterable<string>): Promise<void>;
}

export interface MaintenanceDirectoryTaskDefinition {
  id: string;
  directoryScope: DirectoryTaskScope;
  configuration: Configuration;
  rootId: string;
  outputRootId: string;
  outputRelativeDirectory: string;
  presetId: MaintenancePresetId;
}

type MaintenancePublicationIdentity = SharedMaintenancePublicationIdentity;

export interface MaintenanceLibraryPort {
  resolveParticipants(
    sources: readonly (RootFileRef & { fileId?: string })[],
    outputs?: readonly RootFileRef[],
    identity?: string,
    movieId?: string,
  ): Promise<MaintenancePublicationIdentity>;
  assertPublication(identity: MaintenancePublicationIdentity, outputs?: readonly RootFileRef[]): Promise<void>;
  registeredOutputs(paths: readonly string[]): Promise<Map<string, RegisteredMediaLocation>>;
  publishRefresh(input: {
    operationId: string;
    ownershipToken: string;
    output: PreparedMovieOutput;
    crawlerData?: CrawlerData;
    fallbackNumber: string;
    refreshedAt: Date;
  }): Promise<{ libraryItemId: string; cleanupIssues: unknown[] }>;
}

export type MaintenanceCoordinatorEvent =
  | { kind: "session-changed"; session: MaintenanceActiveSessionSnapshot }
  | { kind: "log"; sessionId: string; event: MaintenanceSessionEvent };

export interface MaintenanceRunHandle<TResult> {
  session: MaintenanceActiveSessionSnapshot;
  completion: Promise<TResult>;
}

type ActiveExecution = {
  sessionId: string;
  generation: number;
  executor: { pause(): void; stop(): void };
};

type MaintenanceMovieSelection = {
  ref: MaintenanceSessionRef;
  identity: MaintenancePublicationIdentity;
  files?: LocalScanEntry[];
};

type PreviewExecutionResult = {
  item: MaintenanceRuntimePreviewItem;
  selection: MaintenanceMovieSelection;
};

type ApplyExecutionResult = {
  result: MaintenanceApplyItemResult;
  publication?: Parameters<MaintenanceLibraryPort["publishRefresh"]>[0];
  release?: () => Promise<void>;
};

const PREVIEW_ALL_FAILED = "维护预览全部失败";
const APPLY_FAILED = "维护应用失败";
const STOPPED = "维护已停止";
const STOPPED_ITEM = "维护已停止，项目未执行";
const INTERRUPTED = "维护因服务关闭而中断，请重新预览后执行";
const OWNERSHIP_CHANGED = "Maintenance execution ownership changed";

const errorMessage = (error: unknown): string => toErrorMessage(error);

const refKey = (ref: RootFileRef): string => `${ref.rootId}\0${ref.relativePath}`;

const assertUniqueRefs = (refs: readonly MaintenanceSessionRef[]): void => {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.relativePath.trim()) throw new Error("维护文件路径不能为空");
    const key = refKey(ref);
    if (seen.has(key)) throw new Error(`维护文件路径重复：${ref.rootId}:${ref.relativePath}`);
    seen.add(key);
  }
};

const canonicalizeRefs = async (
  roots: MaintenanceRootPort,
  refs: readonly MaintenanceSessionRef[],
): Promise<MaintenanceSessionRef[]> => {
  const registeredRoots = await roots.list();
  const canonical = canonicalizeRootFileRefs(registeredRoots, refs);
  assertUniqueRefs(canonical);
  return canonical;
};

const resolveMovieSelections = async (
  library: MaintenanceLibraryPort,
  refs: readonly MaintenanceSessionRef[],
): Promise<MaintenanceMovieSelection[]> => {
  const movies = new Map<string, MaintenanceMovieSelection>();
  for (const ref of refs) {
    const identity = await library.resolveParticipants([ref]);
    const representative = identity.files
      .map(({ rootId, relativePath }) => ({ rootId, relativePath }))
      .toSorted((left, right) => refKey(left).localeCompare(refKey(right)))[0];
    if (!representative) throw new Error("维护影片没有可扫描的视频文件");
    movies.set(identity.movieId, { ref: representative, identity });
  }
  return [...movies.values()];
};

const ownedPreviewPaths = (
  roots: readonly MediaRoot[],
  previews: readonly MaintenanceSessionPreview[],
): RootFileRef[] => {
  const paths = new Map<string, RootFileRef>();
  for (const preview of previews) {
    const entry = preview.entry;
    for (const absolutePath of [
      entry?.fileInfo.filePath,
      preview.pathDiff?.currentVideoPath,
      preview.pathDiff?.targetVideoPath,
      entry?.nfoPath,
      entry?.assets.thumb,
      entry?.assets.poster,
      entry?.assets.fanart,
      entry?.assets.trailer,
      ...(entry?.assets.sceneImages ?? []),
      ...(entry?.assets.actorPhotos ?? []),
    ]) {
      if (!absolutePath) continue;
      const resolved = resolveRootFile(roots, absolutePath);
      const ref = { rootId: resolved.root.id, relativePath: resolved.relativePath };
      paths.set(refKey(ref), ref);
    }
  }
  return [...paths.values()];
};

const scanMembers = async (
  runtime: MaintenanceRuntime,
  roots: MaintenanceRootPort,
  library: MaintenanceLibraryPort,
  members: readonly (RootFileRef & { fileId: string })[],
  signal?: AbortSignal,
): Promise<Array<LocalScanEntry & { fileId: string }>> => {
  assertUniqueRefs(members);
  const refsByRoot = new Map<string, Array<RootFileRef & { fileId: string }>>();
  for (const member of members) {
    const group = refsByRoot.get(member.rootId) ?? [];
    group.push(member);
    refsByRoot.set(member.rootId, group);
  }
  const byRef = new Map<string, LocalScanEntry>();
  const registeredOutputs = await library.registeredOutputs(
    await Promise.all(
      members.map(async (member) => resolveRootRelativePath(await roots.get(member.rootId), member.relativePath)),
    ),
  );
  for (const [rootId, group] of refsByRoot) {
    const root = await roots.get(rootId);
    const entries = await runtime.scanRefs({
      root,
      registeredOutputs,
      refs: group.map(({ relativePath }) => ({ relativePath })),
      signal,
    });
    for (const entry of entries) {
      const ref = { rootId, relativePath: entry.ref.relativePath };
      const key = refKey(ref);
      if (byRef.has(key)) throw new Error(`维护扫描结果路径重复：${rootId}:${entry.ref.relativePath}`);
      byRef.set(key, { ...entry, ref });
    }
  }
  if (byRef.size !== members.length || members.some((member) => !byRef.has(refKey(member)))) {
    throw new Error("维护扫描结果与请求文件不一致");
  }
  return members.map((member) => {
    const observation = byRef.get(refKey(member));
    if (!observation) throw new Error("维护扫描结果与请求文件不一致");
    return { ...observation, fileId: member.fileId };
  });
};

const libraryCommitFailure = (error: unknown): MaintenanceApplyItemResult => ({
  status: "failed",
  error: `维护发布失败：${errorMessage(error)}`,
});

export class MaintenanceSessionCoordinator {
  private runtime: MaintenanceRuntime;
  private session: MaintenanceSession | null = null;
  private active: ActiveExecution | null = null;
  private executionPromise: Promise<void> | null = null;
  private stopOperation?: { sessionId: string; generation: number; promise: Promise<MaintenanceSessionSnapshot> };
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private revision = 0;
  private releaseOwnedPaths: (() => void) | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private previewStarting = false;
  private previewSelections = new Map<string, MaintenanceMovieSelection>();
  private pendingPreviewSetup: {
    root: MediaRoot;
    outputRoot: MediaRoot;
    outputRelativeDirectory: string;
    configuration?: Configuration;
  } | null = null;

  constructor(
    private readonly deps: {
      roots: MaintenanceRootPort;
      runtime: MaintenanceRuntime;
      directoryTasks: {
        save(definition: MaintenanceDirectoryTaskDefinition): Promise<void>;
        get(id: string): Promise<MaintenanceDirectoryTaskDefinition>;
        setStatus(id: string, status: string): Promise<void>;
      };
      discoverDirectory?: (
        scope: DirectoryTaskScope,
        configuration: Configuration,
        signal: AbortSignal,
        onProgress: (progress: DiscoveryProgress) => void,
      ) => Promise<MaintenanceSessionRef[]>;
      library: MaintenanceLibraryPort;
      events?: { publish(event: MaintenanceCoordinatorEvent): void | Promise<void> };
      acquireAll?: (keys: readonly string[], owner: string) => () => void;
    },
  ) {
    this.runtime = deps.runtime;
  }

  async startPreview(input: {
    directoryScope?: DirectoryTaskScope;
    configuration?: Configuration;
    rootId: string;
    presetId: MaintenancePresetId;
    refs: readonly MaintenanceSessionRef[];
    outputRootId?: string;
    outputRelativeDirectory?: string;
  }): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    this.assertOpen();
    if (input.refs.length === 0 && !input.directoryScope) throw new Error("维护文件不能为空");
    if (this.previewStarting || this.session?.isActive()) {
      throw new Error("已有活动的维护会话，请先完成或停止当前会话");
    }
    this.previewStarting = true;
    try {
      const currentConfiguration = await this.deps.runtime.getConfiguration();
      const configuration = input.configuration ?? currentConfiguration;
      if (configuration.behavior.metadataOnly) {
        throw new Error("维护模式不支持仅输出元数据，请先在设置中关闭");
      }
      const canonical = await canonicalizeRefs(this.deps.roots, input.refs);
      const selections = await resolveMovieSelections(this.deps.library, canonical);
      if (!input.directoryScope)
        await this.deps.roots.assertRootIntegrity([
          input.rootId,
          ...canonical.map((ref) => ref.rootId),
          ...selections.flatMap((selection) => selection.identity.files.map((file) => file.rootId)),
          ...(input.outputRootId ? [input.outputRootId] : []),
        ]);
      const refs = selections.map((selection) => selection.ref);
      this.previewSelections = new Map(selections.map((selection) => [refKey(selection.ref), selection]));
      const root = await this.deps.roots.get(input.rootId);
      const outputRoot = input.outputRootId ? await this.deps.roots.get(input.outputRootId) : root;
      const outputRelativeDirectory = input.outputRelativeDirectory ?? "";
      this.pendingPreviewSetup = { root, outputRoot, outputRelativeDirectory, configuration };
      for (const rootId of new Set(refs.map((ref) => ref.rootId))) await this.deps.roots.get(rootId);
      this.assertOpen();
      const generation = (this.session?.generation ?? 0) + 1;
      this.session?.invalidate();
      this.assertOpen();
      const sessionId = randomUUID();
      if (input.directoryScope) {
        await this.deps.directoryTasks.save({
          id: sessionId,
          directoryScope: input.directoryScope,
          configuration,
          rootId: input.rootId,
          outputRootId: outputRoot.id,
          outputRelativeDirectory,
          presetId: input.presetId,
        });
      }
      this.session = new MaintenanceSession({
        directoryScope: input.directoryScope,
        id: sessionId,
        rootId: input.rootId,
        presetId: input.presetId,
        generation,
        refs,
        outputRootId: outputRoot.id,
        outputRelativeDirectory,
      });
      await this.publishStatus(this.session, "queued", `Maintenance session queued. Preset: ${input.presetId}`);
      await this.publishLog(this.session, "preset", `Maintenance preset: ${input.presetId}`);
      await this.startCurrentPhase(this.session.id, generation);
      return { session: this.session.snapshot(), completion: this.waitForPreview(this.session.id) };
    } finally {
      this.previewStarting = false;
    }
  }

  async readPreview(sessionId: string): Promise<MaintenancePreviewBatch> {
    const session = this.require(sessionId);
    return { session: session.statusSnapshot(), items: session.editablePreviews() };
  }

  async waitForPreview(sessionId: string): Promise<MaintenancePreviewBatch> {
    for (;;) {
      const revision = this.revision;
      const batch = await this.readPreview(sessionId);
      if (batch.session.status === "completed") return batch;
      if (
        batch.session.status === "failed" ||
        batch.session.status === "stopped" ||
        batch.session.status === "interrupted"
      ) {
        if (batch.session.error === PREVIEW_ALL_FAILED) return batch;
        throw new Error(batch.session.error ?? "维护预览失败");
      }
      await this.waitForChange(sessionId, revision);
    }
  }

  async beginApply(input: {
    sessionId: string;
    selections: readonly MaintenanceApplySelection[];
  }): Promise<MaintenanceRunHandle<MaintenanceApplyBatch>> {
    this.assertOpen();
    await this.deps.runtime.getConfiguration();
    if (this.previewStarting) throw new Error("维护预览正在启动，请稍后重试");
    if (input.selections.length === 0) throw new Error("请选择要应用的维护预览");
    const previewIds = input.selections.map((selection) => selection.previewId);
    const session = this.require(input.sessionId);
    const previews = previewIds
      .map((previewId) => session.preview(previewId))
      .filter((preview) => preview !== undefined);
    if (previews.length !== previewIds.length) throw new Error("部分维护预览不存在、已提交或不属于当前会话");
    const refs = ownedPreviewPaths(await this.deps.roots.list(), previews);
    for (const preview of previews)
      for (const file of preview.publicationIdentity?.files ?? [])
        refs.push({ rootId: file.rootId, relativePath: file.relativePath });
    await this.deps.roots.assertRootIntegrity(refs.map((ref) => ref.rootId));
    const keys = await Promise.all(
      refs.map(async (ref) =>
        filesystemPathKey(resolveRootRelativePath(await this.deps.roots.get(ref.rootId), ref.relativePath)),
      ),
    );
    this.assertOpen();
    if (this.previewStarting) throw new Error("维护预览正在启动，请稍后重试");
    if (this.session !== session) throw new Error("当前维护任务已失效，请重新开始");
    const acquireAll = this.deps.acquireAll ?? ((owned, owner) => mediaPathOwnership.acquireAll(owned, owner));
    const release = acquireAll(keys, session.id);
    let apply: { generation: number; batchId: string };
    try {
      apply = session.beginApply(input.selections);
    } catch (error) {
      release();
      throw error;
    }
    this.releaseOwnedPaths = release;
    try {
      await this.publishStatus(session, "queued", `Maintenance apply queued. Items: ${input.selections.length}`);
      await this.startCurrentPhase(session.id, apply.generation);
    } catch (error) {
      const message = errorMessage(error);
      const generation = session.beginStopping(message);
      session.finish(generation, "failed", message);
      this.releasePaths();
      throw error;
    }
    return {
      session: session.snapshot(),
      completion: this.waitForApply(session.id, apply.batchId, new Set(previewIds)),
    };
  }

  async pause(sessionId: string): Promise<MaintenanceSessionSnapshot> {
    const session = this.require(sessionId);
    if (session.status === "discovering") throw new Error("目录扫描不支持暂停，请停止任务");
    if (!session.pause()) return session.statusSnapshot();
    await this.publishStatus(session, "paused", "Maintenance session paused");
    this.activeFor(session.id, session.generation)?.executor.pause();
    await this.awaitCurrentExecution();
    return this.require(sessionId).statusSnapshot();
  }

  async resume(sessionId: string): Promise<MaintenanceSessionSnapshot> {
    const session = this.require(sessionId);
    if (session.status !== "paused") return session.statusSnapshot();
    await this.awaitCurrentExecution();
    const current = this.require(sessionId);
    if (current.status !== "paused") return current.statusSnapshot();
    await this.startCurrentPhase(current.id, current.generation, "Maintenance session resumed");
    return current.statusSnapshot();
  }

  stop(sessionId: string): Promise<MaintenanceSessionSnapshot> {
    return this.requestTermination(sessionId, STOPPED, STOPPED_ITEM);
  }

  private requestTermination(
    sessionId: string,
    reason: string,
    itemReason: string,
  ): Promise<MaintenanceSessionSnapshot> {
    const current = this.require(sessionId);
    if (this.stopOperation?.sessionId === sessionId && this.stopOperation.generation === current.generation)
      return this.stopOperation.promise;
    const promise = this.terminate(sessionId, reason, itemReason);
    this.stopOperation = { sessionId, generation: current.generation, promise };
    return promise;
  }

  private async terminate(sessionId: string, reason: string, itemReason: string): Promise<MaintenanceSessionSnapshot> {
    const current = this.require(sessionId);
    if (!current.isActive()) return current.statusSnapshot();
    const generation = current.beginStopping(reason);
    const errors: unknown[] = [];
    this.active?.executor.stop();
    try {
      await this.publishStatus(current, "stopping", "Stopping maintenance session");
    } catch (error) {
      errors.push(error);
    }
    await this.awaitCurrentExecution();
    const latest = this.require(sessionId);
    if (latest.generation !== generation) return latest.statusSnapshot();
    try {
      if (latest.phase === "apply") await this.skipOutstanding(latest.id, generation, itemReason);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.finishSession(latest.id, generation, reason === INTERRUPTED ? "interrupted" : "stopped", reason);
    } catch (error) {
      errors.push(error);
    } finally {
      this.releasePaths();
      this.notify(sessionId);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Maintenance stopped with notification errors");
    return latest.statusSnapshot();
  }

  async getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null> {
    return this.session?.snapshot() ?? null;
  }

  async rerunDirectory(sessionId: string): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    const definition = await this.deps.directoryTasks.get(sessionId);
    return await this.startPreview({
      ...definition,
      refs: [],
    });
  }

  async updateDraft(input: {
    sessionId: string;
    previewId: string;
    fieldSelections?: Record<string, "old" | "new">;
  }): Promise<MaintenanceActiveSessionSnapshot> {
    const session = this.require(input.sessionId);
    session.updateDraft(input.previewId, input.fieldSelections);
    await this.publishChanged(session);
    return session.snapshot();
  }

  async discardSession(sessionId?: string): Promise<void> {
    if (!this.session) return;
    if (sessionId && this.session.id !== sessionId) throw new Error("当前维护任务已失效，请重新开始");
    if (this.session.isActive()) throw new Error("维护会话仍在运行，请先停止后再返回设置");
    const id = this.session.id;
    this.session.invalidate();
    this.releasePaths();
    this.previewSelections.clear();
    this.session = null;
    this.notify(id);
  }

  async waitForIdle(): Promise<void> {
    await this.awaitCurrentExecution();
  }

  close(): Promise<void> {
    this.closePromise ??= this.finishClose();
    return this.closePromise;
  }

  private async finishClose(): Promise<void> {
    this.closing = true;
    const session = this.session;
    if (session) await this.requestTermination(session.id, INTERRUPTED, INTERRUPTED);
    this.releasePaths();
    this.previewSelections.clear();
  }

  private async startCurrentPhase(sessionId: string, generation: number, message?: string): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["queued", "paused"]);
    const expectedStatus = session.status;
    if (this.executionPromise) throw new Error("Maintenance coordinator already has an active executor");
    if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== expectedStatus) return;
    session.startRunning(generation);
    await this.publishStatus(session, "running", message ?? `Starting maintenance ${session.phase}`);
    if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
    const run =
      session.phase === "preview" ? this.runPreview(sessionId, generation) : this.runApply(sessionId, generation);
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (this.executionPromise === tracked) this.executionPromise = null;
      this.notify(sessionId);
    });
    this.executionPromise = tracked;
    void tracked.catch(() => undefined);
  }

  private async runPreview(sessionId: string, generation: number): Promise<void> {
    const scanController = new AbortController();
    this.active = { sessionId, generation, executor: { pause: () => undefined, stop: () => scanController.abort() } };
    try {
      let initial = this.assertCurrent(sessionId, generation, ["running"]);
      if (initial.directoryScope && !initial.snapshot().manifestFixed) {
        initial.startDiscovery(generation);
        await this.publishChanged(initial);
      }
      const setup = this.pendingPreviewSetup;
      if (setup) {
        this.runtime = await this.deps.runtime.createSession(setup);
        this.pendingPreviewSetup = null;
      }
      scanController.signal.throwIfAborted();
      if (initial.directoryScope && !initial.snapshot().manifestFixed) {
        if (!this.deps.discoverDirectory || !setup?.configuration) throw new Error("目录扫描缺少必要配置");
        let progressNotification = Promise.resolve();
        let progressError: unknown;
        const refs = await this.deps.discoverDirectory(
          initial.directoryScope,
          setup.configuration,
          scanController.signal,
          (progress) => {
            initial.recordDiscovery(generation, progress);
            progressNotification = progressNotification
              .then(async () => {
                if (!scanController.signal.aborted) await this.publishChanged(initial);
              })
              .catch((error) => {
                progressError = error;
              });
          },
        );
        await progressNotification;
        if (progressError) throw progressError;
        scanController.signal.throwIfAborted();
        const canonical = await canonicalizeRefs(this.deps.roots, refs);
        const selections = await resolveMovieSelections(this.deps.library, canonical);
        this.previewSelections = new Map(selections.map((selection) => [refKey(selection.ref), selection]));
        initial.fixDiscoveredRefs(
          generation,
          selections.map((selection) => selection.ref),
        );
        await this.publishChanged(initial);
      }
      await this.runtime.applyNetworkPolicy?.();
      initial = this.assertCurrent(sessionId, generation, ["running", "paused"]);
      if (initial.status === "paused") return;
      const selections = initial.refs.map((ref) => {
        const selection = this.previewSelections.get(refKey(ref));
        if (!selection) throw new Error(`维护影片选择已失效：${ref.rootId}:${ref.relativePath}`);
        return selection;
      });
      for (const selection of selections) {
        if (selection.files) continue;
        const scanned = await scanMembers(
          this.runtime,
          this.deps.roots,
          this.deps.library,
          selection.identity.files,
          scanController.signal,
        );
        selection.files = scanned;
      }
      let current = this.assertCurrent(sessionId, generation, ["running", "paused"]);
      if (current.status === "paused") return;
      if (!current.activePreviews().length && selections.length) {
        current.initializeEntries(
          generation,
          selections.map((selection) => {
            const entry = selection.files?.find((file) => refKey(file.ref) === refKey(selection.ref));
            if (!entry) throw new Error("维护预览缺少选中的文件");
            return entry;
          }),
        );
        await this.publishChanged(current);
      }
      const committedPaths = new Set(
        current
          .snapshot()
          .previews.filter((preview) => preview.status === "ready" || preview.status === "blocked")
          .map(refKey),
      );
      const pending = selections.filter((selection) => !committedPaths.has(refKey(selection.ref)));
      await this.executeItems<MaintenanceMovieSelection, PreviewExecutionResult>(sessionId, generation, pending, {
        runItem: async (selection, context) => {
          this.assertCurrent(sessionId, generation, ["running"]);
          const activeSession = this.require(sessionId);
          activeSession.markPreviewProcessing(generation, selection.ref.rootId, selection.ref.relativePath);
          await this.publishChanged(activeSession);

          const files = selection.files;
          const entry = files?.find((file) => refKey(file.ref) === refKey(selection.ref));
          if (!files || !entry) throw new Error("维护预览缺少已扫描的影片成员");
          const root = await this.deps.roots.get(entry.ref.rootId);
          try {
            const active = this.assertCurrent(sessionId, generation, ["running"]);
            const item = await this.runtime.previewMovie({
              root,
              presetId: active.presetId,
              entry,
              files,
              signal: context.signal,
            });
            if (
              item.affectedFiles &&
              new Set(item.affectedFiles.map((file) => file.targetPath)).size !== item.affectedFiles.length
            )
              throw new Error("影片多个文件的目标路径重复，请调整命名后重新预览");
            return { item, selection };
          } catch (error) {
            if (isAbortError(error) || context.signal.aborted) throw error;
            return {
              selection,
              item: {
                entry,
                files,
                rootId: entry.ref.rootId,
                relativePath: entry.ref.relativePath,
                status: "blocked",
                error: errorMessage(error),
                fieldDiffs: [],
                unchangedFieldDiffs: [],
                pathDiff: null,
                proposedCrawlerData: null,
              },
            };
          }
        },
        applyResult: async (_selection, result) => {
          this.commitPreview(sessionId, generation, result.item, result.selection);
          await this.publishChanged(this.require(sessionId));
        },
      });
      if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
      current = this.assertCurrent(sessionId, generation, ["running"]);
      const progress = current.progress();
      const allBlocked =
        progress.totalEntries > 0 && progress.successCount === 0 && progress.failedCount >= progress.totalEntries;
      await this.finishSession(
        sessionId,
        generation,
        allBlocked ? "failed" : "completed",
        allBlocked ? PREVIEW_ALL_FAILED : null,
      );
    } catch (error) {
      if (!this.isCurrent(sessionId, generation) || this.closing) return;
      const current = this.require(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || error instanceof StaleMaintenanceGenerationError)
        return;
      await this.failSession(sessionId, generation, errorMessage(error));
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private async runApply(sessionId: string, generation: number): Promise<void> {
    try {
      await this.runtime.applyNetworkPolicy?.();
      const initial = this.assertCurrent(sessionId, generation, ["running"]);
      const pending = initial.pendingBatchItems();
      await this.executeItems<MaintenanceBatchItem, ApplyExecutionResult>(sessionId, generation, pending, {
        runItem: async (item, context) => {
          const active = this.markApplyProcessing(sessionId, generation, item);
          if (!active.preview) return { result: { status: "failed", error: "维护预览不存在" } };
          if (active.preview.status === "blocked") {
            return { result: { status: "skipped", error: active.preview.error ?? "维护预览不可应用" } };
          }
          let release: (() => Promise<void>) | undefined;
          try {
            const previewIdentity = active.preview.publicationIdentity;
            if (!previewIdentity) throw new Error("Maintenance preview has no publication identity");
            const root = await this.deps.roots.get(active.preview.rootId);
            await this.deps.library.assertPublication(previewIdentity);

            const files = await scanMembers(
              this.runtime,
              this.deps.roots,
              this.deps.library,
              previewIdentity.files,
              context.signal,
            );
            for (const previous of active.preview.files ?? []) {
              const current = files.find((file) => file.fileId === previous.fileId);
              if (
                !current ||
                !isDeepStrictEqual(current.fileInfo, previous.fileInfo) ||
                !isDeepStrictEqual(current.nfoLocalState, previous.nfoLocalState)
              ) {
                throw new Error("影片源文件或本地元数据已修改，请重新预览");
              }
            }
            const entry = files.find(
              (file) =>
                file.ref.rootId === active.preview?.rootId && file.ref.relativePath === active.preview.relativePath,
            );
            if (!entry)
              return { result: { status: "failed", error: `维护文件不存在：${active.preview.relativePath}` } };
            const committed = buildMaintenanceApplyData(entry, active.preview, active.item.selection.fieldSelections);
            const latest = this.assertCurrent(sessionId, generation, ["running", "paused"]);
            const progress = latest.progress();
            const publicationRoots = await this.deps.roots.list();
            const applied = await this.runtime.applyEntry({
              root,
              presetId: latest.presetId,
              entry,
              committed,
              files,
              progress: {
                fileIndex: Math.min(progress.totalEntries, progress.completedEntries + 1),
                totalFiles: progress.totalEntries,
              },
              signal: context.signal,
              publication: {
                operationId: `${sessionId}:${active.preview.id}`,
                roots: publicationRoots,
                validateOutputs: async (outputs) => {
                  await this.deps.library.assertPublication(previewIdentity, outputs);
                },
                identity: {
                  movieId: previewIdentity.movieId,
                  expected: previewIdentity.expected,
                },
              },
            });
            if (applied.status === "failed") return { result: { status: "failed", error: applied.error } };
            release = applied.release;
            const publication = applied.publication;
            if (!publication) {
              if (latest.presetId === "read_local")
                return { result: { status: "success", entry: applied.entry }, release };
              return { result: { status: "failed", error: "维护处理未产生任何待更新的文件" }, release };
            }
            const crawlerData = applied.crawlerData ?? applied.entry.crawlerData ?? committed.crawlerData;
            return {
              result: {
                status: "success",
                entry: applied.entry,
                crawlerData: applied.crawlerData ?? committed.crawlerData,
                fieldDiffs: applied.fieldDiffs,
                unchangedFieldDiffs: applied.unchangedFieldDiffs,
                pathDiff: applied.pathDiff,
                outputRelativePath: applied.outputRelativePath || active.preview.relativePath,
                outputSize: applied.outputSize,
                outputModifiedAt: applied.outputModifiedAt,
              },
              publication: {
                operationId: `${sessionId}:${active.preview.id}`,
                ownershipToken: sessionId,
                output: publication.output,
                crawlerData,
                fallbackNumber: applied.entry.fileInfo.number,
                refreshedAt: new Date(),
              },
              release,
            };
          } catch (error) {
            const stopped = isAbortError(error) || context.signal.aborted;
            return {
              result: { status: stopped ? "skipped" : "failed", error: stopped ? STOPPED_ITEM : errorMessage(error) },
              release,
            };
          }
        },
        applyResult: async (item, executionResult) =>
          await this.applyPublication(sessionId, generation, item, executionResult),
      });
      if (!this.isCurrent(sessionId, generation) || this.require(sessionId).status !== "running") return;
      const current = this.assertCurrent(sessionId, generation, ["running"]);
      const progress = current.progress();
      if (progress.completedEntries < progress.totalEntries) {
        this.releasePaths();
        return;
      }
      const failedAll =
        progress.totalEntries > 0 && progress.successCount === 0 && progress.failedCount >= progress.totalEntries;
      await this.finishSession(
        sessionId,
        generation,
        failedAll ? "failed" : "completed",
        failedAll ? APPLY_FAILED : null,
      );
    } catch (error) {
      if (!this.isCurrent(sessionId, generation) || this.closing) return;
      const current = this.require(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || error instanceof StaleMaintenanceGenerationError)
        return;
      const message = errorMessage(error);
      await this.skipOutstanding(sessionId, generation, message);
      await this.failSession(sessionId, generation, message);
    } finally {
      if (this.active?.sessionId === sessionId && this.active.generation === generation) this.active = null;
      this.notify(sessionId);
    }
  }

  private async applyPublication(
    sessionId: string,
    generation: number,
    item: MaintenanceBatchItem,
    execution: ApplyExecutionResult,
  ): Promise<void> {
    let result = execution.result;
    if (execution.publication) {
      try {
        this.assertCurrent(sessionId, generation, ["running", "paused"]);
        const published = await this.deps.library.publishRefresh(execution.publication);
        result = {
          ...result,
          ...(published.cleanupIssues.length ? { error: published.cleanupIssues.map(errorMessage).join("; ") } : {}),
        };
      } catch (error) {
        if (!this.isCurrent(sessionId, generation)) throw error;
        result = libraryCommitFailure(error);
      }
    }
    await this.commitItem(sessionId, generation, item, result);
  }

  private async executeItems<TItem, TResult>(
    sessionId: string,
    generation: number,
    items: readonly TItem[],
    execution: {
      runItem(item: TItem, context: TaskExecutorContext): Promise<TResult>;
      applyResult(item: TItem, result: TResult, context: TaskExecutorContext): Promise<unknown>;
    },
  ): Promise<void> {
    const executor = new TaskExecutor<TItem, TResult>({
      concurrency: 1,
      gate: {
        beforeItem: async () => void this.assertCurrent(sessionId, generation, ["running"]),
        beforeResult: async () => void this.assertCurrent(sessionId, generation, ["running", "paused"]),
      },
      finalizeResult: async (_item, result) => {
        await (result as ApplyExecutionResult).release?.();
      },
      onFinalizeError: async (_item, error) => {
        if (!this.isCurrent(sessionId, generation)) return;
        await this.publishLog(this.require(sessionId), "warning", `Staging cleanup failed: ${errorMessage(error)}`);
      },
      ...execution,
    });
    this.active = { sessionId, generation, executor };
    await executor.execute(items);
  }

  private commitPreview(
    sessionId: string,
    generation: number,
    item: MaintenanceRuntimePreviewItem,
    selection: MaintenanceMovieSelection,
  ): void {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused"]);
    session.commitPreview(generation, {
      publicationIdentity: selection.identity,
      rootId: item.rootId,
      relativePath: item.relativePath,
      status: item.status,
      error: item.error,
      fieldDiffs: item.fieldDiffs,
      unchangedFieldDiffs: item.unchangedFieldDiffs,
      pathDiff: item.pathDiff,
      proposedCrawlerData: item.proposedCrawlerData,
      imageAlternatives: item.imageAlternatives,
      affectedFiles: item.affectedFiles,
      files: item.files,
      entry: item.entry,
    });
  }

  private markApplyProcessing(sessionId: string, generation: number, item: MaintenanceBatchItem) {
    const session = this.assertCurrent(sessionId, generation, ["running"]);
    return session.markApplyProcessing(generation, item);
  }

  private async commitItem(
    sessionId: string,
    generation: number,
    item: MaintenanceBatchItem,
    result: MaintenanceApplyItemResult,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    if (session.commitItem(generation, item, result)) await this.publishChanged(session);
  }

  private async skipOutstanding(sessionId: string, generation: number, error: string): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "paused", "stopping"]);
    if (session.skipOutstanding(generation, error)) await this.publishChanged(session);
  }

  private async waitForApply(
    sessionId: string,
    batchId: string,
    selectedIds: ReadonlySet<string>,
  ): Promise<MaintenanceApplyBatch> {
    for (;;) {
      const revision = this.revision;
      const session = this.require(sessionId);
      if (["completed", "failed", "stopped", "interrupted"].includes(session.status)) {
        if (session.snapshot().currentBatch?.id !== batchId) throw new Error("维护执行状态已变动，请重新查看任务进度");
        return {
          session: session.statusSnapshot(),
          batchId,
          items: session.editablePreviews(),
          applied: session.applyLogs().filter((log) => selectedIds.has(log.previewId)),
        };
      }
      await this.waitForChange(sessionId, revision);
    }
  }

  private async finishSession(
    sessionId: string,
    generation: number,
    status: "completed" | "failed" | "stopped" | "interrupted",
    error: string | null,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, generation, ["running", "discovering", "stopping"]);
    session.finish(generation, status, error);
    this.releasePaths();
    const progress = session.progress();
    const message =
      session.phase === "preview"
        ? status === "failed"
          ? (error ?? "维护预览失败")
          : `Maintenance preview completed. Ready: ${progress.successCount}, Blocked: ${progress.failedCount}`
        : status === "failed"
          ? (error ?? APPLY_FAILED)
          : `Maintenance completed. Succeeded: ${progress.successCount}, Failed: ${progress.failedCount}`;
    await this.publishStatus(session, status, message);
  }

  private releasePaths(): void {
    this.releaseOwnedPaths?.();
    this.releaseOwnedPaths = null;
  }

  private async failSession(sessionId: string, generation: number, error: string): Promise<void> {
    if (!this.isCurrent(sessionId, generation)) return;
    const session = this.require(sessionId);
    if (session.status !== "running" && session.status !== "discovering" && session.status !== "stopping") return;
    await this.finishSession(sessionId, generation, "failed", error);
  }

  private require(sessionId: string): MaintenanceSession {
    if (!this.session || this.session.id !== sessionId) throw new Error(`Maintenance session not found: ${sessionId}`);
    return this.session;
  }

  private isCurrent(sessionId: string, generation: number): boolean {
    return Boolean(this.session && this.session.id === sessionId && this.session.generation === generation);
  }

  private assertCurrent(
    sessionId: string,
    generation: number,
    statuses?: readonly MaintenanceSessionStatus[],
  ): MaintenanceSession {
    const session = this.session;
    if (!session || session.id !== sessionId) throw new StaleMaintenanceGenerationError(OWNERSHIP_CHANGED);
    session.assertGeneration(generation, statuses);
    return session;
  }

  private activeFor(sessionId: string, generation: number): ActiveExecution | null {
    return this.active?.sessionId === sessionId && this.active.generation === generation ? this.active : null;
  }

  private async publishStatus(session: MaintenanceSession, type: string, message: string): Promise<void> {
    if (session.directoryScope) await this.deps.directoryTasks.setStatus(session.id, session.status);
    await this.publishChanged(session);
    await this.publishLog(session, type, message);
  }

  private async publishChanged(session: MaintenanceSession): Promise<void> {
    const snapshot = session.snapshot();
    await this.deps.events?.publish({ kind: "session-changed", session: snapshot });
    this.notify(session.id);
  }

  private async publishLog(session: MaintenanceSession, type: string, message: string): Promise<void> {
    await this.deps.events?.publish({
      kind: "log",
      sessionId: session.id,
      event: { id: randomUUID(), sessionId: session.id, type, message, createdAt: new Date() },
    });
    this.notify(session.id);
  }

  private notify(sessionId: string): void {
    this.revision += 1;
    const waiters = this.changeWaiters.get(sessionId);
    if (!waiters) return;
    this.changeWaiters.delete(sessionId);
    for (const waiter of waiters) waiter();
  }

  private waitForChange(sessionId: string, since: number): Promise<void> {
    if (this.revision !== since) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = this.changeWaiters.get(sessionId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.changeWaiters.set(sessionId, waiters);
    });
  }

  private async awaitCurrentExecution(): Promise<void> {
    for (;;) {
      const current = this.executionPromise;
      if (!current) return;
      await current.catch(() => undefined);
      if (this.executionPromise === current) return;
    }
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("Maintenance coordinator is closed");
  }
}
