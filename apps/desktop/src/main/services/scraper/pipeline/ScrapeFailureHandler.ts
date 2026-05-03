import type { Configuration } from "@main/services/config";
import { configManager } from "@main/services/config";
import { toErrorMessage } from "@main/utils/common";
import { pathExists } from "@main/utils/file";
import type { FileOrganizer, FileScraperStageRuntime, ScrapeContext } from "@mdcz/runtime/scrape";
import { parseFileInfo } from "@mdcz/runtime/scrape/utils/number";
import type { FileInfo, ScrapeResult } from "@mdcz/shared/types";
import type { Logger } from "winston";
import type { FileScrapeProgress, ScrapeExecutionMode } from "../FileScraper";
import { updateScrapeProgress } from "../output";

export class ScrapeFailureHandler {
  constructor(
    private readonly fileOrganizer: FileOrganizer,
    private readonly logger: Pick<Logger, "error" | "info" | "warn">,
    private readonly signalService: FileScraperStageRuntime["signalService"],
  ) {}

  setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    updateScrapeProgress(this.signalService, progress, stepPercent);
  }

  async handleAbort(context: ScrapeContext): Promise<ScrapeResult> {
    this.logger.info(`Scrape aborted for ${context.fileInfo.filePath}`);
    this.setProgress(context.progress, 100);
    const skippedResult: ScrapeResult = {
      fileId: context.fileId,
      fileInfo: context.fileInfo,
      status: "skipped",
      error: "Operation aborted",
    };
    this.signalService.showScrapeResult(skippedResult);
    return skippedResult;
  }

  async handleError(context: ScrapeContext, error: unknown): Promise<ScrapeResult> {
    const message = toErrorMessage(error);
    this.logger.error(`Scrape failed for ${context.fileInfo.filePath}: ${message}`);
    this.setProgress(context.progress, 100);

    try {
      const configuration = await configManager.getValidated();
      context.fileInfo = await this.moveToFailedFolder(context.fileInfo, configuration, context.mode);
    } catch (moveError) {
      const moveMsg = moveError instanceof Error ? moveError.message : String(moveError);
      this.logger.warn(`Failed to move file to failed folder: ${moveMsg}`);
    }

    const failedResult: ScrapeResult = {
      fileId: context.fileId,
      fileInfo: context.fileInfo,
      status: "failed",
      error: message,
    };
    this.signalService.showScrapeResult(failedResult);
    this.signalService.showFailedInfo({ fileInfo: context.fileInfo, error: message });
    return failedResult;
  }

  async moveToFailedFolder(
    fileInfo: FileInfo,
    config: Configuration,
    mode: ScrapeExecutionMode = "batch",
  ): Promise<FileInfo> {
    if (mode === "single" || !config.behavior.failedFileMove) {
      return fileInfo;
    }
    if (!(await pathExists(fileInfo.filePath))) {
      this.logger.warn(`Skip failed-file move because source no longer exists: ${fileInfo.filePath}`);
      return fileInfo;
    }
    try {
      const movedPath = await this.fileOrganizer.moveToFailedFolder(fileInfo, config);
      const movedFileInfo = parseFileInfo(movedPath);
      return {
        ...fileInfo,
        ...movedFileInfo,
        filePath: movedPath,
        isSubtitled: fileInfo.isSubtitled || movedFileInfo.isSubtitled,
        subtitleTag: fileInfo.subtitleTag ?? movedFileInfo.subtitleTag,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to move file to failed folder: ${message}`);
      return fileInfo;
    }
  }
}
