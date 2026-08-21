import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { LibraryDetailInput } from "../serverDtos";

export interface OverviewRecentAcquisitionItem {
  id: string;
  number: string;
  title: string | null;
  actors: string[];
  thumbnailPath: string | null;
  lastKnownPath: string | null;
  completedAt: number;
}

export interface OverviewOutputSummary {
  fileCount: number;
  totalBytes: number;
  scannedAt: number;
  rootPath: string | null;
}

export type OverviewIpcContract = {
  [IpcChannel.Overview_GetRecentAcquisitions]: IpcProcedure<void, { items: OverviewRecentAcquisitionItem[] }>;
  [IpcChannel.Overview_RemoveRecentAcquisition]: IpcProcedure<LibraryDetailInput, { success: true }>;
  [IpcChannel.Overview_GetOutputSummary]: IpcProcedure<void, OverviewOutputSummary>;
};
