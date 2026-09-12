import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { libraryFileRemoveInputSchema, libraryRelinkInputSchema } from "@mdcz/shared/serverDtos";
import { libraryAvailabilityInputSchema, libraryDeleteInputSchema, libraryListInputSchema } from "../payloads";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:library");

export const createLibraryHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Library_Availability
  | typeof IpcChannel.Library_List
  | typeof IpcChannel.Library_Delete
  | typeof IpcChannel.Library_RemoveFile
  | typeof IpcChannel.Library_RelinkFile
> => ({
  [IpcChannel.Library_RelinkFile]: t.procedure
    .input(libraryRelinkInputSchema)
    .action(async ({ input }) => context.desktopLibraryService.relinkFile(input)),
  [IpcChannel.Library_RemoveFile]: t.procedure
    .input(libraryFileRemoveInputSchema)
    .action(async ({ input }) => context.desktopLibraryService.removeFile(input)),
  [IpcChannel.Library_Availability]: t.procedure.input(libraryAvailabilityInputSchema).action(async ({ input }) => {
    try {
      return await context.desktopLibraryService.availability(input);
    } catch (error) {
      logger.error(`Library availability failed: ${toErrorMessage(error)}`);
      throw asSerializableIpcError(error);
    }
  }),
  [IpcChannel.Library_List]: t.procedure.input(libraryListInputSchema).action(async ({ input }) => {
    try {
      return await context.desktopLibraryService.list(input ?? {});
    } catch (error) {
      logger.error(`Library list failed: ${toErrorMessage(error)}`);
      throw asSerializableIpcError(error);
    }
  }),
  [IpcChannel.Library_Delete]: t.procedure.input(libraryDeleteInputSchema).action(async ({ input }) => {
    try {
      return await context.desktopLibraryService.deleteEntry(input?.id ?? "");
    } catch (error) {
      logger.error(`Library delete failed: ${toErrorMessage(error)}`);
      throw asSerializableIpcError(error);
    }
  }),
});
