import type { RootBrowserEntryDto } from "@mdcz/shared";
import { toErrorMessage } from "@mdcz/shared/error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../client";
import { buildHref } from "../routeHelpers";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui";
import { AppLink, ErrorBanner, formatBytes } from "./Common";

const parentPath = (value: string): string => {
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

export const BrowserPage = () => {
  const queryClient = useQueryClient();
  const search = new URLSearchParams(window.location.search);
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const rootId = search.get("rootId") ?? rootsQ.data?.roots[0]?.id;
  const relativePath = search.get("path") ?? "";
  const selectedRoot = rootsQ.data?.roots.find((root) => root.id === rootId);
  const scanM = useMutation({ mutationFn: (id: string) => api.scans.start({ rootId: id }) });
  const browserQ = useQuery({
    queryKey: ["browser", rootId, relativePath],
    queryFn: () => api.browser.list({ rootId: rootId ?? "", relativePath }),
    enabled: Boolean(rootId),
    retry: false,
  });

  const startScan = async () => {
    if (!rootId) {
      return;
    }
    await scanM.mutateAsync(rootId);
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">浏览</h1>
          <p className="mt-3 break-all text-sm leading-6 text-muted-foreground">
            {selectedRoot
              ? `${selectedRoot.displayName} · ${browserQ.data?.root.hostPath ?? selectedRoot.hostPath}`
              : "选择媒体目录以浏览目录和视频文件。"}
          </p>
        </header>
        {browserQ.error && <ErrorBanner>{toErrorMessage(browserQ.error)}</ErrorBanner>}
        <Card>
          <CardHeader>
            <CardTitle>目录上下文</CardTitle>
            <CardDescription>浏览始终限制在已注册媒体目录内，路径以媒体目录为边界保存。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.35fr)_minmax(0,1fr)_auto_auto] lg:items-center">
              <select
                aria-label="媒体目录"
                className="h-10 rounded-quiet border border-border/60 bg-surface-low px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={rootId ?? ""}
                onChange={(event) => {
                  window.location.href = buildHref("/browser", { rootId: event.target.value, path: "" });
                }}
              >
                <option value="">选择媒体目录</option>
                {rootsQ.data?.roots.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.displayName}
                  </option>
                ))}
              </select>
              <div className="truncate rounded-quiet border border-border/50 bg-surface-low px-3 py-2 font-mono text-sm text-muted-foreground">
                /{relativePath}
              </div>
              <Button disabled={!rootId || scanM.isPending} variant="secondary" onClick={() => void startScan()}>
                扫描此媒体目录
              </Button>
              <Button variant="secondary" onClick={() => void browserQ.refetch()}>
                刷新
              </Button>
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center gap-3">
          {rootId && relativePath && (
            <AppLink
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
              to="/browser"
              search={{ rootId, path: parentPath(relativePath) }}
            >
              返回上级
            </AppLink>
          )}
          {browserQ.data && (
            <AppLink
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
              to="/media-roots"
              search={{
                suggestedPath: browserQ.data.relativePath
                  ? `${browserQ.data.root.hostPath}/${browserQ.data.relativePath}`
                  : browserQ.data.root.hostPath,
              }}
            >
              将此目录作为媒体目录
            </AppLink>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>/{browserQ.data?.relativePath ?? relativePath}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid overflow-hidden rounded-quiet border border-border/50 bg-surface-low/40">
              {browserQ.data?.entries.map((entry: RootBrowserEntryDto) => (
                <div
                  className="flex items-center justify-between gap-4 border-t border-border/40 px-4 py-3 first:border-t-0"
                  key={entry.relativePath}
                >
                  {entry.type === "directory" ? (
                    <AppLink
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                      to="/browser"
                      search={{ rootId, path: entry.relativePath }}
                    >
                      {entry.name}/
                    </AppLink>
                  ) : (
                    <span className="truncate">{entry.name}</span>
                  )}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {entry.type === "file"
                      ? `${entry.classification === "video" ? "视频" : "文件"} · ${formatBytes(entry.size ?? 0)}`
                      : "目录"}
                  </span>
                </div>
              ))}
              {browserQ.data?.entries.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  当前目录没有可显示的子目录或文件。
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export const Route = createFileRoute("/browser")({
  component: BrowserPage,
});
