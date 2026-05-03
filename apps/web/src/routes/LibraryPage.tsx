import { toErrorMessage } from "@mdcz/shared/error";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "../ui";
import { AppLink, ErrorBanner, LibraryEntryRow } from "./common";

export const LibraryPage = () => {
  const [query, setQuery] = useState("");
  const [rootId, setRootId] = useState("");
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const libraryQ = useQuery({
    queryKey: ["library", query, rootId],
    queryFn: () => api.library.list({ query, rootId: rootId || undefined, limit: 300 }),
    retry: false,
  });

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">媒体库</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            基于已完成扫描任务的持久化视频索引，后续会继续承接刮削结果和 NFO 状态。
          </p>
        </header>
        {libraryQ.error && <ErrorBanner>{toErrorMessage(libraryQ.error)}</ErrorBanner>}
        <Card>
          <CardHeader>
            <CardTitle>浏览与搜索</CardTitle>
            <CardDescription>选择媒体目录或输入文件名、相对路径进行过滤。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.35fr)_auto] lg:items-center">
              <Input
                aria-label="搜索媒体库"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文件名或相对路径..."
                value={query}
              />
              <select
                aria-label="媒体目录"
                className="h-10 rounded-quiet border border-border/60 bg-surface-low px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setRootId(event.target.value)}
                value={rootId}
              >
                <option value="">全部媒体目录</option>
                {rootsQ.data?.roots.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.displayName}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => void libraryQ.refetch()}>
                刷新
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>
                显示 {libraryQ.data?.entries.length ?? 0} / {libraryQ.data?.total ?? 0} 个文件
              </span>
              <AppLink className="font-medium text-foreground underline-offset-4 hover:underline" to="/workbench">
                返回工作台扫描
              </AppLink>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>最近入库</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid overflow-hidden rounded-quiet border border-border/50 bg-surface-low/40">
              {libraryQ.data?.entries.map((entry) => (
                <LibraryEntryRow entry={entry} key={entry.id} />
              ))}
              {libraryQ.data?.entries.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  暂无匹配的视频。先从工作台扫描媒体目录，或调整搜索条件。
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};
