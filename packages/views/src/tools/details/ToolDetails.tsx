import type { MediaRootDto, RootBrowserEntryDto, ToolId } from "@mdcz/shared";
import { Website } from "@mdcz/shared/enums";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mdcz/ui";
import { FolderOpen, Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ToolField as Field, ToolShell } from "../ToolScaffold";

export interface ToolRunState {
  pending?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

export interface SingleFileScraperDetailProps {
  browserEntries: RootBrowserEntryDto[];
  roots: MediaRootDto[];
  state?: ToolRunState;
  onRootChange?: (rootId: string) => void;
  onRun: (input: { rootId: string; relativePath: string; manualUrl?: string }) => void;
  workbenchLink?: React.ReactNode;
}

export function SingleFileScraperDetail({
  browserEntries,
  roots,
  state,
  onRootChange,
  onRun,
  workbenchLink,
}: SingleFileScraperDetailProps) {
  const [rootId, setRootId] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const enabledRoots = roots.filter((root) => root.enabled);
  const files = browserEntries.filter((entry) => entry.type === "file");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="媒体目录">
          <select
            className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground"
            value={rootId}
            onChange={(event) => {
              const nextRootId = event.target.value;
              setRootId(nextRootId);
              setRelativePath("");
              onRootChange?.(nextRootId);
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
        {files.map((entry) => (
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
        <Button
          disabled={!rootId || !relativePath.trim() || state?.pending}
          onClick={() => onRun({ rootId, relativePath: relativePath.trim(), manualUrl: manualUrl.trim() || undefined })}
        >
          <Play className="h-4 w-4" />
          启动单文件刮削
        </Button>
        {workbenchLink}
      </div>
      <ToolState state={state} />
    </div>
  );
}

export interface CrawlerTesterDetailProps {
  result?: {
    data: {
      actors?: string[];
      genres?: string[];
      release_date?: string;
      studio?: string;
      title?: string;
    } | null;
    elapsed: number;
    error?: string;
  } | null;
  siteOptions?: Array<{ enabled: boolean; name: string; native: boolean; site: string }>;
  state?: ToolRunState;
  onRun: (input: { number: string; site?: Website; manualUrl?: string }) => void;
}

export function CrawlerTesterDetail({ result, siteOptions, state, onRun }: CrawlerTesterDetailProps) {
  const [number, setNumber] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [site, setSite] = useState("");
  const sites =
    siteOptions ?? Object.values(Website).map((value) => ({ enabled: true, name: value, native: true, site: value }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="番号">
          <Input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="例如 ABP-001" />
        </Field>
        <Field label="限定站点">
          <Select value={site || "all"} onValueChange={(value) => setSite(value === "all" ? "" : value)}>
            <SelectTrigger className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm text-foreground">
              <SelectValue placeholder="选择站点" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">按配置聚合</SelectItem>
              {sites.map((option) => (
                <SelectItem key={option.site} value={option.site}>
                  <span className="flex items-center gap-2">
                    {option.name}
                    {option.enabled ? (
                      <Badge variant="secondary" className="h-5 rounded-quiet-capsule px-2 text-[10px]">
                        已启用
                      </Badge>
                    ) : null}
                    {!option.native ? (
                      <Badge variant="outline" className="h-5 rounded-quiet-capsule px-2 text-[10px]">
                        浏览器
                      </Badge>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="手动 URL">
          <Input
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder="可选：站点详情页 URL"
          />
        </Field>
      </div>
      <Button
        disabled={!number.trim() || state?.pending}
        variant="secondary"
        onClick={() =>
          onRun({
            number: number.trim(),
            site: site ? (site as Website) : undefined,
            manualUrl: manualUrl.trim() || undefined,
          })
        }
      >
        <Search className="h-4 w-4" />
        运行爬虫测试
      </Button>
      {result ? <CrawlerTesterResult result={result} /> : null}
      <ToolState state={state} pre />
    </div>
  );
}

function CrawlerTesterResult({ result }: { result: NonNullable<CrawlerTesterDetailProps["result"]> }) {
  return (
    <div className="rounded-quiet border border-border/50 bg-surface-low/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          {result.data ? (
            <span className="text-emerald-600 dark:text-emerald-400">测试成功</span>
          ) : (
            <span className="text-destructive">测试失败</span>
          )}
        </span>
        <span className="font-numeric text-muted-foreground">耗时 {(result.elapsed / 1000).toFixed(1)}s</span>
      </div>

      {result.error ? <p className="mt-3 text-sm text-destructive">{result.error}</p> : null}

      {result.data ? (
        <div className="mt-3 grid gap-2 text-sm leading-7">
          {result.data.title ? <CrawlerTesterResultRow label="标题" value={result.data.title} /> : null}
          {result.data.actors?.length ? (
            <CrawlerTesterResultRow label="演员" value={result.data.actors.join(", ")} />
          ) : null}
          {result.data.genres?.length ? (
            <CrawlerTesterResultRow label="标签" value={result.data.genres.join(", ")} />
          ) : null}
          {result.data.release_date ? (
            <CrawlerTesterResultRow label="发行日期" value={result.data.release_date} />
          ) : null}
          {result.data.studio ? <CrawlerTesterResultRow label="片商" value={result.data.studio} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function CrawlerTesterResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

const parseNumbers = (value: string): string[] =>
  value
    .split(/[\s,，;；]+/u)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

export interface MissingNumberFinderDetailProps {
  state?: ToolRunState;
  onRun: (input: { prefix: string; start: number; end: number; existing: string[] }) => void;
}

export function MissingNumberFinderDetail({ state, onRun }: MissingNumberFinderDetailProps) {
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
      <Button
        variant="secondary"
        disabled={state?.pending}
        onClick={() =>
          onRun({
            prefix,
            start: Number.parseInt(start, 10),
            end: Number.parseInt(end, 10),
            existing: parseNumbers(existing),
          })
        }
      >
        <Play className="h-4 w-4" />
        通过服务端执行
      </Button>
      <ToolState state={state} />
    </div>
  );
}

export interface SymlinkManagerDetailProps {
  state?: ToolRunState;
  onBrowseDestDir?: () => Promise<string | null | undefined>;
  onBrowseSourceDir?: () => Promise<string | null | undefined>;
  onRun: (input: { sourceDir: string; destDir: string; copyFiles: boolean; dryRun: boolean }) => void;
}

export function SymlinkManagerDetail({ state, onBrowseDestDir, onBrowseSourceDir, onRun }: SymlinkManagerDetailProps) {
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [copyFiles, setCopyFiles] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const handleBrowseSource = async () => {
    const selected = await onBrowseSourceDir?.();
    if (selected) setSourceDir(selected);
  };
  const handleBrowseDest = async () => {
    const selected = await onBrowseDestDir?.();
    if (selected) setDestDir(selected);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="来源目录">
          <div className="flex gap-2">
            <Input value={sourceDir} onChange={(event) => setSourceDir(event.target.value)} />
            {onBrowseSourceDir ? (
              <Button type="button" variant="secondary" size="icon" onClick={handleBrowseSource}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </Field>
        <Field label="目标目录">
          <div className="flex gap-2">
            <Input value={destDir} onChange={(event) => setDestDir(event.target.value)} />
            {onBrowseDestDir ? (
              <Button type="button" variant="secondary" size="icon" onClick={handleBrowseDest}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
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
      <Button
        disabled={!sourceDir.trim() || !destDir.trim() || state?.pending}
        onClick={() => onRun({ sourceDir, destDir, copyFiles, dryRun })}
      >
        <Play className="h-4 w-4" />
        执行软链接任务
      </Button>
      <ToolState state={state} pre />
    </div>
  );
}

export function ToolDetailShell({ toolId, children }: { toolId: ToolId; children: React.ReactNode }) {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === toolId);
  return tool ? <ToolShell tool={tool}>{children}</ToolShell> : null;
}

function ToolState({ state, pre = false }: { state?: ToolRunState; pre?: boolean }) {
  if (!state) return null;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.data && pre) {
    return (
      <pre className="max-h-[360px] overflow-auto rounded-quiet bg-surface-low p-3 text-xs text-muted-foreground">
        {JSON.stringify(state.data, null, 2)}
      </pre>
    );
  }
  if (state.data) {
    return (
      <p className="rounded-quiet bg-surface-low p-3 text-sm text-muted-foreground">{JSON.stringify(state.data)}</p>
    );
  }
  if (state.message) return <p className="text-sm text-muted-foreground">{state.message}</p>;
  return null;
}
