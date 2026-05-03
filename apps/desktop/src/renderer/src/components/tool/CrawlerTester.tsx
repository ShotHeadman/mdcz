import type { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import { CrawlerTesterDetail, type CrawlerTesterDetailProps, type ToolRunState } from "@mdcz/views/tools";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ipc } from "@/client/ipc";
import { useToast } from "@/contexts/ToastProvider";

type CrawlerSiteOption = NonNullable<CrawlerTesterDetailProps["siteOptions"]>[number];
type CrawlerTestResult = NonNullable<CrawlerTesterDetailProps["result"]>;

export function CrawlerTester() {
  const { showError, showSuccess } = useToast();
  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as { sites: CrawlerSiteOption[] };
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
      showError("请选择站点");
      return;
    }
    if (!number.trim()) {
      showError("请输入番号");
      return;
    }

    setCrawlerTesting(true);
    setCrawlerTestResult(null);
    try {
      const result = await ipc.crawler.test(site as Website, number.trim());
      setCrawlerTestResult(result);
      if (result.data) {
        showSuccess(`测试成功，耗时 ${(result.elapsed / 1000).toFixed(1)}s`);
      } else {
        showError(result.error ?? "未获取到数据");
      }
    } catch (error) {
      showError(`爬虫测试失败: ${toErrorMessage(error)}`);
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
