import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure, TranslateTestLlmInput } from "../ipcTypes";
import type { TranslateTestLlmResponse } from "../serverDtos";

export type TranslateIpcContract = {
  [IpcChannel.Translate_TestLlm]: IpcProcedure<TranslateTestLlmInput, TranslateTestLlmResponse>;
};
