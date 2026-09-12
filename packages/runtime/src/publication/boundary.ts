import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isPathInside, resolveRootRelativePath } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type { PublicationBoundary, PublicationFileSystem, PublishMediaOptions } from "./types";

export const publicationRefKey = (ref: RootFileRef): string => `${ref.rootId}\0${ref.relativePath}`;

export const resolvePublicationReferenceKeys = async (
  refs: readonly RootFileRef[],
  required: readonly RootFileRef[],
  resolveRoot: PublishMediaOptions<unknown>["resolveRoot"],
  additionalRequiredPaths: readonly string[] = [],
): Promise<Map<string, string>> => {
  const requiredRoots = new Set(required.map((ref) => ref.rootId));
  const roots = new Map(
    await Promise.all(
      [...new Set(refs.map((ref) => ref.rootId))].map(async (id) => [id, await resolveRoot(id)] as const),
    ),
  );
  const absolutePath = (ref: RootFileRef): string => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Publication root not found: ${ref.rootId}`);
    return resolveRootRelativePath(root, ref.relativePath);
  };
  const requiredPaths = [...required.map(absolutePath), ...additionalRequiredPaths];
  const unavailable = new Set<string>();
  await Promise.all(
    [...roots].map(async ([id, root]) => {
      try {
        await resolvePublicationPath(root.hostPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          requiredRoots.has(id) ||
          requiredPaths.some((path) => isPathInside(root.hostPath, path)) ||
          !["ENOENT", "ENODEV", "ENOTCONN", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(code ?? "")
        )
          throw error;
        // Only an unavailable, unrelated root may be omitted from physical alias checks.
        // Errors below an accessible root (including dangling links) remain fatal.
        unavailable.add(id);
      }
    }),
  );
  const physical = new Map<string, Promise<string>>();
  return new Map(
    await Promise.all(
      refs.map(async (ref) => {
        const absolute = absolutePath(ref);
        const pathKey = publicationPathKey(absolute);
        if (unavailable.has(ref.rootId)) return [publicationRefKey(ref), `unavailable:${pathKey}`] as const;
        let pending = physical.get(pathKey);
        if (!pending) {
          pending = resolvePublicationPath(absolute).then(publicationPathKey);
          physical.set(pathKey, pending);
        }
        return [publicationRefKey(ref), await pending] as const;
      }),
    ),
  );
};

export const publicationPathKey = (value: string): string =>
  process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);

export const resolvePublicationPath = async (value: string): Promise<string> => {
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
    return resolve(await resolvePublicationPath(parent), basename(absolute));
  }
};

export const capturePublicationBoundary = async (input: {
  writeRoots: string[];
  writablePaths: string[];
  readOnlyPaths: string[];
  readOnlyDirectories: string[];
}): Promise<PublicationBoundary> => {
  const locations = async (paths: string[]) =>
    await Promise.all(
      [...new Set(paths.map((resolvePath) => resolve(resolvePath)))].map(async (path) => ({
        path,
        realPath: await resolvePublicationPath(path),
      })),
    );
  const boundary = {
    writeRoots: await locations(input.writeRoots),
    writablePaths: await locations(input.writablePaths),
    readOnlyPaths: await locations(input.readOnlyPaths),
    readOnlyDirectories: await locations(input.readOnlyDirectories),
  };
  await assertPublicationBoundary(boundary);
  return boundary;
};

export const assertPublicationBoundary = async (boundary: PublicationBoundary): Promise<void> => {
  for (const location of [
    ...boundary.writeRoots,
    ...boundary.writablePaths,
    ...boundary.readOnlyPaths,
    ...boundary.readOnlyDirectories,
  ]) {
    if (publicationPathKey(await resolvePublicationPath(location.path)) !== publicationPathKey(location.realPath)) {
      throw new Error(`Publication filesystem link changed: ${location.path}`);
    }
  }
  for (const target of boundary.writablePaths) {
    if (
      !boundary.writeRoots.some(
        (root) => isPathInside(root.path, target.path) && isPathInside(root.realPath, target.realPath),
      )
    ) {
      throw new Error(`Publication target escapes its output root: ${target.path}`);
    }
    if (
      boundary.readOnlyPaths.some(
        (source) => publicationPathKey(source.realPath) === publicationPathKey(target.realPath),
      ) ||
      boundary.readOnlyDirectories.some((source) => isPathInside(source.realPath, target.realPath))
    ) {
      throw new Error(`Publication cannot modify a protected source: ${target.path}`);
    }
  }
};

export const guardPublicationFileSystem = (
  fileSystem: PublicationFileSystem,
  boundary: PublicationBoundary | undefined,
): PublicationFileSystem => {
  if (!boundary) return fileSystem;
  const assertWrite = async (path: string, directory = false): Promise<void> => {
    const absolute = resolve(path);
    const declared = boundary.writablePaths.find((target) =>
      directory
        ? isPathInside(absolute, target.path)
        : publicationPathKey(target.path) === publicationPathKey(absolute) ||
          (absolute.startsWith(`${target.path}.`) &&
            /^\.[a-f0-9]{16}\.(?:part|bak)$/u.test(absolute.slice(target.path.length))),
    );
    if (!declared) throw new Error(`Publication mutation was not declared: ${path}`);
    if (!directory && /\.[a-f0-9]{16}\.part$/u.test(absolute)) {
      const existing = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (existing && (existing.isSymbolicLink() || existing.nlink > 1))
        throw new Error(`Publication temporary file is linked: ${path}`);
    }
    await assertPublicationBoundary(boundary);
    const expected = directory
      ? await resolvePublicationPath(absolute)
      : `${declared.realPath}${absolute.slice(declared.path.length)}`;
    if (publicationPathKey(await resolvePublicationPath(absolute)) !== publicationPathKey(expected))
      throw new Error(`Publication temporary path escapes its boundary: ${path}`);
    if (
      boundary.readOnlyPaths.some((source) => publicationPathKey(source.realPath) === publicationPathKey(expected)) ||
      boundary.readOnlyDirectories.some((source) => isPathInside(source.realPath, expected))
    )
      throw new Error(`Publication cannot modify a protected source: ${path}`);
  };
  return {
    ...fileSystem,
    mkdir: async (path, options) => {
      await assertWrite(path, true);
      return await fileSystem.mkdir(path, options);
    },
    copyFile: async (source, target) => {
      await assertWrite(target);
      await fileSystem.copyFile(source, target);
    },
    writeFile: async (path, data, options) => {
      await assertWrite(path);
      await fileSystem.writeFile(path, data, options);
    },
    rename: async (source, target) => {
      await assertWrite(source);
      await assertWrite(target);
      await fileSystem.rename(source, target);
    },
    rm: async (path, options) => {
      await assertWrite(path);
      await fileSystem.rm(path, options);
    },
    flush: fileSystem.flush
      ? async (path) => {
          await assertWrite(path);
          await fileSystem.flush?.(path);
        }
      : undefined,
  };
};
