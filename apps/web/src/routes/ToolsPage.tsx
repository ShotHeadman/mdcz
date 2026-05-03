import type { DiagnosticCheckDto, RootBrowserEntryDto, ToolDefinition, ToolId } from "@mdcz/shared";
import { toErrorMessage } from "@mdcz/shared/error";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bug, FileText, FolderOpen, Languages, Link2, Play, Search, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { api } from "../client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "../ui";
import { AppLink, ErrorBanner, formatDate } from "./common";

const AVAILABLE_TOOL_IDS = new Set<ToolId>(["single-file-scraper", "missing-number-finder"]);

const ToolCardIcon = ({ icon }: { icon: ToolDefinition["overviewIcon"] }) => {
  const iconClassName = "h-8 w-8";

  if (icon === "file") return <FileText className={iconClassName} strokeWidth={1.8} />;
  if (icon === "bug") return <Bug className={iconClassName} strokeWidth={1.8} />;
  if (icon === "folder") return <FolderOpen className={iconClassName} strokeWidth={1.8} />;
  if (icon === "link") return <Link2 className={iconClassName} strokeWidth={1.8} />;
  if (icon === "trash") return <Trash2 className={iconClassName} strokeWidth={1.8} />;
  if (icon === "translate") return <Languages className={iconClassName} strokeWidth={1.8} />;
  if (icon === "search") return <Search className={iconClassName} strokeWidth={1.8} />;

  return (
    <span className="relative text-[2.2rem] font-semibold leading-none lowercase tracking-tight">
      a
      <span className="absolute -bottom-1 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-current/75" />
    </span>
  );
};

const toolLayoutClass: Record<ToolDefinition["overviewLayoutClass"], string> = {
  "min-h-[170px] md:col-span-12 md:min-h-[190px]": "min-h-[170px] md:col-span-12 md:min-h-[190px]",
  "min-h-[190px] md:col-span-6 md:min-h-[208px]": "min-h-[190px] md:col-span-6 md:min-h-[208px]",
  "min-h-[300px] md:col-span-4 md:min-h-[320px]": "min-h-[300px] md:col-span-4 md:min-h-[320px]",
};

const ToolCard = ({ tool, onSelect }: { tool: ToolDefinition; onSelect: (toolId: ToolId) => void }) => {
  const available = AVAILABLE_TOOL_IDS.has(tool.id);
  return (
    <button
      className={`${toolLayoutClass[tool.overviewLayoutClass]} flex h-full cursor-pointer flex-col rounded-[2rem] bg-surface-low/80 p-8 text-left transition-colors duration-200 hover:bg-surface-floating focus-visible:ring-2 focus-visible:ring-ring/40 ${
        available ? "" : "opacity-60"
      }`}
      type="button"
      onClick={() => onSelect(tool.id)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-quiet-capsule bg-surface-floating text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <ToolCardIcon icon={tool.overviewIcon} />
        </div>
        <Badge variant={available ? "default" : "secondary"}>{available ? "可用" : "未开放"}</Badge>
      </div>
      <div className="mt-auto pt-12">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">{tool.title}</h2>
        <p className="mt-4 max-w-[26rem] text-sm leading-8 text-muted-foreground">{tool.description}</p>
      </div>
    </button>
  );
};

const ToolShell = ({ tool, children }: { tool: ToolDefinition; children: ReactNode }) => (
  <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{tool.detailTitle}</CardTitle>
          <CardDescription>{tool.detailDescription}</CardDescription>
        </div>
        <Badge variant={AVAILABLE_TOOL_IDS.has(tool.id) ? "default" : "secondary"}>
          {AVAILABLE_TOOL_IDS.has(tool.id) ? "WebUI 可用" : "WebUI 未开放"}
        </Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-5">{children}</CardContent>
  </Card>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-2">
    <Label>{label}</Label>
    {children}
  </div>
);

const SingleFileScraperTool = () => {
  const queryClient = useQueryClient();
  const [rootId, setRootId] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const browserQ = useQuery({
    queryKey: ["browser", rootId],
    queryFn: () => api.browser.list({ rootId, relativePath: "" }),
    enabled: Boolean(rootId),
    retry: false,
  });
  const scrapeM = useMutation({
    mutationFn: () =>
      api.scrape.start({
        refs: [{ rootId, relativePath: relativePath.trim() }],
        manualUrl: manualUrl.trim() || undefined,
        uncensoredConfirmed: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["scrapeResults"] });
    },
  });

  const enabledRoots = rootsQ.data?.roots.filter((root) => root.enabled) ?? [];
  const files = browserQ.data?.entries.filter((entry) => entry.type === "file") ?? [];

  return (
    <div className="space-y-5">
      {rootsQ.error && <ErrorBanner>{toErrorMessage(rootsQ.error)}</ErrorBanner>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="媒体目录">
          <select
            className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
            value={rootId}
            onChange={(event) => {
              setRootId(event.target.value);
              setRelativePath("");
            }}
          >
            <option value="">选择媒体目录</option>
            {enabledRoots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="手动 URL">
          <Input
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder="可选：站点详情页 URL"
          />
        </Field>
      </div>
      <Field label="相对路径">
        <Input
          value={relativePath}
          onChange={(event) => setRelativePath(event.target.value)}
          placeholder="从下方选择，或输入 rootId 下的相对路径"
        />
      </Field>
      <div className="grid max-h-[320px] gap-2 overflow-y-auto rounded-quiet border border-border/50 bg-surface-low/40 p-3">
        {files.map((entry: RootBrowserEntryDto) => (
          <button
            key={entry.relativePath}
            className={`rounded-quiet px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              relativePath === entry.relativePath ? "bg-primary/10 text-foreground" : "hover:bg-surface-raised/60"
            }`}
            type="button"
            onClick={() => setRelativePath(entry.relativePath)}
          >
            <span className="block truncate font-medium">{entry.name}</span>
            <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{entry.relativePath}</span>
          </button>
        ))}
        {rootId && files.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">根目录暂无文件。</p>
        )}
        {!rootId && <p className="px-3 py-8 text-center text-sm text-muted-foreground">请选择媒体目录。</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!rootId || !relativePath.trim() || scrapeM.isPending} onClick={() => void scrapeM.mutate()}>
          <Play className="h-4 w-4" />
          启动单文件刮削
        </Button>
        <AppLink className="text-sm font-medium underline-offset-4 hover:underline" to="/workbench">
          打开工作台
        </AppLink>
      </div>
      {scrapeM.data && <p className="text-sm text-muted-foreground">已创建任务：{scrapeM.data.id}</p>}
      {scrapeM.error && <p className="text-sm text-destructive">{scrapeM.error.message}</p>}
    </div>
  );
};

const CrawlerTesterTool = () => {
  const [number, setNumber] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const runDryCheck = () => {
    const normalized = number.trim();
    if (!normalized) {
      setResult("请输入番号用于检查。WebUI 当前只能验证输入形态；真实站点爬虫测试需要桌面 crawler provider。 ");
      return;
    }
    setResult(`输入已就绪：${normalized}${manualUrl.trim() ? ` · 手动 URL ${manualUrl.trim()}` : ""}`);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-quiet border border-border/50 bg-surface-low/50 p-4 text-sm leading-7 text-muted-foreground">
        真实站点爬虫测试依赖桌面 crawler provider，当前 WebUI server
        尚未暴露该服务；此处保留诊断入口和输入校验，并可转到单文件刮削工作流。
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="番号">
          <Input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="例如 ABP-001" />
        </Field>
        <Field label="手动 URL">
          <Input
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder="可选：站点详情页 URL"
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={runDryCheck}>
          <Search className="h-4 w-4" />
          检查输入
        </Button>
        <Button disabled title="缺少 server crawler provider" variant="secondary">
          真实爬虫测试未开放
        </Button>
      </div>
      {result && <p className="rounded-quiet bg-surface-low p-3 text-sm text-muted-foreground">{result}</p>}
    </div>
  );
};

const parseNumbers = (value: string): string[] =>
  value
    .split(/[\s,，;；]+/u)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

const MissingNumberFinderTool = () => {
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState("20");
  const [existing, setExisting] = useState("");

  const missing = useMemo(() => {
    const from = Number.parseInt(start, 10);
    const to = Number.parseInt(end, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [];
    const normalizedPrefix = prefix.trim().toUpperCase();
    const existingSet = new Set(parseNumbers(existing).map((item) => item.replace(/[ _]/gu, "-")));
    const width = Math.max(start.length, end.length, 3);
    const result: string[] = [];
    for (let current = from; current <= to; current += 1) {
      const number = `${normalizedPrefix}${normalizedPrefix ? "-" : ""}${String(current).padStart(width, "0")}`;
      if (!existingSet.has(number)) result.push(number);
    }
    return result;
  }, [end, existing, prefix, start]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="前缀">
          <Input value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="例如 ABP" />
        </Field>
        <Field label="起始编号">
          <Input value={start} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label="结束编号">
          <Input value={end} onChange={(event) => setEnd(event.target.value)} />
        </Field>
      </div>
      <Field label="已有编号">
        <Textarea
          className="min-h-36 font-mono text-sm"
          value={existing}
          onChange={(event) => setExisting(event.target.value)}
          placeholder="ABP-001 ABP-003 ABP-005"
        />
      </Field>
      <div className="rounded-quiet border border-border/50 bg-surface-low/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium text-foreground">缺失编号</p>
          <Badge>{missing.length} 个</Badge>
        </div>
        <p className="mt-3 break-words font-mono text-sm leading-7 text-muted-foreground">
          {missing.length > 0 ? missing.join(" ") : "当前范围内没有缺失编号。"}
        </p>
      </div>
    </div>
  );
};

const DiagnosticsPanel = () => {
  const diagnosticsQ = useQuery({ queryKey: ["diagnostics"], queryFn: () => api.diagnostics.summary(), retry: false });
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>诊断</CardTitle>
            <CardDescription>检查持久化、媒体目录可用性，以及当前 WebUI 可验证的运行条件。</CardDescription>
          </div>
          <Button variant="secondary" onClick={() => void diagnosticsQ.refetch()}>
            刷新诊断
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {diagnosticsQ.error && <ErrorBanner>{toErrorMessage(diagnosticsQ.error)}</ErrorBanner>}
        {(diagnosticsQ.data?.checks ?? []).map((check: DiagnosticCheckDto) => (
          <div
            key={check.id}
            className="grid gap-2 rounded-quiet border border-border/50 bg-surface-low/50 p-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
          >
            <Badge variant={check.ok ? "default" : "destructive"}>{check.ok ? "OK" : "ERR"}</Badge>
            <div className="min-w-0">
              <p className="font-medium text-foreground">{check.label}</p>
              <p className="break-all text-sm text-muted-foreground">{check.message}</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{formatDate(check.checkedAt)}</span>
          </div>
        ))}
        {diagnosticsQ.data?.checks.length === 0 && <p className="text-sm text-muted-foreground">暂无诊断结果。</p>}
      </CardContent>
    </Card>
  );
};

const UnavailableTool = ({ tool }: { tool: ToolDefinition }) => (
  <div className="rounded-quiet border border-border/50 bg-surface-low/50 p-4 text-sm leading-7 text-muted-foreground">
    {tool.title} 需要桌面端本地服务或文件系统选择能力，当前 WebUI 先按桌面 catalog 展示并禁用操作入口。
  </div>
);

const ToolDetail = ({ tool }: { tool: ToolDefinition }) => {
  if (tool.id === "single-file-scraper") return <SingleFileScraperTool />;
  if (tool.id === "crawler-tester") return <CrawlerTesterTool />;
  if (tool.id === "missing-number-finder") return <MissingNumberFinderTool />;
  return <UnavailableTool tool={tool} />;
};

export const ToolsPage = () => {
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [selectedToolId, setSelectedToolId] = useState<ToolId | null>(null);
  const selectedTool = selectedToolId ? TOOL_DEFINITIONS.find((tool) => tool.id === selectedToolId) : null;

  const scrollToTop = () => {
    window.requestAnimationFrame(() => {
      pageScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const handleSelectTool = (toolId: ToolId) => {
    setSelectedToolId(toolId);
    scrollToTop();
  };

  const handleBackToOverview = () => {
    setSelectedToolId(null);
    scrollToTop();
  };

  return (
    <div ref={pageScrollRef} className="h-full w-full overflow-y-auto bg-surface-canvas scroll-smooth">
      {selectedTool ? (
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 py-6 md:px-8 lg:px-10 lg:py-8">
          <div className="sticky top-0 z-10 w-fit rounded-full bg-surface-canvas/92 pt-1 backdrop-blur-sm">
            <Button
              className="h-12 w-12 rounded-full bg-surface-low text-foreground"
              variant="secondary"
              onClick={handleBackToOverview}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </div>
          <ToolShell tool={selectedTool}>
            <ToolDetail tool={selectedTool} />
          </ToolShell>
          <DiagnosticsPanel />
        </main>
      ) : (
        <main className="mx-auto grid w-full max-w-[1120px] gap-6 px-6 py-8 md:px-8 lg:px-10 lg:py-10">
          <section className="grid gap-5 md:grid-cols-12">
            {TOOL_DEFINITIONS.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onSelect={handleSelectTool} />
            ))}
          </section>
          <DiagnosticsPanel />
        </main>
      )}
    </div>
  );
};
