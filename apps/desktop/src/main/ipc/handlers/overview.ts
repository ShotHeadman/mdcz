import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { sortAndLimitRecentAcquisitions, toRuntimeRecentAcquisition } from "@mdcz/runtime/library";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { OverviewRecentAcquisitionItem } from "@mdcz/shared/ipc-contracts/overviewContract";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:overview");

export const createOverviewHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  typeof IpcChannel.Overview_GetRecentAcquisitions | typeof IpcChannel.Overview_GetOutputSummary
> => {
  const { outputLibraryScanner } = context;

  return {
    [IpcChannel.Overview_GetRecentAcquisitions]: t.procedure.action(async () => {
      try {
        return { items: await readPersistedRecentAcquisitions(context) };
      } catch (error) {
        logger.error(`Overview recent acquisitions failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Overview_GetOutputSummary]: t.procedure.action(async () => {
      try {
        return await outputLibraryScanner.getSummary();
      } catch (error) {
        logger.error(`Overview output summary failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
  };
};

const readPersistedRecentAcquisitions = async (context: ServiceContainer): Promise<OverviewRecentAcquisitionItem[]> => {
  const state = await context.persistenceService.getState();
  const entries = await state.repositories.library.listEntries();
  const recent = sortAndLimitRecentAcquisitions(
    entries
      .map((entry) =>
        toRuntimeRecentAcquisition({
          id: entry.id,
          number: entry.number,
          fileName: entry.fileName,
          title: entry.title,
          actors: entry.actors,
          thumbnailPath: entry.thumbnailPath,
          lastKnownPath: entry.lastKnownPath,
          indexedAt: entry.indexedAt,
        }),
      )
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );

  return recent.map((record) => ({
    number: record.number,
    title: record.title,
    actors: record.actors,
    thumbnailPath: record.thumbnailPath ? record.thumbnailPath : null,
    lastKnownPath: record.lastKnownPath,
    completedAt: record.completedAt,
  }));
};
