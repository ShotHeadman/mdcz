import type { LogEntryDto } from "@mdcz/shared/serverDtos";
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
import { useT } from "@mdcz/views/i18n";
import { LogsPanelView } from "@mdcz/views/logs";
import { useLogStore } from "@mdcz/views/state/logStore";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getRuntimeLogSearchText,
  getVisualLogLevel,
  getVisualLogLevelLabel,
  stringifyRuntimeLogMessage,
} from "@/components/logviewer/logFormat";

const toLogEntryLevel = (level: string): LogEntryDto["level"] => {
  if (level === "OK" || level === "WARN" || level === "ERR" || level === "REQ" || level === "INFO") {
    return level;
  }
  return "INFO";
};

export const Route = createFileRoute("/logs")({
  component: LogsComponent,
});

function LogsComponent() {
  const t = useT();
  const { logs, clearLogs } = useLogStore();
  const [autoScroll, setAutoScroll] = useState(true);
  const [query, setQuery] = useState("");
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const logEntries = useMemo<LogEntryDto[]>(
    () =>
      logs.map((log) => {
        const visualLevel = getVisualLogLevel(log);
        return {
          id: log.id,
          createdAt: log.timestamp,
          level: toLogEntryLevel(getVisualLogLevelLabel(visualLevel)),
          message: stringifyRuntimeLogMessage(log.message),
          source: "runtime",
          taskId: "desktop",
          type: "runtime",
        };
      }),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const normalizedFilter = query.trim().toLowerCase();
    if (!normalizedFilter) return logEntries;
    const matchingIds = new Set(
      logs.filter((log) => getRuntimeLogSearchText(log).includes(normalizedFilter)).map((log) => log.id),
    );
    return logEntries.filter((log) => matchingIds.has(log.id));
  }, [logEntries, logs, query]);

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1240px] gap-7 px-6 py-8 lg:px-10 lg:py-10">
        <LogsPanelView
          autoScroll={autoScroll}
          emptyText={query ? t.desktop.logsNoMatch : t.desktop.logsEmpty}
          logs={filteredLogs}
          query={query}
          onAutoScrollChange={(nextValue) => {
            setAutoScroll(nextValue);
            toast.info(nextValue ? t.desktop.autoScrollEnabled : t.desktop.autoScrollDisabled);
          }}
          onClearRuntime={() => setIsClearDialogOpen(true)}
          onQueryChange={setQuery}
        />
        <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
          <DialogContent className="max-w-md gap-5 rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-6 shadow-[0_28px_90px_-44px_rgba(15,23,42,0.45)]">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle>{t.desktop.clearAllLogsTitle}</DialogTitle>
              <DialogDescription>{t.desktop.clearAllLogsDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {t.common.cancel}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  clearLogs();
                  setIsClearDialogOpen(false);
                  toast.success(t.desktop.logsCleared);
                }}
              >
                {t.desktop.confirmClear}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
