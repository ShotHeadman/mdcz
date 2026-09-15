import { relative } from "node:path";
import { isPathInside, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { publicationPathKey, resolvePublicationPath } from "./boundary";
import type { PublicationBoundary, PublishMediaOptions } from "./types";

export const preparePublicationPaths = async (
  refs: readonly RootFileRef[],
  options: Pick<PublishMediaOptions<unknown>, "resolveRoot" | "outputs">,
  boundary?: PublicationBoundary,
) => {
  const roots = new Map((options.outputs?.publicationRoots() ?? []).map((root) => [root.id, root]));
  for (const id of new Set(refs.map((ref) => ref.rootId)))
    if (!roots.has(id)) roots.set(id, await options.resolveRoot(id));
  const physical = new Map<string, string>();
  const absolute = (ref: RootFileRef): string => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Publication root was not prepared: ${ref.rootId}`);
    return publicationPathKey(resolveRootRelativePath(root, ref.relativePath));
  };
  const rootPaths = new Map<string, string>();
  await Promise.all(
    [...roots.values()].map(async (root) => {
      try {
        const captured = boundary?.writeRoots.find(
          (location) => publicationPathKey(location.path) === publicationPathKey(root.hostPath),
        );
        rootPaths.set(root.id, publicationPathKey(captured?.realPath ?? (await resolvePublicationPath(root.hostPath))));
      } catch (error) {
        if (
          refs.some((ref) => ref.rootId === root.id) ||
          !["ENOENT", "ENODEV", "ENOTCONN", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }),
  );
  const prepare = async (references: readonly RootFileRef[], boundary?: PublicationBoundary) => {
    for (const location of [...(boundary?.writablePaths ?? []), ...(boundary?.readOnlyPaths ?? [])]) {
      const path = publicationPathKey(location.path);
      const value = publicationPathKey(location.realPath);
      if (physical.has(path) && physical.get(path) !== value)
        throw new Error(`Publication path identity changed: ${path}`);
      physical.set(path, value);
      physical.set(value, value);
    }
    for (const ref of references) {
      if (!roots.has(ref.rootId)) roots.set(ref.rootId, await options.resolveRoot(ref.rootId));
      const path = absolute(ref);
      if (physical.has(path)) continue;
      physical.set(path, publicationPathKey(await resolvePublicationPath(path)));
    }
  };
  await prepare(refs, boundary);
  const key = (ref: RootFileRef): string => {
    const path = absolute(ref);
    const value = physical.get(path);
    if (value === undefined) throw new Error(`Publication path identity was not prepared: ${path}`);
    return value;
  };
  const queryPaths = new Set(refs.map(absolute));
  for (const ref of refs) {
    const real = key(ref);
    queryPaths.add(real);
    for (const [id, canonical] of rootPaths) {
      if (!isPathInside(canonical, real)) continue;
      const alias = absolute({ rootId: id, relativePath: relative(canonical, real).replaceAll("\\", "/") });
      physical.set(alias, real);
      queryPaths.add(alias);
    }
  }
  return { absolute, key, prepare, queryPaths: [...queryPaths] };
};

export type PublicationPaths = Awaited<ReturnType<typeof preparePublicationPaths>>;
