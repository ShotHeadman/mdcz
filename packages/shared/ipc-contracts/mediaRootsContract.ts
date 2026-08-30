import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { MediaRootEnsurePathInput, MediaRootEnsurePathResponse } from "../serverDtos";

export type MediaRootsIpcContract = {
  [IpcChannel.MediaRoots_EnsurePath]: IpcProcedure<MediaRootEnsurePathInput, MediaRootEnsurePathResponse>;
  [IpcChannel.MediaRoots_PrepareOutputDirectory]: IpcProcedure<MediaRootEnsurePathInput, MediaRootEnsurePathResponse>;
};
