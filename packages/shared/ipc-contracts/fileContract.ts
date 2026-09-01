import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { LocalFileTarget, RootFileRef } from "../mediaRef";
import type { NormalizedCropRegion } from "../posterCrop";
import type { CrawlerData, MediaCandidate } from "../types";

export type FileIpcContract = {
  [IpcChannel.File_ListMediaCandidates]: IpcProcedure<
    { dirPath?: string; excludeDirPaths?: string[] },
    {
      candidates: MediaCandidate[];
      supportedExtensions: string[];
    }
  >;
  [IpcChannel.File_Exists]: IpcProcedure<{ path: LocalFileTarget }, { exists: boolean; url?: string }>;
  [IpcChannel.File_Browse]: IpcProcedure<
    { type?: "file" | "directory"; filters?: Array<{ name: string; extensions: string[] }> },
    { paths: string[] | null }
  >;
  [IpcChannel.File_Delete]: IpcProcedure<
    { targets: RootFileRef[]; containingFolder?: boolean },
    { deletedCount: number; failedCount: number }
  >;
  [IpcChannel.File_NfoRead]: IpcProcedure<
    { nfoPath: LocalFileTarget; videoPath?: LocalFileTarget },
    { data: CrawlerData; nfoPath: string }
  >;
  [IpcChannel.File_NfoWrite]: IpcProcedure<
    { nfoPath: LocalFileTarget; videoPath?: LocalFileTarget; data?: CrawlerData },
    { success: true; nfoPath: string }
  >;
  [IpcChannel.File_PosterCropSession]: IpcProcedure<
    { videoPath: LocalFileTarget },
    {
      sourcePath: string;
      targetPath: string;
      width: number;
      height: number;
      initialCrop: NormalizedCropRegion;
    }
  >;
  [IpcChannel.File_PosterCropSave]: IpcProcedure<
    { videoPath: LocalFileTarget; crop?: NormalizedCropRegion },
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
