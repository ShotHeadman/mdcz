import type { ServiceContainer } from "@main/container";
import { ScraperServiceError } from "@main/services/scraper";
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
      withIpcErrorHandling("start scraper", async () => await scraperService.start(input), {
        mapError: toScraperServiceIpcError,
      }),
    ),
    [IpcChannel.Scraper_StartSinglePath]: t.procedure
      .input(scraperStartSinglePathInputSchema)
      .action(({ input }) =>
        withIpcErrorHandling(
          "start single-file scraper",
          async () => await scraperService.startFromNativePath(input.path),
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
    [IpcChannel.Scraper_RerunDirectory]: t.procedure.input(scraperRerunDirectoryInputSchema).action(({ input }) =>
      withIpcErrorHandling("rerun directory", async () => await scraperService.rerunDirectory(input.runId), {
        mapError: toScraperServiceIpcError,
      }),
    ),
    [IpcChannel.Scraper_Retry]: t.procedure.input(scraperRetryInputSchema).action(({ input }) =>
      withIpcErrorHandling("retry files", async () => await scraperService.retry(input.runId, input.itemIds), {
        mapError: toScraperServiceIpcError,
      }),
    ),
    [IpcChannel.Scraper_ConfirmUncensored]: t.procedure.input(scrapeConfirmUncensoredInputSchema).action(({ input }) =>
      withIpcErrorHandling("confirm uncensored items", async () => await scraperService.confirmUncensored(input), {
        mapError: toScraperServiceIpcError,
      }),
    ),
  };
};
