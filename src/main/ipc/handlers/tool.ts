import type { ServiceContainer } from "@main/container";
import { configManager, configurationSchema } from "@main/services/config";
import { ActorPhotoFolderConfigurationError } from "@main/services/config/actorPhotoPath";
import {
  checkConnection as checkEmbyConnection,
  EmbyServiceError,
  parseMode as parseEmbyMode,
} from "@main/services/emby";
import {
  checkConnection as checkJellyfinConnection,
  JellyfinServiceError,
  parseMode as parseJellyfinMode,
} from "@main/services/jellyfin";
import { loggerService } from "@main/services/LoggerService";
import { SymlinkServiceError } from "@main/services/tools";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");

export const createToolHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Tool_JellyfinServerCheckConnection
  | typeof IpcChannel.Tool_JellyfinActorPhotoSync
  | typeof IpcChannel.Tool_JellyfinActorInfoSync
  | typeof IpcChannel.Tool_EmbyServerCheckConnection
  | typeof IpcChannel.Tool_EmbyActorPhotoSync
  | typeof IpcChannel.Tool_EmbyActorInfoSync
  | typeof IpcChannel.Tool_CreateSymlink
  | typeof IpcChannel.Tool_AmazonPosterScan
  | typeof IpcChannel.Tool_AmazonPosterLookup
  | typeof IpcChannel.Tool_AmazonPosterApply
  | typeof IpcChannel.Tool_ToggleDevTools
> => {
  const {
    signalService,
    networkClient,
    jellyfinActorPhotoService,
    jellyfinActorInfoService,
    embyActorPhotoService,
    embyActorInfoService,
    symlinkService,
    windowService,
    amazonPosterToolService,
  } = context;
  let symlinkTask: Promise<void> | null = null;
  let symlinkTaskStarting = false;

  const reportHandlerError = (operation: string, error: unknown): void => {
    logger.error(`${operation} failed: ${toErrorMessage(error)}`);
  };

  const raiseHandlerError = <T>(operation: string, error: unknown): T => {
    reportHandlerError(operation, error);
    throw asSerializableIpcError(error);
  };

  const reportBackgroundError = (operation: string, error: unknown): void => {
    signalService.showLogText(`${operation} failed: ${toErrorMessage(error)}`, "error");
  };

  const ensureJellyfinReady = async () => {
    await configManager.ensureLoaded();
    const configuration = configurationSchema.parse(await configManager.get());

    if (!configuration.jellyfin.url.trim() || !configuration.jellyfin.apiKey.trim()) {
      throw createIpcError(IpcErrorCode.NETWORK_ERROR, "Jellyfin URL and API key are required");
    }

    return configuration;
  };

  const ensureEmbyReady = async () => {
    await configManager.ensureLoaded();
    const configuration = configurationSchema.parse(await configManager.get());

    if (!configuration.emby.url.trim() || !configuration.emby.apiKey.trim()) {
      throw createIpcError(IpcErrorCode.NETWORK_ERROR, "Emby URL and API key are required");
    }

    return configuration;
  };

  return {
    [IpcChannel.Tool_JellyfinServerCheckConnection]: t.procedure.action(async () => {
      try {
        const configuration = await ensureJellyfinReady();
        return await checkJellyfinConnection(networkClient, configuration);
      } catch (error) {
        if (error instanceof JellyfinServiceError) {
          throw createIpcError(error.code, error.message);
        }
        return raiseHandlerError("Tool_JellyfinServerCheckConnection", error);
      }
    }),
    [IpcChannel.Tool_JellyfinActorPhotoSync]: t.procedure
      .input<{ mode?: "all" | "missing" }>()
      .action(async ({ input }) => {
        try {
          const mode = parseJellyfinMode(input?.mode);
          if (!mode) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Mode must be 'all' or 'missing'");
          }
          const configuration = await ensureJellyfinReady();
          return jellyfinActorPhotoService.run(configuration, mode);
        } catch (error) {
          if (error instanceof JellyfinServiceError) {
            throw createIpcError(error.code, error.message);
          }
          if (error instanceof ActorPhotoFolderConfigurationError) {
            throw createIpcError(error.code, error.message);
          }
          return raiseHandlerError("Tool_JellyfinActorPhotoSync", error);
        }
      }),
    [IpcChannel.Tool_JellyfinActorInfoSync]: t.procedure
      .input<{ mode?: "all" | "missing" }>()
      .action(async ({ input }) => {
        try {
          const mode = parseJellyfinMode(input?.mode);
          if (!mode) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Mode must be 'all' or 'missing'");
          }
          const configuration = await ensureJellyfinReady();
          return jellyfinActorInfoService.run(configuration, mode);
        } catch (error) {
          if (error instanceof JellyfinServiceError) {
            throw createIpcError(error.code, error.message);
          }
          return raiseHandlerError("Tool_JellyfinActorInfoSync", error);
        }
      }),
    [IpcChannel.Tool_EmbyServerCheckConnection]: t.procedure.action(async () => {
      try {
        const configuration = await ensureEmbyReady();
        return await checkEmbyConnection(networkClient, configuration);
      } catch (error) {
        if (error instanceof EmbyServiceError) {
          throw createIpcError(error.code, error.message);
        }
        return raiseHandlerError("Tool_EmbyServerCheckConnection", error);
      }
    }),
    [IpcChannel.Tool_EmbyActorPhotoSync]: t.procedure
      .input<{ mode?: "all" | "missing" }>()
      .action(async ({ input }) => {
        try {
          const mode = parseEmbyMode(input?.mode);
          if (!mode) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Mode must be 'all' or 'missing'");
          }
          const configuration = await ensureEmbyReady();
          return embyActorPhotoService.run(configuration, mode);
        } catch (error) {
          if (error instanceof EmbyServiceError) {
            throw createIpcError(error.code, error.message);
          }
          if (error instanceof ActorPhotoFolderConfigurationError) {
            throw createIpcError(error.code, error.message);
          }
          return raiseHandlerError("Tool_EmbyActorPhotoSync", error);
        }
      }),
    [IpcChannel.Tool_EmbyActorInfoSync]: t.procedure.input<{ mode?: "all" | "missing" }>().action(async ({ input }) => {
      try {
        const mode = parseEmbyMode(input?.mode);
        if (!mode) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Mode must be 'all' or 'missing'");
        }
        const configuration = await ensureEmbyReady();
        return embyActorInfoService.run(configuration, mode);
      } catch (error) {
        if (error instanceof EmbyServiceError) {
          throw createIpcError(error.code, error.message);
        }
        return raiseHandlerError("Tool_EmbyActorInfoSync", error);
      }
    }),
    [IpcChannel.Tool_CreateSymlink]: t.procedure
      .input<{
        sourceDir?: string;
        source_dir?: string;
        destDir?: string;
        dest_dir?: string;
        copyFiles?: boolean;
        copy_files?: boolean;
      }>()
      .action(async ({ input }): Promise<{ message: string }> => {
        try {
          if (symlinkTaskStarting || symlinkTask) {
            throw createIpcError(IpcErrorCode.OPERATION_CANCELLED, "Softlink creation task is already running");
          }

          const sourceDir = (input?.sourceDir ?? input?.source_dir ?? "").trim();
          const destDir = (input?.destDir ?? input?.dest_dir ?? "").trim();
          const copyFiles = input?.copyFiles ?? input?.copy_files ?? false;

          if (!sourceDir || !destDir) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Source and destination directories are required");
          }

          symlinkTaskStarting = true;
          const preparedTask = await symlinkService.prepare({ sourceDir, destDir, copyFiles });
          symlinkTask = symlinkService
            .runPrepared(preparedTask)
            .then(() => undefined)
            .catch((error) => {
              reportBackgroundError("Tool_CreateSymlink", error);
            })
            .finally(() => {
              symlinkTask = null;
            });

          return { message: "软链接创建任务已启动" };
        } catch (error) {
          if (error instanceof SymlinkServiceError) {
            throw createIpcError(error.code, error.message);
          }
          return raiseHandlerError("Tool_CreateSymlink setup", error);
        } finally {
          symlinkTaskStarting = false;
        }
      }),
    [IpcChannel.Tool_AmazonPosterScan]: t.procedure.input<{ directory?: string }>().action(async ({ input }) => {
      try {
        const directory = input?.directory?.trim();
        if (!directory) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Directory is required");
        }
        return {
          items: await amazonPosterToolService.scan(directory),
        };
      } catch (error) {
        return raiseHandlerError("Tool_AmazonPosterScan", error);
      }
    }),
    [IpcChannel.Tool_AmazonPosterLookup]: t.procedure
      .input<{ nfoPath?: string; title?: string }>()
      .action(async ({ input }) => {
        try {
          const nfoPath = input?.nfoPath?.trim();
          const title = input?.title?.trim();
          if (!nfoPath || !title) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "NFO path and title are required");
          }
          return amazonPosterToolService.lookup(nfoPath, title);
        } catch (error) {
          return raiseHandlerError("Tool_AmazonPosterLookup", error);
        }
      }),
    [IpcChannel.Tool_AmazonPosterApply]: t.procedure
      .input<{ items?: Array<{ directory: string; amazonPosterUrl: string }> }>()
      .action(async ({ input }) => {
        try {
          return {
            results: await amazonPosterToolService.apply(input?.items ?? []),
          };
        } catch (error) {
          return raiseHandlerError("Tool_AmazonPosterApply", error);
        }
      }),
    [IpcChannel.Tool_ToggleDevTools]: t.procedure.action(async () => {
      windowService.toggleDevTools();
      return { success: true as const };
    }),
  };
};
