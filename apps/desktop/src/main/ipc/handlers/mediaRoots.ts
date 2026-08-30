import { stat } from "node:fs/promises";
import type { ServiceContainer } from "@main/container";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { createIpcError, IpcErrorCode } from "../errors";
import { mediaRootEnsurePathInputSchema } from "../payloads";
import { t } from "../shared";

export const createMediaRootHandlers = (
  context: ServiceContainer,
): Pick<IpcRouterContract, typeof IpcChannel.MediaRoots_EnsurePath> => {
  const { persistenceService } = context;
  return {
    [IpcChannel.MediaRoots_EnsurePath]: t.procedure.input(mediaRootEnsurePathInputSchema).action(async ({ input }) => {
      const hostPath = input.hostPath.trim();
      try {
        const stats = await stat(hostPath);
        if (!stats.isDirectory()) {
          throw new Error("Not a directory");
        }
      } catch {
        throw createIpcError(IpcErrorCode.DIRECTORY_NOT_FOUND, `Directory not found: ${hostPath}`);
      }

      const state = await persistenceService.getState();
      const root = await state.repositories.mediaRoots.ensurePath(hostPath, input.displayName);
      return {
        id: root.id,
        displayName: root.displayName,
        hostPath: root.hostPath,
        createdAt: root.createdAt.toISOString(),
        updatedAt: root.updatedAt.toISOString(),
      };
    }),
  };
};
