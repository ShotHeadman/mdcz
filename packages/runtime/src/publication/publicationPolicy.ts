import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "@mdcz/media-store";

export interface CloudMountInfo {
  mountPoint: string;
  fsType: string;
}

export interface PublicationPolicyHooks {
  /** Local directory for staging folders when publishing to a direct-write destination. */
  stagingRoot?: () => string | undefined;
  /** Whether a target path is configured for direct write (for example, by its owning library). */
  isDirectWrite?: (targetPath: string) => Promise<boolean> | boolean;
  /** Root directory to remember when a fresh-file rename hits EIO (defaults to the target's directory). */
  resolveRoot?: (targetPath: string) => Promise<string | undefined> | string | undefined;
}

interface MountEntry {
  mountPoint: string;
  fsType: string;
  mountSource: string;
}

const CLOUD_FS_TYPES = new Set([
  "fuse.clouddrive",
  "fuse.clouddrive2",
  "fuse.rclone",
  "fuse.alist",
  "fuse.openlist",
  "davfs",
  "fuse.davfs",
  "fuse.webdav",
]);

const MOUNT_CACHE_TTL_MS = 5_000;
let mountCache: { expiresAt: number; entries: MountEntry[] } | undefined;
let hooks: PublicationPolicyHooks | undefined;
const learnedDirectRoots = new Set<string>();

const unescapeMountField = (value: string): string =>
  value.replace(/\\([0-7]{3})/gu, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)));

export const parseLinuxMountInfo = (content: string): MountEntry[] => {
  const entries: MountEntry[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(" - ");
    if (separator === -1) continue;
    const left = line.slice(0, separator).split(" ");
    const right = line.slice(separator + 3).split(" ");
    const mountPoint = left[4];
    const fsType = right[0];
    const mountSource = right[1] ?? "";
    if (!mountPoint || !fsType) continue;
    entries.push({ mountPoint: unescapeMountField(mountPoint), fsType, mountSource });
  }
  return entries;
};

const isCloudMountEntry = (entry: MountEntry): boolean =>
  CLOUD_FS_TYPES.has(entry.fsType) ||
  (entry.fsType === "fuse" && /^(clouddrive|rclone|alist|openlist|davfs)/iu.test(entry.mountSource));

export const matchCloudMount = (targetPath: string, entries: readonly MountEntry[]): CloudMountInfo | undefined => {
  const normalized = path.posix.resolve(targetPath);
  let best: MountEntry | undefined;
  for (const entry of entries) {
    const mount = path.posix.resolve(entry.mountPoint);
    if (normalized !== mount && !normalized.startsWith(mount === "/" ? "/" : `${mount}/`)) continue;
    if (!best || mount.length > path.posix.resolve(best.mountPoint).length) best = entry;
  }
  return best && isCloudMountEntry(best) ? { mountPoint: best.mountPoint, fsType: best.fsType } : undefined;
};

const resolveNearestRealPath = async (targetPath: string): Promise<string> => {
  const resolved = path.resolve(targetPath);
  const tail: string[] = [];
  for (let current = resolved; ; ) {
    try {
      const real = await realpath(current);
      return tail.length ? path.join(real, ...tail.toReversed()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return resolved;
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      tail.push(path.basename(current));
      current = parent;
    }
  }
};

const readLinuxMounts = async (): Promise<MountEntry[]> => {
  const now = Date.now();
  if (mountCache && now < mountCache.expiresAt) return mountCache.entries;
  try {
    const entries = parseLinuxMountInfo(await readFile("/proc/self/mountinfo", "utf8"));
    mountCache = { expiresAt: now + MOUNT_CACHE_TTL_MS, entries };
    return entries;
  } catch {
    return [];
  }
};

export const clearCloudMountCache = (): void => {
  mountCache = undefined;
};

export const detectCloudMount = async (targetPath: string): Promise<CloudMountInfo | undefined> => {
  if (process.platform !== "linux" || !targetPath.trim()) return undefined;
  const entries = await readLinuxMounts();
  if (!entries.length) return undefined;
  return matchCloudMount(await resolveNearestRealPath(targetPath), entries);
};

/**
 * Process-wide publication policy (like `publicationJournal`): decides whether a destination must stage locally and
 * write directly without renaming freshly created files, combining Linux cloud-mount detection, per-library settings,
 * and runtime EIO fallback learning.
 */
export const publicationPolicy = {
  configure(next: PublicationPolicyHooks): void {
    hooks = next;
    learnedDirectRoots.clear();
  },
  reset(expected?: PublicationPolicyHooks): void {
    if (expected && hooks !== expected) return;
    hooks = undefined;
    learnedDirectRoots.clear();
    mountCache = undefined;
  },
  async isDirectWrite(targetPath: string): Promise<boolean> {
    if (!targetPath.trim()) return false;
    const resolved = path.resolve(targetPath);
    for (const root of learnedDirectRoots) {
      if (isPathInside(root, resolved)) return true;
    }
    if (await hooks?.isDirectWrite?.(resolved)) return true;
    return (await detectCloudMount(resolved)) !== undefined;
  },
  async stagingParent(outputDir: string): Promise<string> {
    if (!(await publicationPolicy.isDirectWrite(outputDir))) return outputDir;
    const stagingRoot = hooks?.stagingRoot?.()?.trim();
    return stagingRoot || outputDir;
  },
  async markDirectWrite(targetPath: string): Promise<string> {
    const resolved = path.resolve(targetPath);
    const root = path.resolve((await hooks?.resolveRoot?.(resolved)) || path.dirname(resolved));
    learnedDirectRoots.add(root);
    return root;
  },
};
