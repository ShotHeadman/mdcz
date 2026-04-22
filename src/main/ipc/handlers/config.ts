import { extname } from "node:path";
import type { ServiceContainer } from "@main/container";
import {
  type Configuration,
  ConfigValidationError,
  configManager,
  configurationSchema,
  type DeepPartial,
} from "@main/services/config";
import { fileOrganizer } from "@main/services/scraper/FileOrganizer";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { dialog } from "electron";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

export const createConfigHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Config_Get
  | typeof IpcChannel.Config_Save
  | typeof IpcChannel.Config_List
  | typeof IpcChannel.Config_Reset
  | typeof IpcChannel.Config_PreviewNaming
  | typeof IpcChannel.Config_ListProfiles
  | typeof IpcChannel.Config_CreateProfile
  | typeof IpcChannel.Config_SwitchProfile
  | typeof IpcChannel.Config_DeleteProfile
  | typeof IpcChannel.Config_ExportProfile
  | typeof IpcChannel.Config_ImportProfile
> => {
  const { windowService } = context;

  return {
    [IpcChannel.Config_Get]: t.procedure.input<{ path?: string }>().action(async ({ input }) => {
      try {
        if (!input?.path) {
          return await configManager.getValidated();
        }

        const value = await configManager.get(input.path);
        if (value === undefined) {
          throw createIpcError(IpcErrorCode.CONFIG_VALIDATION_ERROR, `Config path not found: ${input.path}`);
        }
        return value;
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Config_Save]: t.procedure.input<{ config?: DeepPartial<Configuration> }>().action(async ({ input }) => {
      try {
        await configManager.save(input?.config ?? {});
        return { success: true as const };
      } catch (error) {
        if (error instanceof ConfigValidationError) {
          throw asSerializableIpcError(
            createIpcError(IpcErrorCode.CONFIG_VALIDATION_ERROR, error.message, {
              fields: error.fields,
              fieldErrors: error.fieldErrors,
            }),
          );
        }
        throw asSerializableIpcError(createIpcError(IpcErrorCode.CONFIG_SAVE_ERROR, toErrorMessage(error)));
      }
    }),
    [IpcChannel.Config_List]: t.procedure.action(async () => {
      try {
        await configManager.ensureLoaded();
        return configManager.list();
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Config_Reset]: t.procedure.input<{ path?: string }>().action(async ({ input }) => {
      try {
        await configManager.reset(input?.path);
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(createIpcError(IpcErrorCode.CONFIG_SAVE_ERROR, toErrorMessage(error)));
      }
    }),
    [IpcChannel.Config_PreviewNaming]: t.procedure
      .input<{ config?: DeepPartial<Configuration> }>()
      .action(async ({ input }) => {
        try {
          const config = configurationSchema.parse(input?.config ?? {});
          return {
            items: fileOrganizer.buildNamingPreview(config),
          };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
    [IpcChannel.Config_ListProfiles]: t.procedure.action(async () => {
      try {
        await configManager.ensureLoaded();
        return configManager.listProfiles();
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Config_CreateProfile]: t.procedure.input<{ name?: string }>().action(async ({ input }) => {
      try {
        const name = input?.name?.trim();
        if (!name) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Profile name is required");
        }
        await configManager.createProfile(name);
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Config_SwitchProfile]: t.procedure.input<{ name?: string }>().action(async ({ input }) => {
      try {
        const name = input?.name?.trim();
        if (!name) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Profile name is required");
        }
        await configManager.switchProfile(name);
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Config_DeleteProfile]: t.procedure.input<{ name?: string }>().action(async ({ input }) => {
      try {
        const name = input?.name?.trim();
        if (!name) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Profile name is required");
        }
        await configManager.deleteProfile(name);
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Config_ExportProfile]: t.procedure.input<{ name?: string }>().action(async ({ input }) => {
      try {
        const name = input?.name?.trim();
        if (!name) {
          throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Profile name is required");
        }

        const options = {
          defaultPath: `${name}.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        };
        const mainWindow = windowService.getMainWindow();
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options);

        if (result.canceled || !result.filePath) {
          return { canceled: true as const, filePath: null, profileName: name };
        }

        const filePath =
          extname(result.filePath).toLowerCase() === ".json" ? result.filePath : `${result.filePath}.json`;

        await configManager.exportProfile(name, filePath);

        return {
          canceled: false as const,
          filePath,
          profileName: name,
        };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Config_ImportProfile]: t.procedure
      .input<{ filePath?: string; name?: string; overwrite?: boolean }>()
      .action(async ({ input }) => {
        try {
          const filePath = input?.filePath?.trim();
          const name = input?.name?.trim();
          if (!filePath) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Import file path is required");
          }
          if (!name) {
            throw createIpcError(IpcErrorCode.INVALID_ARGUMENT, "Profile name is required");
          }

          const result = await configManager.importProfile(filePath, name, Boolean(input?.overwrite));
          return {
            success: true as const,
            ...result,
          };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),
  };
};
