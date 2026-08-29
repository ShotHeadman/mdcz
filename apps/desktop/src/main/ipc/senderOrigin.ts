import type { IpcActionContext } from "@mdcz/shared/ipcTypes";
import { createIpcError } from "./errors";

const forbiddenSender = () => createIpcError("FORBIDDEN", "IPC sender origin is not allowed");

export const isAllowedIpcSenderUrl = (url: string, rendererUrl = process.env.ELECTRON_RENDERER_URL): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const configured = rendererUrl?.trim();
  if (configured) {
    try {
      return parsed.origin === new URL(configured).origin;
    } catch {
      return false;
    }
  }

  // Node serializes file: origins as "null". Allow the packaged renderer by protocol only.
  return parsed.protocol === "file:";
};

export const getSenderFrameUrl = (context: IpcActionContext): string | undefined => {
  const frameUrl = context.senderFrame?.url?.trim();
  if (frameUrl) {
    return frameUrl;
  }
  const mainFrameUrl = context.sender?.mainFrame?.url;
  return typeof mainFrameUrl === "string" ? mainFrameUrl : undefined;
};

export const assertAllowedIpcSender = (
  context: IpcActionContext,
  rendererUrl = process.env.ELECTRON_RENDERER_URL,
): void => {
  const url = getSenderFrameUrl(context);
  if (!url || !isAllowedIpcSenderUrl(url, rendererUrl)) {
    throw forbiddenSender();
  }
};
