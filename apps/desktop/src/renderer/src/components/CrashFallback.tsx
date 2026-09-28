import { toErrorMessage } from "@mdcz/shared/error";
import { Button } from "@mdcz/ui";
import { useT } from "@mdcz/views/i18n";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";

export default function CrashFallback({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const t = useT();
  const message = toErrorMessage(error, t.common.unknownError);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_38%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted))/0.3)] px-6 py-10">
      <div className="w-full max-w-xl rounded-3xl border bg-background/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600">
          <AlertTriangle className="h-6 w-6" />
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t.desktop.renderErrorTitle}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{t.desktop.renderErrorDescription}</p>
        </div>

        <div className="mt-6 rounded-2xl border bg-muted/35 p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Error</div>
          <div className="wrap-break-word font-mono text-sm leading-6 text-foreground/90">{message}</div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t.desktop.retryView}
            </Button>
          )}
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t.desktop.reloadApp}
          </Button>
        </div>
      </div>
    </div>
  );
}
