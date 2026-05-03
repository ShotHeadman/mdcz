import { toErrorMessage } from "@mdcz/shared/error";
import { SingleFilePathScraperDetail } from "@mdcz/views/tools";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { scrapeSingleFile } from "@/client/api";
import { chooseScrapeFilePath } from "@/client/scrapeFilePath";
import type { ScrapeFileBody } from "@/client/types";
import { useToast } from "@/contexts/ToastProvider";

export function SingleFileScraper() {
  const navigate = useNavigate();
  const { showError, showInfo, showSuccess } = useToast();
  const scrapeSingleFileMut = useMutation({
    mutationFn: async (body: ScrapeFileBody) => scrapeSingleFile({ body, throwOnError: true }),
  });

  const handleScrapeSingleFile = async (path: string) => {
    const targetPath = path.trim();
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
      return await chooseScrapeFilePath();
    } catch (error) {
      showError(`文件选择失败: ${toErrorMessage(error)}`);
      return null;
    }
  };

  return (
    <SingleFilePathScraperDetail
      pending={scrapeSingleFileMut.isPending}
      onBrowseFile={handleBrowseSingleFile}
      onRun={handleScrapeSingleFile}
    />
  );
}
