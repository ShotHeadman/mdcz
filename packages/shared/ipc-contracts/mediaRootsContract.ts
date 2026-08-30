import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { MediaRootDto, MediaRootEnsurePathInput } from "../serverDtos";

export type MediaRootsIpcContract = {
  [IpcChannel.MediaRoots_EnsurePath]: IpcProcedure<MediaRootEnsurePathInput, MediaRootDto>;
};
