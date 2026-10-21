import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { SingleFilePathScraperDetail } from "@mdcz/views/tools";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";
import { chooseScrapeFilePath } from "@/client/scrapeFilePath";

export function SingleFileScraper() {
  const t = useT();
  const navigate = useNavigate();
  const scrapeSingleFileMut = useMutation({
    mutationFn: ipc.scraper.startSinglePath,
  });

  const handleScrapeSingleFile = async (path: string) => {
    const targetPath = path.trim();
    if (!targetPath) {
      toast.error(t.desktop.enterFilePath);
      return;
    }

    toast.info(t.desktop.startingSingleScrape);
    try {
      await scrapeSingleFileMut.mutateAsync(targetPath);
      toast.success(t.scrape.launch.singleFile);
      window.setTimeout(() => navigate({ to: "/logs" }), 1000);
    } catch (error) {
      toast.error(t.desktop.singleScrapeStartFailed(toErrorMessage(error)));
    }
  };

  const handleBrowseSingleFile = async () => {
    try {
      return await chooseScrapeFilePath();
    } catch (error) {
      toast.error(t.desktop.fileSelectFailed(toErrorMessage(error)));
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
