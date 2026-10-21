import { toErrorMessage } from "@mdcz/shared/error";
import type { LocalFileTarget } from "@mdcz/shared/mediaRef";
import { getT } from "@mdcz/views/i18n";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

export const playMediaPath = async (path: LocalFileTarget): Promise<void> => {
  try {
    await ipc.app.playMedia(path);
  } catch (error) {
    toast.error(toErrorMessage(error, getT().desktop.playbackFailed));
  }
};
