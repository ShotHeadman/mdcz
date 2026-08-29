import type { IpcActionContext } from "@mdcz/shared/ipcTypes";
import { isTrustedRendererUrl } from "../rendererTrust";
import { createIpcError } from "./errors";

const forbiddenSender = () => createIpcError("FORBIDDEN", "IPC sender origin is not allowed");

export const isAllowedIpcSenderUrl = isTrustedRendererUrl;

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
