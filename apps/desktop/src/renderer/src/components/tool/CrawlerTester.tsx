import type { Website } from "@mdcz/shared/enums";
import { toErrorMessage } from "@mdcz/shared/error";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { ipc } from "@/client/ipc";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { ToolPanel } from "./ToolPanel";
import {
  TOOL_INPUT_CLASS,
  TOOL_SECONDARY_BUTTON_CLASS,
  TOOL_SELECT_TRIGGER_CLASS,
  TOOL_SUBSECTION_CLASS,
} from "./toolStyles";

interface CrawlerSiteOption {
  site: string;
  name: string;
  enabled: boolean;
  native: boolean;
}

interface CrawlerTestResult {
  data: {
    title?: string;
    actors?: string[];
    genres?: string[];
    release_date?: string;
    studio?: string;
  } | null;
  error?: string;
  elapsed: number;
}

export function CrawlerTester() {
  const { showError, showSuccess } = useToast();
  const sitesQ = useQuery({
    queryKey: ["crawler", "sites"],
    queryFn: async () => {
      const result = (await ipc.crawler.listSites()) as { sites: CrawlerSiteOption[] };
      return result.sites;
    },
  });
  const [crawlerTestSite, setCrawlerTestSite] = useState("");
  const [crawlerTestNumber, setCrawlerTestNumber] = useState("");
  const [crawlerTestResult, setCrawlerTestResult] = useState<CrawlerTestResult | null>(null);
  const [crawlerTesting, setCrawlerTesting] = useState(false);

  const handleCrawlerTest = async () => {
    if (!crawlerTestSite) {
      showError("请选择站点");
      return;
    }
    if (!crawlerTestNumber.trim()) {
      showError("请输入番号");
      return;
    }

    setCrawlerTesting(true);
    setCrawlerTestResult(null);
    try {
      const result = await ipc.crawler.test(crawlerTestSite as Website, crawlerTestNumber.trim());
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
    <ToolPanel toolId="crawler-tester" icon={<Search className="h-5 w-5" />}>
      <div className={TOOL_SUBSECTION_CLASS}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">站点</Label>
            <Select value={crawlerTestSite} onValueChange={setCrawlerTestSite}>
              <SelectTrigger className={TOOL_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="选择站点" />
              </SelectTrigger>
              <SelectContent>
                {(sitesQ.data ?? []).map((site) => (
                  <SelectItem key={site.site} value={site.site}>
                    <span className="flex items-center gap-2">
                      {site.name}
                      {site.enabled ? (
                        <Badge variant="secondary" className="h-5 rounded-quiet-capsule px-2 text-[10px]">
                          已启用
                        </Badge>
                      ) : null}
                      {!site.native ? (
                        <Badge variant="outline" className="h-5 rounded-quiet-capsule px-2 text-[10px]">
                          浏览器
                        </Badge>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label
              htmlFor="crawlerTestNumber"
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              番号
            </Label>
            <Input
              id="crawlerTestNumber"
              value={crawlerTestNumber}
              onChange={(event) => setCrawlerTestNumber(event.target.value)}
              placeholder="例如: ABP-001"
              className={TOOL_INPUT_CLASS}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleCrawlerTest();
                }
              }}
            />
          </div>
        </div>
      </div>

      <Button
        variant="secondary"
        onClick={handleCrawlerTest}
        disabled={crawlerTesting}
        className={cn(TOOL_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto")}
      >
        {crawlerTesting ? "测试中..." : "开始测试"}
      </Button>

      {crawlerTestResult ? (
        <div className={TOOL_SUBSECTION_CLASS}>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="font-medium">
              {crawlerTestResult.data ? (
                <span className="text-emerald-600 dark:text-emerald-400">测试成功</span>
              ) : (
                <span className="text-destructive">测试失败</span>
              )}
            </span>
            <span className="font-numeric text-muted-foreground">
              耗时 {(crawlerTestResult.elapsed / 1000).toFixed(1)}s
            </span>
          </div>

          {crawlerTestResult.error ? <p className="text-sm text-destructive">{crawlerTestResult.error}</p> : null}

          {crawlerTestResult.data ? (
            <div className="grid gap-2 text-sm leading-7">
              {crawlerTestResult.data.title ? (
                <div>
                  <span className="text-muted-foreground">标题: </span>
                  <span className="font-medium text-foreground">{crawlerTestResult.data.title}</span>
                </div>
              ) : null}
              {crawlerTestResult.data.actors?.length ? (
                <div>
                  <span className="text-muted-foreground">演员: </span>
                  <span>{crawlerTestResult.data.actors.join(", ")}</span>
                </div>
              ) : null}
              {crawlerTestResult.data.genres?.length ? (
                <div>
                  <span className="text-muted-foreground">标签: </span>
                  <span>{crawlerTestResult.data.genres.join(", ")}</span>
                </div>
              ) : null}
              {crawlerTestResult.data.release_date ? (
                <div>
                  <span className="text-muted-foreground">发行日期: </span>
                  <span>{crawlerTestResult.data.release_date}</span>
                </div>
              ) : null}
              {crawlerTestResult.data.studio ? (
                <div>
                  <span className="text-muted-foreground">片商: </span>
                  <span>{crawlerTestResult.data.studio}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </ToolPanel>
  );
}
