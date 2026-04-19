import { stat } from "node:fs/promises";
import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:dashboard");

const resolveExistingThumbnailPath = async (thumbnailPath: string): Promise<string | null> => {
  try {
    const thumbnailStats = await stat(thumbnailPath);
    return thumbnailStats.isFile() ? thumbnailPath : null;
  } catch {
    return null;
  }
};

export const createDashboardHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  typeof IpcChannel.Dashboard_GetRecentAcquisitions | typeof IpcChannel.Dashboard_GetOutputSummary
> => {
  const { outputLibraryScanner, recentAcquisitionsStore } = context;

  return {
    [IpcChannel.Dashboard_GetRecentAcquisitions]: t.procedure.action(async () => {
      try {
        const records = await recentAcquisitionsStore.list();
        const items = await Promise.all(
          records.map(async (record) => ({
            number: record.number,
            title: record.title,
            actors: record.actors,
            thumbnailPath: await resolveExistingThumbnailPath(recentAcquisitionsStore.getThumbnailPath(record.number)),
            lastKnownPath: record.lastKnownPath,
            completedAt: record.completedAt,
          })),
        );

        return { items };
      } catch (error) {
        logger.error(`Dashboard recent acquisitions failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Dashboard_GetOutputSummary]: t.procedure.action(async () => {
      try {
        return await outputLibraryScanner.getSummary();
      } catch (error) {
        logger.error(`Dashboard output summary failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
  };
};
