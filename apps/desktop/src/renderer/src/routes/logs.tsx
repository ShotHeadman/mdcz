import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownToLine, Eraser, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LogList } from "@/components/logviewer/LogList";
import { getRuntimeLogSearchText } from "@/components/logviewer/logFormat";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useLogStore } from "@/store/logStore";

export const Route = createFileRoute("/logs")({
  component: LogsComponent,
});

function LogsComponent() {
  const { logs, clearLogs } = useLogStore();
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  const filteredLogs = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) {
      return logs;
    }

    return logs.filter((log) => getRuntimeLogSearchText(log).includes(normalizedFilter));
  }, [logs, filter]);

  return (
    <div className="h-full overflow-hidden bg-surface-canvas">
      <main className="mx-auto flex h-full w-full max-w-[1240px] flex-col px-5 py-4 sm:px-6 md:px-8 lg:px-10 lg:py-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="relative w-full min-w-0 sm:mr-auto sm:max-w-[360px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              placeholder="搜索日志内容..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-11 rounded-[var(--radius-quiet-capsule)] pl-11 pr-4 shadow-none"
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            className={cn(
              "h-11 gap-2 px-4",
              autoScroll &&
                "border-primary/15 bg-primary text-primary-foreground shadow-[0_16px_34px_-22px_rgba(15,23,42,0.65)] hover:bg-primary/92",
            )}
            onClick={() => {
              const nextValue = !autoScroll;
              setAutoScroll(nextValue);
              toast.info(nextValue ? "已开启自动滚动" : "已关闭自动滚动");
            }}
          >
            <ArrowDownToLine className={cn("h-4 w-4", !autoScroll && "opacity-60")} />
            <span className="text-sm font-medium">自动滚动</span>
          </Button>

          <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
            <Button
              type="button"
              variant="secondary"
              className="h-11 gap-2 px-4 text-foreground hover:border-destructive/15 hover:bg-destructive/5 hover:text-destructive"
              onClick={() => setIsClearDialogOpen(true)}
            >
              <Eraser className="h-4 w-4" />
              <span className="text-sm font-medium">清空</span>
            </Button>
            <DialogContent className="max-w-md gap-5 rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating p-6 shadow-[0_28px_90px_-44px_rgba(15,23,42,0.45)]">
              <DialogHeader className="space-y-2 text-left">
                <DialogTitle>清空所有日志</DialogTitle>
                <DialogDescription>确定要清空所有日志内容吗？此操作不可撤销。</DialogDescription>
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
                  onClick={() => {
                    clearLogs();
                    setIsClearDialogOpen(false);
                    toast.success("日志已成功清空");
                  }}
                >
                  确定清空
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <section className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-quiet-xl)] border border-border/50 bg-surface-floating/96 p-1.5 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.42)] sm:p-2">
          <div className="min-h-0 flex-1">
            <LogList items={filteredLogs} autoScroll={autoScroll} />
          </div>
        </section>
      </main>
    </div>
  );
}
