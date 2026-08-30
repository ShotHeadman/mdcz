import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { ScraperServiceError } from "@main/services/scraper";
import { confirmUncensoredItems, createUncensoredConfirmDependencies } from "@main/services/scraper/confirmUncensored";
import type { StartScrapeResult } from "@main/services/scraper/ScraperService";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { withIpcErrorHandling } from "../errorHandling";
import { createIpcError, IpcErrorCode } from "../errors";
import {
  scraperConfirmUncensoredInputSchema,
  scraperRetryInputSchema,
  scraperStartInputSchema,
  scraperStartSinglePathInputSchema,
} from "../payloads";
import { t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");
const withLaunchMessage = (result: StartScrapeResult, message: string) => ({ ...result, message });
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
  | typeof IpcChannel.Scraper_Start
  | typeof IpcChannel.Scraper_StartSinglePath
  | typeof IpcChannel.Scraper_Stop
  | typeof IpcChannel.Scraper_Pause
  | typeof IpcChannel.Scraper_Resume
  | typeof IpcChannel.Scraper_Retry
  | typeof IpcChannel.Scraper_ConfirmUncensored
> => {
  const { scraperService } = context;

  return {
    [IpcChannel.Scraper_GetStatus]: t.procedure.action(async () => {
      return scraperService.getSnapshot();
    }),
    [IpcChannel.Scraper_Start]: t.procedure.input(scraperStartInputSchema).action(({ input }) =>
      withIpcErrorHandling(
        "start scraper",
        async () => {
          if (input.mode === "selection") {
            return withLaunchMessage(await scraperService.start(input.refs, input.outputRootId), "已启动选中文件刮削");
          }

          return withLaunchMessage(await scraperService.startSingle(input.ref), "单文件刮削任务已启动");
        },
        { mapError: toScraperServiceIpcError },
      ),
    ),
    [IpcChannel.Scraper_StartSinglePath]: t.procedure
      .input(scraperStartSinglePathInputSchema)
      .action(({ input }) =>
        withIpcErrorHandling(
          "start single-file scraper",
          async () => withLaunchMessage(await scraperService.startFromNativePath(input.path), "单文件刮削任务已启动"),
          { mapError: toScraperServiceIpcError },
        ),
      ),
    [IpcChannel.Scraper_Stop]: t.procedure.action(() =>
      withIpcErrorHandling("stop scraper", async () => {
        return {
          success: true as const,
          pendingCount: (await scraperService.stop()).pendingCount,
        };
      }),
    ),
    [IpcChannel.Scraper_Pause]: t.procedure.action(() =>
      withIpcErrorHandling("pause scraper", async () => {
        await scraperService.pause();
        return { success: true as const };
      }),
    ),
    [IpcChannel.Scraper_Resume]: t.procedure.action(() =>
      withIpcErrorHandling("resume scraper", async () => {
        await scraperService.resume();
        return { success: true as const };
      }),
    ),
    [IpcChannel.Scraper_Retry]: t.procedure.input(scraperRetryInputSchema).action(({ input }) =>
      withIpcErrorHandling(
        "retry files",
        async () => {
          const result = await scraperService.retry(input.runId);
          return withLaunchMessage(result, `重试任务已启动，共 ${result.totalFiles} 个文件`);
        },
        { mapError: toScraperServiceIpcError },
      ),
    ),
    [IpcChannel.Scraper_ConfirmUncensored]: t.procedure.input(scraperConfirmUncensoredInputSchema).action(({ input }) =>
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

        const state = await context.persistenceService.getState();
        return await confirmUncensoredItems(
          items,
          config,
          createUncensoredConfirmDependencies({
            journal: state.repositories.publicationJournal,
            repairIssues: state.repositories.libraryRepairIssues,
            roots: await state.repositories.mediaRoots.list(),
          }),
        );
      }),
    ),
  };
};
