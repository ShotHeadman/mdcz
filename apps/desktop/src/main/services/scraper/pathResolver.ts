import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { toErrorMessage } from "@main/utils/common";
import { DEFAULT_VIDEO_EXTENSIONS, listVideoFiles } from "@main/utils/file";
import { isGeneratedSidecarVideo } from "@mdcz/runtime/scrape";
import { ScraperServiceError } from "./ScraperServiceError";

export const uniquePaths = (paths: string[]): string[] => {
  const outputs: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    outputs.push(trimmed);
  }
  return outputs;
};

export const resolveSingleFilePaths = async (paths: string[]): Promise<string[]> => {
  const filePath = paths[0]?.trim();
  if (!filePath) {
    return [];
  }

  try {
    const targetStats = await stat(filePath);
    if (!targetStats.isDirectory()) {
      return [filePath];
    }
  } catch {
    throw new ScraperServiceError("FILE_NOT_FOUND", `Selected media file not found: ${filePath}`);
  }

  let candidatePaths: string[];
  try {
    candidatePaths = (await listVideoFiles(filePath, false)).filter(
      (candidatePath) => !isGeneratedSidecarVideo(candidatePath),
    );
  } catch (error) {
    throw new ScraperServiceError("DIR_NOT_FOUND", toErrorMessage(error));
  }

  if (candidatePaths.length === 0) {
    return [];
  }

  if (candidatePaths.length > 1) {
    throw new ScraperServiceError("MULTIPLE_FILES", "Directory contains multiple media files; choose a file path");
  }

  return candidatePaths;
};

export const resolveSelectedFilePaths = async (paths: string[]): Promise<string[]> => {
  const outputs: string[] = [];

  for (const filePath of uniquePaths(paths)) {
    let targetStats: Awaited<ReturnType<typeof stat>>;
    try {
      targetStats = await stat(filePath);
    } catch {
      throw new ScraperServiceError("FILE_NOT_FOUND", `Selected media file not found: ${filePath}`);
    }

    if (!targetStats.isFile()) {
      throw new ScraperServiceError("FILE_NOT_FOUND", `Selected media file not found: ${filePath}`);
    }

    if (!DEFAULT_VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase()) || isGeneratedSidecarVideo(filePath)) {
      continue;
    }

    outputs.push(filePath);
  }

  return outputs;
};
