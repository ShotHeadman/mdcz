import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import {
  type LibraryAvailabilityInput,
  type LibraryListInput,
  libraryAvailabilityInputSchema,
  libraryListInputSchema,
} from "@mdcz/shared/serverDtos";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:library");

export const createLibraryHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  typeof IpcChannel.Library_Availability | typeof IpcChannel.Library_List | typeof IpcChannel.Library_Delete
> => ({
  [IpcChannel.Library_Availability]: t.procedure.input<LibraryAvailabilityInput>().action(async ({ input }) => {
    try {
      return await context.desktopLibraryService.availability(parseLibraryAvailabilityInput(input));
    } catch (error) {
      logger.error(`Library availability failed: ${toErrorMessage(error)}`);
      throw asSerializableIpcError(error);
    }
  }),
  [IpcChannel.Library_List]: t.procedure.input<LibraryListInput>().action(async ({ input }) => {
    try {
      return await context.desktopLibraryService.list(parseLibraryListInput(input));
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

const parseLibraryListInput = (input: LibraryListInput): LibraryListInput => {
  const parsed = libraryListInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data ?? {};
};

const parseLibraryAvailabilityInput = (input: LibraryAvailabilityInput): LibraryAvailabilityInput => {
  const parsed = libraryAvailabilityInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
};
