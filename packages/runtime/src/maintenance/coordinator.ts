import { randomUUID } from "node:crypto";
import {
  canonicalizeRootFileRefs,
  filesystemPathKey,
  type MediaRoot,
  resolveRootRelativePath,
} from "@mdcz/media-store";
import type { LibraryRepository } from "@mdcz/persistence";
import type { Configuration } from "@mdcz/shared/config";
import type { DirectoryTaskScope, DiscoveryProgress } from "@mdcz/shared/directoryTasks";
import { toErrorMessage } from "@mdcz/shared/error";
import type {
  MaintenanceActiveSessionSnapshot,
  MaintenanceApplyBatch,
  MaintenanceApplyItemResult,
  MaintenanceApplySelection,
  MaintenanceMovieGroup,
  MaintenancePreviewBatch,
  MaintenanceSessionEvent,
  MaintenanceSessionRef,
  MaintenanceSessionSnapshot,
  MaintenanceSessionStatus,
} from "@mdcz/shared/maintenanceTasks";
import type { PublicationTarget } from "@mdcz/shared/mediaLibrary";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { LocalScanEntry, MaintenancePresetId } from "@mdcz/shared/types";
import { writeCommittedMovie } from "../publication/committedMovie";
import { PublicationConflictError } from "../publication/conflicts";
import { DirectoryInventory } from "../scrape/DirectoryInventory";
import { admitMaintenanceGroups, type MovieOwnership } from "../scrape/movieGroups";
import { isAbortError } from "../scrape/utils/abort";
import { TaskExecutor, type TaskExecutorContext } from "../tasks";
import {
  InactiveMaintenanceSessionError,
  type MaintenanceBatchItem,
  MaintenanceSession,
} from "../tasks/session/MaintenanceSession";
import { buildMaintenanceApplyData } from "./applyData";
import type { MaintenanceRuntime, MaintenanceRuntimePreviewItem } from "./MaintenanceRuntime";

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
  target?: PublicationTarget;
  presetId: MaintenancePresetId;
}

export interface MaintenancePersistencePort {
  get(): Promise<{
    library: LibraryRepository;
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

const PREVIEW_ALL_FAILED = "Maintenance preview failed for all items";
const APPLY_FAILED = "Maintenance apply failed";
const STOPPED = "Maintenance stopped";
const STOPPED_ITEM = "Maintenance stopped; item not processed";
const INTERRUPTED = "Maintenance interrupted due to service shutdown; please preview and apply again";
const OWNERSHIP_CHANGED = "Maintenance execution ownership changed";

const refKey = (ref: RootFileRef): string => `${ref.rootId}\0${ref.relativePath}`;

const assertUniqueRefs = (refs: readonly MaintenanceSessionRef[]): void => {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.relativePath.trim()) throw new Error("Maintenance file path cannot be empty");
    const key = refKey(ref);
    if (seen.has(key)) throw new Error(`Duplicate maintenance file path: ${ref.rootId}:${ref.relativePath}`);
    seen.add(key);
  }
};

const resolveMovieSelections = async (
  roots: MaintenanceRootPort,
  ownership: readonly MovieOwnership[],
  refs: readonly MaintenanceSessionRef[],
  inventory: DirectoryInventory,
  configuration: Configuration,
): Promise<MaintenanceMovieSelection[]> => {
  const selectedPaths = new Set(
    await Promise.all(
      refs.map(async (ref) =>
        filesystemPathKey(
          await inventory.entryPath(resolveRootRelativePath(await roots.get(ref.rootId), ref.relativePath)),
        ),
      ),
    ),
  );
  const videos = await Promise.all(
    ownership
      .filter((entry) => entry.kind === "video")
      .map(async (entry) => ({
        ...entry,
        path: filesystemPathKey(
          await inventory.entryPath(resolveRootRelativePath(await roots.get(entry.rootId), entry.relativePath)),
        ),
      })),
  );
  const selectedMovies = new Set(videos.filter((entry) => selectedPaths.has(entry.path)).map((entry) => entry.movieId));
  const groups = await admitMaintenanceGroups({
    refs: [...refs, ...videos.filter((entry) => selectedMovies.has(entry.movieId))],
    ownership,
    resolveRoot: (id) => roots.get(id),
    inventory,
    configuration,
  });

  return groups.map((group) => {
    if (group.error) throw new Error(group.error);
    const files = group.members.map((member) => ({
      rootId: member.source.rootId,
      relativePath: member.source.relativePath,
      fileId: member.fileId,
    }));
    files.sort((left, right) => refKey(left).localeCompare(refKey(right)));
    const selected = files[0];
    if (!selected) throw new Error("Movie is missing valid files");
    return {
      ref: { rootId: selected.rootId, relativePath: selected.relativePath },
      identity: {
        movieId: group.movieId,
        files,
        assets: group.assets,
      },
    };
  });
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
  const registeredOutputs = new Map<string, { nfoPaths: string[]; assets: LocalScanEntry["assets"] }>();
  const assets = await Promise.all(
    identity.assets.map(async (asset) => ({
      ...asset,
      path: resolveRootRelativePath(await roots.get(asset.rootId), asset.relativePath),
    })),
  );
  for (const member of members) {
    const location: { nfoPaths: string[]; assets: LocalScanEntry["assets"] } = {
      nfoPaths: [],
      assets: { sceneImages: [], actorPhotos: [] },
    };
    for (const asset of assets.filter((asset) => asset.fileId === null || asset.fileId === member.fileId)) {
      if (asset.kind === "nfo") location.nfoPaths.push(asset.path);
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
      if (byRef.has(key))
        throw new Error(`Duplicate maintenance scan result path: ${rootId}:${entry.ref.relativePath}`);
      byRef.set(key, { ...entry, ref });
    }
  }
  if (byRef.size !== members.length || members.some((member) => !byRef.has(refKey(member)))) {
    throw new Error("Maintenance scan results do not match requested files");
  }
  return members.map((member) => {
    const observation = byRef.get(refKey(member));
    if (!observation) throw new Error("Maintenance scan results do not match requested files");
    return { ...observation, fileId: member.fileId };
  });
};

export class MaintenanceSessionCoordinator {
  private runtime: MaintenanceRuntime;
  private inventory = new DirectoryInventory();
  private session: MaintenanceSession | null = null;
  private active: ActiveExecution | null = null;
  private executionPromise: Promise<void> | null = null;
  private stopOperation?: { sessionId: string; promise: Promise<MaintenanceSessionSnapshot> };
  private readonly changeWaiters = new Map<string, Set<() => void>>();
  private revision = 0;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private previewStarting = false;
  private sessionController = new AbortController();
  private previewSelections = new Map<string, MaintenanceMovieSelection>();
  private pendingPreviewSetup: {
    root: MediaRoot;
    target?: PublicationTarget;
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
    /** The library that moving presets organize into. */
    target?: PublicationTarget;
  }): Promise<MaintenanceRunHandle<MaintenancePreviewBatch>> {
    this.assertOpen();
    if (input.refs.length === 0 && !input.directoryScope) throw new Error("Maintenance files cannot be empty");
    if (this.previewStarting || this.session?.isActive()) {
      throw new Error(
        "An active maintenance session already exists; please complete or stop the current session first",
      );
    }
    this.previewStarting = true;
    try {
      const currentConfiguration = await this.deps.runtime.getConfiguration();
      const configuration = input.configuration ?? currentConfiguration;
      this.inventory = new DirectoryInventory();
      this.sessionController.abort();
      this.sessionController = new AbortController();
      const canonical = await canonicalizeRootFileRefs(await this.deps.roots.list(), input.refs);
      const admitted = await Promise.all(
        canonical.map(async (ref) => ({
          ...ref,
          entryIdentity: filesystemPathKey(
            await this.inventory.entryPath(
              resolveRootRelativePath(await this.deps.roots.get(ref.rootId), ref.relativePath),
            ),
          ),
        })),
      );
      const ownership =
        admitted.length === 0 ? [] : (await this.deps.persistence.get()).library.inventoryOwnership(admitted);
      const selections = await resolveMovieSelections(
        this.deps.roots,
        ownership,
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
        target: input.target,
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
            target: input.target,
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
        throw new Error(batch.session.error ?? "Maintenance preview failed");
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
    if (this.previewStarting) throw new Error("Maintenance preview is starting, please try again shortly");
    if (input.selections.length === 0) throw new Error("Please select maintenance previews to apply");
    const previewIds = input.selections.map((selection) => selection.previewId);
    const session = this.require(input.sessionId);
    const previews = previewIds
      .map((previewId) => session.preview(previewId))
      .filter((preview) => preview !== undefined);
    if (previews.length !== previewIds.length)
      throw new Error(
        "Some maintenance previews do not exist, were already committed, or do not belong to the current session",
      );
    const draftSelections = session.snapshot().draft.fieldSelections;
    for (const selection of input.selections) {
      const preview = previews.find((item) => item.id === selection.previewId);
      const fieldSelections = selection.fieldSelections ?? draftSelections[selection.previewId];
      if (!fieldSelections || preview?.status !== "ready" || !preview.entry || !preview.files?.length) continue;
      const crawlerData = buildMaintenanceApplyData(preview.entry, preview, fieldSelections).crawlerData;
      if (!crawlerData) throw new Error("Maintenance preview is missing movie metadata");
      const paths = await this.runtime.previewPaths({
        presetId: session.presetId,
        entry: preview.entry,
        files: preview.files,
        crawlerData,
      });
      if (
        paths.pathDiff?.targetVideoPath !== preview.pathDiff?.targetVideoPath ||
        JSON.stringify(paths.affectedFiles) !== JSON.stringify(preview.affectedFiles)
      ) {
        throw new Error(
          "Field selections have changed the target path; please refresh the maintenance preview before executing",
        );
      }
    }
    await this.deps.roots.assertRootIntegrity([
      session.outputRootId,
      ...previews.flatMap((preview) => preview.movieGroup?.files.map((file) => file.rootId) ?? []),
    ]);
    this.assertOpen();
    if (this.previewStarting) throw new Error("Maintenance preview is starting, please try again shortly");
    if (this.session !== session) throw new Error("Current maintenance task is no longer valid; please start over");
    const apply = session.beginApply(input.selections);
    try {
      await this.publishStatus(session, "queued", `Maintenance apply queued. Items: ${input.selections.length}`);
      await this.startCurrentPhase(session.id);
    } catch (error) {
      const message = toErrorMessage(error);
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
    if (session.status === "discovering")
      throw new Error("Pausing is not supported during scanning; please stop the task directly");
    if (!session.pause()) return session.statusSnapshot();
    await this.publishStatus(session, "paused", "Maintenance session paused");
    if (this.active?.sessionId === session.id) this.active.executor.pause();
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
    this.sessionController.abort();
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
    const preview = session.preview(input.previewId);
    if (!preview?.entry || !preview.files?.length)
      throw new Error("Maintenance preview does not exist or is missing movie files");
    const selections = input.fieldSelections ?? session.snapshot().draft.fieldSelections[input.previewId];
    const crawlerData = buildMaintenanceApplyData(preview.entry, preview, selections).crawlerData;
    if (!crawlerData) throw new Error("Maintenance preview is missing movie metadata");
    const paths = await this.runtime.previewPaths({
      presetId: session.presetId,
      entry: preview.entry,
      files: preview.files,
      crawlerData,
    });
    if (new Set(paths.affectedFiles.map((file) => file.targetPath)).size !== paths.affectedFiles.length)
      throw new Error("Multiple files for the movie have identical target paths; please adjust field selections");
    this.require(input.sessionId).updateDraft(input.previewId, input.fieldSelections, {
      pathDiff: paths.pathDiff ?? null,
      affectedFiles: paths.affectedFiles,
    });
    await this.publishChanged(session);
    return session.snapshot();
  }

  async discardSession(sessionId?: string): Promise<void> {
    if (!this.session) return;
    if (sessionId && this.session.id !== sessionId)
      throw new Error("Current maintenance task is no longer valid; please start over");
    if (this.session.isActive()) throw new Error("Maintenance task is still running; please stop before returning");
    const id = this.session.id;
    this.previewSelections.clear();
    this.sessionController.abort();
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
    const tracked = run.finally(() => {
      if (this.executionPromise === tracked) this.executionPromise = null;
      this.notify(sessionId);
    });
    this.executionPromise = tracked;
    void tracked.catch(() => undefined);
  }

  private async runPreview(sessionId: string): Promise<void> {
    const scanController = this.sessionController;
    this.active = { sessionId, executor: { pause: () => undefined, stop: () => scanController.abort() } };
    try {
      let initial = this.assertCurrent(sessionId, ["running"]);
      if (initial.directoryScope && !initial.snapshot().manifestFixed) {
        initial.startDiscovery();
        await this.publishChanged(initial);
      }
      const setup = this.pendingPreviewSetup;
      if (setup) {
        this.runtime = await this.deps.runtime.createSession({ ...setup, signal: scanController.signal });
        this.pendingPreviewSetup = null;
      }
      scanController.signal.throwIfAborted();
      if (initial.directoryScope && !initial.snapshot().manifestFixed) {
        if (!this.deps.discoverDirectory || !setup?.configuration)
          throw new Error("Directory scan is missing required configuration");
        let progressNotification = Promise.resolve();
        let progressError: unknown;
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
        );
        await progressNotification;
        if (progressError) throw progressError;
        scanController.signal.throwIfAborted();
        const canonical = await canonicalizeRootFileRefs(await this.deps.roots.list(), refs);
        const admitted = await Promise.all(
          canonical.map(async (ref) => ({
            ...ref,
            entryIdentity: filesystemPathKey(
              await this.inventory.entryPath(
                resolveRootRelativePath(await this.deps.roots.get(ref.rootId), ref.relativePath),
              ),
            ),
          })),
        );
        const ownership = (await this.deps.persistence.get()).library.inventoryOwnership(admitted);
        const selections = await resolveMovieSelections(
          this.deps.roots,
          ownership,
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
        if (!selection)
          throw new Error(`Maintenance movie selection is no longer valid: ${ref.rootId}:${ref.relativePath}`);
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
            if (!entry) throw new Error("Maintenance preview is missing selected file");
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
          if (!files || !entry) throw new Error("Maintenance preview is missing scanned video files");
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
              throw new Error(
                "Multiple files for the movie have identical target paths; please adjust naming and re-preview",
              );
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
                error: toErrorMessage(error),
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
      if (this.abandonedPhase(sessionId, error)) return;
      await this.failSession(sessionId, toErrorMessage(error));
    } finally {
      this.endPhase(sessionId);
    }
  }

  private async runApply(sessionId: string): Promise<void> {
    try {
      await this.runtime.applyNetworkPolicy?.();
      const initial = this.assertCurrent(sessionId, ["running"]);
      const pending = initial.pendingBatchItems();
      await this.executeItems<MaintenanceBatchItem, void>(sessionId, pending, {
        runItem: async (item, context) => {
          const active = this.assertCurrent(sessionId, ["running"]).markApplyProcessing(item);
          if (!active.preview) {
            await this.commitItem(sessionId, item, { status: "failed", error: "Maintenance preview does not exist" });
            return;
          }
          if (active.preview.status === "blocked") {
            await this.commitItem(sessionId, item, {
              status: "skipped",
              error: active.preview.error ?? "Maintenance preview is not applicable",
            });
            return;
          }
          let result: MaintenanceApplyItemResult;
          try {
            const previewIdentity = active.preview.movieGroup;
            if (!previewIdentity) throw new Error("Maintenance preview has no publication identity");
            const files = active.preview.files;
            if (!files?.length) throw new Error("Maintenance preview has no movie members");
            const entry = files.find(
              (file) =>
                file.ref.rootId === active.preview?.rootId && file.ref.relativePath === active.preview.relativePath,
            );
            if (!entry) throw new Error(`Maintenance file does not exist: ${active.preview.relativePath}`);
            const committed = buildMaintenanceApplyData(entry, active.preview, active.item.selection.fieldSelections);
            const latest = this.assertCurrent(sessionId, ["running", "paused"]);
            const publicationRoots = await this.deps.roots.list();
            const { library } = await this.deps.persistence.get();
            const applied = await this.runtime.applyEntry({
              presetId: latest.presetId,
              entry,
              committed,
              files,
              signal: context.signal,
              publication: {
                roots: publicationRoots,
                commit: (movie) => writeCommittedMovie(library, movie),
                identity: {
                  movieId: previewIdentity.movieId,
                  assets: previewIdentity.assets,
                },
              },
            });
            result = { status: applied.status, error: applied.error };
          } catch (error) {
            const stopped = isAbortError(error) || context.signal.aborted;
            result = {
              status: stopped || error instanceof PublicationConflictError ? "skipped" : "failed",
              error: stopped ? STOPPED_ITEM : toErrorMessage(error),
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
      if (this.abandonedPhase(sessionId, error)) return;
      const message = toErrorMessage(error);
      await this.skipOutstanding(sessionId, message);
      await this.failSession(sessionId, message);
    } finally {
      this.endPhase(sessionId);
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
    await executor.execute(items, this.sessionController.signal);
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
        if (session.snapshot().currentBatch?.id !== batchId)
          throw new Error("Maintenance execution status has changed; please review task progress again");
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
          ? (error ?? "Maintenance preview failed")
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

  private abandonedPhase(sessionId: string, error: unknown): boolean {
    if (!this.isCurrent(sessionId) || this.closing) return true;
    const current = this.require(sessionId);
    return (
      current.status === "paused" ||
      isAbortError(error) ||
      current.status === "stopping" ||
      error instanceof InactiveMaintenanceSessionError
    );
  }

  private endPhase(sessionId: string): void {
    if (this.active?.sessionId === sessionId) this.active = null;
    this.notify(sessionId);
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
