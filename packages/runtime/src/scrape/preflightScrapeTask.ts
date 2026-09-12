import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { dirname, extname, parse, resolve } from "node:path";
import type { OrganizePlan } from "./FileOrganizer";
import { isGeneratedSidecarVideo } from "./media/generatedSidecarVideos";
import { DEFAULT_VIDEO_EXTENSIONS } from "./utils/filesystem";

export interface PreparedScrapeTarget {
  libraryItemId?: string;
  itemId: string;
  sourcePath: string;
  outputPlan: Pick<OrganizePlan, "targetVideoPath">;
  mediaIdentity?: string;
  partNumber?: number | null;
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

const pathKey = (value: string): string => resolve(value).toLocaleLowerCase();
const targetKey = (value: string): string => `${pathKey(dirname(value))}\0${parse(value).name.toLocaleLowerCase()}`;
export const scrapeMovieGroupKey = (
  item: Pick<PreparedScrapeTarget, "libraryItemId" | "sourcePath" | "mediaIdentity">,
): string =>
  item.libraryItemId ?? `${pathKey(dirname(item.sourcePath))}\0${item.mediaIdentity?.trim().toLocaleUpperCase() ?? ""}`;

const resolvedRealPath = async (filePath: string): Promise<string> =>
  await realpath(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return resolve(filePath);
    throw error;
  });

export const validatePreparedScrapeFiles = async (prepared: readonly PreparedScrapeTarget[]): Promise<void> => {
  const conflicts: ScrapeTargetConflict[] = [];
  const candidates = new Map<string, PreparedScrapeTarget[]>();
  for (const item of prepared) {
    if (!item.mediaIdentity?.trim()) continue;
    const group = candidates.get(scrapeMovieGroupKey(item)) ?? [];
    group.push(item);
    candidates.set(scrapeMovieGroupKey(item), group);
  }
  for (const group of candidates.values()) {
    if (group.every((item) => item.libraryItemId)) continue;
    if (group.length < 2) continue;
    const parts = group.filter((item) => item.partNumber !== null && item.partNumber !== undefined);
    const duplicatePart = new Set<number>();
    const seenParts = new Set<number>();
    for (const item of parts) {
      const partNumber = item.partNumber as number;
      if (seenParts.has(partNumber)) duplicatePart.add(partNumber);
      seenParts.add(partNumber);
    }
    const message =
      parts.length > 0 && parts.length < group.length
        ? "同一影片同时包含分盘文件和独立文件，需要手动核对"
        : duplicatePart.size > 0
          ? `同一影片存在重复分盘号：${[...duplicatePart].sort((left, right) => left - right).join("、")}`
          : null;
    if (!message) continue;
    for (const item of group) {
      conflicts.push({
        itemId: item.itemId,
        sourcePath: item.sourcePath,
        targetPath: item.outputPlan.targetVideoPath,
        message,
      });
    }
  }
  const plannedByTarget = new Map<string, PreparedScrapeTarget[]>();
  for (const item of prepared) {
    const key = targetKey(item.outputPlan.targetVideoPath);
    const siblings = plannedByTarget.get(key) ?? [];
    for (const sibling of siblings) {
      if ((await resolvedRealPath(sibling.sourcePath)) === (await resolvedRealPath(item.sourcePath))) continue;
      conflicts.push({
        itemId: sibling.itemId,
        sourcePath: sibling.sourcePath,
        targetPath: item.outputPlan.targetVideoPath,
        message: "批次内多部影片目标文件名重复",
      });
      conflicts.push({
        itemId: item.itemId,
        sourcePath: item.sourcePath,
        targetPath: sibling.outputPlan.targetVideoPath,
        message: "批次内多部影片目标文件名重复",
      });
    }
    siblings.push(item);
    plannedByTarget.set(key, siblings);
  }

  const byDirectory = new Map<string, PreparedScrapeTarget[]>();
  for (const item of prepared) {
    const directory = resolve(dirname(item.outputPlan.targetVideoPath));
    const items = byDirectory.get(pathKey(directory)) ?? [];
    items.push(item);
    byDirectory.set(pathKey(directory), items);
  }

  for (const items of byDirectory.values()) {
    const first = items[0];
    if (!first) continue;
    const directory = resolve(dirname(first.outputPlan.targetVideoPath));
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { encoding: "utf8", withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      for (const item of items) {
        conflicts.push({
          itemId: item.itemId,
          sourcePath: item.sourcePath,
          targetPath: directory,
          message: `无法检查目标目录：${error instanceof Error ? error.message : String(error)}`,
        });
      }
      continue;
    }

    for (const entry of entries) {
      const targetPath = resolve(directory, entry.name);
      let kind = entry;
      try {
        if (entry.isSymbolicLink()) kind = (await stat(targetPath)) as unknown as Dirent;
      } catch (error) {
        for (const item of items) {
          conflicts.push({
            itemId: item.itemId,
            sourcePath: item.sourcePath,
            targetPath,
            message: `无法检查目标文件：${error instanceof Error ? error.message : String(error)}`,
          });
        }
        continue;
      }
      if (!kind.isFile() || !DEFAULT_VIDEO_EXTENSIONS.has(extname(targetPath).toLowerCase())) continue;
      if (isGeneratedSidecarVideo(targetPath)) continue;
      const matches = plannedByTarget.get(targetKey(targetPath));
      if (!matches) continue;
      const existingRealPath = await resolvedRealPath(targetPath);
      for (const item of matches) {
        if ((await resolvedRealPath(item.sourcePath)) === existingRealPath) continue;
        conflicts.push({
          itemId: item.itemId,
          sourcePath: item.sourcePath,
          targetPath,
          message: "目标目录已存在同名影片",
        });
      }
    }
  }

  if (!conflicts.length) return;
  const unique = new Map(
    conflicts.map((conflict) => [`${conflict.itemId}\0${pathKey(conflict.targetPath)}`, conflict]),
  );
  throw new ScrapeTargetConflictError([...unique.values()]);
};
