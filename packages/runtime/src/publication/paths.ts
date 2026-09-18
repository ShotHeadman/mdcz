import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { isPathInside, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { PublishMediaOptions } from "./types";

export const publicationRefKey = (ref: RootFileRef): string => `${ref.rootId}\0${ref.relativePath}`;

export const publicationPathKey = (value: string): string =>
  process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);

const resolvePublicationDirectory = async (value: string): Promise<string> => {
  const absolute = resolve(value);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const entry = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (entry?.isSymbolicLink()) throw new Error(`Publication path is a dangling link: ${absolute}`);
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(await resolvePublicationDirectory(parent), basename(absolute));
  }
};

export const resolvePublicationPath = async (value: string): Promise<string> => {
  const absolute = resolve(value);
  return resolve(await resolvePublicationDirectory(dirname(absolute)), basename(absolute));
};

export const resolvePublicationReferenceKeys = async (
  refs: readonly RootFileRef[],
  required: readonly RootFileRef[],
  resolveRoot: PublishMediaOptions<unknown>["resolveRoot"],
  additionalRequiredPaths: readonly string[] = [],
): Promise<Map<string, string>> => {
  const paths = await preparePublicationPaths(refs, { resolveRoot }, additionalRequiredPaths, required);
  return new Map(refs.map((ref) => [publicationRefKey(ref), paths.key(ref)]));
};

export const prepareMediaPathKeys = async (
  refs: readonly RootFileRef[],
  resolveRoot: PublishMediaOptions<unknown>["resolveRoot"],
): Promise<string[]> => [...(await resolvePublicationReferenceKeys(refs, refs, resolveRoot)).values()];

export const preparePublicationPaths = async (
  refs: readonly RootFileRef[],
  options: Pick<PublishMediaOptions<unknown>, "resolveRoot" | "outputs">,
  nativePaths: readonly string[] = [],
  requiredRefs: readonly RootFileRef[] = refs,
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
  const unavailable = new Set<string>();
  const requiredRoots = new Set(requiredRefs.map((ref) => ref.rootId));
  const requiredPaths = [
    ...requiredRefs.map((ref) => {
      const root = roots.get(ref.rootId);
      if (!root) throw new Error(`Publication root not found: ${ref.rootId}`);
      return resolveRootRelativePath(root, ref.relativePath);
    }),
    ...nativePaths,
  ];
  await Promise.all(
    [...roots.values()].map(async (root) => {
      try {
        rootPaths.set(root.id, publicationPathKey(await resolvePublicationDirectory(root.hostPath)));
      } catch (error) {
        if (
          requiredRoots.has(root.id) ||
          requiredPaths.some((path) => isPathInside(root.hostPath, path)) ||
          !["ENOENT", "ENODEV", "ENOTCONN", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        unavailable.add(root.id);
      }
    }),
  );
  const prepare = async (references: readonly RootFileRef[]) => {
    for (const ref of references) {
      if (!roots.has(ref.rootId)) roots.set(ref.rootId, await options.resolveRoot(ref.rootId));
      const path = absolute(ref);
      if (physical.has(path)) continue;
      physical.set(
        path,
        unavailable.has(ref.rootId)
          ? `unavailable:${publicationPathKey(path)}`
          : publicationPathKey(await resolvePublicationPath(path)),
      );
    }
  };
  await prepare(refs);
  for (const path of nativePaths) {
    const absolutePath = publicationPathKey(path);
    if (!physical.has(absolutePath))
      physical.set(absolutePath, publicationPathKey(await resolvePublicationPath(absolutePath)));
  }
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
  const pathKey = (path: string): string => {
    const absolutePath = publicationPathKey(path);
    const value = physical.get(absolutePath);
    if (value === undefined) throw new Error(`Publication path identity was not prepared: ${absolutePath}`);
    return value;
  };
  return { absolute, key, pathKey, prepare, queryPaths: [...queryPaths] };
};

export type PublicationPaths = Awaited<ReturnType<typeof preparePublicationPaths>>;
