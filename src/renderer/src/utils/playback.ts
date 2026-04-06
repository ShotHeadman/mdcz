import { toast } from "sonner";
import { ipc } from "@/client/ipc";

const toErrorMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallbackMessage;
};

export const playMediaPath = async (
  path: string,
  unavailableMessage = "播放功能仅在桌面模式下可用",
  fallbackErrorMessage = "播放失败",
): Promise<void> => {
  if (!window.api) {
    toast.info(unavailableMessage);
    return;
  }

  try {
    await ipc.app.playMedia(path);
  } catch (error) {
    toast.error(toErrorMessage(error, fallbackErrorMessage));
  }
};
