import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type { MaintenanceApplySelection } from "@mdcz/shared/maintenanceTasks";
import {
  maintenanceApplyInputSchema,
  maintenanceStartPreviewInputSchema,
  maintenanceUpdateDraftInputSchema,
} from "../payloads";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:maintenance");

export const createMaintenanceHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Maintenance_StartPreview
  | typeof IpcChannel.Maintenance_Apply
  | typeof IpcChannel.Maintenance_Stop
  | typeof IpcChannel.Maintenance_Pause
  | typeof IpcChannel.Maintenance_Resume
  | typeof IpcChannel.Maintenance_ReadSnapshot
  | typeof IpcChannel.Maintenance_UpdateDraft
  | typeof IpcChannel.Maintenance_DiscardSession
> => {
  const { maintenanceService } = context;
  return {
    [IpcChannel.Maintenance_StartPreview]: t.procedure
      .input(maintenanceStartPreviewInputSchema)
      .action(async ({ input }) => {
        try {
          const refs = input?.refs;
          const presetId = input?.presetId;
          if (!refs || !Array.isArray(refs) || refs.length === 0) {
            throw new Error("refs is required and must be non-empty");
          }
          if (!presetId) {
            throw new Error("presetId is required");
          }

          const handle = await maintenanceService.startPreview(refs, presetId);
          void handle.completion.catch(() => undefined);
          return { sessionId: handle.session.id, snapshot: handle.session };
        } catch (error) {
          logger.error("Maintenance preview failed");
          throw asSerializableIpcError(error);
        }
      }),

    [IpcChannel.Maintenance_Apply]: t.procedure.input(maintenanceApplyInputSchema).action(async ({ input }) => {
      try {
        const selections = input?.selections;
        const presetId = input?.presetId;
        if (!selections || !Array.isArray(selections) || selections.length === 0) {
          throw new Error("selections is required and must be non-empty");
        }
        if (!presetId) {
          throw new Error("presetId is required");
        }

        const handle = await maintenanceService.execute(selections as MaintenanceApplySelection[], presetId);

        return { sessionId: handle.session.id, snapshot: handle.session };
      } catch (error) {
        logger.error("Maintenance execute failed");
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Stop]: t.procedure.action(async () => {
      try {
        await maintenanceService.stop();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Pause]: t.procedure.action(async () => {
      try {
        await maintenanceService.pause();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Resume]: t.procedure.action(async () => {
      try {
        await maintenanceService.resume();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_ReadSnapshot]: t.procedure.action(async () => await maintenanceService.getActiveSession()),

    [IpcChannel.Maintenance_UpdateDraft]: t.procedure
      .input(maintenanceUpdateDraftInputSchema)
      .action(async ({ input }) => {
        try {
          await maintenanceService.updateDraft(input);
          return { success: true as const };
        } catch (error) {
          throw asSerializableIpcError(error);
        }
      }),

    [IpcChannel.Maintenance_DiscardSession]: t.procedure.action(async () => {
      try {
        await maintenanceService.discardSession();
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
  };
};
