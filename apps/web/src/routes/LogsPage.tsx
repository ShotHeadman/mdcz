import { toErrorMessage } from "@mdcz/shared/error";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../client";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "../ui";
import { AppLink, ErrorBanner, formatDate } from "./common";

export const LogsPage = () => {
  const logsQ = useQuery({ queryKey: ["logs"], queryFn: () => api.logs.list(), retry: false });
  const [query, setQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const endRef = useRef<HTMLDivElement | null>(null);
  const filteredLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const logs = logsQ.data?.logs ?? [];
    if (!normalized) {
      return logs;
    }
    return logs.filter((log) =>
      [log.source, log.type, log.taskId, log.message, log.createdAt].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [logsQ.data?.logs, query]);

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
        {logsQ.error && <ErrorBanner>{toErrorMessage(logsQ.error)}</ErrorBanner>}
        <Card>
          <CardHeader>
            <CardTitle>任务事件</CardTitle>
            <CardDescription>当前日志页先聚合已持久化任务事件；运行时服务日志将在后续日志系统接入。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center">
              <Input
                aria-label="搜索日志内容"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索日志内容..."
                value={query}
              />
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  checked={autoScroll}
                  className="h-4 w-4 rounded border-border bg-surface-low text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  type="checkbox"
                  onChange={(event) => setAutoScroll(event.target.checked)}
                />
                <span>自动滚动</span>
              </label>
              <Button variant="secondary" onClick={() => void logsQ.refetch()}>
                刷新
              </Button>
              <Button disabled={!query} variant="secondary" onClick={() => setQuery("")}>
                清空搜索
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <AppLink
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                to="/workbench"
              >
                打开工作台
              </AppLink>
              <span className="text-sm text-muted-foreground">
                {filteredLogs.length} / {logsQ.data?.logs.length ?? 0} 条
              </span>
            </div>
            <div className="grid max-h-[620px] overflow-auto rounded-quiet border border-border/50 bg-surface-low/40">
              {filteredLogs.map((log) => (
                <div className="grid gap-1 border-t border-border/40 px-4 py-3 first:border-t-0" key={log.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{log.source}</Badge>
                      <Badge>{log.type}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{log.taskId}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{log.message}</p>
                </div>
              ))}
              <div ref={endRef} />
              {filteredLogs.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {query ? "没有匹配的日志。" : "暂无日志。扫描媒体目录后，任务事件会显示在这里。"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};
