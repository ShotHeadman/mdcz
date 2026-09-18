import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { MediaPathBusyError, mediaPathOwnership } from "../library/mediaPathOwnership";
import { runtimeLoggerService } from "../shared";
import { PublicationConflictError } from "./conflicts";
import { manifestRefs } from "./manifest";
import { prepareOutputValidation } from "./outputValidation";
import { preparePublicationPaths, publicationRefKey as refKey } from "./paths";
import {
  assertPublicationFileUnchanged,
  type ObservedPublicationFile,
  observePublicationFile,
  planRefs,
  preflightPublication,
  publicationFilesMatch,
  publicationSources,
  removeCommittedObsoleteFiles,
  toObsoleteObservation,
} from "./preflight";
import { publicationOperations } from "./publicationPlan";
import { isPublicationPathReferenced } from "./registeredOutputs";
import { restorePublicationFile } from "./restorePublicationFile";
import type {
  PublicationFileSystem,
  PublicationJournalManifest,
  PublicationOperation,
  PublicationPlan,
  PublicationRepairPort,
  PublicationResult,
  PublishMediaOptions,
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
  operation: PublicationOperation;
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
): Promise<PublicationResult<TResult>> => {
  const outputs = options.outputs;
  const fileSystem = options.fileSystem ?? defaultFileSystem;
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
  const lockRefs = uniqueRefs(planRefs(plan));
  const copySources = publicationOperations(plan).flatMap((operation) =>
    operation.kind === "copy" ? [operation.sourcePath] : [],
  );
  const lockStartedAt = startPhase("lock");
  const paths = await preparePublicationPaths(lockRefs, options, copySources);
  for (const operation of publicationOperations(plan)) {
    if (operation.kind !== "move") continue;
    const source = paths.key(operation.source);
    const target = paths.key(operation.target);
    const entry = await lstat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error(`Publication source is missing: ${source}`, { cause: error });
      throw error;
    });
    if (!entry.isSymbolicLink()) continue;
    const linkTarget = await readlink(source);
    if (!path.isAbsolute(linkTarget) && path.dirname(source) !== path.dirname(target)) {
      throw new Error(`Cannot relocate a relative file symlink without preserving its target: ${source}`);
    }
    const [sourceParent, targetParent] = await Promise.all([
      stat(path.dirname(source)),
      stat(path.dirname(target)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    ]);
    if (!targetParent || sourceParent.dev !== targetParent.dev) {
      throw new Error(`Cannot copy a file symlink as source media: ${source}`);
    }
  }
  const lockKeys = new Set([...lockRefs.map(paths.key), ...copySources.map(paths.pathKey)]);
  let release: () => void;
  try {
    release = options.acquireAll?.([...lockKeys]) ?? mediaPathOwnership.acquireAll([...lockKeys]);
  } catch (error) {
    if (error instanceof MediaPathBusyError) {
      throw new PublicationConflictError(error.path, error.path, "发布路径正被其他并发任务占用");
    }
    throw error;
  }
  recordPhase("lock", lockStartedAt);
  let journalOpen = false;
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
    const unfinished = options.journal.listUnfinished();
    for (const record of unfinished) await paths.prepare(manifestRefs(record.manifest));
    const conflict = unfinished.find((entry) =>
      manifestRefs(entry.manifest).some((ref) => lockKeys.has(paths.key(ref))),
    );
    if (conflict)
      throw new PublicationConflictError(
        plan.operationId,
        conflict.operationId,
        "目标路径存在未完成的发布操作，请先恢复或清理",
      );
    const preflightStartedAt = startPhase("preflight");
    await options.validate?.();
    const resolved = await preflightPublication(plan, paths, fileSystem);
    const outputValidation = await prepareOutputValidation(plan, options, paths, resolved.observed);
    recordPhase("preflight", preflightStartedAt);
    const orderedOperations = [...publicationOperations(plan)].sort(
      (left, right) => Number(left.kind === "move") - Number(right.kind === "move"),
    );
    for (const operation of orderedOperations) {
      const targetPath = resolved.resolve(operation.target);
      const targetFact = observedAt(resolved.observed, targetPath);
      const targetExisted = targetFact?.exists === true;
      if (
        (operation.kind === "copy"
          ? operation.sourcePath
          : operation.kind === "move"
            ? resolved.resolve(operation.source)
            : undefined) === targetPath
      )
        continue;
      if (targetExisted && !operation.replaceExisting) continue;
      const temporaryPath = createTargetTemporaryPath(targetPath, plan.operationId);
      planned.push({
        operation,
        ref: operation.target,
        targetPath,
        temporaryPath,
        backupPath: targetExisted ? createTargetBackupPath(targetPath, plan.operationId) : null,
        targetExisted,
        ...(operation.kind === "move"
          ? { sourcePath: resolved.resolve(operation.source), source: operation.source }
          : {}),
        stage: async () => {
          await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
          if (operation.kind !== "write") {
            const sourcePath = operation.kind === "copy" ? operation.sourcePath : resolved.resolve(operation.source);
            const source = await fileSystem.stat(sourcePath);
            const observed = observedAt(resolved.observed, sourcePath);
            if (
              !source.isFile() ||
              source.size !== operation.size ||
              (observed?.exists === true && (source.size !== observed.size || source.mtimeMs !== observed.mtimeMs))
            )
              throw new Error(
                `Publication source changed before mutation: ${operation.kind === "copy" ? operation.sourcePath : refKey(operation.source)}`,
              );
            const capacity = await fileSystem.statfs(path.dirname(targetPath));
            if (operation.kind === "copy" && capacity.bavail * capacity.bsize < operation.size) {
              throw new Error(`Insufficient space for publication target: ${targetPath}`);
            }
            const writeStartedAt = startPhase(operation.kind);
            if (operation.kind === "copy") {
              await fileSystem.copyFile(sourcePath, temporaryPath);
            } else {
              try {
                await fileSystem.rename(sourcePath, temporaryPath);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
                if ((await lstat(sourcePath)).isSymbolicLink())
                  throw new Error(`Cannot copy a file symlink as source media: ${sourcePath}`, { cause: error });
                if (capacity.bavail * capacity.bsize < operation.size)
                  throw new Error(`Insufficient space for publication target: ${targetPath}`);
                await fileSystem.copyFile(sourcePath, temporaryPath);
              }
            }
            recordPhase(operation.kind, writeStartedAt);
            await fileSystem.flush?.(temporaryPath);
            const staged = await fileSystem.stat(temporaryPath);
            if (!staged.isFile() || staged.size !== operation.size)
              throw new Error(`Staged transfer size mismatch for ${refKey(operation.target)}`);
            return;
          }
          const data = operation.content.data;
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
            throw new Error(`Staged artifact size mismatch for ${refKey(operation.target)}`);
          }
        },
      });
    }

    const obsolete = uniqueRefs([
      ...(outputValidation?.obsolete ?? plan.obsolete),
      ...publicationOperations(plan)
        .filter(
          (operation) =>
            operation.kind === "move" && resolved.resolve(operation.source) !== resolved.resolve(operation.target),
        )
        .map((operation) => (operation.kind === "move" ? operation.source : operation.target)),
    ]).map((ref) => {
      const obsoletePath = resolved.resolve(ref);
      const fact = observedAt(resolved.observed, obsoletePath);
      if (!fact) throw new Error(`Publication obsolete path was not observed: ${obsoletePath}`);
      return { ...ref, observed: toObsoleteObservation(fact) };
    });
    const manifest: PublicationJournalManifest = {
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
      if (!publicationFilesMatch(expectedTarget, currentTarget))
        throw new PublicationConflictError(
          publicationSources(plan)[0] ? resolved.resolve(publicationSources(plan)[0].source) : item.targetPath,
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
    for (const media of publicationSources(plan)) {
      if (planned.some((item) => item.sourcePath === resolved.resolve(media.source))) continue;
      const expected = observedAt(resolved.observed, resolved.resolve(media.source));
      if (expected) assertPublicationFileUnchanged(expected, await observePublicationFile(fileSystem, expected.path));
    }
    const commitStartedAt = startPhase("commit");
    const result = options.journal.commit(plan.operationId, () => {
      outputValidation?.assertCurrent();
      return options.commit();
    });
    journalOpen = false;
    const cleanupIssues: unknown[] = [];
    try {
      recordPhase("commit", commitStartedAt);
      const cleanupStartedAt = startPhase("cleanup");
      const retainedObsolete = await removeCommittedObsoleteFiles(
        fileSystem,
        obsolete,
        (rootId, relativePath) => resolved.resolve({ rootId, relativePath }),
        outputs ? (ref) => isPublicationPathReferenced(ref, outputs, options.resolveRoot) : undefined,
      );
      for (const ref of retainedObsolete) {
        const issue = new Error(
          `Publication obsolete path changed or remains referenced: ${ref.rootId}:${ref.relativePath}`,
        );
        cleanupIssues.push(issue);
        await recordRepair(plan, options.repairIssues, ref, issue);
      }
      for (const item of planned) {
        if (item.backupPath) await fileSystem.rm(item.backupPath, { force: true });
        await fileSystem.rm(item.temporaryPath, { force: true });
      }
      for (const target of uniqueRefs([...publicationOperations(plan).map((operation) => operation.target)])) {
        await options.repairIssues?.resolve(plan.operationId, target.rootId, target.relativePath);
      }
      options.journal.finish(plan.operationId);
      recordPhase("cleanup", cleanupStartedAt);
    } catch (error) {
      cleanupIssues.push(error);
      try {
        const target = publicationOperations(plan)[0]?.target ?? plan.obsolete[0];
        await recordRepair(plan, options.repairIssues, target, error);
      } catch (repairError) {
        cleanupIssues.push(repairError);
      }
    }
    return { value: result, cleanupIssues };
  } catch (error) {
    if (journalOpen) await rollback(error);
    throw error;
  } finally {
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
