import { lstat, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { MediaRoot } from "./mediaRoot";
import { normalizeRootRelativePath, resolveRootRelativePath } from "./rootRelativePath";

export const canonicalizeRootFileRefs = <T extends { rootId: string; relativePath: string }>(
  roots: readonly MediaRoot[],
  refs: readonly T[],
): T[] => {
  const rootsById = new Map(roots.map((root) => [root.id, root]));
  return refs.map((ref) => {
    const root = rootsById.get(ref.rootId);
    if (!root) throw new Error(`Media root not found: ${ref.rootId}`);
    const relativePath = normalizeRootRelativePath(ref.relativePath);
    if (!relativePath) throw new Error("Media file path must not be empty");
    resolveRootRelativePath(root, relativePath);
    return { ...ref, relativePath };
  });
};

export const filesystemPathKey = (value: string): string =>
  process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);

export const resolveEntryPath = async (value: string): Promise<string> => {
  const absolute = path.resolve(value);
  return path.join(await realpath(path.dirname(absolute)), path.basename(absolute));
};

export const inspectFileEntry = async (value: string) => {
  const entryPath = await resolveEntryPath(value);
  const entry = await lstat(entryPath);
  const linkTarget = entry.isSymbolicLink() ? await readlink(entryPath) : null;
  const referent = linkTarget === null ? entry : await stat(entryPath);
  if (!referent.isFile()) throw new Error(`Media entry is not a file: ${value}`);
  return {
    stats: referent,
    entryPath,
    entryIdentity: filesystemPathKey(entryPath),
    traversalIdentity: filesystemPathKey(path.dirname(entryPath)),
    linkTarget,
    entryFacts: { size: entry.size, mtimeMs: entry.mtimeMs, dev: entry.dev, ino: entry.ino },
    referentFacts: {
      path: linkTarget === null ? entryPath : await realpath(entryPath),
      size: referent.size,
      mtimeMs: referent.mtimeMs,
      dev: referent.dev,
      ino: referent.ino,
    },
  };
};
