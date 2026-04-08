import { IpcChannel } from "../IpcChannel";
import type {
  AmazonPosterApplyResultItem,
  AmazonPosterLookupResult,
  AmazonPosterScanItem,
  EmbyConnectionCheckResult,
  IpcProcedure,
  JellyfinConnectionCheckResult,
  PersonSyncResult,
} from "../ipcTypes";

export type ToolIpcContract = {
  [IpcChannel.Tool_AmazonPosterScan]: IpcProcedure<{ directory?: string }, { items: AmazonPosterScanItem[] }>;
  [IpcChannel.Tool_AmazonPosterLookup]: IpcProcedure<{ nfoPath?: string; title?: string }, AmazonPosterLookupResult>;
  [IpcChannel.Tool_AmazonPosterApply]: IpcProcedure<
    { items?: Array<{ directory: string; amazonPosterUrl: string }> },
    { results: AmazonPosterApplyResultItem[] }
  >;
  [IpcChannel.Tool_CreateSymlink]: IpcProcedure<
    {
      sourceDir?: string;
      source_dir?: string;
      destDir?: string;
      dest_dir?: string;
      copyFiles?: boolean;
      copy_files?: boolean;
    },
    { message: string }
  >;
  [IpcChannel.Tool_JellyfinServerCheckConnection]: IpcProcedure<void, JellyfinConnectionCheckResult>;
  [IpcChannel.Tool_JellyfinActorPhotoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_JellyfinActorInfoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_EmbyServerCheckConnection]: IpcProcedure<void, EmbyConnectionCheckResult>;
  [IpcChannel.Tool_EmbyActorPhotoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_EmbyActorInfoSync]: IpcProcedure<{ mode?: "all" | "missing" }, PersonSyncResult>;
  [IpcChannel.Tool_ToggleDevTools]: IpcProcedure<void, { success: true }>;
};
