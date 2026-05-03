import { toErrorMessage } from "@mdcz/shared/error";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BrushCleaning, FolderCog, ImageOff, Library, Loader2, Play, Telescope } from "lucide-react";

import { api } from "../client";
import { Button } from "../ui";
import { AppLink, ErrorBanner, formatBytes } from "./common";

const skeletonKeys = ["recent-1", "recent-2", "recent-3", "recent-4", "recent-5", "recent-6", "recent-7", "recent-8"];

export const OverviewPage = () => {
  const setupQ = useQuery({ queryKey: ["setup"], queryFn: () => api.setup.status(), retry: false });
  const overviewQ = useQuery({
    queryKey: ["overview", "summary"],
    queryFn: () => api.overview.summary(),
    retry: false,
  });
  const output = overviewQ.data?.output;
  const recent = overviewQ.data?.recentAcquisitions ?? [];
  const configured = Boolean(setupQ.data?.configured);
  const hasOutputRoot = Boolean(output?.rootPath);
  const hasProductData = Boolean(output && output.fileCount > 0);
  const canOpenWorkbench = configured || hasOutputRoot || hasProductData;

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-12 gap-8 px-6 py-8 lg:px-12 lg:py-12">
        <section className="col-span-12 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          <section className="relative flex min-h-[280px] flex-col justify-between overflow-hidden rounded-quiet-xl bg-[linear-gradient(135deg,#050505_0%,#111111_56%,#2f3131_100%)] p-7 text-white shadow-none md:p-8 lg:col-span-2">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.13),transparent_28%,rgba(255,255,255,0.05)_100%)]" />
            <div className="relative z-10 flex items-start justify-between gap-6">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">开始刮削</h1>
                <p className="mt-3 max-w-lg text-lg leading-8 text-white/66">
                  进入工作台执行元数据提取。当前输出目录概况会在完成刮削后保持更新。
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-quiet-lg bg-white/10 text-white/55">
                <Telescope className="h-6 w-6" />
              </div>
            </div>
            <div className="relative z-10 mt-10 flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex gap-7">
                <MetricBlock
                  label="Files"
                  value={overviewQ.isLoading ? "..." : overviewQ.isError ? "-" : (output?.fileCount ?? 0)}
                />
                <MetricBlock
                  label="Size"
                  value={
                    overviewQ.isLoading ? "..." : overviewQ.isError ? "加载失败" : formatBytes(output?.totalBytes ?? 0)
                  }
                />
              </div>
              <Button
                className="h-14 rounded-quiet-capsule bg-primary-foreground px-8! font-bold text-primary hover:bg-primary-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
                onClick={() => {
                  window.location.href = canOpenWorkbench ? "/workbench" : "/setup";
                }}
              >
                {canOpenWorkbench ? <Play className="h-4 w-4 fill-current" /> : <FolderCog className="h-4 w-4" />}
                {canOpenWorkbench ? "去工作台" : "去初始化"}
              </Button>
            </div>
          </section>
          <section className="flex min-h-[280px] flex-col justify-between rounded-quiet-xl bg-surface-low p-7 text-foreground md:p-8">
            <div>
              <div className="flex items-start justify-between gap-5">
                <h2 className="text-xl font-bold tracking-tight">维护</h2>
                <BrushCleaning className="mt-1 h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
                预览目录变更、修复元数据并处理批量重写，让输出目录保持干净一致。
              </p>
            </div>
            <Button
              className="h-12 w-full rounded-quiet-capsule font-bold"
              onClick={() => {
                window.location.href = "/workbench?intent=maintenance";
              }}
            >
              去工作台
            </Button>
          </section>
        </section>
        {overviewQ.error && <ErrorBanner>{toErrorMessage(overviewQ.error)}</ErrorBanner>}
        <section className="col-span-12 mt-8">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">最近入库</h2>
            <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/library">
              打开媒体库
            </AppLink>
          </div>
          {overviewQ.isLoading ? (
            <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
              {skeletonKeys.map((key) => (
                <div key={key} className="aspect-[2/3] animate-pulse rounded-quiet-lg bg-surface-raised" />
              ))}
            </div>
          ) : overviewQ.isError ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-quiet-xl bg-surface-low p-8 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <h3 className="mt-4 text-base font-semibold">最近入库加载失败</h3>
              <p className="mt-1 text-sm text-muted-foreground">请稍后重试，或检查应用日志。</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-5 rounded-quiet-capsule"
                onClick={() => void overviewQ.refetch()}
              >
                <Loader2 className="h-4 w-4" />
                重试
              </Button>
            </div>
          ) : recent.length ? (
            <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
              {recent.map((item) => (
                <AppLink
                  key={item.id}
                  className="group relative aspect-[2/3] rounded-quiet-lg bg-surface-raised text-left shadow-none outline-none transition duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
                  to={`/library/${encodeURIComponent(item.id)}`}
                >
                  <div className="absolute inset-0 overflow-hidden rounded-quiet-lg">
                    {item.thumbnailPath ? (
                      <img
                        src={item.thumbnailPath}
                        alt={item.title ?? item.number}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageOff className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex h-1/3 flex-col justify-end rounded-b-quiet-lg bg-linear-to-t from-surface-floating/92 via-surface-floating/68 to-transparent p-5 text-foreground opacity-95 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    <div className="mb-2 inline-flex max-w-full truncate rounded-quiet-sm font-numeric text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">
                      {item.number}
                    </div>
                    <div className="line-clamp-1 text-base font-bold leading-tight">{item.title ?? item.number}</div>
                    <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      {item.actors.length
                        ? item.actors.join(" / ")
                        : item.available === false
                          ? "文件已移动或删除"
                          : "未知演员"}
                    </div>
                  </div>
                </AppLink>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-quiet-xl bg-surface-low p-8 text-center">
              <Library className="h-9 w-9 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">暂无刮削记录</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                完成一次刮削后，最近入库的影片会出现在这里。
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

function MetricBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-sm font-medium text-white/54">{label}</div>
      <div className="mt-1 font-numeric text-xl font-bold tracking-tight text-white">{value}</div>
    </div>
  );
}
