import { toErrorMessage } from "@mdcz/shared/error";
import { Button } from "@mdcz/ui";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { useT } from "../i18n";

export function CrashFallback({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const t = useT();
  const message = toErrorMessage(error, t.common.unknownError);

  return (
    <div className="flex h-full overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_38%),linear-gradient(180deg,var(--background),color-mix(in_srgb,var(--muted)_30%,transparent))] px-6 py-10">
      <div className="m-auto w-full max-w-xl rounded-3xl border bg-background/95 p-8 shadow-2xl backdrop-blur">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600">
          <AlertTriangle className="h-6 w-6" />
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t.shell.renderErrorTitle}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{t.shell.renderErrorDescription}</p>
        </div>

        <div className="mt-6 wrap-break-word rounded-2xl border bg-muted/35 p-4 font-mono text-sm leading-6 text-foreground/90">
          {message}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t.shell.retryView}
            </Button>
          )}
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t.shell.reloadApp}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Catches what the router's own boundary cannot: errors in the shell around the routes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }): void {
    console.error("Uncaught render error", error, errorInfo.componentStack);
  }

  render() {
    if (this.state.error) {
      return <CrashFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
