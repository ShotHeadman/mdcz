import { toErrorMessage } from "@mdcz/shared/error";
import type { LocalFileTarget } from "@mdcz/shared/mediaRef";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

export const playMediaPath = async (
  path: LocalFileTarget,
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
