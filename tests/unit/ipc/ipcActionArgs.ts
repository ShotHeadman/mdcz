import type { IpcActionContext } from "@mdcz/shared/ipcTypes";

const allowedSenderUrl = (): string => {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    return new URL("/", rendererUrl).href;
  }
  return "file:///renderer/index.html";
};

export const allowedIpcContext: IpcActionContext = {
  sender: {} as never,
  senderFrame: { url: allowedSenderUrl() },
};

export const ipcActionArgs = <TInput>(input: TInput) => ({
  context: allowedIpcContext,
  input,
});
