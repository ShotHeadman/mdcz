import { type MediaRoot, resolveRootFile } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";

export const toRootFileRef = (
  absolutePath: string,
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[],
): RootFileRef => {
  const resolved = resolveRootFile(roots, absolutePath);
  return { rootId: resolved.root.id, relativePath: resolved.relativePath };
};
