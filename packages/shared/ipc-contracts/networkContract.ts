import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { NetworkCookieCheckStatus } from "../serverDtos";

export type NetworkIpcContract = {
  [IpcChannel.Network_CheckCookies]: IpcProcedure<
    void,
    { results: Array<{ site: string; valid: boolean; message: string; status: NetworkCookieCheckStatus }> }
  >;
};
