import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { NormalizedCropRegion } from "../posterCrop";
import type { CrawlerData, MediaCandidate } from "../types";

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
  [IpcChannel.File_ListMediaCandidates]: IpcProcedure<
    { dirPath?: string; excludeDirPaths?: string[] },
    {
      candidates: MediaCandidate[];
      supportedExtensions: string[];
    }
  >;
  [IpcChannel.File_Exists]: IpcProcedure<{ path?: string }, { exists: boolean }>;
  [IpcChannel.File_Browse]: IpcProcedure<
    { type?: "file" | "directory"; filters?: Array<{ name: string; extensions: string[] }> },
    { paths: string[] | null }
  >;
  [IpcChannel.File_Delete]: IpcProcedure<{ filePaths?: string[] }, { deletedCount: number; failedCount: number }>;
  [IpcChannel.File_NfoRead]: IpcProcedure<
    { nfoPath?: string; videoPath?: string },
    { data: CrawlerData; nfoPath: string }
  >;
  [IpcChannel.File_NfoWrite]: IpcProcedure<
    { nfoPath?: string; videoPath?: string; data?: CrawlerData },
    { success: true; nfoPath: string }
  >;
  [IpcChannel.File_PosterCropSession]: IpcProcedure<
    { videoPath?: string },
    {
      sourcePath: string;
      targetPath: string;
      width: number;
      height: number;
      initialCrop: NormalizedCropRegion;
    }
  >;
  [IpcChannel.File_PosterCropSave]: IpcProcedure<
    { videoPath?: string; crop?: NormalizedCropRegion },
    {
      sourcePath: string;
      targetPath: string;
      width: number;
      height: number;
      initialCrop: NormalizedCropRegion;
      revision: string;
    }
  >;
};
