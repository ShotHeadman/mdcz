import type { CrawlerDataDto, LibraryEntryDto, MediaRootDto } from "@mdcz/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Input } from "@mdcz/ui";
import { AlertCircle, Database, FolderOpen, RefreshCw, Search } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

export interface LibraryIndexViewProps {
  className?: string;
  entries: LibraryEntryDto[];
  errorMessage?: string | null;
  isLoading?: boolean;
  query: string;
  rootId: string;
  roots: MediaRootDto[];
  total: number;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onRootChange: (value: string) => void;
}

export function LibraryIndexView({
  className,
  entries,
  errorMessage,
  isLoading = false,
  query,
  rootId,
  roots,
  total,
  linkComponent: LinkComponent,
  onQueryChange,
  onRefresh,
  onRootChange,
}: LibraryIndexViewProps) {
  return (
    <main className={cn("h-full overflow-y-auto bg-surface-canvas text-foreground", className)}>
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">媒体库</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            浏览持久化媒体库索引，查看刮削元数据、文件引用和缺失路径状态。
          </p>
        </header>

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-quiet border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {errorMessage}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>浏览与搜索</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.35fr)_auto] lg:items-center">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="搜索媒体库"
                  className="pl-9"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="搜索标题、番号、演员或相对路径..."
                  value={query}
                />
              </div>
              <select
                aria-label="媒体目录"
                className="h-10 rounded-quiet border border-border/60 bg-surface-low px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => onRootChange(event.target.value)}
                value={rootId}
              >
                <option value="">全部媒体目录</option>
                {roots.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.displayName}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
                刷新
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              显示 {entries.length} / {total} 个条目
              {isLoading ? "，正在更新..." : ""}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最近入库</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid overflow-hidden rounded-quiet border border-border/50 bg-surface-low/40">
              {entries.map((entry) => (
                <LibraryEntryRow entry={entry} key={entry.id} linkComponent={LinkComponent} />
              ))}
              {entries.length === 0 && (
                <div className="flex min-h-[220px] flex-col items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground">
                  <Database className="mb-3 h-8 w-8" />
                  暂无匹配的视频。先从工作台扫描或刮削媒体目录，或调整搜索条件。
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export interface LibraryDetailViewProps {
  entry: LibraryEntryDto | null;
  errorMessage?: string | null;
  isLoading?: boolean;
  getImageSrc?: (path: string) => string;
  onRefresh: () => void;
  onRescan?: () => void;
  backLink?: ReactNode;
  browserLink?: ReactNode;
  taskLink?: ReactNode;
}

export function LibraryDetailView({
  entry,
  errorMessage,
  isLoading = false,
  getImageSrc = (path) => path,
  onRefresh,
  onRescan,
  backLink,
  browserLink,
  taskLink,
}: LibraryDetailViewProps) {
  const title = entry?.crawlerData?.title_zh || entry?.title || entry?.fileName || "媒体条目";
  const poster = entry?.assets.find((asset) => asset.kind === "poster")?.uri ?? entry?.thumbnailPath;

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1180px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">媒体库详情</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">{title}</h1>
            <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
              {entry?.relativePath ?? (isLoading ? "加载中..." : "无已知路径")}
            </p>
          </div>
          {backLink}
        </header>

        {errorMessage && (
          <div className="rounded-quiet border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {entry && (
          <div className="grid gap-7 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="aspect-[2/3] overflow-hidden rounded-quiet-lg bg-surface-raised">
                {poster ? (
                  <img src={getImageSrc(poster)} alt={title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">无封面</div>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="secondary" onClick={onRefresh}>
                  <RefreshCw className="h-4 w-4" />
                  刷新状态
                </Button>
                {onRescan && (
                  <Button type="button" variant="outline" onClick={onRescan}>
                    重新扫描
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {taskLink}
                {browserLink}
              </div>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>索引信息</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                  <Detail label="番号" value={entry.number ?? "—"} />
                  <Detail label="媒体标识" value={entry.mediaIdentity ?? "—"} />
                  <Detail label="演员" value={entry.actors.length ? entry.actors.join(" / ") : "—"} />
                  <Detail label="大小" value={formatBytes(entry.size)} />
                  <Detail label="修改时间" value={formatDate(entry.modifiedAt)} />
                  <Detail label="入库时间" value={formatDate(entry.indexedAt)} />
                  <Detail label="刷新时间" value={formatDate(entry.lastRefreshedAt)} />
                  <Detail label="媒体目录" value={entry.rootDisplayName} />
                  <Detail label="文件状态" value={resolveFileStatus(entry)} />
                  <div className="md:col-span-2">
                    <Detail label="文件路径" value={entry.lastKnownPath || entry.relativePath || "无已知路径"} />
                  </div>
                </CardContent>
              </Card>

              <CrawlerDataPanel crawlerData={entry.crawlerData} />
              <AssetPanel assets={entry.assets} />
              <FileRefsPanel files={entry.fileRefs} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function LibraryEntryRow({
  entry,
  linkComponent: LinkComponent,
}: {
  entry: LibraryEntryDto;
  linkComponent?: ComponentType<{ children: ReactNode; className?: string; entry: LibraryEntryDto }>;
}) {
  const detailClass = "font-medium text-foreground underline-offset-4 hover:underline";
  return (
    <div className="grid gap-2 border-t border-border/40 px-4 py-3 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">
          {entry.crawlerData?.title_zh || entry.title || entry.fileName}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {entry.rootDisplayName}
          {entry.directory ? ` / ${entry.directory}` : ""}
        </p>
        {entry.available === false && <p className="mt-1 text-xs text-destructive">文件已移动或删除</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
        <Badge>{formatBytes(entry.size)}</Badge>
        <span className="font-mono">{formatDate(entry.indexedAt)}</span>
        {LinkComponent ? (
          <LinkComponent className={detailClass} entry={entry}>
            详情
          </LinkComponent>
        ) : null}
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-quiet bg-surface-low px-4 py-3">
    <div className="text-xs font-medium text-muted-foreground">{label}</div>
    <div className="mt-1 break-all text-foreground">{value}</div>
  </div>
);

const CrawlerDataPanel = ({ crawlerData }: { crawlerData: CrawlerDataDto | null }) => (
  <Card>
    <CardHeader>
      <CardTitle>crawlerData</CardTitle>
    </CardHeader>
    <CardContent className="grid gap-3 text-sm md:grid-cols-2">
      {crawlerData ? (
        crawlerDataFields(crawlerData).map(([key, value]) => <Detail key={key} label={key} value={value} />)
      ) : (
        <div className="text-sm text-muted-foreground">暂无刮削元数据。</div>
      )}
    </CardContent>
  </Card>
);

const AssetPanel = ({ assets }: { assets: LibraryEntryDto["assets"] }) => (
  <Card>
    <CardHeader>
      <CardTitle>资源</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 text-sm">
      {assets.length > 0 ? (
        assets.map((asset) => (
          <div
            key={asset.id}
            className="grid gap-2 rounded-quiet bg-surface-low px-4 py-3 md:grid-cols-[120px_minmax(0,1fr)]"
          >
            <span className="font-medium">{asset.kind}</span>
            <span className="break-all font-mono text-xs text-muted-foreground">{asset.uri}</span>
          </div>
        ))
      ) : (
        <div className="text-muted-foreground">暂无资源引用。</div>
      )}
    </CardContent>
  </Card>
);

const FileRefsPanel = ({ files }: { files: LibraryEntryDto["fileRefs"] }) => (
  <Card>
    <CardHeader>
      <CardTitle>文件引用</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 text-sm">
      {files.length > 0 ? (
        files.map((file) => (
          <div key={file.id} className="rounded-quiet bg-surface-low px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{file.rootDisplayName}</span>
              <Badge>{file.available === false ? "文件已移动或删除" : "路径可用"}</Badge>
            </div>
            <div className="mt-2 break-all font-mono text-xs text-muted-foreground">
              {file.lastKnownPath || file.relativePath || "无已知路径"}
            </div>
          </div>
        ))
      ) : (
        <div className="text-muted-foreground">无已知路径</div>
      )}
    </CardContent>
  </Card>
);

const crawlerDataFields = (crawlerData: CrawlerDataDto): Array<[string, string]> =>
  Object.entries(crawlerData)
    .filter(([, value]) => value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(" / ") : String(value)]);

const resolveFileStatus = (entry: LibraryEntryDto): string => {
  if (!entry.lastKnownPath && !entry.relativePath) {
    return "无已知路径";
  }
  if (entry.available === false) {
    return "文件已移动或删除";
  }
  return entry.available === true ? "路径可用" : "未检查";
};

const formatDate = (value: string | null | undefined): string => (value ? new Date(value).toLocaleString() : "—");

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};
