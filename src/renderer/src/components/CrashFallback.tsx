import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "未知错误";
};

export default function CrashFallback({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_38%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted))/0.3)] px-6 py-10">
      <div className="w-full max-w-xl rounded-3xl border bg-background/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600">
          <AlertTriangle className="h-6 w-6" />
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">渲染错误</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            当前页面没有正常渲染。可以先重试当前界面，若仍然失败再刷新整个应用。
          </p>
        </div>

        <div className="mt-6 rounded-2xl border bg-muted/35 p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Error</div>
          <div className="wrap-break-word font-mono text-sm leading-6 text-foreground/90">{toErrorMessage(error)}</div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重试界面
            </Button>
          )}
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新应用
          </Button>
        </div>
      </div>
    </div>
  );
}
