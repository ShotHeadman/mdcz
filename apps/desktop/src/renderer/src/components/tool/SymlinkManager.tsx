import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { SymlinkManagerDetail, type ToolRunState } from "@mdcz/views/tools";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { browseDirectoryPath } from "./toolUtils";

export function SymlinkManager() {
  const t = useT();
  const navigate = useNavigate();
  const [state, setState] = useState<ToolRunState | undefined>();
  const createSymlinkMut = useMutation({
    mutationFn: ipc.tool.createSymlink,
  });

  return (
    <SymlinkManagerDetail
      state={{ ...state, pending: createSymlinkMut.isPending }}
      onBrowseSourceDir={browseDirectoryPath}
      onBrowseDestDir={browseDirectoryPath}
      onRun={async ({ sourceDir, destDir, copyFiles }) => {
        if (!sourceDir.trim() || !destDir.trim()) {
          toast.error(t.desktop.enterSourceAndDest);
          setState({ error: t.desktop.enterSourceAndDest });
          return;
        }

        toast.info(t.desktop.startingSymlinkTask);
        setState({ pending: true, message: t.desktop.startingSymlinkTask });
        try {
          await createSymlinkMut.mutateAsync({ sourceDir: sourceDir.trim(), destDir: destDir.trim(), copyFiles });
          const message = t.tools.symlinkStarted;
          toast.success(message);
          setState({ message });
          window.setTimeout(() => navigate({ to: "/logs" }), 1000);
        } catch (error) {
          const message = t.desktop.symlinkTaskStartFailed(toErrorMessage(error));
          toast.error(message);
          setState({ error: message });
        }
      }}
    />
  );
}
