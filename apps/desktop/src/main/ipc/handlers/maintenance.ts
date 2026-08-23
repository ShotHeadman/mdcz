import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type { LocalScanEntry, MaintenanceApplyCommit, MaintenancePresetId } from "@mdcz/shared/types";
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
  | typeof IpcChannel.Maintenance_GetActiveSession
  | typeof IpcChannel.Maintenance_UpdateDraft
  | typeof IpcChannel.Maintenance_DiscardSession
> => {
  const { maintenanceService } = context;
  let activeTaskId: string | null = null;

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

          const handle = await maintenanceService.startPreview(entries, presetId);
          activeTaskId = handle.task.id;
          const batch = await handle.completion;
          return maintenanceService.toPreviewResult(batch);
        } catch (error) {
          logger.error("Maintenance preview failed");
          throw asSerializableIpcError(error);
        }
      }),

    [IpcChannel.Maintenance_Execute]: t.procedure
      .input<{ items?: MaintenanceApplyCommit[]; presetId?: MaintenancePresetId }>()
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

          const taskId = await maintenanceService.resolveActiveTaskId(activeTaskId ?? undefined);
          if (!taskId) throw new Error("没有活动的维护预览任务");
          activeTaskId = taskId;
          await maintenanceService.execute(taskId, items, presetId);

          return { success: true as const };
        } catch (error) {
          logger.error("Maintenance execute failed");
          throw asSerializableIpcError(error);
        }
      }),

    [IpcChannel.Maintenance_Stop]: t.procedure.action(async () => {
      try {
        const taskId = await maintenanceService.resolveActiveTaskId(activeTaskId ?? undefined);
        await maintenanceService.stop(taskId ?? undefined);
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Pause]: t.procedure.action(async () => {
      try {
        const taskId = await maintenanceService.resolveActiveTaskId(activeTaskId ?? undefined);
        await maintenanceService.pause(taskId ?? undefined);
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_Resume]: t.procedure.action(async () => {
      try {
        const taskId = await maintenanceService.resolveActiveTaskId(activeTaskId ?? undefined);
        await maintenanceService.resume(taskId ?? undefined);
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),

    [IpcChannel.Maintenance_GetStatus]: t.procedure.action(async () => {
      const taskId = await maintenanceService.resolveActiveTaskId(activeTaskId ?? undefined);
      return await maintenanceService.getStatus(taskId ?? undefined);
    }),

    [IpcChannel.Maintenance_GetActiveSession]: t.procedure.action(async () => {
      const session = await maintenanceService.getActiveSession();
      activeTaskId = session?.taskId ?? null;
      return session;
    }),

    [IpcChannel.Maintenance_UpdateDraft]: t.procedure
      .input<{
        previewId: string;
        fieldSelections?: Record<string, "old" | "new">;
        imageSelections?: Record<string, string>;
      }>()
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
        activeTaskId = null;
        return { success: true as const };
      } catch (error) {
        throw asSerializableIpcError(error);
      }
    }),
  };
};
