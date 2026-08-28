import { createHash } from "node:crypto";
import path from "node:path";
import { createMediaRoot, type MediaRoot, normalizeHostPath } from "@mdcz/media-store";

export const deterministicMediaRootId = (hostPath: string): string => {
  const normalized = normalizeHostPath(hostPath);
  const identity = process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
  return `path-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
};

export const createDesktopInputRoot = (hostPath: string, now = new Date()): MediaRoot => {
  const normalized = normalizeHostPath(hostPath);
  return createMediaRoot({
    id: deterministicMediaRootId(normalized),
    displayName: path.basename(normalized) || normalized,
    hostPath: normalized,
    enabled: true,
    now,
  });
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

export const resolveDesktopInputRootPath = (filePaths: readonly string[], preferredRootPath?: string): string => {
  if (filePaths.length === 0) throw new Error("Cannot create a scrape root without files");
  const preferred = preferredRootPath?.trim();
  if (preferred) {
    const normalized = normalizeHostPath(preferred);
    if (filePaths.every((filePath) => isWithin(normalized, filePath))) return normalized;
  }
  let common = path.dirname(path.resolve(filePaths[0]));
  for (const filePath of filePaths.slice(1)) {
    const resolved = path.resolve(filePath);
    while (!isWithin(common, resolved)) {
      const parent = path.dirname(common);
      if (parent === common) throw new Error("Selected files do not share a filesystem root");
      common = parent;
    }
  }
  return common;
};
