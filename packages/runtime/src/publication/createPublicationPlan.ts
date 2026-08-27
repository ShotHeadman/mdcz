import type { MediaRoot } from "@mdcz/media-store";
import { toRootRelativePath } from "@mdcz/media-store";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";
import type { PreparedPublicationPlan, PublicationPlan } from "./types";

export const toRootFileRef = (
  absolutePath: string,
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[],
): RootFileRef => {
  const candidates = roots.flatMap((root) => {
    try {
      return [{ root, relativePath: toRootRelativePath(root, absolutePath) }];
    } catch {
      return [];
    }
  });
  candidates.sort((left, right) => right.root.hostPath.length - left.root.hostPath.length);
  const candidate = candidates[0];
  if (!candidate) throw new Error(`Publication path is outside registered roots: ${absolutePath}`);
  return { rootId: candidate.root.id, relativePath: candidate.relativePath };
};

export const createPublicationPlan = (
  operationId: string,
  operationType: PublicationPlan["operationType"],
  prepared: PreparedPublicationPlan,
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[],
): PublicationPlan => {
  const toRef = (absolutePath: string): RootFileRef => toRootFileRef(absolutePath, roots);
  const assets: AssetRef[] = prepared.assets.flatMap((asset): AssetRef[] =>
    asset.targetPath
      ? [{ type: "local", kind: asset.kind, file: toRef(asset.targetPath) }]
      : asset.url
        ? [{ type: "remote", kind: asset.kind, url: asset.url }]
        : [],
  );
  return {
    operationId,
    operationType,
    video: prepared.video
      ? {
          source: toRef(prepared.video.sourcePath),
          target: toRef(prepared.video.targetPath),
          size: prepared.video.size,
        }
      : undefined,
    artifacts: prepared.artifacts.map((artifact) => ({
      target: toRef(artifact.targetPath),
      content: artifact.content,
    })),
    assets,
    obsolete: prepared.obsoletePaths.map(toRef),
  };
};
