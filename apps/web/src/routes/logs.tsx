import { toErrorMessage } from "@mdcz/shared/error";
import { getLogSearchText, projectLogEntryLevel } from "@mdcz/shared/logFormatting";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mdcz/ui";
import { LogsPanelView } from "@mdcz/views/logs";
import { useWorkbenchTaskStore } from "@mdcz/views/state/workbenchTaskStore";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, subscribeTaskEvents } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";

export const LogsPage = () => {
  const queryClient = useQueryClient();
  const { activeMaintenanceTaskId, activeScrapeTaskId } = useWorkbenchTaskStore((state) => state.hydrationState);
  const activeTaskIds = useMemo(() => {
    return [activeScrapeTaskId, activeMaintenanceTaskId].filter((id) => id.trim().length > 0);
  }, [activeMaintenanceTaskId, activeScrapeTaskId]);
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const logsQueryKey = useMemo(() => queryKeys.logs.list(activeTaskIds), [activeTaskIds]);
  const logsQ = useQuery({
    queryKey: logsQueryKey,
    queryFn: () =>
      api.logs.list({
        kind: "all",
        ...(activeTaskIds.length > 0 ? { taskIds: activeTaskIds } : {}),
      }),
    retry: false,
  });
  const clearRuntimeM = useMutation({
    mutationFn: () => api.logs.clearRuntime(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.logs.all });
      setIsClearDialogOpen(false);
      toast.success("日志已成功清空");
    },
  });

  useEffect(
    () =>
      subscribeTaskEvents((event) => {
        if (event.kind !== "log") return;
        if (activeTaskIds.length > 0 && event.log.source === "task" && !activeTaskIds.includes(event.log.taskId)) {
          return;
        }
        queryClient.setQueryData(logsQueryKey, (previous: typeof logsQ.data | undefined) => {
          if (!previous) return { logs: [event.log] };
          if (previous.logs.some((log) => log.id === event.log.id)) return previous;
          return { logs: [...previous.logs, event.log] };
        });
      }),
    [activeTaskIds, logsQueryKey, queryClient],
  );
  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const logs = [...(logsQ.data?.logs ?? [])]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((log) => ({ ...log, level: projectLogEntryLevel(log) }));
    return logs.filter((log) => {
      if (!normalized) return true;
      return getLogSearchText(log).includes(normalized);
    });
  }, [logsQ.data?.logs, query]);

  return (
    <main className="h-full overflow-hidden bg-surface-canvas">
      <div className="mx-auto flex h-full w-full max-w-[1240px] flex-col px-5 py-4 sm:px-6 md:px-8 lg:px-10 lg:py-5">
        <LogsPanelView
          autoScroll={autoScroll}
          emptyText={query ? "没有匹配的日志。" : "暂无日志。刮削或维护任务开始后，运行日志会显示在这里。"}
          error={logsQ.error ? <ErrorBanner>{toErrorMessage(logsQ.error)}</ErrorBanner> : undefined}
          logs={filteredLogs}
          query={query}
          onAutoScrollChange={(nextValue) => {
            setAutoScroll(nextValue);
            toast.info(nextValue ? "已开启自动滚动" : "已关闭自动滚动");
          }}
          onClearRuntime={() => setIsClearDialogOpen(true)}
          onQueryChange={setQuery}
        />
        <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
          <DialogContent className="max-w-md gap-5 rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-6 shadow-[0_28px_90px_-44px_rgba(15,23,42,0.45)]">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle>清空所有日志</DialogTitle>
              <DialogDescription>确定要清空所有日志内容吗？</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  取消
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={clearRuntimeM.isPending}
                onClick={() => void clearRuntimeM.mutate()}
              >
                确定清空
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
};

export const Route = createFileRoute("/logs")({
  component: LogsPage,
});
