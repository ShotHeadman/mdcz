import { stat } from "node:fs/promises";
import { toErrorMessage } from "@main/utils/common";
import { listVideoFiles } from "@main/utils/file";
import { isGeneratedSidecarVideo } from "@mdcz/runtime/scrape";
import { ScraperServiceError } from "./ScraperServiceError";

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
