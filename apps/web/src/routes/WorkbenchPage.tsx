import type { ScanTaskDto } from "@mdcz/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { useEffect } from "react";
import { api, subscribeTaskUpdates } from "../client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui";
import { AppLink, formatDate, scanStatusLabels, taskKindLabels } from "./common";

export const WorkbenchPage = () => {
  const queryClient = useQueryClient();
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const tasksQ = useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks.list(), retry: false });
  const retryM = useMutation({ mutationFn: (taskId: string) => api.tasks.retry({ taskId }) });
  const enabledRoots = rootsQ.data?.roots.filter((root) => root.enabled) ?? [];

  const retryTask = async (taskId: string) => {
    await retryM.mutateAsync(taskId);
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  useEffect(
    () =>
      subscribeTaskUpdates(() => {
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }),
    [queryClient],
  );

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">工作台</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            启动媒体目录扫描，并查看 SQLite 任务队列与持久化结果。
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>扫描媒体目录</CardTitle>
            <CardDescription>任务队列属于工作台；选择一个已启用媒体目录开始扫描。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <AppLink
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                to="/media-roots"
              >
                媒体目录
              </AppLink>
              <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/browser">
                浏览
              </AppLink>
              <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/library">
                媒体库
              </AppLink>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {enabledRoots.map((root) => (
                <Button
                  key={root.id}
                  variant="secondary"
                  onClick={() => {
                    void api.scans
                      .start({ rootId: root.id })
                      .then(() => queryClient.invalidateQueries({ queryKey: ["tasks"] }));
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                  {root.displayName}
                </Button>
              ))}
              <Button variant="secondary" onClick={() => void tasksQ.refetch()}>
                刷新
              </Button>
            </div>
            {enabledRoots.length === 0 && (
              <p className="text-sm text-muted-foreground">没有已启用的媒体目录。先到媒体目录页面添加挂载路径。</p>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-4">
          {tasksQ.data?.tasks.map((task: ScanTaskDto) => (
            <Card key={task.id}>
              <CardHeader>
                <CardTitle>{`${taskKindLabels[task.kind]} · ${task.rootDisplayName} · ${scanStatusLabels[task.status]}`}</CardTitle>
                <CardDescription>{task.id}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {task.error ?? `${task.videoCount} 个视频，${task.directoryCount} 个目录`}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  创建 {formatDate(task.createdAt)} · 更新 {formatDate(task.updatedAt)}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <AppLink
                    className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                    to={`/tasks/${task.id}`}
                  >
                    查看任务详情
                  </AppLink>
                  <Button
                    disabled={task.status === "queued" || task.status === "running" || retryM.isPending}
                    variant="secondary"
                    onClick={() => void retryTask(task.id)}
                  >
                    重试扫描
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
};
