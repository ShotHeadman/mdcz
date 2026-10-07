import type { ServiceContainer } from "@main/container";
import { createDesktopMediaRootService } from "@main/services/mediaRoots";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { mediaRootEnsurePathInputSchema } from "../payloads";
import { asSerializableIpcError, t } from "../shared";

export const createMediaRootHandlers = (
  context: ServiceContainer,
): Pick<IpcRouterContract, typeof IpcChannel.MediaRoots_EnsurePath> => {
  const mediaRoots = context.mediaRoots ?? createDesktopMediaRootService(context.persistenceService);

  return {
    [IpcChannel.MediaRoots_EnsurePath]: t.procedure.input(mediaRootEnsurePathInputSchema).action(async ({ input }) => {
      try {
        return await mediaRoots.ensurePath(input);
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
  };
};
