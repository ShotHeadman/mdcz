import type { LocalScanEntry, PathDiff } from "@shared/types";
import type { OrganizePlan } from "../FileOrganizer";

/**
 * Compare a scan entry's current paths against a pre-computed organize plan.
 */
export function diffPaths(entry: LocalScanEntry, plan: OrganizePlan): PathDiff {
  const currentVideoPath = entry.fileInfo.filePath;
  const targetVideoPath = plan.targetVideoPath;
  const currentDir = entry.currentDir;
  const targetDir = plan.outputDir;

  const changed = currentVideoPath !== targetVideoPath || currentDir !== targetDir;

  return {
    fileId: entry.fileId,
    currentVideoPath,
    targetVideoPath,
    currentDir,
    targetDir,
    changed,
  };
}
