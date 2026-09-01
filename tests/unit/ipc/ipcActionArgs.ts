import { pathToFileURL } from "node:url";
import { resolvePackagedRendererPath } from "@main/rendererTrust";
import type { IpcActionContext } from "@mdcz/shared/ipcTypes";

const allowedSenderUrl = (): string => {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    return new URL("/", rendererUrl).href;
  }
  return pathToFileURL(resolvePackagedRendererPath()).href;
};

export const allowedIpcContext: IpcActionContext = {
  sender: {} as never,
  senderFrame: { url: allowedSenderUrl() },
};

export const ipcActionArgs = <TInput>(input: TInput) => ({
  context: allowedIpcContext,
  input,
});
