import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import type { LocalScanEntry, MaintenancePresetId } from "@shared/types";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:maintenance");

export const createMaintenanceHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Maintenance_Scan
  | typeof IpcChannel.Maintenance_Execute
  | typeof IpcChannel.Maintenance_Stop
  | typeof IpcChannel.Maintenance_GetStatus
> => {
  const { maintenanceService } = context;

  return {
    [IpcChannel.Maintenance_Scan]: t.procedure.input<{ dirPath?: string }>().action(async ({ input }) => {
      try {
        const dirPath = input?.dirPath?.trim();
        if (!dirPath) {
          throw new Error("dirPath is required");
        }
        const entries = await maintenanceService.scan(dirPath);
        return { entries };
      } catch (error) {
        logger.error(`Maintenance scan failed: ${error instanceof Error ? error.message : String(error)}`);
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Execute]: t.procedure
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

          // Run execution in background — don't await
          void maintenanceService.execute(entries, presetId);

          return { success: true as const };
        } catch (error) {
          logger.error(`Maintenance execute failed: ${error instanceof Error ? error.message : String(error)}`);
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

    [IpcChannel.Maintenance_GetStatus]: t.procedure.action(async () => {
      return maintenanceService.getStatus();
    }),
  };
};
