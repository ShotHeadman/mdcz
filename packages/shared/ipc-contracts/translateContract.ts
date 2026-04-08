import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure, TranslateTestLlmInput } from "../ipcTypes";

export type TranslateIpcContract = {
  [IpcChannel.Translate_TestLlm]: IpcProcedure<TranslateTestLlmInput, { success: boolean; message: string }>;
};
