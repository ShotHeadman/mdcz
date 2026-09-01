import { arch } from "node:os";
import type { ServiceContainer } from "@main/container";
import { ensureWatermarkDirectory } from "@mdcz/runtime/scrape";
import { resolvePlayableMediaTarget } from "@mdcz/runtime/scrape/utils/strm";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { app, shell } from "electron";
import { getDesktopUserDataPath } from "../../appIdentity";
import { resolveLocalFileTarget } from "../localFileTarget";
import {
  appOpenExternalInputSchema,
  appPlayMediaInputSchema,
  appShowItemInFolderInputSchema,
  appSyncTitleBarThemeInputSchema,
} from "../payloads";
import { t } from "../shared";

const ALLOWED_EXTERNAL_SCHEMES = new Set(["http:", "https:"]);

export const assertAllowedExternalUrl = (url: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid external URL");
  }
  if (!ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Unsupported external URL scheme: ${parsed.protocol}`);
  }
};

export const createAppHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.App_Info
  | typeof IpcChannel.App_OpenExternal
  | typeof IpcChannel.App_PlayMedia
  | typeof IpcChannel.App_ShowItemInFolder
  | typeof IpcChannel.App_EnsureWatermarkDirectory
  | typeof IpcChannel.App_OpenWatermarkDirectory
  | typeof IpcChannel.App_Relaunch
  | typeof IpcChannel.App_SyncTitleBarTheme
> => ({
  [IpcChannel.App_Info]: t.procedure.action(async () => ({
    version: app.getVersion(),
    arch: arch(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  })),
  [IpcChannel.App_OpenExternal]: t.procedure.input(appOpenExternalInputSchema).action(async ({ input }) => {
    assertAllowedExternalUrl(input.url);
    await shell.openExternal(input.url);
    return { success: true as const };
  }),
  [IpcChannel.App_PlayMedia]: t.procedure.input(appPlayMediaInputSchema).action(async ({ input }) => {
    const { hostPath: targetPath } = await resolveLocalFileTarget(context, input.path);

    const playableTarget = await resolvePlayableMediaTarget(targetPath);
    if (playableTarget.kind === "url") {
      assertAllowedExternalUrl(playableTarget.target);
      await shell.openExternal(playableTarget.target);
      return { success: true as const };
    }

    const errorMessage = await shell.openPath(playableTarget.target);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return { success: true as const };
  }),
  [IpcChannel.App_ShowItemInFolder]: t.procedure.input(appShowItemInFolderInputSchema).action(async ({ input }) => {
    const { hostPath: targetPath } = await resolveLocalFileTarget(context, input.path);

    shell.showItemInFolder(targetPath);
    return { success: true as const };
  }),
  [IpcChannel.App_EnsureWatermarkDirectory]: t.procedure.action(async () => ({
    path: await ensureWatermarkDirectory(getDesktopUserDataPath()),
  })),
  [IpcChannel.App_OpenWatermarkDirectory]: t.procedure.action(async () => {
    const directoryPath = await ensureWatermarkDirectory(getDesktopUserDataPath());
    const errorMessage = await shell.openPath(directoryPath);
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
  [IpcChannel.App_SyncTitleBarTheme]: t.procedure.input(appSyncTitleBarThemeInputSchema).action(async ({ input }) => {
    context.windowService.syncTitleBarOverlay(input.isDark);
    return { success: true as const };
  }),
});
