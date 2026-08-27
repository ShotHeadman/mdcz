import path from "node:path";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { normalizeRootRelativePath, type RootFileRef } from "@mdcz/shared/mediaRef";
import type { PublicationFileSystem, PublicationPlan, PublishMediaOptions } from "./types";

export interface ResolvedPublicationPlan {
  roots: Map<string, Awaited<ReturnType<PublishMediaOptions<unknown>["resolveRoot"]>>>;
  resolve(ref: RootFileRef): string;
}

const refKey = (ref: RootFileRef): string => `${ref.rootId}\0${normalizeRootRelativePath(ref.relativePath)}`;

const exists = async (fileSystem: PublicationFileSystem, filePath: string): Promise<boolean> => {
  try {
    await fileSystem.stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

export const preflightPublication = async (
  plan: PublicationPlan,
  options: Pick<PublishMediaOptions<unknown>, "resolveRoot">,
  fileSystem: PublicationFileSystem,
): Promise<ResolvedPublicationPlan> => {
  if (!plan.operationId.trim()) throw new Error("Publication operation ID is required");
  const refs = [
    ...(plan.video ? [plan.video.source, plan.video.target] : []),
    ...plan.artifacts.map(({ target }) => target),
    ...plan.assets.flatMap((asset) => (asset.type === "local" ? [asset.file] : [])),
    ...plan.obsolete,
  ];
  const rootIds = [...new Set(refs.map((ref) => ref.rootId))];
  const roots = new Map(
    await Promise.all(rootIds.map(async (rootId) => [rootId, await options.resolveRoot(rootId)] as const)),
  );
  const resolve = (ref: RootFileRef): string => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Publication root not resolved: ${ref.rootId}`);
    return resolveRootRelativePath(root, normalizeRootRelativePath(ref.relativePath));
  };

  const targets = [...(plan.video ? [plan.video.target] : []), ...plan.artifacts.map(({ target }) => target)];
  const targetKeys = targets.map(refKey);
  if (new Set(targetKeys).size !== targetKeys.length) throw new Error("Publication target collision within plan");

  if (plan.video) {
    if (!Number.isSafeInteger(plan.video.size) || plan.video.size < 0)
      throw new Error("Invalid publication video size");
    const sourcePath = resolve(plan.video.source);
    const targetPath = resolve(plan.video.target);
    const sourceExists = await exists(fileSystem, sourcePath);
    const targetStats = await fileSystem.stat(targetPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (sourceExists) {
      const sourceStats = await fileSystem.stat(sourcePath);
      if (!sourceStats.isFile() || sourceStats.size !== plan.video.size) {
        throw new Error(
          `Publication source size mismatch: ${plan.video.source.rootId}:${plan.video.source.relativePath}`,
        );
      }
    } else if (!targetStats?.isFile() || targetStats.size !== plan.video.size) {
      throw new Error(`Publication source is missing: ${plan.video.source.rootId}:${plan.video.source.relativePath}`);
    }
    const videoTarget = plan.video.target;
    const replacing = plan.replaceExistingTargets?.some((ref) => refKey(ref) === refKey(videoTarget));
    if (sourcePath !== targetPath && targetStats && targetStats.size !== plan.video.size && !replacing) {
      throw new Error(
        `Publication target already exists: ${plan.video.target.rootId}:${plan.video.target.relativePath}`,
      );
    }

    if (sourcePath !== targetPath && !targetStats) {
      const targetRoot = roots.get(plan.video.target.rootId);
      if (!targetRoot) throw new Error(`Publication root not resolved: ${plan.video.target.rootId}`);
      const capacity = await fileSystem.statfs(targetRoot.hostPath);
      if (capacity.bavail * capacity.bsize < plan.video.size) {
        throw new Error(`Insufficient space for publication target: ${path.dirname(targetPath)}`);
      }
    }
  }

  for (const artifact of plan.artifacts) {
    const targetPath = resolve(artifact.target);
    const replacing = plan.replaceExistingTargets?.some((ref) => refKey(ref) === refKey(artifact.target));
    if (!(await exists(fileSystem, targetPath))) continue;
    if (artifact.content.kind === "download") {
      throw new Error(`Publication target already exists: ${artifact.target.rootId}:${artifact.target.relativePath}`);
    }
    const expected = Buffer.from(artifact.content.data);
    const actual = await fileSystem.readFile(targetPath);
    if (!actual.equals(expected) && !replacing) {
      throw new Error(`Publication target already exists: ${artifact.target.rootId}:${artifact.target.relativePath}`);
    }
  }

  return { roots, resolve };
};
