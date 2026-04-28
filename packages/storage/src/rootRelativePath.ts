import path from "node:path";

import { StorageError, storageErrorCodes } from "./errors";
import type { MediaRoot } from "./mediaRoot";

export type RootRelativePath = string & { readonly __rootRelativePath: unique symbol };

const toPortableSeparators = (value: string): string => value.replaceAll(path.sep, "/").replaceAll("\\", "/");

export const normalizeRootRelativePath = (input: string): RootRelativePath => {
  const normalized = path.posix.normalize(toPortableSeparators(input).trim());

  if (normalized === "." || normalized === "") {
    return "" as RootRelativePath;
  }
  if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new StorageError(storageErrorCodes.OutsideRoot, `Path escapes media root: ${input}`);
  }

  return normalized.replace(/^\/+/u, "") as RootRelativePath;
};

export const resolveRootRelativePath = (root: Pick<MediaRoot, "hostPath">, relativePath: string): string => {
  const normalizedRelativePath = normalizeRootRelativePath(relativePath);
  const absolutePath = path.resolve(root.hostPath, normalizedRelativePath);
  assertInsideRoot(root, absolutePath);
  return absolutePath;
};

export const assertInsideRoot = (root: Pick<MediaRoot, "hostPath">, candidatePath: string): void => {
  const rootPath = path.resolve(root.hostPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(rootPath, resolvedCandidate);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return;
  }

  throw new StorageError(storageErrorCodes.OutsideRoot, `Path is outside media root: ${candidatePath}`);
};

export const toRootRelativePath = (root: Pick<MediaRoot, "hostPath">, candidatePath: string): RootRelativePath => {
  assertInsideRoot(root, candidatePath);
  const relative = path.relative(path.resolve(root.hostPath), path.resolve(candidatePath));
  return normalizeRootRelativePath(toPortableSeparators(relative));
};
