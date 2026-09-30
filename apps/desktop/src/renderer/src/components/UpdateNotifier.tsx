import { useT } from "@mdcz/views/i18n";
import { useEffect } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

const UPDATE_TOAST_ID = "app-update";

export function UpdateNotifier() {
  const t = useT();

  useEffect(
    () =>
      ipc.on.updateStatus((status) => {
        if (status.phase === "available") {
          const { manualDownloadUrl } = status;
          toast.info(t.desktop.updateAvailable(status.version), {
            id: UPDATE_TOAST_ID,
            duration: Number.POSITIVE_INFINITY,
            action: manualDownloadUrl
              ? { label: t.desktop.updateOpenDownload, onClick: () => void ipc.app.openExternal(manualDownloadUrl) }
              : { label: t.desktop.updateDownload, onClick: () => void ipc.app.downloadUpdate() },
          });
        }
        if (status.phase === "downloaded") {
          toast.success(t.desktop.updateDownloaded(status.version), {
            id: UPDATE_TOAST_ID,
            duration: Number.POSITIVE_INFINITY,
            action: { label: t.desktop.updateInstall, onClick: () => void ipc.app.installUpdate() },
          });
        }
      }),
    [t],
  );

  return null;
}
