import { toErrorMessage } from "@mdcz/shared/error";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileSearch, FolderOpen } from "lucide-react";
import { useState } from "react";
import { scrapeSingleFile } from "@/client/api";
import { chooseScrapeFilePath } from "@/client/scrapeFilePath";
import type { ScrapeFileBody } from "@/client/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { ToolPanel } from "./ToolPanel";
import {
  TOOL_ICON_BUTTON_CLASS,
  TOOL_INPUT_CLASS,
  TOOL_NOTE_CLASS,
  TOOL_PRIMARY_BUTTON_CLASS,
  TOOL_SUBSECTION_CLASS,
} from "./toolStyles";

export function SingleFileScraper() {
  const navigate = useNavigate();
  const { showError, showInfo, showSuccess } = useToast();
  const [singleFilePath, setSingleFilePath] = useState("");
  const scrapeSingleFileMut = useMutation({
    mutationFn: async (body: ScrapeFileBody) => scrapeSingleFile({ body, throwOnError: true }),
  });

  const handleScrapeSingleFile = async () => {
    const targetPath = singleFilePath.trim();
    if (!targetPath) {
      showError("请输入文件路径");
      return;
    }

    showInfo("正在启动单文件刮削任务...");
    try {
      const result = await scrapeSingleFileMut.mutateAsync({ path: targetPath });
      showSuccess(result.data.message);
      window.setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(`单文件刮削任务启动失败: ${toErrorMessage(error)}`);
    }
  };

  const handleBrowseSingleFile = async () => {
    try {
      const selectedPath = await chooseScrapeFilePath();
      if (selectedPath) {
        setSingleFilePath(selectedPath);
      }
    } catch (error) {
      showError(`文件选择失败: ${toErrorMessage(error)}`);
    }
  };

  return (
    <ToolPanel toolId="single-file-scraper" icon={<FileSearch className="h-5 w-5" />}>
      <div className={TOOL_SUBSECTION_CLASS}>
        <Label
          htmlFor="filePath"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          文件路径
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="filePath"
            value={singleFilePath}
            onChange={(event) => setSingleFilePath(event.target.value)}
            placeholder="/path/to/video.mp4"
            className={cn(TOOL_INPUT_CLASS, "flex-1")}
          />
          <Button type="button" variant="secondary" onClick={handleBrowseSingleFile} className={TOOL_ICON_BUTTON_CLASS}>
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
        <p className={TOOL_NOTE_CLASS}>适合针对单个失败样本重试，任务启动后会自动跳转到日志页面。</p>
      </div>

      <Button
        onClick={handleScrapeSingleFile}
        disabled={scrapeSingleFileMut.isPending}
        className={cn(TOOL_PRIMARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        {scrapeSingleFileMut.isPending ? "正在刮削..." : "开始单文件刮削"}
      </Button>
    </ToolPanel>
  );
}
