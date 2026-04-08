import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";

export type NetworkIpcContract = {
  [IpcChannel.Network_CheckCookies]: IpcProcedure<
    void,
    { results: Array<{ site: string; valid: boolean; message: string }> }
  >;
};
