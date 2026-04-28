import type { ServiceContainer } from "@main/container";
import { type Configuration, configManager } from "@main/services/config";
import { ActorPhotoFolderConfigurationError } from "@main/services/config/actorPhotoPath";
import { loggerService } from "@main/services/LoggerService";
import {
  checkConnection as checkEmbyConnection,
  EmbyServiceError,
  parseMode as parseEmbyMode,
} from "@main/services/mediaServer/emby";
import {
  checkConnection as checkJellyfinConnection,
  JellyfinServiceError,
  parseMode as parseJellyfinMode,
} from "@main/services/mediaServer/jellyfin";
import { SymlinkServiceError } from "@main/services/tools";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type {
  BatchTranslateScanItem,
  EmbyConnectionCheckResult,
  JellyfinConnectionCheckResult,
  PersonSyncResult,
} from "@mdcz/shared/ipcTypes";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter");
type MediaServerMode = "all" | "missing";
type MediaServerConfigurationLoader = () => Promise<Configuration>;
type MediaServerModeParser = (value: unknown) => MediaServerMode | null;
type MediaServerRunner<TResult = PersonSyncResult> = {
  run(configuration: Configuration, mode: MediaServerMode): Promise<TResult>;
};
type MediaServerConnectionChecker<TResult> = (
  networkClient: ServiceContainer["networkClient"],
  configuration: Configuration,
) => Promise<TResult>;
type MediaServerErrorCtor = typeof JellyfinServiceError | typeof EmbyServiceError;

interface MediaServerHandlerOptions<TConnectionResult> {
  checkConnectionOperation: string;
  syncInfoOperation: string;
  syncPhotoOperation: string;
  ensureReady: MediaServerConfigurationLoader;
  parseMode: MediaServerModeParser;
  checkConnection: MediaServerConnectionChecker<TConnectionResult>;
  errorType: MediaServerErrorCtor;
  infoService: MediaServerRunner<PersonSyncResult>;
  photoService: MediaServerRunner<PersonSyncResult>;
}

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
  | typeof IpcChannel.Tool_BatchTranslateScan
  | typeof IpcChannel.Tool_BatchTranslateApply
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
    batchTranslateToolService,
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

  const ensureMediaServerReady = async (
    type: "jellyfin" | "emby",
    serviceName: "Jellyfin" | "Emby",
  ): Promise<Configuration> => {
    const configuration = await configManager.getValidated();
    const serverConfig = configuration[type];

    if (!serverConfig.url.trim() || !serverConfig.apiKey.trim()) {
      throw createIpcError(IpcErrorCode.NETWORK_ERROR, `${serviceName} URL and API key are required`);
    }

    return configuration;
  };

  const ensureJellyfinReady = () => ensureMediaServerReady("jellyfin", "Jellyfin");
  const ensureEmbyReady = () => ensureMediaServerReady("emby", "Emby");

  const rethrowMediaServerError = (
    error: unknown,
    errorType: MediaServerErrorCtor,
    options: { includeActorPhotoFolderError?: boolean } = {},
  ): void => {
    if (error instanceof errorType) {
      throw createIpcError(error.code, error.message);
    }

    if (options.includeActorPhotoFolderError && error instanceof ActorPhotoFolderConfigurationError) {
      throw createIpcError(error.code, error.message);
    }
  };

  const createModeError = () => createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Mode must be 'all' or 'missing'");

  const createMediaServerCheckConnectionHandler = <TConnectionResult>(
    options: MediaServerHandlerOptions<TConnectionResult>,
  ) =>
    t.procedure.action(async (): Promise<TConnectionResult> => {
      try {
        const configuration = await options.ensureReady();
        return await options.checkConnection(networkClient, configuration);
      } catch (error) {
        rethrowMediaServerError(error, options.errorType);
        return raiseHandlerError(options.checkConnectionOperation, error);
      }
    });

  const createMediaServerSyncHandler = (
    operation: string,
    options: MediaServerHandlerOptions<unknown>,
    service: MediaServerRunner<PersonSyncResult>,
    extra: { includeActorPhotoFolderError?: boolean } = {},
  ) =>
    t.procedure.input<{ mode?: MediaServerMode }>().action(async ({ input }): Promise<PersonSyncResult> => {
      try {
        const mode = options.parseMode(input?.mode);
        if (!mode) {
          throw createModeError();
        }

        const configuration = await options.ensureReady();
        return await service.run(configuration, mode);
      } catch (error) {
        rethrowMediaServerError(error, options.errorType, extra);
        return raiseHandlerError(operation, error);
      }
    });

  const jellyfinHandlers: MediaServerHandlerOptions<JellyfinConnectionCheckResult> = {
    checkConnectionOperation: "Tool_JellyfinServerCheckConnection",
    syncInfoOperation: "Tool_JellyfinActorInfoSync",
    syncPhotoOperation: "Tool_JellyfinActorPhotoSync",
    ensureReady: ensureJellyfinReady,
    parseMode: parseJellyfinMode,
    checkConnection: checkJellyfinConnection,
    errorType: JellyfinServiceError,
    infoService: jellyfinActorInfoService,
    photoService: jellyfinActorPhotoService,
  };

  const embyHandlers: MediaServerHandlerOptions<EmbyConnectionCheckResult> = {
    checkConnectionOperation: "Tool_EmbyServerCheckConnection",
    syncInfoOperation: "Tool_EmbyActorInfoSync",
    syncPhotoOperation: "Tool_EmbyActorPhotoSync",
    ensureReady: ensureEmbyReady,
    parseMode: parseEmbyMode,
    checkConnection: checkEmbyConnection,
    errorType: EmbyServiceError,
    infoService: embyActorInfoService,
    photoService: embyActorPhotoService,
  };

  return {
    [IpcChannel.Tool_JellyfinServerCheckConnection]: createMediaServerCheckConnectionHandler(jellyfinHandlers),
    [IpcChannel.Tool_JellyfinActorPhotoSync]: createMediaServerSyncHandler(
      jellyfinHandlers.syncPhotoOperation,
      jellyfinHandlers,
      jellyfinHandlers.photoService,
      { includeActorPhotoFolderError: true },
    ),
    [IpcChannel.Tool_JellyfinActorInfoSync]: createMediaServerSyncHandler(
      jellyfinHandlers.syncInfoOperation,
      jellyfinHandlers,
      jellyfinHandlers.infoService,
    ),
    [IpcChannel.Tool_EmbyServerCheckConnection]: createMediaServerCheckConnectionHandler(embyHandlers),
    [IpcChannel.Tool_EmbyActorPhotoSync]: createMediaServerSyncHandler(
      embyHandlers.syncPhotoOperation,
      embyHandlers,
      embyHandlers.photoService,
      { includeActorPhotoFolderError: true },
    ),
    [IpcChannel.Tool_EmbyActorInfoSync]: createMediaServerSyncHandler(
      embyHandlers.syncInfoOperation,
      embyHandlers,
      embyHandlers.infoService,
    ),
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
      .input<{ items?: Array<{ nfoPath: string; amazonPosterUrl: string }> }>()
      .action(async ({ input }) => {
        try {
          return {
            results: await amazonPosterToolService.apply(input?.items ?? []),
          };
        } catch (error) {
          return raiseHandlerError("Tool_AmazonPosterApply", error);
        }
      }),
    [IpcChannel.Tool_BatchTranslateScan]: t.procedure.input<{ directory?: string }>().action(async ({ input }) => {
      try {
        const directory = input?.directory?.trim();
        if (!directory) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Directory is required");
        }

        const configuration = await configManager.getValidated();
        return {
          items: await batchTranslateToolService.scan(directory, configuration),
        };
      } catch (error) {
        return raiseHandlerError("Tool_BatchTranslateScan", error);
      }
    }),
    [IpcChannel.Tool_BatchTranslateApply]: t.procedure
      .input<{ items?: BatchTranslateScanItem[] }>()
      .action(async ({ input }) => {
        try {
          const items = input?.items ?? [];
          if (items.length === 0) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "At least one item is required");
          }

          const configuration = await configManager.getValidated();
          return {
            results: await batchTranslateToolService.apply(items, configuration),
          };
        } catch (error) {
          return raiseHandlerError("Tool_BatchTranslateApply", error);
        }
      }),
    [IpcChannel.Tool_ToggleDevTools]: t.procedure.action(async () => {
      windowService.toggleDevTools();
      return { success: true as const };
    }),
  };
};
