import { arch } from "node:os";
import type { ServiceContainer } from "@main/container";
import { resolvePlayableMediaTarget } from "@main/utils/strm";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { app, shell } from "electron";
import { t } from "../shared";

export const createAppHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.App_Info
  | typeof IpcChannel.App_OpenExternal
  | typeof IpcChannel.App_PlayMedia
  | typeof IpcChannel.App_Relaunch
  | typeof IpcChannel.App_SyncTitleBarTheme
> => ({
  [IpcChannel.App_Info]: t.procedure.action(async () => ({
    version: app.getVersion(),
    arch: arch(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  })),
  [IpcChannel.App_OpenExternal]: t.procedure.input<{ url: string }>().action(async ({ input }) => {
    await shell.openExternal(input.url);
    return { success: true as const };
  }),
  [IpcChannel.App_PlayMedia]: t.procedure.input<{ path?: string }>().action(async ({ input }) => {
    const targetPath = input.path?.trim();
    if (!targetPath) {
      throw new Error("Media path is required");
    }

    const playableTarget = await resolvePlayableMediaTarget(targetPath);
    if (playableTarget.kind === "url") {
      await shell.openExternal(playableTarget.target);
      return { success: true as const };
    }

    const errorMessage = await shell.openPath(playableTarget.target);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return { success: true as const };
  }),
  [IpcChannel.App_Relaunch]: t.procedure.action(async () => {
    app.relaunch();
    app.exit(0);
    return { success: true as const };
  }),
  [IpcChannel.App_SyncTitleBarTheme]: t.procedure.input<{ isDark: boolean }>().action(async ({ input }) => {
    context.windowService.syncTitleBarOverlay(input.isDark);
    return { success: true as const };
  }),
});
