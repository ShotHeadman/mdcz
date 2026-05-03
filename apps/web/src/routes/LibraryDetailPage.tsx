import { toErrorMessage } from "@mdcz/shared/error";
import { useQuery } from "@tanstack/react-query";

import { api } from "../client";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../ui";
import { AppLink, ErrorBanner, formatBytes, formatDate } from "./common";

export const LibraryDetailPage = () => {
  const id = decodeURIComponent(window.location.pathname.replace(/^\/library\//u, ""));
  const detailQ = useQuery({
    queryKey: ["library", "detail", id],
    queryFn: () => api.library.detail({ id }),
    retry: false,
  });
  const entry = detailQ.data?.entry;

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1100px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">媒体库详情</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
              {entry?.title || entry?.fileName || "媒体条目"}
            </h1>
            <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{entry?.relativePath ?? id}</p>
          </div>
          <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/library">
            返回媒体库
          </AppLink>
        </header>
        {detailQ.error && <ErrorBanner>{toErrorMessage(detailQ.error)}</ErrorBanner>}
        {entry && (
          <Card>
            <CardHeader>
              <CardTitle>索引信息</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 text-sm md:grid-cols-2">
              <Detail label="番号" value={entry.number ?? "—"} />
              <Detail label="演员" value={entry.actors.length ? entry.actors.join(" / ") : "—"} />
              <Detail label="大小" value={formatBytes(entry.size)} />
              <Detail label="修改时间" value={formatDate(entry.modifiedAt)} />
              <Detail label="入库时间" value={formatDate(entry.indexedAt)} />
              <Detail label="媒体目录" value={entry.rootDisplayName} />
              <Detail
                label="文件状态"
                value={
                  entry.available === false ? "文件已移动或删除" : entry.available === true ? "路径可用" : "未检查"
                }
              />
              <div className="md:col-span-2">
                <Detail label="目录" value={entry.directory || "根目录"} />
              </div>
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <Button type="button" variant="secondary" onClick={() => void detailQ.refetch()}>
                  刷新状态
                </Button>
                {entry.taskId && (
                  <AppLink
                    className="inline-flex h-10 items-center rounded-quiet px-4 text-sm font-medium underline-offset-4 hover:underline"
                    to={`/tasks/${entry.taskId}`}
                  >
                    查看任务
                  </AppLink>
                )}
                <AppLink
                  className="inline-flex h-10 items-center rounded-quiet px-4 text-sm font-medium underline-offset-4 hover:underline"
                  to="/browser"
                  search={{ rootId: entry.rootId, path: entry.directory }}
                >
                  浏览目录
                </AppLink>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-quiet bg-surface-low px-4 py-3">
    <div className="text-xs font-medium text-muted-foreground">{label}</div>
    <div className="mt-1 break-all text-foreground">{value}</div>
  </div>
);
