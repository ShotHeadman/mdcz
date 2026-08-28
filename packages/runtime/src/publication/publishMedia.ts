import { copyFile, mkdir, open, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { preflightPublication } from "./preflight";
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

const exists = async (fileSystem: PublicationFileSystem, filePath: string): Promise<boolean> => {
  try {
    await fileSystem.stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const operationFileToken = (operationId: string): string => operationId.replaceAll(/[^A-Za-z0-9._-]/g, "_");

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
  const resolved = await preflightPublication(plan, options, fileSystem);
  const conflict = options.journal.conflicts(lockRefs);
  if (conflict) throw new Error(`Publication conflicts with unfinished operation: ${conflict.operationId}`);
  const release = options.acquireAll?.(lockRefs) ?? (() => undefined);
  let journalOpen = false;
  const planned: PlannedPublication[] = [];
  const published: PlannedPublication[] = [];

  const rollback = async (error: unknown): Promise<never> => {
    const restoreErrors: unknown[] = [];
    for (const item of [...published].reverse()) {
      try {
        if (item.targetExisted && item.backupPath) await fileSystem.rename(item.backupPath, item.targetPath);
        else await fileSystem.rm(item.targetPath, { force: true });
      } catch (restoreError) {
        restoreErrors.push(restoreError);
        await recordRepair(plan, options.repairIssues, item.ref, restoreError);
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError(
        [error, ...restoreErrors],
        `Publication rollback failed for ${plan.operationId}: ${toErrorMessage(error)}`,
      );
    }
    for (const item of planned) await fileSystem.rm(item.temporaryPath, { force: true });
    options.journal.finish(plan.operationId);
    throw error;
  };

  try {
    const replacing = new Set((plan.replaceExistingTargets ?? []).map(refKey));
    for (const artifact of plan.artifacts) {
      const targetPath = resolved.resolve(artifact.target);
      const targetExisted = await exists(fileSystem, targetPath);
      const alreadySatisfied =
        targetExisted && artifact.content.kind !== "download" && !replacing.has(refKey(artifact.target));
      if (alreadySatisfied) continue;
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
      const targetStats = await fileSystem.stat(targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const targetSatisfied = Boolean(targetStats?.isFile() && targetStats.size === video.size);
      if (sourcePath !== targetPath && (!targetSatisfied || replacing.has(refKey(video.target)))) {
        await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
        const temporaryPath = createTargetTemporaryPath(targetPath, plan.operationId);
        planned.push({
          ref: video.target,
          targetPath,
          temporaryPath,
          backupPath: targetStats ? createTargetBackupPath(targetPath, plan.operationId) : null,
          targetExisted: Boolean(targetStats),
          stage: async () => {
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
    ]);
    const manifest: PublicationJournalManifest = {
      entries: planned.map((item) => ({
        rootId: item.ref.rootId,
        relativePath: item.ref.relativePath,
        temporaryPath: item.temporaryPath,
        backupPath: item.backupPath,
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

    for (const item of planned) {
      if (item.targetExisted && item.backupPath) await fileSystem.rename(item.targetPath, item.backupPath);
      await fileSystem.rename(item.temporaryPath, item.targetPath);
      published.push(item);
    }

    const result = options.journal.commit(plan.operationId, () => options.commit());

    try {
      for (const ref of obsolete) await fileSystem.rm(resolved.resolve(ref), { force: true });
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
      journalOpen = false;
    } catch (error) {
      const target = plan.video?.target ?? plan.artifacts[0]?.target ?? plan.obsolete[0];
      await recordRepair(plan, options.repairIssues, target, error);
      throw new PublicationError(
        `Publication committed but cleanup failed: ${toErrorMessage(error)}`,
        plan.operationId,
        true,
        { cause: error },
      );
    }

    return result;
  } catch (error) {
    if (error instanceof PublicationError && error.committed) throw error;
    if (error instanceof AggregateError) throw error;
    if (journalOpen) await rollback(error);
    throw error;
  } finally {
    release();
  }
};
