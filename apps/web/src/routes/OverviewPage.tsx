import { useQuery } from "@tanstack/react-query";
import { HardDrive, Library, ListChecks, PlaySquare } from "lucide-react";

import { api } from "../client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui";
import { AppLink, LibraryEntryRow, Notice, scanStatusLabels } from "./common";

export const OverviewPage = () => {
  const setupQ = useQuery({ queryKey: ["setup"], queryFn: () => api.setup.status(), retry: false });
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const tasksQ = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list(), retry: false });
  const libraryQ = useQuery({
    queryKey: ["library", "recent"],
    queryFn: () => api.library.list({ limit: 5 }),
    retry: false,
  });
  const latestTask = tasksQ.data?.tasks[0];

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">概览</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">已挂载媒体目录的 WebUI 运行状态。</p>
        </header>
        {!setupQ.data?.configured && (
          <Notice>
            <AppLink className="font-medium text-foreground underline-offset-4 hover:underline" to="/setup">
              完成首次初始化
            </AppLink>
          </Notice>
        )}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="relative flex min-h-[280px] flex-col justify-between overflow-hidden rounded-quiet-xl bg-[linear-gradient(135deg,#050505_0%,#111111_56%,#2f3131_100%)] p-7 text-white shadow-none md:p-8 lg:col-span-2">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.13),transparent_28%,rgba(255,255,255,0.05)_100%)]" />
            <div className="relative z-10 flex items-start justify-between gap-6">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">开始刮削</h2>
                <p className="mt-3 max-w-lg text-lg leading-8 text-white/66">
                  进入工作台扫描已挂载媒体目录。任务队列和扫描结果会保留在工作台中。
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-quiet-lg bg-white/10 text-white/55">
                <ListChecks className="h-6 w-6" />
              </div>
            </div>
            <div className="relative z-10 mt-10 flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex gap-7">
                <MetricBlock label="媒体目录" value={rootsQ.data?.roots.length ?? "..."} />
                <MetricBlock label="任务" value={tasksQ.data?.tasks.length ?? "..."} />
                <MetricBlock label="Files" value={libraryQ.data?.total ?? "..."} />
              </div>
              <Button
                className="h-14 rounded-quiet-capsule bg-primary-foreground px-8! font-bold text-primary hover:bg-primary-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
                onClick={() => {
                  window.location.href = setupQ.data?.configured ? "/workbench" : "/setup";
                }}
              >
                <PlaySquare className="h-4 w-4" />
                {setupQ.data?.configured ? "去工作台" : "去初始化"}
              </Button>
            </div>
          </section>
          <section className="flex min-h-[280px] flex-col justify-between rounded-quiet-xl bg-surface-low p-7 text-foreground md:p-8">
            <div>
              <div className="flex items-start justify-between gap-5">
                <h2 className="text-xl font-bold tracking-tight">维护</h2>
                <HardDrive className="mt-1 h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
                管理已挂载媒体目录、检查服务状态，并继续把目录扫描结果沉淀为可恢复任务。
              </p>
            </div>
            <Button
              className="h-12 w-full rounded-quiet-capsule font-bold"
              onClick={() => {
                window.location.href = "/media-roots";
              }}
            >
              管理媒体目录
            </Button>
          </section>
        </section>
        <section className="mt-8">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">最近入库</h2>
            <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/library">
              打开媒体库
            </AppLink>
          </div>
          {libraryQ.data?.entries.length ? (
            <Card>
              <CardHeader>
                <CardTitle>扫描结果</CardTitle>
                {latestTask && <CardDescription>最近任务：{scanStatusLabels[latestTask.status]}</CardDescription>}
              </CardHeader>
              <CardContent>
                <div className="grid overflow-hidden rounded-quiet border border-border/50 bg-surface-low/40">
                  {libraryQ.data.entries.map((entry) => (
                    <LibraryEntryRow entry={entry} key={entry.id} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-quiet-xl bg-surface-low p-8 text-center">
              <Library className="h-9 w-9 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">暂无入库记录</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                从工作台扫描媒体目录后，已发现的视频会作为最近入库出现在这里。
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
