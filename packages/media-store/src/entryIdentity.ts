import { realpath as realpathCallback } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { MediaRoot } from "./mediaRoot";
import { normalizeRootRelativePath, resolveRootRelativePath } from "./rootRelativePath";

const realpathJs = promisify(realpathCallback);

export const canonicalPath = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "UNKNOWN") throw error;
    // WinFsp mounts can reject native final-path queries; resolve links through the JS implementation.
    return await realpathJs(target);
  }
};

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
  return path.join(await canonicalPath(path.dirname(absolute)), path.basename(absolute));
};
