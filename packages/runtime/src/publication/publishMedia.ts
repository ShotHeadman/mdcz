import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { mediaPathOwnership } from "../library/mediaPathOwnership";
import {
  assertPublicationFileUnchanged,
  type ObservedPublicationFile,
  observePublicationFile,
  preflightPublication,
  removeCommittedObsoleteFiles,
  toObsoleteObservation,
} from "./preflight";
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
    await flushFile(target);
  },
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
};

const uniqueRefs = (refs: readonly RootFileRef[]): RootFileRef[] => {
  const unique = new Map(refs.map((ref) => [`${ref.rootId}\0${ref.relativePath}`, ref]));
  return [...unique.values()];
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const refKey = (ref: RootFileRef): string => `${ref.rootId}\0${ref.relativePath}`;

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
}

export const commitPublishedMedia = async <TResult>(
  plan: PublicationPlan,
  options: PublishMediaOptions<TResult>,
): Promise<TResult> => {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const lockRefs = uniqueRefs([
    ...(plan.video ? [plan.video.source, plan.video.target] : []),
    ...plan.artifacts.map(({ target }) => target),
    ...plan.assets.flatMap((asset) => (asset.type === "local" ? [asset.file] : [])),
    ...plan.obsolete,
  ]);
  const previewed = await preflightPublication(plan, options, fileSystem);
  const release = options.acquireAll?.(lockRefs) ?? mediaPathOwnership.acquireAll(lockRefs);
  let journalOpen = false;
  let committed = false;
  const planned: PlannedPublication[] = [];
  const published: PlannedPublication[] = [];

  const rollback = async (error: unknown): Promise<never> => {
    const secondary: unknown[] = [];
    for (const item of [...published].reverse()) {
      try {
        if (item.targetExisted && item.backupPath) await fileSystem.rename(item.backupPath, item.targetPath);
        else await fileSystem.rm(item.targetPath, { force: true });
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
    if (conflict) throw new Error(`Publication conflicts with unfinished operation: ${conflict.operationId}`);
    const resolved = await preflightPublication(plan, options, fileSystem, previewed.observed);
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
          let data: Buffer | string;
          if (artifact.content.kind === "download") {
            const downloaded = options.download
              ? await options.download(artifact.content.url)
              : new Uint8Array(await (await fetch(artifact.content.url)).arrayBuffer());
            data = Buffer.from(downloaded);
          } else {
            data = artifact.content.data;
          }
          await fileSystem.writeFile(temporaryPath, data, { flush: true });
          const staged = await fileSystem.stat(temporaryPath);
          if (!staged.isFile() || staged.size !== expectedBytes(data)) {
            throw new Error(
              `Staged artifact size mismatch for ${artifact.target.rootId}:${artifact.target.relativePath}`,
            );
          }
        },
      });
    }

    if (plan.video) {
      const video = plan.video;
      const sourcePath = resolved.resolve(video.source);
      const targetPath = resolved.resolve(video.target);
      const targetFact = observedAt(resolved.observed, targetPath);
      const targetExisted = targetFact?.exists === true;
      const targetSatisfied = targetFact?.exists === true && targetFact.isFile && targetFact.size === video.size;
      if (sourcePath !== targetPath && (!targetSatisfied || replacing.has(refKey(video.target)))) {
        await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
        const temporaryPath = createTargetTemporaryPath(targetPath, plan.operationId);
        planned.push({
          ref: video.target,
          targetPath,
          temporaryPath,
          backupPath: targetExisted ? createTargetBackupPath(targetPath, plan.operationId) : null,
          targetExisted,
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
            await fileSystem.copyFile(sourcePath, temporaryPath);
            const copied = await fileSystem.stat(temporaryPath);
            if (!copied.isFile() || copied.size !== video.size) {
              throw new Error(`Copied video size mismatch for ${video.target.rootId}:${video.target.relativePath}`);
            }
          },
        });
      }
    }

    const obsolete = uniqueRefs([
      ...plan.obsolete,
      ...(plan.video && resolved.resolve(plan.video.source) !== resolved.resolve(plan.video.target)
        ? [plan.video.source]
        : []),
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
    const staged = await preflightPublication(plan, options, fileSystem, resolved.observed);

    for (const item of planned) {
      const expectedTarget = observedAt(staged.observed, item.targetPath);
      if (!expectedTarget) throw new Error(`Publication target was not observed: ${item.targetPath}`);
      assertPublicationFileUnchanged(expectedTarget, await observePublicationFile(fileSystem, item.targetPath));
      if (item.targetExisted && item.backupPath) {
        await fileSystem.rename(item.targetPath, item.backupPath);
        published.push(item);
      }
      await fileSystem.rename(item.temporaryPath, item.targetPath);
      if (!item.targetExisted) published.push(item);
    }

    const result = options.journal.commit(plan.operationId, () => options.commit());
    committed = true;
    journalOpen = false;

    try {
      const retainedObsolete = await removeCommittedObsoleteFiles(fileSystem, obsolete, (rootId, relativePath) =>
        resolved.resolve({ rootId, relativePath }),
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
        ...(plan.video ? [plan.video.target] : []),
        ...plan.artifacts.map(({ target }) => target),
      ])) {
        await options.repairIssues?.resolve(plan.operationId, target.rootId, target.relativePath);
      }
      options.journal.finish(plan.operationId);
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
        const target = plan.video?.target ?? plan.artifacts[0]?.target ?? plan.obsolete[0];
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
    if (error instanceof AggregateError) throw error;
    if (journalOpen) await rollback(error);
    throw error;
  } finally {
    release();
  }
};
