import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  canonicalizeRootFileRefs,
  filesystemPathKey,
  type MediaRoot,
  resolveRootRelativePath,
  toRootRelativePath,
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
  MaintenanceSessionRef,
  MaintenanceSessionSnapshot,
  MaintenanceSessionStatus,
  MaintenanceMovieGroup as SharedMaintenanceMovieGroup,
} from "@mdcz/shared/maintenanceTasks";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import { PublicationConflictError } from "../publication/conflicts";
import type { PublicationLibraryAsset } from "../publication/outputLibrary";
import type { PublicationJournalPort } from "../publication/types";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { isAbortError } from "../scrape/utils/abort";
import { parseFileInfo } from "../scrape/utils/number";
import { TaskExecutor, type TaskExecutorContext } from "../tasks";
import {
  InactiveMaintenanceSessionError,
  type MaintenanceBatchItem,
  MaintenanceSession,
} from "../tasks/session/MaintenanceSession";
import { buildMaintenanceApplyData } from "./applyData";
import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";
import { getMaintenancePreset } from "./presets";

export interface MaintenanceRootPort {
  get(rootId: string): Promise<MediaRoot>;
  list(): Promise<MediaRoot[]>;
  assertRootIntegrity(rootIds: Iterable<string>): Promise<void>;
}

interface MaintenanceDirectoryDefinition {
  directoryScope: DirectoryTaskScope;
  configuration: Configuration;
  rootId: string;
  outputRootId: string;
  outputRelativeDirectory: string;
  presetId: MaintenancePresetId;
}

type MaintenanceMovieGroup = SharedMaintenanceMovieGroup;

interface MaintenanceLibraryRepository {
  inventoryOwnership(): Array<
    RootFileRef & { movieId: string; fileId: string | null; kind: string; published: number }
  >;

  writeEntry(
    movie: {
      id: string;
      mediaIdentity: string;
      title?: string;
      number: string;
      actors?: string[];
      crawlerDataJson?: string;
      lastRefreshedAt: Date;
      assets: PublicationLibraryAsset[];
    },
    files: Array<{
      fileId: string;
      rootId: string;
      rootRelativePath: string;
      size: number;
      modifiedAt: Date | null;
      partNumber?: number | null;
      partSuffix?: string | null;
      resolution?: string | null;
      assets: PublicationLibraryAsset[];
      lastKnownPath: string;
    }>,
  ): string;
}

export interface MaintenancePersistencePort {
  get(): Promise<{
    library: MaintenanceLibraryRepository;
    publicationJournal: PublicationJournalPort;
  }>;
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
  executor: { pause(): void; stop(): void };
};

type MaintenanceMovieSelection = {
  ref: MaintenanceSessionRef;
  identity: MaintenanceMovieGroup;
  files?: LocalScanEntry[];
};

type PreviewExecutionResult = {
  item: MaintenanceRuntimePreviewItem;
  selection: MaintenanceMovieSelection;
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
  return canonicalizeRootFileRefs(registeredRoots, refs);
};

const resolveMovieSelections = async (
  roots: MaintenanceRootPort,
  ownership: ReturnType<MaintenanceLibraryRepository["inventoryOwnership"]>,
  refs: readonly MaintenanceSessionRef[],
  inventory: DirectoryInventory,
  configuration: Configuration,
): Promise<MaintenanceMovieSelection[]> => {
  const locations = await Promise.all(
    ownership.map(async (entry) => ({
      ...entry,
      path: await inventory.entryPath(resolveRootRelativePath(await roots.get(entry.rootId), entry.relativePath)),
    })),
  );
  const owners = new Map<string, (typeof locations)[number]>();
  for (const entry of locations) {
    const key = filesystemPathKey(entry.path);
    if (entry.kind === "strm" && entry.published) inventory.generatedStrms.add(key);
    if (entry.kind !== "video") continue;
    const previous = owners.get(key);
    if (previous && previous.movieId !== entry.movieId)
      throw new Error(`Media entry belongs to multiple movies: ${entry.path}`);
    owners.set(key, entry);
  }
  const movies = new Map<string, MaintenanceMovieSelection>();
  for (const ref of await inventory.admitRefs(refs, (id) => roots.get(id))) {
    const root = await roots.get(ref.rootId);
    const path = resolveRootRelativePath(root, ref.relativePath);
    const canonical = await inventory.entryPath(path);
    if (inventory.generatedStrms.has(filesystemPathKey(canonical)))
      throw new Error(`不能单独维护生成的视频附属文件：${path}`);
    const owner = owners.get(filesystemPathKey(canonical));
    const info = parseFileInfo(path, configuration.scrape.filenameIgnoreTokens);
    const key = owner?.movieId ?? `${filesystemPathKey(dirname(canonical))}\0${info.number.toUpperCase() || canonical}`;
    const existing = movies.get(key);
    if (existing) {
      if (!owner && !existing.identity.files.some((file) => refKey(file) === refKey(ref)))
        existing.identity.files.push({ ...ref, fileId: `${ref.rootId}:${ref.relativePath}` });
      continue;
    }
    const movieId = owner?.movieId ?? randomUUID();
    const sources: Array<RootFileRef & { fileId: string }> = owner
      ? locations
          .filter((entry) => entry.kind === "video" && entry.movieId === movieId)
          .map((entry) => ({
            rootId: entry.fileId === owner.fileId ? ref.rootId : entry.rootId,
            relativePath: entry.fileId === owner.fileId ? ref.relativePath : entry.relativePath,
            fileId:
              entry.fileId ??
              (() => {
                throw new Error("Registered media has no file ID");
              })(),
          }))
      : [{ ...ref, fileId: `${ref.rootId}:${ref.relativePath}` }];
    if (!owner && info.part) {
      for (const sibling of await inventory.mediaEntries(dirname(path))) {
        const siblingPath = join(dirname(path), sibling.name);
        const parsed = parseFileInfo(siblingPath, configuration.scrape.filenameIgnoreTokens);
        if (!parsed.part || parsed.number.toUpperCase() !== info.number.toUpperCase()) continue;
        if (owners.has(filesystemPathKey(await inventory.entryPath(siblingPath)))) continue;
        const siblingRef = { rootId: root.id, relativePath: toRootRelativePath(root, siblingPath) };
        if (!sources.some((entry) => refKey(entry) === refKey(siblingRef)))
          sources.push({ ...siblingRef, fileId: `${root.id}:${siblingRef.relativePath}` });
      }
    }
    const files: typeof sources = [];
    const seen = new Set<string>();
    for (const source of sources) {
      const path = resolveRootRelativePath(await roots.get(source.rootId), source.relativePath);
      const identity = filesystemPathKey(await inventory.entryPath(path));
      if (seen.has(identity)) continue;
      seen.add(identity);
      files.push(source);
    }
    files.sort((left, right) => refKey(left).localeCompare(refKey(right)));
    const selected = files[0];
    movies.set(key, {
      ref: { rootId: selected.rootId, relativePath: selected.relativePath },
      identity: {
        movieId,
        files,
        assets: locations
          .filter((entry) => entry.kind !== "video" && entry.movieId === movieId)
          .map((entry) => ({
            rootId: entry.rootId,
            relativePath: entry.relativePath,
            fileId: entry.fileId,
            kind: entry.kind,
            published: Boolean(entry.published),
          })),
      },
    });
  }
  for (const selection of movies.values()) {
    const parts = new Set<number>();
    for (const file of selection.identity.files) {
      const part = parseFileInfo(file.relativePath, configuration.scrape.filenameIgnoreTokens).part?.number;
      if (part === undefined) continue;
      if (parts.has(part)) throw new Error("影片存在重复分盘号");
      parts.add(part);
    }
    if (parts.size && parts.size !== selection.identity.files.length)
      throw new Error("同一影片同时包含分盘文件和独立文件，需要手动核对");
  }
  return [...movies.values()];
};

const scanMembers = async (
  runtime: MaintenanceRuntime,
  roots: MaintenanceRootPort,
  identity: MaintenanceMovieGroup,
  signal?: AbortSignal,
): Promise<Array<LocalScanEntry & { fileId: string }>> => {
  const members = identity.files;
  assertUniqueRefs(members);
  const refsByRoot = new Map<string, Array<RootFileRef & { fileId: string }>>();
  for (const member of members) {
    const group = refsByRoot.get(member.rootId) ?? [];
    group.push(member);
    refsByRoot.set(member.rootId, group);
  }
  const byRef = new Map<string, LocalScanEntry>();
  const registeredOutputs = new Map<
    string,
    { nfoPath?: string; strmPath?: string; assets: LocalScanEntry["assets"] }
  >();
  const assets = await Promise.all(
    identity.assets.map(async (asset) => ({
      ...asset,
      path: resolveRootRelativePath(await roots.get(asset.rootId), asset.relativePath),
    })),
  );
  for (const member of members) {
    const location: { nfoPath?: string; strmPath?: string; assets: LocalScanEntry["assets"] } = {
      assets: { sceneImages: [], actorPhotos: [] },
    };
    for (const asset of assets.filter((asset) => asset.fileId === null || asset.fileId === member.fileId)) {
      if (asset.kind === "nfo") location.nfoPath ??= asset.path;
      else if (asset.kind === "strm") location.strmPath ??= asset.path;
      else if (asset.kind === "scene") location.assets.sceneImages.push(asset.path);
      else if (asset.kind === "actor") location.assets.actorPhotos.push(asset.path);
      else if (["thumb", "poster", "fanart", "trailer"].includes(asset.kind))
        location.assets[asset.kind as "thumb" | "poster" | "fanart" | "trailer"] = asset.path;
    }
    if (assets.length)
      registeredOutputs.set(resolveRootRelativePath(await roots.get(member.rootId), member.relativePath), location);
  }
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

export class MaintenanceSessionCoordinator {
  private runtime: MaintenanceRuntime;
  private inventory = new DirectoryInventory();
  private ownership: ReturnType<MaintenanceLibraryRepository["inventoryOwnership"]> = [];
  private session: MaintenanceSession | null = null;
  private active: ActiveExecution | null = null;
  private executionPromise: Promise<void> | null = null;
  private stopOperation?: { sessionId: string; promise: Promise<MaintenanceSessionSnapshot> };
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private revision = 0;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private previewStarting = false;
  private previewSelections = new Map<string, MaintenanceMovieSelection>();
  private pendingPreviewSetup: {
    root: MediaRoot;
    outputRoot: MediaRoot;
    outputRelativeDirectory: string;
    configuration?: Configuration;
    inventory: DirectoryInventory;
  } | null = null;
  private directoryDefinition: MaintenanceDirectoryDefinition | null = null;

  constructor(
    private readonly deps: {
      roots: MaintenanceRootPort;
      runtime: MaintenanceRuntime;
      discoverDirectory?: (
        scope: DirectoryTaskScope,
        configuration: Configuration,
        signal: AbortSignal,
        onProgress: (progress: DiscoveryProgress) => void,
        inventory: DirectoryInventory,
        generatedStrms: ReadonlySet<string>,
      ) => Promise<MaintenanceSessionRef[]>;
      persistence: MaintenancePersistencePort;
      events?: { publish(event: MaintenanceCoordinatorEvent): void | Promise<void> };
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
      this.inventory = new DirectoryInventory();
      this.ownership = (await this.deps.persistence.get()).library.inventoryOwnership();
      const canonical = await canonicalizeRefs(this.deps.roots, input.refs);
      const selections = await resolveMovieSelections(
        this.deps.roots,
        this.ownership,
        canonical,
        this.inventory,
        configuration,
      );
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
      this.pendingPreviewSetup = {
        root,
        outputRoot,
        outputRelativeDirectory,
        configuration,
        inventory: this.inventory,
      };
      for (const rootId of new Set(refs.map((ref) => ref.rootId))) await this.deps.roots.get(rootId);
      this.assertOpen();
      const sessionId = randomUUID();
      this.directoryDefinition = input.directoryScope
        ? {
            directoryScope: input.directoryScope,
            configuration,
            rootId: input.rootId,
            outputRootId: outputRoot.id,
            outputRelativeDirectory,
            presetId: input.presetId,
          }
        : null;
      this.session = new MaintenanceSession({
        directoryScope: input.directoryScope,
        id: sessionId,
        rootId: input.rootId,
        presetId: input.presetId,
        refs,
        outputRootId: outputRoot.id,
        outputRelativeDirectory,
      });
      await this.publishStatus(this.session, "queued", `Maintenance session queued. Preset: ${input.presetId}`);
      await this.publishLog(this.session, "preset", `Maintenance preset: ${input.presetId}`);
      await this.startCurrentPhase(this.session.id);
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
    if (!getMaintenancePreset(session.presetId).supportsExecution) {
      throw new Error(`维护预设 ${session.presetId} 不支持执行`);
    }
    const previews = previewIds
      .map((previewId) => session.preview(previewId))
      .filter((preview) => preview !== undefined);
    if (previews.length !== previewIds.length) throw new Error("部分维护预览不存在、已提交或不属于当前会话");
    await this.deps.roots.assertRootIntegrity([
      session.outputRootId,
      ...previews.flatMap((preview) => preview.movieGroup?.files.map((file) => file.rootId) ?? []),
    ]);
    this.assertOpen();
    if (this.previewStarting) throw new Error("维护预览正在启动，请稍后重试");
    if (this.session !== session) throw new Error("当前维护任务已失效，请重新开始");
    const apply = session.beginApply(input.selections);
    try {
      await this.publishStatus(session, "queued", `Maintenance apply queued. Items: ${input.selections.length}`);
      await this.startCurrentPhase(session.id);
    } catch (error) {
      const message = errorMessage(error);
      session.beginStopping(message);
      session.finish("failed", message);
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
    this.activeFor(session.id)?.executor.pause();
    await this.awaitCurrentExecution();
    return this.require(sessionId).statusSnapshot();
  }

  async resume(sessionId: string): Promise<MaintenanceSessionSnapshot> {
    const session = this.require(sessionId);
    if (session.status !== "paused") return session.statusSnapshot();
    await this.awaitCurrentExecution();
    const current = this.require(sessionId);
    if (current.status !== "paused") return current.statusSnapshot();
    await this.startCurrentPhase(current.id, "Maintenance session resumed");
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
    this.require(sessionId);
    if (this.stopOperation?.sessionId === sessionId) return this.stopOperation.promise;
    const promise = this.terminate(sessionId, reason, itemReason);
    this.stopOperation = { sessionId, promise };
    return promise;
  }

  private async terminate(sessionId: string, reason: string, itemReason: string): Promise<MaintenanceSessionSnapshot> {
    const current = this.require(sessionId);
    if (!current.isActive()) return current.statusSnapshot();
    current.beginStopping(reason);
    const errors: unknown[] = [];
    this.active?.executor.stop();
    try {
      await this.publishStatus(current, "stopping", "Stopping maintenance session");
    } catch (error) {
      errors.push(error);
    }
    await this.awaitCurrentExecution();
    const latest = this.require(sessionId);
    if (this.session !== latest) return latest.statusSnapshot();
    try {
      if (latest.phase === "apply") await this.skipOutstanding(latest.id, itemReason);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.finishSession(latest.id, reason === INTERRUPTED ? "interrupted" : "stopped", reason);
    } catch (error) {
      errors.push(error);
    } finally {
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
    if (this.session?.id !== sessionId || !this.directoryDefinition) {
      throw new Error(`Maintenance directory session not found: ${sessionId}`);
    }
    const definition = this.directoryDefinition;
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
    this.previewSelections.clear();
  }

  private async startCurrentPhase(sessionId: string, message?: string): Promise<void> {
    const session = this.assertCurrent(sessionId, ["queued", "paused"]);
    const expectedStatus = session.status;
    if (this.executionPromise) throw new Error("Maintenance coordinator already has an active executor");
    if (!this.isCurrent(sessionId) || this.require(sessionId).status !== expectedStatus) return;
    session.startRunning();
    await this.publishStatus(session, "running", message ?? `Starting maintenance ${session.phase}`);
    if (!this.isCurrent(sessionId) || this.require(sessionId).status !== "running") return;
    const run = session.phase === "preview" ? this.runPreview(sessionId) : this.runApply(sessionId);
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (this.executionPromise === tracked) this.executionPromise = null;
      this.notify(sessionId);
    });
    this.executionPromise = tracked;
    void tracked.catch(() => undefined);
  }

  private async runPreview(sessionId: string): Promise<void> {
    const scanController = new AbortController();
    this.active = { sessionId, executor: { pause: () => undefined, stop: () => scanController.abort() } };
    try {
      let initial = this.assertCurrent(sessionId, ["running"]);
      if (initial.directoryScope && !initial.snapshot().manifestFixed) {
        initial.startDiscovery();
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
        const generatedStrms = new Set(
          await Promise.all(
            this.ownership
              .filter((entry) => entry.kind === "strm" && entry.published)
              .map(async (entry) =>
                filesystemPathKey(resolveRootRelativePath(await this.deps.roots.get(entry.rootId), entry.relativePath)),
              ),
          ),
        );
        const refs = await this.deps.discoverDirectory(
          initial.directoryScope,
          setup.configuration,
          scanController.signal,
          (progress) => {
            initial.recordDiscovery(progress);
            progressNotification = progressNotification
              .then(async () => {
                if (!scanController.signal.aborted) await this.publishChanged(initial);
              })
              .catch((error) => {
                progressError = error;
              });
          },
          this.inventory,
          generatedStrms,
        );
        await progressNotification;
        if (progressError) throw progressError;
        scanController.signal.throwIfAborted();
        const canonical = await canonicalizeRefs(this.deps.roots, refs);
        const selections = await resolveMovieSelections(
          this.deps.roots,
          this.ownership,
          canonical,
          this.inventory,
          setup.configuration,
        );
        this.previewSelections = new Map(selections.map((selection) => [refKey(selection.ref), selection]));
        initial.fixDiscoveredRefs(selections.map((selection) => selection.ref));
        await this.publishChanged(initial);
      }
      await this.runtime.applyNetworkPolicy?.();
      initial = this.assertCurrent(sessionId, ["running", "paused"]);
      if (initial.status === "paused") return;
      const selections = initial.refs.map((ref) => {
        const selection = this.previewSelections.get(refKey(ref));
        if (!selection) throw new Error(`维护影片选择已失效：${ref.rootId}:${ref.relativePath}`);
        return selection;
      });
      for (const selection of selections) {
        if (selection.files) continue;
        const scanned = await scanMembers(this.runtime, this.deps.roots, selection.identity, scanController.signal);
        selection.files = scanned;
      }
      let current = this.assertCurrent(sessionId, ["running", "paused"]);
      if (current.status === "paused") return;
      if (!current.activePreviews().length && selections.length) {
        current.initializeEntries(
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
      await this.executeItems<MaintenanceMovieSelection, PreviewExecutionResult>(sessionId, pending, {
        runItem: async (selection, context) => {
          this.assertCurrent(sessionId, ["running"]);
          const activeSession = this.require(sessionId);
          activeSession.markPreviewProcessing(selection.ref.rootId, selection.ref.relativePath);
          await this.publishChanged(activeSession);

          const files = selection.files;
          const entry = files?.find((file) => refKey(file.ref) === refKey(selection.ref));
          if (!files || !entry) throw new Error("维护预览缺少已扫描的影片成员");
          const root = await this.deps.roots.get(entry.ref.rootId);
          try {
            const active = this.assertCurrent(sessionId, ["running"]);
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
          this.commitPreview(sessionId, result.item, result.selection);
          await this.publishChanged(this.require(sessionId));
        },
      });
      if (!this.isCurrent(sessionId) || this.require(sessionId).status !== "running") return;
      current = this.assertCurrent(sessionId, ["running"]);
      const progress = current.progress();
      const allBlocked =
        progress.totalEntries > 0 && progress.successCount === 0 && progress.failedCount >= progress.totalEntries;
      await this.finishSession(sessionId, allBlocked ? "failed" : "completed", allBlocked ? PREVIEW_ALL_FAILED : null);
    } catch (error) {
      if (!this.isCurrent(sessionId) || this.closing) return;
      const current = this.require(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || error instanceof InactiveMaintenanceSessionError)
        return;
      await this.failSession(sessionId, errorMessage(error));
    } finally {
      if (this.active?.sessionId === sessionId) this.active = null;
      this.notify(sessionId);
    }
  }

  private async runApply(sessionId: string): Promise<void> {
    try {
      await this.runtime.applyNetworkPolicy?.();
      const initial = this.assertCurrent(sessionId, ["running"]);
      const pending = initial.pendingBatchItems();
      await this.executeItems<MaintenanceBatchItem, void>(sessionId, pending, {
        runItem: async (item, context) => {
          const active = this.markApplyProcessing(sessionId, item);
          if (!active.preview) {
            await this.commitItem(sessionId, item, { status: "failed", error: "维护预览不存在" });
            return;
          }
          if (active.preview.status === "blocked") {
            await this.commitItem(sessionId, item, {
              status: "skipped",
              error: active.preview.error ?? "维护预览不可应用",
            });
            return;
          }
          let result: MaintenanceApplyItemResult;
          try {
            const previewIdentity = active.preview.movieGroup;
            if (!previewIdentity) throw new Error("Maintenance preview has no publication identity");
            const root = await this.deps.roots.get(active.preview.rootId);
            const files = active.preview.files;
            if (!files?.length) throw new Error("Maintenance preview has no movie members");
            const entry = files.find(
              (file) =>
                file.ref.rootId === active.preview?.rootId && file.ref.relativePath === active.preview.relativePath,
            );
            if (!entry) throw new Error(`维护文件不存在：${active.preview.relativePath}`);
            const committed = buildMaintenanceApplyData(entry, active.preview, active.item.selection.fieldSelections);
            const latest = this.assertCurrent(sessionId, ["running", "paused"]);
            const progress = latest.progress();
            const publicationRoots = await this.deps.roots.list();
            const { library, publicationJournal } = await this.deps.persistence.get();
            result = await this.runtime.applyEntry({
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
                journal: publicationJournal,
                commit: (movie) => {
                  library.writeEntry(
                    {
                      id: movie.id,
                      mediaIdentity: movie.mediaIdentity,
                      number: movie.number,
                      title: movie.title,
                      actors: [...movie.actors],
                      crawlerDataJson: movie.crawlerDataJson,
                      lastRefreshedAt: new Date(),
                      assets: movie.assets.filter((asset) => asset.fileId === null),
                    },
                    movie.files.map((file) => ({
                      fileId: file.fileId,
                      rootId: file.rootId,
                      rootRelativePath: file.rootRelativePath,
                      size: file.size,
                      modifiedAt: file.modifiedAtMs === null ? null : new Date(file.modifiedAtMs),
                      partNumber: file.partNumber,
                      partSuffix: file.partSuffix,
                      resolution: file.resolution,
                      assets: movie.assets.filter((asset) => asset.fileId === file.fileId),
                      lastKnownPath: file.rootRelativePath,
                    })),
                  );
                },
                identity: {
                  movieId: previewIdentity.movieId,
                  assets: previewIdentity.assets,
                },
              },
            });
          } catch (error) {
            const stopped = isAbortError(error) || context.signal.aborted;
            result = {
              status: stopped || error instanceof PublicationConflictError ? "skipped" : "failed",
              error: stopped ? STOPPED_ITEM : errorMessage(error),
            };
          }
          await this.commitItem(sessionId, item, result);
        },
        applyResult: async () => undefined,
      });
      if (!this.isCurrent(sessionId) || this.require(sessionId).status !== "running") return;
      const current = this.assertCurrent(sessionId, ["running"]);
      const progress = current.progress();
      if (progress.completedEntries < progress.totalEntries) {
        return;
      }
      const failedAll =
        progress.totalEntries > 0 && progress.successCount === 0 && progress.failedCount >= progress.totalEntries;
      await this.finishSession(sessionId, failedAll ? "failed" : "completed", failedAll ? APPLY_FAILED : null);
    } catch (error) {
      if (!this.isCurrent(sessionId) || this.closing) return;
      const current = this.require(sessionId);
      if (current.status === "paused") return;
      if (isAbortError(error) || current.status === "stopping" || error instanceof InactiveMaintenanceSessionError)
        return;
      const message = errorMessage(error);
      await this.skipOutstanding(sessionId, message);
      await this.failSession(sessionId, message);
    } finally {
      if (this.active?.sessionId === sessionId) this.active = null;
      this.notify(sessionId);
    }
  }

  private async executeItems<TItem, TResult>(
    sessionId: string,
    items: readonly TItem[],
    execution: {
      runItem(item: TItem, context: TaskExecutorContext): Promise<TResult>;
      applyResult(item: TItem, result: TResult, context: TaskExecutorContext): Promise<unknown>;
    },
  ): Promise<void> {
    const executor = new TaskExecutor<TItem, TResult>({
      concurrency: 1,
      gate: {
        beforeItem: async () => void this.assertCurrent(sessionId, ["running"]),
        beforeResult: async () => void this.assertCurrent(sessionId, ["running", "paused"]),
      },
      ...execution,
    });
    this.active = { sessionId, executor };
    await executor.execute(items);
  }

  private commitPreview(
    sessionId: string,
    item: MaintenanceRuntimePreviewItem,
    selection: MaintenanceMovieSelection,
  ): void {
    const session = this.assertCurrent(sessionId, ["running", "paused"]);
    session.commitPreview({
      movieGroup: selection.identity,
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

  private markApplyProcessing(sessionId: string, item: MaintenanceBatchItem) {
    const session = this.assertCurrent(sessionId, ["running"]);
    return session.markApplyProcessing(item);
  }

  private async commitItem(
    sessionId: string,
    item: MaintenanceBatchItem,
    result: MaintenanceApplyItemResult,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, ["running", "paused", "stopping"]);
    if (session.commitItem(item, result)) await this.publishChanged(session);
  }

  private async skipOutstanding(sessionId: string, error: string): Promise<void> {
    const session = this.assertCurrent(sessionId, ["running", "paused", "stopping"]);
    if (session.skipOutstanding(error)) await this.publishChanged(session);
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
    status: "completed" | "failed" | "stopped" | "interrupted",
    error: string | null,
  ): Promise<void> {
    const session = this.assertCurrent(sessionId, ["running", "discovering", "stopping"]);
    session.finish(status, error);
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

  private async failSession(sessionId: string, error: string): Promise<void> {
    if (!this.isCurrent(sessionId)) return;
    const session = this.require(sessionId);
    if (session.status !== "running" && session.status !== "discovering" && session.status !== "stopping") return;
    await this.finishSession(sessionId, "failed", error);
  }

  private require(sessionId: string): MaintenanceSession {
    if (!this.session || this.session.id !== sessionId) throw new Error(`Maintenance session not found: ${sessionId}`);
    return this.session;
  }

  private isCurrent(sessionId: string): boolean {
    return Boolean(this.session && this.session.id === sessionId);
  }

  private assertCurrent(sessionId: string, statuses?: readonly MaintenanceSessionStatus[]): MaintenanceSession {
    const session = this.session;
    if (!session || session.id !== sessionId) throw new InactiveMaintenanceSessionError(OWNERSHIP_CHANGED);
    session.assertActive(statuses);
    return session;
  }

  private activeFor(sessionId: string): ActiveExecution | null {
    return this.active?.sessionId === sessionId ? this.active : null;
  }

  private async publishStatus(session: MaintenanceSession, type: string, message: string): Promise<void> {
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
