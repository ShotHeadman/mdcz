import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type { NetworkCheckCookiesResponse } from "../serverDtos";

export type NetworkIpcContract = {
  [IpcChannel.Network_CheckCookies]: IpcProcedure<void, NetworkCheckCookiesResponse>;
};
