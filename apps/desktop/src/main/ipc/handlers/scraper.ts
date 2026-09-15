import type { ServiceContainer } from "@main/container";
import { ScraperServiceError } from "@main/services/scraper";
import type { StartScrapeResult } from "@main/services/scraper/ScraperService";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { scrapeConfirmUncensoredInputSchema } from "@mdcz/shared/serverDtos";
import { withIpcErrorHandling } from "../errorHandling";
import { createIpcError } from "../errors";
import {
  scraperGetStatusInputSchema,
  scraperRerunDirectoryInputSchema,
  scraperRetryInputSchema,
  scraperStartInputSchema,
  scraperStartSinglePathInputSchema,
} from "../payloads";
import { t } from "../shared";

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
  | typeof IpcChannel.Scraper_RerunDirectory
  | typeof IpcChannel.Scraper_Retry
  | typeof IpcChannel.Scraper_ConfirmUncensored
> => {
  const { scraperService } = context;

  return {
    [IpcChannel.Scraper_GetStatus]: t.procedure
      .input(scraperGetStatusInputSchema)
      .action(async ({ input }) => scraperService.getSnapshot(input.taskId)),
    [IpcChannel.Scraper_Start]: t.procedure.input(scraperStartInputSchema).action(({ input }) =>
      withIpcErrorHandling(
        "start scraper",
        async () => {
          return withLaunchMessage(
            await scraperService.start(input),
            input.mode === "directory"
              ? "目录刮削任务已提交"
              : input.mode === "selection"
                ? "已启动选中文件刮削"
                : "单文件刮削任务已启动",
          );
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
    [IpcChannel.Scraper_RerunDirectory]: t.procedure
      .input(scraperRerunDirectoryInputSchema)
      .action(({ input }) =>
        withIpcErrorHandling(
          "rerun directory",
          async () => withLaunchMessage(await scraperService.rerunDirectory(input.runId), "已重新启动目录扫描"),
          { mapError: toScraperServiceIpcError },
        ),
      ),
    [IpcChannel.Scraper_Retry]: t.procedure.input(scraperRetryInputSchema).action(({ input }) =>
      withIpcErrorHandling(
        "retry files",
        async () => {
          const result = await scraperService.retry(input.runId, input.itemIds);
          return withLaunchMessage(result, `已启动重试（共 ${result.totalFiles} 个文件）`);
        },
        { mapError: toScraperServiceIpcError },
      ),
    ),
    [IpcChannel.Scraper_ConfirmUncensored]: t.procedure.input(scrapeConfirmUncensoredInputSchema).action(({ input }) =>
      withIpcErrorHandling("confirm uncensored items", async () => await scraperService.confirmUncensored(input), {
        mapError: toScraperServiceIpcError,
      }),
    ),
  };
};
