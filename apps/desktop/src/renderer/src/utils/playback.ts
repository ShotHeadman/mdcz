import { toErrorMessage } from "@mdcz/shared/error";
import type { LocalFileTarget } from "@mdcz/shared/mediaRef";
import { getT } from "@mdcz/views/i18n";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

export const playMediaPath = async (
  path: LocalFileTarget,
  unavailableMessage = getT().desktop.playbackOnlyOnDesktop,
  fallbackErrorMessage = getT().desktop.playbackFailed,
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
