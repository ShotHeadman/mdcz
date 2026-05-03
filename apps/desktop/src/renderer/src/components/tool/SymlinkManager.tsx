import { toErrorMessage } from "@mdcz/shared/error";
import { SymlinkManagerDetail, type ToolRunState } from "@mdcz/views/tools";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createSymlink } from "@/client/api";
import type { CreateSoftlinksBody } from "@/client/types";
import { useToast } from "@/contexts/ToastProvider";
import { browseDirectoryPath } from "./toolUtils";

export function SymlinkManager() {
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
          showError("请输入源目录和目标目录");
          setState({ error: "请输入源目录和目标目录" });
          return;
        }

        showInfo("正在启动软链接创建任务...");
        setState({ pending: true, message: "正在启动软链接创建任务..." });
        try {
          const result = await createSymlinkMut.mutateAsync({
            source_dir: sourceDir.trim(),
            dest_dir: destDir.trim(),
            copy_files: copyFiles,
          });
          showSuccess(result.data.message);
          setState({ message: result.data.message, data: result.data });
          window.setTimeout(() => navigate({ to: "/logs" }), 1000);
        } catch (error) {
          const message = `软链接创建任务启动失败: ${toErrorMessage(error)}`;
          showError(message);
          setState({ error: message });
        }
      }}
    />
  );
}
