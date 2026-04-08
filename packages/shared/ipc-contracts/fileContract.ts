import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { CrawlerData } from "../types";

export type FileIpcContract = {
  [IpcChannel.File_ListEntries]: IpcProcedure<
    { dirPath?: string },
    {
      entries: Array<{
        type: "file" | "directory";
        path: string;
        name: string;
        size?: number;
        lastModified?: string | null;
      }>;
    }
  >;
  [IpcChannel.File_Exists]: IpcProcedure<{ path?: string }, { exists: boolean }>;
  [IpcChannel.File_Browse]: IpcProcedure<
    { type?: "file" | "directory"; filters?: Array<{ name: string; extensions: string[] }> },
    { paths: string[] | null }
  >;
  [IpcChannel.File_Delete]: IpcProcedure<{ filePaths?: string[] }, { deletedCount: number; failedCount: number }>;
  [IpcChannel.File_NfoRead]: IpcProcedure<{ nfoPath?: string }, { data: CrawlerData }>;
  [IpcChannel.File_NfoWrite]: IpcProcedure<{ nfoPath?: string; data?: CrawlerData }, { success: true }>;
};
