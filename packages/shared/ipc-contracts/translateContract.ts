import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure, TranslateTestInput } from "../ipcTypes";
import type { TranslateTestResponse } from "../serverDtos";

export type TranslateIpcContract = {
  [IpcChannel.Translate_Test]: IpcProcedure<TranslateTestInput, TranslateTestResponse>;
};
