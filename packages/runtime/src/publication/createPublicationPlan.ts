import { type MediaRoot, resolveRootFile } from "@mdcz/media-store";
import type { AssetRef, RootFileRef } from "@mdcz/shared/mediaRef";
import type { PreparedPublicationMove, PreparedPublicationPlan, PublicationMove, PublicationPlan } from "./types";

export const toRootFileRef = (
  absolutePath: string,
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[],
): RootFileRef => {
  const resolved = resolveRootFile(roots, absolutePath);
  return { rootId: resolved.root.id, relativePath: resolved.relativePath };
};

export const createPublicationPlan = (
  operationId: string,
  operationType: PublicationPlan["operationType"],
  prepared: PreparedPublicationPlan,
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[],
): PublicationPlan => {
  const toRef = (absolutePath: string): RootFileRef => toRootFileRef(absolutePath, roots);
  const toMove = (move: PreparedPublicationMove): PublicationMove => ({
    source: toRef(move.sourcePath),
    target: toRef(move.targetPath),
    size: move.size,
    content: move.content,
    preserveSource: move.preserveSource,
    shared: move.shared,
  });
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
    media: prepared.media?.map((media) => ({
      source: toRef(media.sourcePath),
      target: toRef(media.targetPath),
      size: media.size,
      assets: media.assets?.flatMap((asset): AssetRef[] =>
        asset.targetPath
          ? [{ type: "local", kind: asset.kind, file: toRef(asset.targetPath) }]
          : asset.url
            ? [{ type: "remote", kind: asset.kind, url: asset.url }]
            : [],
      ),
    })),
    boundary: prepared.boundary
      ? {
          writeRoots: prepared.boundary.writeRoots.map((location) => ({ ...location })),
          writablePaths: prepared.boundary.writablePaths.map((location) => ({ ...location })),
          readOnlyPaths: prepared.boundary.readOnlyPaths.map((location) => ({ ...location })),
          readOnlyDirectories: prepared.boundary.readOnlyDirectories.map((location) => ({ ...location })),
        }
      : undefined,
    videos: prepared.videos?.map(toMove),
    sidecars: (prepared.sidecars ?? []).map(toMove),
    artifacts: prepared.artifacts.map((artifact) => ({
      target: toRef(artifact.targetPath),
      content:
        artifact.content.kind === "bytes"
          ? { kind: "bytes", data: Buffer.from(artifact.content.data) }
          : { ...artifact.content },
    })),
    assets,
    obsolete: prepared.obsoletePaths.map(toRef),
    editFiles: prepared.editFilePaths?.map(toRef),
    replaceExistingTargets: prepared.replaceExistingTargetPaths?.map(toRef),
  };
};
