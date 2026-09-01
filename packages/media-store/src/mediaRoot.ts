import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export interface MediaRoot {
  id: string;
  displayName: string;
  hostPath: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMediaRootInput {
  id?: string;
  displayName: string;
  hostPath: string;
  now?: Date;
}

export const normalizeHostPath = (hostPath: string): string => path.resolve(hostPath);

export const createMediaRoot = (input: CreateMediaRootInput): MediaRoot => {
  const now = input.now ?? new Date();

  return {
    id: input.id ?? randomUUID(),
    displayName: input.displayName.trim(),
    hostPath: normalizeHostPath(input.hostPath),
    createdAt: now,
    updatedAt: now,
  };
};

export const deterministicMediaRootId = (hostPath: string): string => {
  const normalized = normalizeHostPath(hostPath);
  const identity = process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
  return `path-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
};

const isWithin = (rootPath: string, candidatePath: string): boolean => {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const findEnclosingMediaRoot = <T extends Pick<MediaRoot, "hostPath">>(
  hostPath: string,
  roots: readonly T[],
): T | undefined => {
  const normalized = normalizeHostPath(hostPath);
  return [...roots]
    .filter((root) => isWithin(root.hostPath, normalized))
    .sort((left, right) => right.hostPath.length - left.hostPath.length)[0];
};
