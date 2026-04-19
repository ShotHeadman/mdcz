import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";

export interface DashboardRecentAcquisitionItem {
  number: string;
  title: string | null;
  actors: string[];
  thumbnailPath: string | null;
  lastKnownPath: string | null;
  completedAt: number;
}

export interface DashboardOutputSummary {
  fileCount: number;
  totalBytes: number;
  scannedAt: number;
  rootPath: string | null;
}

export type DashboardIpcContract = {
  [IpcChannel.Dashboard_GetRecentAcquisitions]: IpcProcedure<void, { items: DashboardRecentAcquisitionItem[] }>;
  [IpcChannel.Dashboard_GetOutputSummary]: IpcProcedure<void, DashboardOutputSummary>;
};
