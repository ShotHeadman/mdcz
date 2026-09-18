import { dirname, extname, join, parse } from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";
import type { DirectoryInventory } from "./DirectoryInventory";
import { isGeneratedSidecarVideo } from "./media/generatedSidecarVideos";
import { DEFAULT_VIDEO_EXTENSIONS } from "./utils/filesystem";

export interface ScrapeTarget {
  itemId: string;
  sourcePath: string;
  outputPlan: { targetVideoPath: string };
}

export interface ScrapeTargetConflict {
  itemId: string;
  sourcePath: string;
  targetPath: string;
  message: string;
}

export class ScrapeTargetConflictError extends Error {
  constructor(readonly conflicts: readonly ScrapeTargetConflict[]) {
    super(
      conflicts
        .map((conflict) => `${conflict.message}\n待处理：${conflict.sourcePath}\n目标路径：${conflict.targetPath}`)
        .join("\n\n"),
    );
    this.name = "ScrapeTargetConflictError";
  }
}

export async function checkScrapeTargets(
  targets: readonly ScrapeTarget[],
  inventory: DirectoryInventory,
): Promise<void> {
  const conflicts = new Map<string, ScrapeTargetConflict>();
  const sources = new Map<string, string>();
  const planned = new Map<string, ScrapeTarget[]>();
  const directories = new Set<string>();
  for (const item of targets) {
    sources.set(item.itemId, filesystemPathKey(await inventory.entryPath(item.sourcePath)));
    const target = await inventory.entryPath(item.outputPlan.targetVideoPath);
    const key = join(dirname(target), parse(target).name.toLowerCase());
    const siblings = planned.get(key) ?? [];
    siblings.push(item);
    planned.set(key, siblings);
    directories.add(dirname(target));
  }
  for (const siblings of planned.values()) {
    if (new Set(siblings.map((item) => sources.get(item.itemId))).size < 2) continue;
    for (const item of siblings)
      conflicts.set(item.itemId, {
        itemId: item.itemId,
        sourcePath: item.sourcePath,
        targetPath: item.outputPlan.targetVideoPath,
        message: "批次内多部影片目标文件名重复",
      });
  }
  for (const directory of directories) {
    for (const entry of await inventory.entries(directory)) {
      if (
        (!entry.isFile() && !entry.isSymbolicLink()) ||
        !DEFAULT_VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()) ||
        isGeneratedSidecarVideo(entry.name)
      )
        continue;
      const targetPath = join(directory, entry.name);
      const matches = planned.get(join(directory, parse(entry.name).name.toLowerCase()));
      if (!matches) continue;
      if (entry.isSymbolicLink() && !(await inventory.stats(targetPath)).isFile()) continue;
      for (const item of matches) {
        if (sources.get(item.itemId) === filesystemPathKey(targetPath)) continue;
        conflicts.set(item.itemId, {
          itemId: item.itemId,
          sourcePath: item.sourcePath,
          targetPath,
          message: "目标目录已存在同名影片",
        });
      }
    }
  }
  if (conflicts.size) throw new ScrapeTargetConflictError([...conflicts.values()]);
}
