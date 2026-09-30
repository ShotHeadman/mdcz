import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { SingleFilePathScraperDetail } from "@mdcz/views/tools";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { scrapeSingleFile } from "@/client/api";
import { chooseScrapeFilePath } from "@/client/scrapeFilePath";
import type { ScrapeFileBody } from "@/client/types";
import { useToast } from "@/contexts/ToastProvider";

export function SingleFileScraper() {
  const t = useT();
  const navigate = useNavigate();
  const { showError, showInfo, showSuccess } = useToast();
  const scrapeSingleFileMut = useMutation({
    mutationFn: async (body: ScrapeFileBody) => scrapeSingleFile({ body, throwOnError: true }),
  });

  const handleScrapeSingleFile = async (path: string) => {
    const targetPath = path.trim();
    if (!targetPath) {
      showError(t.desktop.enterFilePath);
      return;
    }

    showInfo(t.desktop.startingSingleScrape);
    try {
      await scrapeSingleFileMut.mutateAsync({ path: targetPath });
      showSuccess(t.scrape.launch.singleFile);
      window.setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      showError(t.desktop.singleScrapeStartFailed(toErrorMessage(error)));
    }
  };

  const handleBrowseSingleFile = async () => {
    try {
      return await chooseScrapeFilePath();
    } catch (error) {
      showError(t.desktop.fileSelectFailed(toErrorMessage(error)));
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
