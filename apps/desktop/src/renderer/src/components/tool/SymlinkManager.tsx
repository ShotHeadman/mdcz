import { toErrorMessage } from "@mdcz/shared/error";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, Link2 } from "lucide-react";
import { useState } from "react";
import { createSymlink } from "@/client/api";
import type { CreateSoftlinksBody } from "@/client/types";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { ToolPanel } from "./ToolPanel";
import {
  TOOL_ICON_BUTTON_CLASS,
  TOOL_INPUT_CLASS,
  TOOL_SECONDARY_BUTTON_CLASS,
  TOOL_SUBSECTION_CLASS,
} from "./toolStyles";
import { browseDirectoryPath } from "./toolUtils";

export function SymlinkManager() {
  const navigate = useNavigate();
  const { showError, showInfo, showSuccess } = useToast();
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [copyFiles, setCopyFiles] = useState(false);
  const createSymlinkMut = useMutation({
    mutationFn: async (body: CreateSoftlinksBody) => createSymlink({ body, throwOnError: true }),
  });

  const handleChooseSourceDir = async () => {
    try {
      const selectedPath = await browseDirectoryPath();
      if (selectedPath) {
        setSourceDir(selectedPath);
      }
    } catch (error) {
      showError(`源目录选择失败: ${toErrorMessage(error)}`);
    }
  };

  const handleChooseDestDir = async () => {
    try {
      const selectedPath = await browseDirectoryPath();
      if (selectedPath) {
        setDestDir(selectedPath);
      }
    } catch (error) {
      showError(`目标目录选择失败: ${toErrorMessage(error)}`);
    }
  };

  const handleCreateSymlink = async () => {
    if (!sourceDir.trim() || !destDir.trim()) {
      showError("请输入源目录和目标目录");
      return;
    }

    showInfo("正在启动软链接创建任务...");
    try {
      const result = await createSymlinkMut.mutateAsync({
        source_dir: sourceDir.trim(),
        dest_dir: destDir.trim(),
        copy_files: copyFiles,
      });
      showSuccess(result.data.message);
      window.setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`软链接创建任务启动失败: ${toErrorMessage(error)}`);
    }
  };

  return (
    <ToolPanel toolId="symlink-manager" icon={<Link2 className="h-5 w-5" />}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={TOOL_SUBSECTION_CLASS}>
          <Label
            htmlFor="sourceDir"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            源目录
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="sourceDir"
              value={sourceDir}
              onChange={(event) => setSourceDir(event.target.value)}
              className={cn(TOOL_INPUT_CLASS, "flex-1")}
              placeholder="原始视频存放目录"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className={TOOL_ICON_BUTTON_CLASS}
              onClick={handleChooseSourceDir}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className={TOOL_SUBSECTION_CLASS}>
          <Label
            htmlFor="destDir"
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
          >
            目标目录
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="destDir"
              value={destDir}
              onChange={(event) => setDestDir(event.target.value)}
              className={cn(TOOL_INPUT_CLASS, "flex-1")}
              placeholder="软链接存放目录"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className={TOOL_ICON_BUTTON_CLASS}
              onClick={handleChooseDestDir}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-quiet-lg bg-surface-low/90 p-4">
        <Checkbox id="copyFiles" checked={copyFiles} onCheckedChange={(checked) => setCopyFiles(Boolean(checked))} />
        <Label htmlFor="copyFiles" className="cursor-pointer text-sm leading-6">
          同时同步 NFO、图片及字幕等附属文件
        </Label>
      </div>

      <Button
        variant="secondary"
        onClick={handleCreateSymlink}
        disabled={createSymlinkMut.isPending}
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        {createSymlinkMut.isPending ? "正在处理..." : "立即建立映射"}
      </Button>
    </ToolPanel>
  );
}
