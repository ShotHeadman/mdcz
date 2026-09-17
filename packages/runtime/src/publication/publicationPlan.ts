import { type MediaRoot, resolveRootFile } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { PublicationOperation, PublicationPlan } from "./types";

export const toRootFileRef = (
  absolutePath: string,
  roots: readonly Pick<MediaRoot, "id" | "hostPath">[],
): RootFileRef => {
  const resolved = resolveRootFile(roots, absolutePath);
  return { rootId: resolved.root.id, relativePath: resolved.relativePath };
};

export const publicationOperations = (plan: PublicationPlan): PublicationOperation[] => [
  ...plan.operations,
  ...plan.files.flatMap((file) => file.operations),
];
