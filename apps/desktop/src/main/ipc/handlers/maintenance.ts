import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type { LocalScanEntry, MaintenanceCommitItem, MaintenancePresetId } from "@mdcz/shared/types";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:maintenance");

export const createMaintenanceHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Maintenance_Scan
  | typeof IpcChannel.Maintenance_Preview
  | typeof IpcChannel.Maintenance_Execute
  | typeof IpcChannel.Maintenance_Stop
  | typeof IpcChannel.Maintenance_Pause
  | typeof IpcChannel.Maintenance_Resume
  | typeof IpcChannel.Maintenance_GetStatus
> => {
  const { maintenanceService } = context;

  return {
    [IpcChannel.Maintenance_Scan]: t.procedure
      .input<{ dirPath?: string; filePaths?: string[] }>()
      .action(async ({ input }) => {
        try {
          const filePaths = input?.filePaths?.map((filePath) => filePath.trim()).filter(Boolean) ?? [];
          if (filePaths.length > 0) {
            const entries = await maintenanceService.scanFiles(filePaths);
            return { entries };
          }

          const dirPath = input?.dirPath?.trim();
          if (!dirPath) {
            throw new Error("dirPath or filePaths is required");
          }
          const entries = await maintenanceService.scan(dirPath);
          return { entries };
        } catch (error) {
          logger.error("Maintenance scan failed");
          throw asSerializableIpcError(error);
        }
      }),

    [IpcChannel.Maintenance_Preview]: t.procedure
      .input<{ entries?: LocalScanEntry[]; presetId?: MaintenancePresetId }>()
      .action(async ({ input }) => {
        try {
          const entries = input?.entries;
          const presetId = input?.presetId;
          if (!entries || !Array.isArray(entries) || entries.length === 0) {
            throw new Error("entries is required and must be non-empty");
          }
          if (!presetId) {
            throw new Error("presetId is required");
          }

          return await maintenanceService.preview(entries, presetId);
        } catch (error) {
          logger.error("Maintenance preview failed");
          throw asSerializableIpcError(error);
        }
      }),

    [IpcChannel.Maintenance_Execute]: t.procedure
      .input<{ items?: MaintenanceCommitItem[]; presetId?: MaintenancePresetId }>()
      .action(async ({ input }) => {
        try {
          const items = input?.items;
          const presetId = input?.presetId;
          if (!items || !Array.isArray(items) || items.length === 0) {
            throw new Error("items is required and must be non-empty");
          }
          if (!presetId) {
            throw new Error("presetId is required");
          }

          await maintenanceService.execute(items, presetId);

          return { success: true as const };
        } catch (error) {
          logger.error("Maintenance execute failed");
          throw asSerializableIpcError(error);
        }
      }),

    [IpcChannel.Maintenance_Stop]: t.procedure.action(async () => {
      try {
        maintenanceService.stop();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Pause]: t.procedure.action(async () => {
      try {
        maintenanceService.pause();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Resume]: t.procedure.action(async () => {
      try {
        maintenanceService.resume();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_GetStatus]: t.procedure.action(async () => {
      return maintenanceService.getStatus();
    }),
  };
};
