import { toErrorMessage } from "@mdcz/shared/error";
import { LogsPanelView } from "@mdcz/views/logs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../client";
import { ErrorBanner, formatDate } from "../routeCommon";

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
  const logsQ = useQuery({
    queryKey: ["logs", "runtime"],
    queryFn: () => api.logs.list({ kind: "runtime" }),
    retry: false,
  });
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
      if (!normalized) return true;
      return [log.source, log.type, projectedLevel, log.taskId, log.message, log.createdAt].some((value) =>
        value.toLowerCase().includes(normalized),
      );
    });
  }, [logsQ.data?.logs, query]);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  });

  return (
    <main className="h-full overflow-hidden bg-surface-canvas">
      <div className="mx-auto flex h-full w-full max-w-[1240px] flex-col px-5 py-4 sm:px-6 md:px-8 lg:px-10 lg:py-5">
        <LogsPanelView
          autoScroll={autoScroll}
          emptyText={query ? "没有匹配的日志。" : "暂无日志。"}
          endRef={endRef}
          error={logsQ.error ? <ErrorBanner>{toErrorMessage(logsQ.error)}</ErrorBanner> : undefined}
          formatDate={formatDate}
          kind="runtime"
          level="all"
          logs={filteredLogs}
          query={query}
          total={logsQ.data?.logs.length ?? 0}
          onAutoScrollChange={setAutoScroll}
          onClearSearch={() => setQuery("")}
          onClearRuntime={() => void clearRuntimeM.mutate()}
          onKindChange={() => undefined}
          onLevelChange={() => undefined}
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
