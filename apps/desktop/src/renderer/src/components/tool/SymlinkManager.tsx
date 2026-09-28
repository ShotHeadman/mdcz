import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { SymlinkManagerDetail, type ToolRunState } from "@mdcz/views/tools";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createSymlink } from "@/client/api";
import type { CreateSoftlinksBody } from "@/client/types";
import { useToast } from "@/contexts/ToastProvider";
import { browseDirectoryPath } from "./toolUtils";

export function SymlinkManager() {
  const t = useT();
  const navigate = useNavigate();
  const { showError, showInfo, showSuccess } = useToast();
  const [state, setState] = useState<ToolRunState | undefined>();
  const createSymlinkMut = useMutation({
    mutationFn: async (body: CreateSoftlinksBody) => createSymlink({ body, throwOnError: true }),
  });

  return (
    <SymlinkManagerDetail
      state={{ ...state, pending: createSymlinkMut.isPending }}
      onBrowseSourceDir={browseDirectoryPath}
      onBrowseDestDir={browseDirectoryPath}
      onRun={async ({ sourceDir, destDir, copyFiles }) => {
        if (!sourceDir.trim() || !destDir.trim()) {
          showError(t.desktop.enterSourceAndDest);
          setState({ error: t.desktop.enterSourceAndDest });
          return;
        }

        showInfo(t.desktop.startingSymlinkTask);
        setState({ pending: true, message: t.desktop.startingSymlinkTask });
        try {
          await createSymlinkMut.mutateAsync({
            source_dir: sourceDir.trim(),
            dest_dir: destDir.trim(),
            copy_files: copyFiles,
          });
          const message = t.tools.symlinkStarted;
          showSuccess(message);
          setState({ message });
          window.setTimeout(() => navigate({ to: "/logs" }), 1000);
        } catch (error) {
          const message = t.desktop.symlinkTaskStartFailed(toErrorMessage(error));
          showError(message);
          setState({ error: message });
        }
      }}
    />
  );
}
