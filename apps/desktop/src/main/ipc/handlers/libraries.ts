import type { ServiceContainer } from "@main/container";
import { toMediaLibraryDto } from "@mdcz/runtime/library";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import {
  mediaLibraryIdInputSchema,
  mediaLibrarySettingsSchema,
  mediaLibraryUpdateInputSchema,
} from "@mdcz/shared/mediaLibrary";
import {
  pendingConfirmUncensoredInputSchema,
  pendingIdInputSchema,
  pendingRetryInputSchema,
} from "@mdcz/shared/pending";
import { withIpcErrorHandling } from "../errorHandling";
import { t } from "../shared";

export const createLibrariesHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Libraries_List
  | typeof IpcChannel.Libraries_Create
  | typeof IpcChannel.Libraries_Update
  | typeof IpcChannel.Libraries_Delete
  | typeof IpcChannel.Libraries_PreviewNaming
  | typeof IpcChannel.Pending_List
  | typeof IpcChannel.Pending_Detail
  | typeof IpcChannel.Pending_Retry
  | typeof IpcChannel.Pending_ConfirmUncensored
  | typeof IpcChannel.Pending_Ignore
> => {
  const { libraries, pendingService } = context;
  return {
    [IpcChannel.Libraries_List]: t.procedure.action(() =>
      withIpcErrorHandling("list libraries", async () => ({
        libraries: (await libraries.list()).map(toMediaLibraryDto),
      })),
    ),
    [IpcChannel.Libraries_Create]: t.procedure
      .input(mediaLibrarySettingsSchema)
      .action(({ input }) =>
        withIpcErrorHandling("create library", async () => toMediaLibraryDto(await libraries.create(input))),
      ),
    [IpcChannel.Libraries_Update]: t.procedure
      .input(mediaLibraryUpdateInputSchema)
      .action(({ input }) =>
        withIpcErrorHandling("update library", async () =>
          toMediaLibraryDto(await libraries.update(input.id, input.settings)),
        ),
      ),
    [IpcChannel.Libraries_Delete]: t.procedure.input(mediaLibraryIdInputSchema).action(({ input }) =>
      withIpcErrorHandling("delete library", async () => {
        await libraries.delete(input.id);
        return { success: true as const };
      }),
    ),
    [IpcChannel.Libraries_PreviewNaming]: t.procedure
      .input(mediaLibrarySettingsSchema)
      .action(({ input }) =>
        withIpcErrorHandling("preview library naming", async () => ({ items: await libraries.previewNaming(input) })),
      ),
    [IpcChannel.Pending_List]: t.procedure.action(() =>
      withIpcErrorHandling("list pending", async () => await pendingService.list()),
    ),
    [IpcChannel.Pending_Detail]: t.procedure
      .input(pendingIdInputSchema)
      .action(({ input }) =>
        withIpcErrorHandling("read pending entry", async () => await pendingService.detail(input.id)),
      ),
    [IpcChannel.Pending_Retry]: t.procedure
      .input(pendingRetryInputSchema)
      .action(({ input }) =>
        withIpcErrorHandling("retry pending entry", async () => await pendingService.retry(input)),
      ),
    [IpcChannel.Pending_ConfirmUncensored]: t.procedure.input(pendingConfirmUncensoredInputSchema).action(({ input }) =>
      withIpcErrorHandling("confirm uncensored type", async () => {
        await pendingService.confirmUncensored(input);
        return { success: true as const };
      }),
    ),
    [IpcChannel.Pending_Ignore]: t.procedure.input(pendingIdInputSchema).action(({ input }) =>
      withIpcErrorHandling("ignore pending entry", async () => {
        await pendingService.ignore(input.id);
        return { success: true as const };
      }),
    ),
  };
};
