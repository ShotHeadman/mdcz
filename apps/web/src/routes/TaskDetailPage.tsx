import type { TaskEventDto } from "@mdcz/shared";
import { toErrorMessage } from "@mdcz/shared/error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui";
import { ErrorBanner, formatDate, scanStatusLabels, taskKindLabels } from "./common";

export const TaskDetailPage = () => {
  const queryClient = useQueryClient();
  const taskId = window.location.pathname.split("/").pop() ?? "";
  const detailQ = useQuery({
    queryKey: ["scan-detail", taskId],
    queryFn: () => api.tasks.detail({ taskId }),
    retry: false,
  });
  const retryM = useMutation({ mutationFn: () => api.tasks.retry({ taskId }) });
  const detail = detailQ.data;
  const task = detail?.task;

  const retryTask = async () => {
    await retryM.mutateAsync();
    await queryClient.invalidateQueries({ queryKey: ["scan-detail", taskId] });
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">任务详情</h1>
          <p className="mt-3 break-all text-sm leading-6 text-muted-foreground">
            {task ? `${task.rootDisplayName} · ${taskId}` : taskId}
          </p>
        </header>
        {detailQ.error && <ErrorBanner>{toErrorMessage(detailQ.error)}</ErrorBanner>}
        {task && (
          <>
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <Card>
                <CardHeader>
                  <CardTitle>状态</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-numeric text-2xl font-bold tracking-tight">{scanStatusLabels[task.status]}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {taskKindLabels[task.kind]}任务 · {task.rootDisplayName}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{task.error ?? "无错误记录"}</p>
                  <Button
                    className="mt-4"
                    disabled={task.status === "queued" || task.status === "running" || retryM.isPending}
                    variant="secondary"
                    onClick={() => void retryTask()}
                  >
                    重试扫描
                  </Button>
                </CardContent>
              </Card>
              <MetricCard label="视频" value={task.videoCount} description="已持久化扫描结果" />
              <MetricCard label="目录" value={task.directoryCount} description="包含视频的目录" />
              <Card>
                <CardHeader>
                  <CardTitle>时间</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-xs text-muted-foreground">开始 {formatDate(task.startedAt)}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">完成 {formatDate(task.completedAt)}</p>
                </CardContent>
              </Card>
            </section>
            <Card>
              <CardHeader>
                <CardTitle>日志</CardTitle>
                <CardDescription>持久化在 SQLite 中的结构化任务事件。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid overflow-hidden rounded-quiet border border-border/50 bg-surface-low/40">
                  {detail.events.map((event: TaskEventDto) => (
                    <div className="grid gap-1 border-t border-border/40 px-4 py-3 first:border-t-0" key={event.id}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Badge>{event.type}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{formatDate(event.createdAt)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{event.message}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>已持久化视频路径</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="max-h-[420px] space-y-1 overflow-auto rounded-quiet bg-surface-low p-4 font-mono text-xs text-muted-foreground">
                  {task.videos?.map((video: string) => (
                    <li className="break-all" key={video}>
                      {video}
                    </li>
                  ))}
                  {(!task.videos || task.videos.length === 0) && <li>此任务尚未持久化视频。</li>}
                </ul>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
};

const MetricCard = ({ label, value, description }: { label: string; value: number; description: string }) => (
  <Card>
    <CardHeader>
      <CardTitle>{label}</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="font-numeric text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);
