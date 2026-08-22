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
