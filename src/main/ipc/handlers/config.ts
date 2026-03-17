import { type Configuration, ConfigValidationError, configManager, type DeepPartial } from "@main/services/config";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import { createIpcError, IpcErrorCode } from "../errors";
import { asSerializableIpcError, t } from "../shared";

export const createConfigHandlers = (): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Config_Get
  | typeof IpcChannel.Config_Save
  | typeof IpcChannel.Config_List
  | typeof IpcChannel.Config_Reset
  | typeof IpcChannel.Config_ListProfiles
  | typeof IpcChannel.Config_CreateProfile
  | typeof IpcChannel.Config_SwitchProfile
  | typeof IpcChannel.Config_DeleteProfile
> => ({
  [IpcChannel.Config_Get]: t.procedure.input<{ path?: string }>().action(async ({ input }) => {
    try {
      await configManager.ensureLoaded();

      if (!input?.path) {
        return configManager.get();
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
});
