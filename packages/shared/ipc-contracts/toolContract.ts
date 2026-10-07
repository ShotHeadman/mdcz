import { IpcChannel } from "../IpcChannel";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
  BatchTranslateApplyInput,
  BatchTranslateApplyResultItem,
  BatchTranslateMode,
  BatchTranslateScanItem,
  IpcProcedure,
  MediaServerConnectionCheckResult,
  PersonSyncResult,
} from "../ipcTypes";

export type ToolIpcContract = {
  [IpcChannel.Tool_AmazonPosterScan]: IpcProcedure<{ directory?: string }, { items: AmazonPosterScanItem[] }>;
  [IpcChannel.Tool_AmazonPosterLookup]: IpcProcedure<{ nfoPath?: string; title?: string }, AmazonPosterLookupResult>;
  [IpcChannel.Tool_AmazonPosterApply]: IpcProcedure<
    { items?: Array<{ nfoPath: string; amazonPosterUrl: string }> },
    { results: AmazonPosterApplyResultItem[] }
  >;
  [IpcChannel.Tool_BatchTranslateScan]: IpcProcedure<
    { directory?: string; mode: BatchTranslateMode },
    { items: BatchTranslateScanItem[] }
  >;
  [IpcChannel.Tool_BatchTranslateApply]: IpcProcedure<
    BatchTranslateApplyInput,
    { results: BatchTranslateApplyResultItem[] }
  >;
  [IpcChannel.Tool_CreateSymlink]: IpcProcedure<
    {
      sourceDir?: string;
      destDir?: string;
      copyFiles?: boolean;
    },
    void
  >;
  [IpcChannel.Tool_JellyfinServerCheckConnection]: IpcProcedure<void, MediaServerConnectionCheckResult>;
  [IpcChannel.Tool_JellyfinActorPhotoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_JellyfinActorInfoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_EmbyServerCheckConnection]: IpcProcedure<void, MediaServerConnectionCheckResult>;
  [IpcChannel.Tool_EmbyActorPhotoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_EmbyActorInfoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_ToggleDevTools]: IpcProcedure<void, { success: true }>;
};
