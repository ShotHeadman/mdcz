import { copyFile, mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { preflightPublication } from "./preflight";
import { createTargetTemporaryPath, PublicationTempManifest } from "./tempManifest";
import { PublicationError, type PublicationFileSystem, type PublicationPlan, type PublishMediaOptions } from "./types";

const defaultFileSystem: PublicationFileSystem = { copyFile, mkdir, readFile, rename, rm, stat, statfs, writeFile };

const uniqueRefs = (refs: readonly RootFileRef[]): RootFileRef[] => {
  const unique = new Map(refs.map((ref) => [`${ref.rootId}\0${ref.relativePath}`, ref]));
  return [...unique.values()];
};

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const removeCommittedSources = async (
  plan: PublicationPlan,
  resolve: (ref: RootFileRef) => string,
  fileSystem: PublicationFileSystem,
): Promise<void> => {
  const refs = [...plan.obsolete];
  if (plan.video) {
    const sourcePath = resolve(plan.video.source);
    if (sourcePath !== resolve(plan.video.target)) refs.push(plan.video.source);
  }
  for (const ref of uniqueRefs(refs)) await fileSystem.rm(resolve(ref), { force: true });
};

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
  const release = options.acquireAll?.(lockRefs) ?? (() => undefined);
  const manifest = new PublicationTempManifest(fileSystem);

  try {
    const resolved = await preflightPublication(plan, options, fileSystem);
    const publications: Array<{ temporaryPath: string; targetPath: string }> = [];

    for (const artifact of plan.artifacts) {
      const targetPath = resolved.resolve(artifact.target);
      const replacing = plan.replaceExistingTargets?.some(
        (ref) => `${ref.rootId}\0${ref.relativePath}` === `${artifact.target.rootId}\0${artifact.target.relativePath}`,
      );
      const alreadySatisfied = await fileSystem
        .stat(targetPath)
        .then(() => artifact.content.kind !== "download" && !replacing)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
      if (alreadySatisfied) continue;
      await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
      const temporaryPath = createTargetTemporaryPath(targetPath);
      manifest.trackTemporary(temporaryPath);
      let data: Buffer | string;
      if (artifact.content.kind === "download") {
        const downloaded = options.download
          ? await options.download(artifact.content.url)
          : new Uint8Array(await (await fetch(artifact.content.url)).arrayBuffer());
        data = Buffer.from(downloaded);
      } else {
        data = artifact.content.data;
      }
      await fileSystem.writeFile(temporaryPath, data);
      publications.push({ temporaryPath, targetPath });
    }

    if (plan.video) {
      const sourcePath = resolved.resolve(plan.video.source);
      const targetPath = resolved.resolve(plan.video.target);
      const targetSatisfied = await fileSystem
        .stat(targetPath)
        .then((info) => info.isFile() && info.size === plan.video?.size)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
      const replacing = plan.replaceExistingTargets?.some(
        (ref) =>
          `${ref.rootId}\0${ref.relativePath}` === `${plan.video?.target.rootId}\0${plan.video?.target.relativePath}`,
      );
      if (sourcePath !== targetPath && (!targetSatisfied || replacing)) {
        await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
        const temporaryPath = createTargetTemporaryPath(targetPath);
        manifest.trackTemporary(temporaryPath);
        await fileSystem.copyFile(sourcePath, temporaryPath);
        const copied = await fileSystem.stat(temporaryPath);
        if (!copied.isFile() || copied.size !== plan.video.size) {
          throw new Error(
            `Copied video size mismatch for ${plan.video.target.rootId}:${plan.video.target.relativePath}`,
          );
        }
        publications.push({ temporaryPath, targetPath });
      }
    }

    for (const publication of publications) {
      await fileSystem.rename(publication.temporaryPath, publication.targetPath);
      manifest.published(publication.temporaryPath, publication.targetPath);
    }

    let result: TResult;
    try {
      result = await options.commit();
    } catch (error) {
      const target = plan.video?.target ?? plan.artifacts[0]?.target ?? plan.obsolete[0];
      if (target && options.repairIssues) {
        await options.repairIssues.record({
          operationId: plan.operationId,
          operationType: plan.operationType,
          rootId: target.rootId,
          relativePath: target.relativePath,
          errorMessage: toErrorMessage(error),
        });
      }
      throw new PublicationError(
        `Published files but database commit failed: ${toErrorMessage(error)}`,
        plan.operationId,
        false,
        { cause: error },
      );
    }

    try {
      await removeCommittedSources(plan, resolved.resolve, fileSystem);
      for (const target of uniqueRefs([
        ...(plan.video ? [plan.video.target] : []),
        ...plan.artifacts.map(({ target }) => target),
      ])) {
        await options.repairIssues?.resolve(plan.operationId, target.rootId, target.relativePath);
      }
    } catch (error) {
      const target = plan.video?.target ?? plan.artifacts[0]?.target ?? plan.obsolete[0];
      if (target && options.repairIssues) {
        await options.repairIssues.record({
          operationId: plan.operationId,
          operationType: plan.operationType,
          rootId: target.rootId,
          relativePath: target.relativePath,
          errorMessage: toErrorMessage(error),
        });
      }
      throw new PublicationError(
        `Publication committed but cleanup failed: ${toErrorMessage(error)}`,
        plan.operationId,
        true,
        { cause: error },
      );
    }

    return result;
  } catch (error) {
    if (!(error instanceof PublicationError)) await manifest.cleanBeforeCommit();
    throw error;
  } finally {
    release();
  }
};
