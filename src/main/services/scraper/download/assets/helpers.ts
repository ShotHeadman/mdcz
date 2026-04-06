import { readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";

import { toErrorMessage } from "@main/utils/common";
import { pathExists } from "@main/utils/file";
import type { CrawlerData } from "@shared/types";
import { isAbortError } from "../../abort";
import type { ImageAlternatives } from "../../aggregation";
import { normalizeUrl } from "../ImageHostCooldownTracker";
import type { SceneImageSet } from "../SceneImageDownloader";
import type { AssetDecision } from "./types";

type ParallelResult<K extends string, TValue> = { key: K; path: string; success: boolean; value?: TValue };

const SCENE_IMAGE_FILE_PATTERN = /^(?:scene-\d+|fanart\d+)\.(?:jpe?g|png|webp)$/iu;

export const resolveExistingAsset = async (assetPath: string): Promise<string | undefined> => {
  return (await pathExists(assetPath)) ? assetPath : undefined;
};

export const resolveSingleAsset = async ({
  targetPath,
  keepExisting,
  fallbackToExistingOnFailure = true,
  create,
}: {
  targetPath: string;
  keepExisting: boolean;
  fallbackToExistingOnFailure?: boolean;
  create: () => Promise<string | null>;
}): Promise<{ assetPath?: string; createdPath?: string }> => {
  const existingPath = await resolveExistingAsset(targetPath);
  if (keepExisting && existingPath) {
    return { assetPath: existingPath };
  }

  const createdPath = await create();
  if (createdPath) {
    return { assetPath: createdPath, createdPath };
  }

  return fallbackToExistingOnFailure ? { assetPath: existingPath } : {};
};

export const runParallel = async <K extends string, TTask extends { key: K; path: string }, TValue>(
  tasks: TTask[],
  maxConcurrent: number,
  runner: (task: TTask) => Promise<TValue | undefined>,
  options: {
    onItemComplete?: () => void;
    warn?: (message: string) => void;
  } = {},
): Promise<Array<ParallelResult<K, TValue>>> => {
  const results: Array<ParallelResult<K, TValue>> = new Array(tasks.length);
  if (tasks.length === 0) {
    return results;
  }

  let nextIndex = 0;
  const workerCount = Math.min(tasks.length, Math.max(1, maxConcurrent));
  const runWorker = async (): Promise<void> => {
    while (true) {
      const taskIndex = nextIndex++;
      const task = tasks[taskIndex];
      if (!task) {
        return;
      }

      try {
        const value = await runner(task);
        results[taskIndex] = {
          key: task.key,
          path: task.path,
          success: value !== undefined,
          value,
        };
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        options.warn?.(`Parallel task failed for ${task.path}: ${toErrorMessage(error)}`);
        results[taskIndex] = { key: task.key, path: task.path, success: false };
      } finally {
        options.onItemComplete?.();
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
};

export const uniqueFilePaths = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    paths.push(value);
  }

  return paths;
};

export const buildImageCandidates = (primaryUrl?: string, alternatives?: string[]): string[] => {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const url of [primaryUrl, ...(alternatives ?? [])]) {
    const normalized = normalizeUrl(url);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    candidates.push(normalized);
  }

  return candidates;
};

export const shouldKeepAsset = (decision: AssetDecision | undefined, defaultKeep: boolean): boolean => {
  if (decision === "preserve") {
    return true;
  }

  if (decision === "replace") {
    return false;
  }

  return defaultKeep;
};

export const shouldFallbackToExistingAsset = (decision: AssetDecision | undefined): boolean => {
  return decision !== "replace";
};

const isExtrafanartFolder = (folderName: string): boolean => {
  return (
    folderName
      .trim()
      .replace(/[\\/]+$/u, "")
      .toLowerCase() === "extrafanart"
  );
};

export const buildSceneImageFileName = (sceneFolder: string, index: number): string => {
  if (isExtrafanartFolder(sceneFolder)) {
    return `fanart${index + 1}.jpg`;
  }

  return `scene-${String(index + 1).padStart(3, "0")}.jpg`;
};

const getNormalizedSceneImageUrls = (values: string[]): string[] => {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of values) {
    const normalized = normalizeUrl(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
};

export const getSceneImageSets = (
  data: CrawlerData,
  imageAlternatives: Partial<ImageAlternatives>,
  maxSceneImages: number,
): SceneImageSet[] => {
  if (maxSceneImages <= 0) {
    return [];
  }

  const seenSets = new Set<string>();
  const sets: SceneImageSet[] = [];
  const candidates: SceneImageSet[] = [
    {
      urls: data.scene_images,
      source: imageAlternatives.scene_images_source,
    },
    ...(imageAlternatives.scene_images ?? []).map((urls, index) => ({
      urls,
      source: imageAlternatives.scene_image_sources?.[index],
    })),
  ];

  for (const candidate of candidates) {
    const urls = getNormalizedSceneImageUrls(Array.isArray(candidate.urls) ? candidate.urls : []).slice(
      0,
      maxSceneImages,
    );
    if (urls.length === 0) {
      continue;
    }

    const signature = JSON.stringify(urls);
    if (seenSets.has(signature)) {
      continue;
    }

    seenSets.add(signature);
    sets.push({
      urls,
      source: candidate.source,
    });
  }

  return sets;
};

export const listExistingSceneImages = async (sceneDir: string): Promise<string[]> => {
  try {
    const entries = await readdir(sceneDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && SCENE_IMAGE_FILE_PATTERN.test(entry.name))
      .map((entry) => join(sceneDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

export const removeStaleSceneImages = async (
  existingPaths: string[],
  activePaths: string[],
  sceneDir: string,
): Promise<void> => {
  const activeSet = new Set(activePaths);
  const stalePaths = existingPaths.filter((filePath) => !activeSet.has(filePath));

  for (const stalePath of stalePaths) {
    await unlink(stalePath).catch(() => undefined);
  }

  if (stalePaths.length === 0) {
    return;
  }

  try {
    const remaining = await readdir(sceneDir);
    if (remaining.length === 0) {
      await rm(sceneDir, { recursive: true });
    }
  } catch {
    /* directory may not exist */
  }
};
