import { toErrorMessage } from "@mdcz/shared/error";
import { type LogsKindFilter, type LogsLevelFilter, LogsPanelView } from "@mdcz/views/logs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../client";
import { AppLink, ErrorBanner, formatDate } from "../routeCommon";

const logLevelLabels: Record<string, string> = {
  completed: "OK",
  failed: "ERR",
  "item-failed": "ERR",
  "item-success": "OK",
  paused: "WARN",
  queued: "REQ",
  running: "INFO",
  stopping: "WARN",
};

export const LogsPage = () => {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<LogsKindFilter>("all");
  const [level, setLevel] = useState<LogsLevelFilter>("all");
  const logsQ = useQuery({ queryKey: ["logs", kind], queryFn: () => api.logs.list({ kind }), retry: false });
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);
  const clearRuntimeM = useMutation({
    mutationFn: () => api.logs.clearRuntime(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
    },
  });
  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const logs = logsQ.data?.logs ?? [];
    return logs.filter((log) => {
      const projectedLevel = log.level ?? logLevelLabels[log.type] ?? "INFO";
      if (level !== "all" && projectedLevel !== level) return false;
      if (!normalized) return true;
      return [log.source, log.type, projectedLevel, log.taskId, log.message, log.createdAt].some((value) =>
        value.toLowerCase().includes(normalized),
      );
    });
  }, [level, logsQ.data?.logs, query]);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  });

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">日志</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            查看服务端任务事件，辅助诊断初始化、扫描和后续刮削流程。
          </p>
        </header>
        <LogsPanelView
          autoScroll={autoScroll}
          emptyText={query ? "没有匹配的日志。" : "暂无日志。扫描媒体目录后，任务事件会显示在这里。"}
          endRef={endRef}
          error={logsQ.error ? <ErrorBanner>{toErrorMessage(logsQ.error)}</ErrorBanner> : undefined}
          formatDate={formatDate}
          kind={kind}
          level={level}
          link={
            <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/workbench">
              打开工作台
            </AppLink>
          }
          logs={filteredLogs}
          query={query}
          total={logsQ.data?.logs.length ?? 0}
          onAutoScrollChange={setAutoScroll}
          onClearSearch={() => setQuery("")}
          onClearRuntime={() => void clearRuntimeM.mutate()}
          onKindChange={setKind}
          onLevelChange={setLevel}
          onQueryChange={setQuery}
          onRefresh={() => void logsQ.refetch()}
        />
      </div>
    </main>
  );
};

export const Route = createFileRoute("/logs")({
  component: LogsPage,
});
