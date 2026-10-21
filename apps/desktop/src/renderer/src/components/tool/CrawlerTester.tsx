import type { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import { useT } from "@mdcz/views/i18n";
import { CrawlerTesterDetail, type CrawlerTesterDetailProps, type ToolRunState } from "@mdcz/views/tools";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/client/ipc";

type CrawlerTestResult = NonNullable<CrawlerTesterDetailProps["result"]>;

export function CrawlerTester() {
  const t = useT();
  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = await ipc.crawler.listSites();
      return result.sites;
    },
  });
  const [crawlerTestResult, setCrawlerTestResult] = useState<CrawlerTestResult | null>(null);
  const [crawlerTesting, setCrawlerTesting] = useState(false);

  const state: ToolRunState = {
    pending: crawlerTesting,
    error: sitesQ.error ? toErrorMessage(sitesQ.error) : undefined,
  };

  const handleCrawlerTest: CrawlerTesterDetailProps["onRun"] = async ({ number, site }) => {
    if (!site) {
      toast.error(t.desktop.selectSite);
      return;
    }
    if (!number.trim()) {
      toast.error(t.desktop.enterMovieNumber);
      return;
    }

    setCrawlerTesting(true);
    setCrawlerTestResult(null);
    try {
      const result = await ipc.crawler.test(site as Website, number.trim());
      setCrawlerTestResult(result);
      if (result.data) {
        toast.success(t.desktop.testSucceededWithTime((result.elapsed / 1000).toFixed(1)));
      } else {
        toast.error(result.error ?? t.desktop.noDataRetrieved);
      }
    } catch (error) {
      toast.error(t.desktop.crawlerTestFailed(toErrorMessage(error)));
    } finally {
      setCrawlerTesting(false);
    }
  };

  return (
    <CrawlerTesterDetail
      result={crawlerTestResult}
      siteOptions={sitesQ.data ?? []}
      state={state}
      onRun={handleCrawlerTest}
    />
  );
}
