import { type RootBrowserEntryDto, type ToolId, Website } from "@mdcz/shared";
import { toErrorMessage } from "@mdcz/shared/error";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import { DiagnosticsPanelView, ToolField as Field, ToolCardIcon, ToolCatalogView, ToolShell } from "@mdcz/views/tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, FolderOpen, Languages, Play, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { api } from "../client";
import { Badge, Button, Input, Textarea } from "../ui";
import { AppLink, ErrorBanner, formatDate } from "./Common";

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
      api.tools.execute({
        toolId: "single-file-scraper",
        rootId,
        relativePath: relativePath.trim(),
        manualUrl: manualUrl.trim() || undefined,
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
      {scrapeM.data && <p className="text-sm text-muted-foreground">{scrapeM.data.message}</p>}
      {scrapeM.error && <p className="text-sm text-destructive">{scrapeM.error.message}</p>}
    </div>
  );
};

const CrawlerTesterTool = () => {
  const [number, setNumber] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [site, setSite] = useState("");
  const runM = useMutation({
    mutationFn: () =>
      api.tools.execute({
        toolId: "crawler-tester",
        number: number.trim(),
        site: site ? (site as Website) : undefined,
        manualUrl: manualUrl.trim() || undefined,
      }),
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="番号">
          <Input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="例如 ABP-001" />
        </Field>
        <Field label="限定站点">
          <select
            className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
            value={site}
            onChange={(event) => setSite(event.target.value)}
          >
            <option value="">按配置聚合</option>
            {Object.values(Website).map((value) => (
              <option key={value} value={value}>
                {value}
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
      <div className="flex flex-wrap gap-3">
        <Button disabled={!number.trim() || runM.isPending} variant="secondary" onClick={() => void runM.mutate()}>
          <Search className="h-4 w-4" />
          运行爬虫测试
        </Button>
      </div>
      {runM.data && (
        <pre className="max-h-[360px] overflow-auto rounded-quiet bg-surface-low p-3 text-xs text-muted-foreground">
          {JSON.stringify(runM.data, null, 2)}
        </pre>
      )}
      {runM.error && <p className="text-sm text-destructive">{runM.error.message}</p>}
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
  const runM = useMutation({
    mutationFn: () =>
      api.tools.execute({
        toolId: "missing-number-finder",
        prefix,
        start: Number.parseInt(start, 10),
        end: Number.parseInt(end, 10),
        existing: parseNumbers(existing),
      }),
  });

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
      <Button variant="secondary" onClick={() => void runM.mutate()}>
        <Play className="h-4 w-4" />
        通过服务端执行
      </Button>
      {runM.data && <p className="text-sm text-muted-foreground">{runM.data.message}</p>}
    </div>
  );
};

const SymlinkManagerTool = () => {
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [copyFiles, setCopyFiles] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const runM = useMutation({
    mutationFn: () => api.tools.execute({ toolId: "symlink-manager", sourceDir, destDir, copyFiles, dryRun }),
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="来源目录">
          <Input value={sourceDir} onChange={(event) => setSourceDir(event.target.value)} />
        </Field>
        <Field label="目标目录">
          <Input value={destDir} onChange={(event) => setDestDir(event.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          <input checked={copyFiles} type="checkbox" onChange={(event) => setCopyFiles(event.target.checked)} />
          复制 NFO / 图片 / 字幕
        </label>
        <label className="flex items-center gap-2">
          <input checked={dryRun} type="checkbox" onChange={(event) => setDryRun(event.target.checked)} />
          仅预览
        </label>
      </div>
      <Button disabled={!sourceDir.trim() || !destDir.trim() || runM.isPending} onClick={() => void runM.mutate()}>
        <Play className="h-4 w-4" />
        执行软链接任务
      </Button>
      {runM.data && (
        <pre className="max-h-[320px] overflow-auto rounded-quiet bg-surface-low p-3 text-xs text-muted-foreground">
          {JSON.stringify(runM.data, null, 2)}
        </pre>
      )}
      {runM.error && <p className="text-sm text-destructive">{runM.error.message}</p>}
    </div>
  );
};

const FileCleanerTool = () => {
  const [rootId, setRootId] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [extensions, setExtensions] = useState(".nfo,.jpg,.png");
  const [dryRun, setDryRun] = useState(true);
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const runM = useMutation({
    mutationFn: () =>
      api.tools.execute({
        toolId: "file-cleaner",
        rootId,
        relativePath,
        extensions: extensions.split(/[\s,，;；]+/u).filter(Boolean),
        dryRun,
      }),
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="媒体目录">
          <select
            className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
            value={rootId}
            onChange={(event) => setRootId(event.target.value)}
          >
            <option value="">选择媒体目录</option>
            {(rootsQ.data?.roots ?? []).map((root) => (
              <option key={root.id} value={root.id}>
                {root.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="相对路径">
          <Input value={relativePath} onChange={(event) => setRelativePath(event.target.value)} />
        </Field>
        <Field label="扩展名">
          <Input value={extensions} onChange={(event) => setExtensions(event.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input checked={dryRun} type="checkbox" onChange={(event) => setDryRun(event.target.checked)} />
        仅预览
      </label>
      <Button disabled={!rootId || runM.isPending} onClick={() => void runM.mutate()}>
        <Trash2 className="h-4 w-4" />
        执行清理
      </Button>
      {runM.data && (
        <pre className="max-h-[320px] overflow-auto rounded-quiet bg-surface-low p-3 text-xs text-muted-foreground">
          {JSON.stringify(runM.data, null, 2)}
        </pre>
      )}
      {runM.error && <p className="text-sm text-destructive">{runM.error.message}</p>}
    </div>
  );
};

const BatchTranslatorTool = () => {
  const [text, setText] = useState("");
  const runM = useMutation({
    mutationFn: () => api.tools.execute({ toolId: "batch-nfo-translator", action: "translate-text", text }),
  });

  return (
    <div className="space-y-5">
      <Field label="待翻译文本">
        <Textarea className="min-h-36" value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      <Button disabled={!text.trim() || runM.isPending} onClick={() => void runM.mutate()}>
        <Languages className="h-4 w-4" />
        执行翻译诊断
      </Button>
      {runM.data && (
        <pre className="rounded-quiet bg-surface-low p-3 text-sm text-muted-foreground">
          {JSON.stringify(runM.data.data, null, 2)}
        </pre>
      )}
      {runM.error && <p className="text-sm text-destructive">{runM.error.message}</p>}
    </div>
  );
};

const MediaLibraryTools = () => {
  const [server, setServer] = useState<"jellyfin" | "emby">("jellyfin");
  const [mode, setMode] = useState<"missing" | "all">("missing");
  const runM = useMutation({
    mutationFn: (action: "check" | "sync-info" | "sync-photo") =>
      api.tools.execute({ toolId: "media-library-tools", server, action, mode }),
  });

  return (
    <div className="space-y-5">
      <Field label="媒体服务器">
        <select
          className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
          value={server}
          onChange={(event) => setServer(event.target.value as "jellyfin" | "emby")}
        >
          <option value="jellyfin">Jellyfin</option>
          <option value="emby">Emby</option>
        </select>
      </Field>
      <Field label="同步模式">
        <select
          className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
          value={mode}
          onChange={(event) => setMode(event.target.value as "missing" | "all")}
        >
          <option value="missing">仅补全缺失项</option>
          <option value="all">重新同步全部</option>
        </select>
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button disabled={runM.isPending} onClick={() => void runM.mutate("check")}>
          <FolderOpen className="h-4 w-4" />
          诊断连接
        </Button>
        <Button disabled={runM.isPending} variant="secondary" onClick={() => void runM.mutate("sync-info")}>
          同步简介
        </Button>
        <Button disabled={runM.isPending} variant="secondary" onClick={() => void runM.mutate("sync-photo")}>
          同步头像
        </Button>
      </div>
      {runM.data && (
        <p className="rounded-quiet bg-surface-low p-3 text-sm text-muted-foreground">{runM.data.message}</p>
      )}
      {runM.error && <p className="text-sm text-destructive">{runM.error.message}</p>}
    </div>
  );
};

const AmazonPosterTool = () => {
  const [rootDir, setRootDir] = useState("");
  const [items, setItems] = useState<Array<{ nfoPath: string; title: string; amazonPosterUrl?: string | null }>>([]);
  const scanM = useMutation({
    mutationFn: () => api.tools.execute({ toolId: "amazon-poster", action: "scan", rootDir }),
    onSuccess: (response) => {
      const scannedItems =
        (response.data as { items?: Array<{ nfoPath: string; title: string }> } | undefined)?.items ?? [];
      setItems(scannedItems.map((item) => ({ nfoPath: item.nfoPath, title: item.title, amazonPosterUrl: null })));
    },
  });
  const lookupM = useMutation({
    mutationFn: async (item: { nfoPath: string; title: string }) =>
      await api.tools.execute({ toolId: "amazon-poster", action: "lookup", nfoPath: item.nfoPath, title: item.title }),
    onSuccess: (response) => {
      const result = response.data as { nfoPath?: string; amazonPosterUrl?: string | null } | undefined;
      if (!result?.nfoPath) return;
      setItems((current) =>
        current.map((item) =>
          item.nfoPath === result.nfoPath ? { ...item, amazonPosterUrl: result.amazonPosterUrl ?? null } : item,
        ),
      );
    },
  });
  const applyM = useMutation({
    mutationFn: () =>
      api.tools.execute({
        toolId: "amazon-poster",
        action: "apply",
        items: items
          .filter((item) => item.amazonPosterUrl)
          .map((item) => ({ nfoPath: item.nfoPath, amazonPosterUrl: item.amazonPosterUrl ?? "" })),
      }),
  });

  return (
    <div className="space-y-5">
      <Field label="媒体库目录">
        <Input value={rootDir} onChange={(event) => setRootDir(event.target.value)} placeholder="包含 NFO 的根目录" />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button disabled={!rootDir.trim() || scanM.isPending} onClick={() => void scanM.mutate()}>
          <Search className="h-4 w-4" />
          扫描 NFO
        </Button>
        <Button
          disabled={items.every((item) => !item.amazonPosterUrl) || applyM.isPending}
          variant="secondary"
          onClick={() => void applyM.mutate()}
        >
          应用已命中海报
        </Button>
      </div>
      {scanM.data && <p className="text-sm text-muted-foreground">{scanM.data.message}</p>}
      {scanM.error && <p className="text-sm text-destructive">{scanM.error.message}</p>}
      <div className="grid max-h-[420px] gap-2 overflow-auto rounded-quiet border border-border/50 bg-surface-low/40 p-3">
        {items.map((item) => (
          <div
            className="grid gap-3 rounded-quiet bg-surface-floating/70 p-3 lg:grid-cols-[minmax(0,1fr)_auto]"
            key={item.nfoPath}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{item.nfoPath}</p>
              {item.amazonPosterUrl && (
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.amazonPosterUrl}</p>
              )}
            </div>
            <Button
              disabled={lookupM.isPending}
              variant="secondary"
              onClick={() => void lookupM.mutate({ nfoPath: item.nfoPath, title: item.title })}
            >
              查询
            </Button>
          </div>
        ))}
        {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无扫描结果。</p>}
      </div>
      {lookupM.data && <p className="text-sm text-muted-foreground">{lookupM.data.message}</p>}
      {applyM.data && <p className="text-sm text-muted-foreground">{applyM.data.message}</p>}
      {applyM.error && <p className="text-sm text-destructive">{applyM.error.message}</p>}
    </div>
  );
};

const DiagnosticsPanel = () => {
  const diagnosticsQ = useQuery({ queryKey: ["diagnostics"], queryFn: () => api.diagnostics.summary(), retry: false });
  return (
    <DiagnosticsPanelView
      checks={diagnosticsQ.data?.checks ?? []}
      error={diagnosticsQ.error ? <ErrorBanner>{toErrorMessage(diagnosticsQ.error)}</ErrorBanner> : undefined}
      formatDate={formatDate}
      onRefresh={() => void diagnosticsQ.refetch()}
    />
  );
};

const ToolDetail = ({ tool }: { tool: (typeof TOOL_DEFINITIONS)[number] }) => {
  if (tool.id === "single-file-scraper") return <SingleFileScraperTool />;
  if (tool.id === "crawler-tester") return <CrawlerTesterTool />;
  if (tool.id === "amazon-poster") return <AmazonPosterTool />;
  if (tool.id === "media-library-tools") return <MediaLibraryTools />;
  if (tool.id === "symlink-manager") return <SymlinkManagerTool />;
  if (tool.id === "file-cleaner") return <FileCleanerTool />;
  if (tool.id === "batch-nfo-translator") return <BatchTranslatorTool />;
  if (tool.id === "missing-number-finder") return <MissingNumberFinderTool />;
  return null;
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
          <ToolCatalogView
            renderIcon={(tool) => <ToolCardIcon icon={tool.overviewIcon} />}
            tools={TOOL_DEFINITIONS}
            onSelect={handleSelectTool}
          />
          <DiagnosticsPanel />
        </main>
      )}
    </div>
  );
};

export const Route = createFileRoute("/tools")({
  component: ToolsPage,
});
