import type { ServiceContainer } from "@main/container";
import { configManager, configurationSchema } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { ScraperServiceError } from "@main/services/scraper";
import { confirmUncensoredItems } from "@main/services/scraper/confirmUncensored";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import type { ScraperStatus, UncensoredConfirmItem } from "@shared/types";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");

const defaultScraperStatus = (): ScraperStatus => ({
  state: "idle",
  running: false,
  totalFiles: 0,
  completedFiles: 0,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
});

export const createScraperHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Scraper_GetStatus
  | typeof IpcChannel.Scraper_GetFailedFiles
  | typeof IpcChannel.Scraper_HasRecoverableSession
  | typeof IpcChannel.Scraper_RecoverSession
  | typeof IpcChannel.Scraper_Start
  | typeof IpcChannel.Scraper_Stop
  | typeof IpcChannel.Scraper_Pause
  | typeof IpcChannel.Scraper_Resume
  | typeof IpcChannel.Scraper_Requeue
  | typeof IpcChannel.Scraper_RetryFailed
  | typeof IpcChannel.Scraper_ConfirmUncensored
> => {
  const { scraperService } = context;

  return {
    [IpcChannel.Scraper_GetStatus]: t.procedure.action(async () => {
      return scraperService.getStatus() ?? defaultScraperStatus();
    }),
    [IpcChannel.Scraper_GetFailedFiles]: t.procedure.action(async () => {
      try {
        return { filePaths: scraperService.getFailedFiles() };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_HasRecoverableSession]: t.procedure.action(async () => {
      try {
        return { recoverable: await scraperService.hasRecoverableSession() };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_RecoverSession]: t.procedure.action(async () => {
      try {
        return await scraperService.recoverSession();
      } catch (error) {
        if (error instanceof ScraperServiceError) {
          throw createIpcError(error.code, error.message);
        }
        logger.error(`Failed to recover scrape session: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_Start]: t.procedure
      .input<{ mode?: "single" | "batch"; paths?: string[] }>()
      .action(async ({ input }) => {
        try {
          const mode = input?.mode ?? "single";
          const paths = input?.paths ?? [];
          return await scraperService.start(mode, paths);
        } catch (error) {
          if (error instanceof ScraperServiceError) {
            throw createIpcError(error.code, error.message);
          }
          logger.error(`Failed to start scraper: ${toErrorMessage(error)}`);
          throw asSerializableIpcError(error);
        }
      }),
    [IpcChannel.Scraper_Stop]: t.procedure.action(async () => {
      try {
        return {
          success: true as const,
          pendingCount: scraperService.stop().pendingCount,
        };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_Pause]: t.procedure.action(async () => {
      try {
        scraperService.pause();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_Resume]: t.procedure.action(async () => {
      try {
        scraperService.resume();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_Requeue]: t.procedure.input<{ filePaths?: string[] }>().action(async ({ input }) => {
      try {
        return await scraperService.requeue(input?.filePaths ?? []);
      } catch (error) {
        if (error instanceof ScraperServiceError) {
          throw createIpcError(error.code, error.message);
        }
        logger.error(`Failed to requeue files: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_RetryFailed]: t.procedure.input<{ filePaths?: string[] }>().action(async ({ input }) => {
      try {
        return await scraperService.retryFiles(input?.filePaths ?? []);
      } catch (error) {
        if (error instanceof ScraperServiceError) {
          throw createIpcError(error.code, error.message);
        }
        logger.error(`Failed to retry files: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Scraper_ConfirmUncensored]: t.procedure
      .input<{ items?: UncensoredConfirmItem[] }>()
      .action(async ({ input }) => {
        const items = input?.items ?? [];
        if (items.length === 0) {
          return { updatedCount: 0, items: [] };
        }

        const config = configurationSchema.parse(await configManager.get());
        if (!config.download.generateNfo) {
          logger.warn("Rejecting uncensored confirm because NFO generation is disabled");
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "已关闭 NFO 生成功能，无法确认无码类型");
        }
        return await confirmUncensoredItems(items, config);
      }),
  };
};
