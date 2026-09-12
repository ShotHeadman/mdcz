import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import { runtimeLoggerService } from "../shared";
import {
  guardPublicationFileSystem,
  publicationPathKey,
  publicationRefKey as refKey,
  resolvePublicationPath,
} from "./boundary";
import { PublicationConflictError } from "./conflicts";
import { manifestRefs } from "./manifest";
import { prepareOutputRegistration } from "./outputs";
import {
  assertPublicationFileUnchanged,
  type ObservedPublicationFile,
  observePublicationFile,
  planMoves,
  planRefs,
  preflightPublication,
  publicationFilesMatch,
  removeCommittedObsoleteFiles,
  toObsoleteObservation,
} from "./preflight";
import { isPublicationPathReferenced } from "./registeredOutputs";
import { restorePublicationFile } from "./restorePublicationFile";
import {
  PublicationError,
  type PublicationFileSystem,
  type PublicationJournalManifest,
  type PublicationPlan,
  type PublicationRepairPort,
  type PublishMediaOptions,
} from "./types";

const flushFile = async (filePath: string): Promise<void> => {
  const handle = await open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const defaultFileSystem: PublicationFileSystem = {
  copyFile: async (source, target) => {
    await copyFile(source, target);
  },
  flush: flushFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
};

const uniqueRefs = (refs: readonly RootFileRef[]): RootFileRef[] => {
  const unique = new Map(refs.map((ref) => [refKey(ref), ref]));
  return [...unique.values()];
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const observedAt = (
  observed: readonly ObservedPublicationFile[],
  filePath: string,
): ObservedPublicationFile | undefined => observed.find((file) => file.path === filePath);

const operationFileToken = (operationId: string): string =>
  createHash("sha256").update(operationId).digest("hex").slice(0, 16);

const createTargetTemporaryPath = (targetPath: string, operationId: string): string => {
  const target = path.parse(targetPath);
  return path.join(target.dir, `${target.base}.${operationFileToken(operationId)}.part`);
};

const createTargetBackupPath = (targetPath: string, operationId: string): string => {
  const target = path.parse(targetPath);
  return path.join(target.dir, `${target.base}.${operationFileToken(operationId)}.bak`);
};

const expectedBytes = (data: Buffer | string): number =>
  typeof data === "string" ? Buffer.byteLength(data) : data.length;

const recordRepair = async (
  plan: PublicationPlan,
  repairIssues: PublicationRepairPort | undefined,
  ref: RootFileRef | undefined,
  error: unknown,
): Promise<void> => {
  if (!ref || !repairIssues) return;
  await repairIssues.record({
    operationId: plan.operationId,
    operationType: plan.operationType,
    rootId: ref.rootId,
    relativePath: ref.relativePath,
    errorMessage: toErrorMessage(error),
  });
};

interface PlannedPublication {
  ref: RootFileRef;
  targetPath: string;
  temporaryPath: string;
  backupPath: string | null;
  targetExisted: boolean;
  stage: () => Promise<void>;
  sourcePath?: string;
  source?: RootFileRef;
}

export const commitPublishedMedia = async <TResult>(
  plan: PublicationPlan,
  options: PublishMediaOptions<TResult>,
): Promise<TResult> => {
  const outputs = options.outputs;
  const fileSystem = guardPublicationFileSystem(options.fileSystem ?? defaultFileSystem, plan.boundary);
  const lockRefs = uniqueRefs(planRefs(plan));
  const logger = runtimeLoggerService.getLogger("Publication");
  const operationLabel = plan.operationId.slice(-8);
  const phaseCounts = new Map<string, number>();
  let activePhase: string | null = null;
  let activePhaseStartedAt = 0;
  let longestPhase: { label: string; durationMs: number } | null = null;
  const recordPhase = (phase: string, phaseStartedAt: number): void => {
    const count = (phaseCounts.get(phase) ?? 0) + 1;
    phaseCounts.set(phase, count);
    const label = count === 1 ? phase : `${phase}#${count}`;
    const durationMs = Math.round(performance.now() - phaseStartedAt);
    if (!longestPhase || durationMs > longestPhase.durationMs) {
      longestPhase = { label, durationMs };
    }
    activePhase = null;
  };
  const startPhase = (phase: string): number => {
    activePhase = phase;
    activePhaseStartedAt = performance.now();
    return activePhaseStartedAt;
  };
  const previewStartedAt = startPhase("preview");
  await prepareOutputRegistration(plan, options, fileSystem);
  const previewed = await preflightPublication(plan, options, fileSystem);
  recordPhase("preview", previewStartedAt);
  const lockStartedAt = startPhase("lock");
  const canonicalRefs = uniqueRefs(
    await Promise.all(
      lockRefs.map(async (ref) => ({
        rootId: "publication-filesystem",
        relativePath: createHash("sha256")
          .update(
            publicationPathKey(
              await resolvePublicationPath(
                resolveRootRelativePath(
                  previewed.roots.get(ref.rootId) ?? (await options.resolveRoot(ref.rootId)),
                  ref.relativePath,
                ),
              ),
            ),
          )
          .digest("hex"),
      })),
    ),
  );
  const releaseCanonical = mediaPathOwnership.acquireAll(canonicalRefs);
  let release: () => void;
  try {
    release = options.acquireAll?.(lockRefs) ?? mediaPathOwnership.acquireAll(lockRefs);
  } catch (error) {
    releaseCanonical();
    throw error;
  }
  recordPhase("lock", lockStartedAt);
  let journalOpen = false;
  let committed = false;
  const planned: PlannedPublication[] = [];
  const published: PlannedPublication[] = [];

  const rollback = async (error: unknown): Promise<never> => {
    const secondary: unknown[] = [];
    for (const item of [...planned].reverse()) {
      try {
        await restorePublicationFile(fileSystem, item, published.includes(item));
      } catch (restoreError) {
        secondary.push(restoreError);
        try {
          await recordRepair(plan, options.repairIssues, item.ref, restoreError);
        } catch (repairError) {
          secondary.push(repairError);
        }
      }
    }
    if (secondary.length > 0) {
      throw new AggregateError(
        [error, ...secondary],
        `Publication rollback failed for ${plan.operationId}: ${toErrorMessage(error)}`,
      );
    }
    try {
      for (const item of planned) await fileSystem.rm(item.temporaryPath, { force: true });
      options.journal.finish(plan.operationId);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Publication rollback failed for ${plan.operationId}: ${toErrorMessage(error)}`,
      );
    }
    throw error;
  };

  try {
    const conflict = options.journal.conflicts(lockRefs);
    if (conflict)
      throw new PublicationConflictError(plan.operationId, conflict.operationId, "目标仍属于未完成的发布操作");
    const lockedPhysicalPaths = new Set(canonicalRefs.map((ref) => ref.relativePath));
    for (const pending of options.journal.listUnfinished()) {
      for (const ref of manifestRefs(pending.manifest)) {
        const absolute = resolveRootRelativePath(await options.resolveRoot(ref.rootId), ref.relativePath);
        const physicalKey = createHash("sha256")
          .update(publicationPathKey(await resolvePublicationPath(absolute)))
          .digest("hex");
        if (lockedPhysicalPaths.has(physicalKey))
          throw new PublicationConflictError(
            plan.operationId,
            absolute,
            `实际目标仍属于未完成的发布操作 ${pending.operationId}`,
          );
      }
    }
    const preflightStartedAt = startPhase("preflight");
    const registerOutputs = await prepareOutputRegistration(plan, options, fileSystem);
    const resolved = await preflightPublication(plan, options, fileSystem, previewed.observed);
    recordPhase("preflight", preflightStartedAt);
    const replacing = new Set((plan.replaceExistingTargets ?? []).map(refKey));
    for (const artifact of plan.artifacts) {
      const targetPath = resolved.resolve(artifact.target);
      const targetFact = observedAt(resolved.observed, targetPath);
      const targetExisted = targetFact?.exists === true;
      if (targetExisted && artifact.content.kind !== "download" && !replacing.has(refKey(artifact.target))) continue;
      await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
      const temporaryPath = createTargetTemporaryPath(targetPath, plan.operationId);
      planned.push({
        ref: artifact.target,
        targetPath,
        temporaryPath,
        backupPath: targetExisted ? createTargetBackupPath(targetPath, plan.operationId) : null,
        targetExisted,
        stage: async () => {
          if (artifact.content.kind === "file") {
            const source = await fileSystem.stat(artifact.content.path);
            if (!source.isFile() || source.size !== artifact.content.size) {
              throw new Error(`Publication artifact source changed before mutation: ${artifact.content.path}`);
            }
            const capacity = await fileSystem.statfs(path.dirname(targetPath));
            if (capacity.bavail * capacity.bsize < artifact.content.size) {
              throw new Error(`Insufficient space for publication target: ${targetPath}`);
            }
            const writeStartedAt = startPhase("sidecar-copy");
            await fileSystem.copyFile(artifact.content.path, temporaryPath);
            recordPhase("sidecar-copy", writeStartedAt);
            await fileSystem.flush?.(temporaryPath);
            const staged = await fileSystem.stat(temporaryPath);
            if (!staged.isFile() || staged.size !== artifact.content.size) {
              throw new Error(
                `Staged artifact size mismatch for ${artifact.target.rootId}:${artifact.target.relativePath}`,
              );
            }
            return;
          }
          let data: Buffer | string;
          if (artifact.content.kind === "download") {
            const downloaded = options.download
              ? await options.download(artifact.content.url)
              : new Uint8Array(await (await fetch(artifact.content.url)).arrayBuffer());
            data = Buffer.from(downloaded);
          } else {
            data = artifact.content.data;
          }
          const writeStartedAt = startPhase("sidecar-write");
          const capacity = await fileSystem.statfs(path.dirname(targetPath));
          if (capacity.bavail * capacity.bsize < expectedBytes(data)) {
            throw new Error(`Insufficient space for publication target: ${targetPath}`);
          }
          await fileSystem.writeFile(temporaryPath, data);
          recordPhase("sidecar-write", writeStartedAt);
          const flushStartedAt = startPhase("flush");
          await fileSystem.flush?.(temporaryPath);
          recordPhase("flush", flushStartedAt);
          const staged = await fileSystem.stat(temporaryPath);
          if (!staged.isFile() || staged.size !== expectedBytes(data)) {
            throw new Error(
              `Staged artifact size mismatch for ${artifact.target.rootId}:${artifact.target.relativePath}`,
            );
          }
        },
      });
    }

    for (const video of planMoves(plan)) {
      const content = video.content;
      const sourcePath = resolved.resolve(video.source);
      const targetPath = resolved.resolve(video.target);
      const targetFact = observedAt(resolved.observed, targetPath);
      const targetExisted = targetFact?.exists === true;
      if (sourcePath !== targetPath) {
        await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
        const temporaryPath = createTargetTemporaryPath(targetPath, plan.operationId);
        planned.push({
          ref: video.target,
          targetPath,
          temporaryPath,
          backupPath: targetExisted ? createTargetBackupPath(targetPath, plan.operationId) : null,
          targetExisted,
          ...(content === undefined && !video.preserveSource ? { sourcePath, source: video.source } : {}),
          stage: async () => {
            const sourceNow = await fileSystem.stat(sourcePath);
            const observed = observedAt(resolved.observed, sourcePath);
            if (
              !sourceNow.isFile() ||
              sourceNow.size !== video.size ||
              (observed?.exists === true &&
                (sourceNow.size !== observed.size || sourceNow.mtimeMs !== observed.mtimeMs))
            ) {
              throw new Error(
                `Publication source changed before mutation: ${video.source.rootId}:${video.source.relativePath}`,
              );
            }
            const copyStartedAt = startPhase("video-copy");
            if (content !== undefined || video.preserveSource) {
              const capacity = await fileSystem.statfs(path.dirname(targetPath));
              if (capacity.bavail * capacity.bsize < (content === undefined ? video.size : expectedBytes(content))) {
                throw new Error(`Insufficient space for publication target: ${targetPath}`);
              }
              if (content === undefined) await fileSystem.copyFile(sourcePath, temporaryPath);
              else await fileSystem.writeFile(temporaryPath, content);
            } else {
              try {
                await fileSystem.rename(sourcePath, temporaryPath);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
                const capacity = await fileSystem.statfs(path.dirname(targetPath));
                if (capacity.bavail * capacity.bsize < video.size) {
                  throw new Error(`Insufficient space for publication target: ${targetPath}`);
                }
                await fileSystem.copyFile(sourcePath, temporaryPath);
              }
            }
            recordPhase("video-copy", copyStartedAt);
            const flushStartedAt = startPhase("flush");
            await fileSystem.flush?.(temporaryPath);
            recordPhase("flush", flushStartedAt);
            const copied = await fileSystem.stat(temporaryPath);
            if (!copied.isFile() || copied.size !== (content === undefined ? video.size : expectedBytes(content))) {
              throw new Error(`Copied video size mismatch for ${video.target.rootId}:${video.target.relativePath}`);
            }
          },
        });
      }
    }

    const obsolete = uniqueRefs([
      ...plan.obsolete,
      ...(plan.deleteFiles ?? []),
      ...planMoves(plan)
        .filter((move) => !move.preserveSource && resolved.resolve(move.source) !== resolved.resolve(move.target))
        .map((move) => move.source),
    ]).map((ref) => {
      const obsoletePath = resolved.resolve(ref);
      const fact = observedAt(resolved.observed, obsoletePath);
      if (!fact) throw new Error(`Publication obsolete path was not observed: ${obsoletePath}`);
      return { ...ref, observed: toObsoleteObservation(fact) };
    });
    const manifest: PublicationJournalManifest = {
      boundary: plan.boundary,
      entries: planned.map((item) => ({
        rootId: item.ref.rootId,
        relativePath: item.ref.relativePath,
        temporaryPath: `${item.ref.relativePath}.${operationFileToken(plan.operationId)}.part`,
        backupPath: item.backupPath ? `${item.ref.relativePath}.${operationFileToken(plan.operationId)}.bak` : null,
        targetExisted: item.targetExisted,
        source: item.source,
      })),
      obsolete,
    };
    options.journal.begin({
      operationId: plan.operationId,
      operationType: plan.operationType,
      manifest,
      createdAt: new Date(),
    });
    journalOpen = true;

    for (const item of planned) await item.stage();
    for (const [index, item] of planned.entries()) {
      const { size, mtimeMs, ino, dev } = await fileSystem.stat(item.temporaryPath);
      manifest.entries[index].staged = { size, mtimeMs, ino, dev };
    }
    options.journal.stage(plan.operationId, manifest);
    // Video staging moves the source atomically, so the source observation from the
    // initial preflight is intentionally invalidated. Targets are revalidated below.

    const renameStartedAt = startPhase("rename");
    for (const item of planned) {
      const expectedTarget = observedAt(resolved.observed, item.targetPath);
      if (!expectedTarget) throw new Error(`Publication target was not observed: ${item.targetPath}`);
      const currentTarget = await observePublicationFile(fileSystem, item.targetPath);
      const video = plan.videos?.find((video) => refKey(video.target) === refKey(item.ref));
      if (video && !expectedTarget.exists && currentTarget.exists) {
        throw new PublicationConflictError(resolved.resolve(video.source), item.targetPath);
      }
      if (!publicationFilesMatch(expectedTarget, currentTarget))
        throw new PublicationConflictError(
          plan.media?.[0] ? resolved.resolve(plan.media[0].source) : item.targetPath,
          item.targetPath,
          "发布目标在提交前发生变化",
        );
      if (item.targetExisted && item.backupPath) {
        await fileSystem.rename(item.targetPath, item.backupPath);
        published.push(item);
      }
      await fileSystem.rename(item.temporaryPath, item.targetPath);
      if (!item.targetExisted) published.push(item);
    }
    recordPhase("rename", renameStartedAt);
    for (const media of plan.media ?? []) {
      if (planned.some((item) => item.sourcePath === resolved.resolve(media.source))) continue;
      const expected = observedAt(resolved.observed, resolved.resolve(media.source));
      if (expected) assertPublicationFileUnchanged(expected, await observePublicationFile(fileSystem, expected.path));
    }
    await registerOutputs?.assertCurrent();
    const commitStartedAt = startPhase("commit");
    const result = options.journal.commit(plan.operationId, () => {
      const result = options.commit();
      registerOutputs?.register();
      return result;
    });
    committed = true;
    journalOpen = false;
    recordPhase("commit", commitStartedAt);

    try {
      const cleanupStartedAt = startPhase("cleanup");
      const retainedObsolete = await removeCommittedObsoleteFiles(
        fileSystem,
        obsolete,
        (rootId, relativePath) => resolved.resolve({ rootId, relativePath }),
        outputs ? (ref) => isPublicationPathReferenced(ref, outputs, options.resolveRoot) : undefined,
      );
      for (const ref of retainedObsolete) {
        await recordRepair(
          plan,
          options.repairIssues,
          ref,
          new Error(`Publication obsolete path changed before cleanup: ${ref.rootId}:${ref.relativePath}`),
        );
      }
      for (const item of planned) {
        if (item.backupPath) await fileSystem.rm(item.backupPath, { force: true });
        await fileSystem.rm(item.temporaryPath, { force: true });
      }
      for (const target of uniqueRefs([
        ...planMoves(plan).map((move) => move.target),
        ...plan.artifacts.map(({ target }) => target),
      ])) {
        await options.repairIssues?.resolve(plan.operationId, target.rootId, target.relativePath);
      }
      options.journal.finish(plan.operationId);
      recordPhase("cleanup", cleanupStartedAt);
    } catch (error) {
      throw new PublicationError(
        `Publication committed but cleanup failed: ${toErrorMessage(error)}`,
        plan.operationId,
        true,
        { cause: error },
      );
    }

    return result;
  } catch (error) {
    if (committed) {
      const publicationError =
        error instanceof PublicationError && error.committed
          ? error
          : new PublicationError(
              `Publication committed but cleanup failed: ${toErrorMessage(error)}`,
              plan.operationId,
              true,
              { cause: error },
            );
      try {
        const target = plan.videos?.[0]?.target ?? plan.artifacts[0]?.target ?? plan.obsolete[0];
        await recordRepair(plan, options.repairIssues, target, error);
      } catch (repairError) {
        throw new PublicationError(
          `Publication committed but cleanup failed: ${toErrorMessage(error)}`,
          plan.operationId,
          true,
          { cause: new AggregateError([error, repairError]) },
        );
      }
      throw publicationError;
    }
    if (journalOpen) await rollback(error);
    throw error;
  } finally {
    releaseCanonical();
    release();
    if (activePhase) {
      const count = (phaseCounts.get(activePhase) ?? 0) + 1;
      const label = count === 1 ? activePhase : `${activePhase}#${count}`;
      const durationMs = Math.round(performance.now() - activePhaseStartedAt);
      if (!longestPhase || durationMs > longestPhase.durationMs) {
        longestPhase = { label, durationMs };
      }
    }
    if (longestPhase) {
      logger.info(
        `[publication] op=${operationLabel} phase=${longestPhase.label} durationMs=${longestPhase.durationMs}`,
      );
    }
  }
};
