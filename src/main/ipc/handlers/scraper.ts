import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { ScraperServiceError } from "@main/services/scraper";
import { confirmUncensoredItems } from "@main/services/scraper/confirmUncensored";
import type { ManualScrapeOptions } from "@main/services/scraper/manualScrape";
import type { StartScrapeResult } from "@main/services/scraper/ScraperService";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { validateManualScrapeUrl } from "@shared/manualScrapeUrl";
import type { ScraperStatus, UncensoredConfirmItem } from "@shared/types";
import { withIpcErrorHandling } from "../errorHandling";
import { createIpcError, IpcErrorCode } from "../errors";
import { t } from "../shared";

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

const withLaunchMessage = (result: StartScrapeResult, message: string) => ({ ...result, message });
const withSuccessMessage = (message: string) => ({ success: true as const, message });
const resolveManualScrapeOptions = (manualUrl?: string): ManualScrapeOptions | undefined => {
  const value = manualUrl?.trim();
  if (!value) {
    return undefined;
  }

  const validation = validateManualScrapeUrl(value);
  if (!validation.valid) {
    throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, validation.message);
  }

  return {
    site: validation.route.site,
    detailUrl: validation.route.detailUrl,
  };
};
const toScraperServiceIpcError = (error: unknown) => {
  if (error instanceof ScraperServiceError) {
    return createIpcError(error.code, error.message);
  }

  return undefined;
};

export const createScraperHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Scraper_GetStatus
  | typeof IpcChannel.Scraper_GetFailedFiles
  | typeof IpcChannel.Scraper_GetRecoverableSession
  | typeof IpcChannel.Scraper_ResolveRecoverableSession
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
    [IpcChannel.Scraper_GetFailedFiles]: t.procedure.action(() =>
      withIpcErrorHandling("get failed files", async () => {
        return { filePaths: scraperService.getFailedFiles() };
      }),
    ),
    [IpcChannel.Scraper_GetRecoverableSession]: t.procedure.action(() =>
      withIpcErrorHandling("get recoverable scrape session", async () => {
        return await scraperService.getRecoverableSession();
      }),
    ),
    [IpcChannel.Scraper_ResolveRecoverableSession]: t.procedure
      .input<{ action?: "recover" | "discard" }>()
      .action(({ input }) =>
        withIpcErrorHandling(
          "resolve recoverable scrape session",
          async () => {
            const action = input?.action ?? "recover";

            if (action === "discard") {
              await scraperService.discardRecoverableSession();
              return withSuccessMessage("已放弃上次未完成的刮削任务");
            }

            return {
              success: true as const,
              ...withLaunchMessage(await scraperService.recoverSession(), "恢复任务已启动"),
            };
          },
          { mapError: toScraperServiceIpcError },
        ),
      ),
    [IpcChannel.Scraper_Start]: t.procedure
      .input<{ mode?: "single" | "selection"; paths?: string[] }>()
      .action(({ input }) =>
        withIpcErrorHandling(
          "start scraper",
          async () => {
            const mode = input?.mode ?? "single";
            const paths = input?.paths ?? [];
            if (mode === "selection") {
              return withLaunchMessage(await scraperService.startSelectedFiles(paths), "已启动选中文件刮削");
            }

            return withLaunchMessage(await scraperService.startSingle(paths), "单文件刮削任务已启动");
          },
          { mapError: toScraperServiceIpcError },
        ),
      ),
    [IpcChannel.Scraper_Stop]: t.procedure.action(() =>
      withIpcErrorHandling("stop scraper", async () => {
        return {
          success: true as const,
          pendingCount: scraperService.stop().pendingCount,
        };
      }),
    ),
    [IpcChannel.Scraper_Pause]: t.procedure.action(() =>
      withIpcErrorHandling("pause scraper", async () => {
        scraperService.pause();
        return { success: true as const };
      }),
    ),
    [IpcChannel.Scraper_Resume]: t.procedure.action(() =>
      withIpcErrorHandling("resume scraper", async () => {
        scraperService.resume();
        return { success: true as const };
      }),
    ),
    [IpcChannel.Scraper_Requeue]: t.procedure
      .input<{ filePaths?: string[]; manualUrl?: string }>()
      .action(({ input }) =>
        withIpcErrorHandling(
          "requeue files",
          async () => {
            return await scraperService.requeue(input?.filePaths ?? [], resolveManualScrapeOptions(input?.manualUrl));
          },
          { mapError: toScraperServiceIpcError },
        ),
      ),
    [IpcChannel.Scraper_RetryFailed]: t.procedure
      .input<{ filePaths?: string[]; manualUrl?: string }>()
      .action(({ input }) =>
        withIpcErrorHandling(
          "retry files",
          async () => {
            const result = await scraperService.retryFiles(
              input?.filePaths ?? [],
              resolveManualScrapeOptions(input?.manualUrl),
            );
            return withLaunchMessage(result, `重试任务已启动，共 ${result.totalFiles} 个文件`);
          },
          { mapError: toScraperServiceIpcError },
        ),
      ),
    [IpcChannel.Scraper_ConfirmUncensored]: t.procedure
      .input<{ items?: UncensoredConfirmItem[] }>()
      .action(({ input }) =>
        withIpcErrorHandling("confirm uncensored items", async () => {
          const items = input?.items ?? [];
          if (items.length === 0) {
            return { updatedCount: 0, items: [] };
          }

          const config = await configManager.getValidated();
          if (!config.download.generateNfo) {
            logger.warn("Rejecting uncensored confirm because NFO generation is disabled");
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "已关闭 NFO 生成功能，无法确认无码类型");
          }

          return await confirmUncensoredItems(items, config);
        }),
      ),
  };
};
