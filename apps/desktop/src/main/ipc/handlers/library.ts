import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:library");

export const createLibraryHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  typeof IpcChannel.Library_Availability | typeof IpcChannel.Library_List | typeof IpcChannel.Library_Delete
> => ({
  [IpcChannel.Library_Availability]: t.procedure
    .input<Parameters<typeof context.desktopLibraryService.availability>[0]>()
    .action(async ({ input }) => {
      try {
        return await context.desktopLibraryService.availability(input);
      } catch (error) {
        logger.error(`Library availability failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
  [IpcChannel.Library_List]: t.procedure
    .input<Parameters<typeof context.desktopLibraryService.list>[0]>()
    .action(async ({ input }) => {
      try {
        return await context.desktopLibraryService.list(input ?? {});
      } catch (error) {
        logger.error(`Library list failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
  [IpcChannel.Library_Delete]: t.procedure
    .input<{ deleteMediaFiles?: boolean; id?: string }>()
    .action(async ({ input }) => {
      try {
        return await context.desktopLibraryService.deleteEntry(input?.id ?? "", {
          deleteMediaFiles: input?.deleteMediaFiles,
        });
      } catch (error) {
        logger.error(`Library delete failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
});
