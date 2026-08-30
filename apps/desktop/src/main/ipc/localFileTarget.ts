import type { ServiceContainer } from "@main/container";
import { resolveRootRelativePath } from "@mdcz/media-store";
import type { LocalFileTarget } from "@mdcz/shared/mediaRef";

export const resolveLocalFileTarget = async (
  context: Pick<ServiceContainer, "persistenceService">,
  target: LocalFileTarget,
) => {
  if (typeof target === "string") {
    return { hostPath: target };
  }

  const state = await context.persistenceService.getState();
  const roots = await state.repositories.mediaRoots.list();
  const root = roots.find((candidate) => candidate.id === target.rootId);
  if (!root) {
    throw new Error(`Media root not found: ${target.rootId}`);
  }

  return {
    hostPath: resolveRootRelativePath(root, target.relativePath),
    ref: target,
  };
};
