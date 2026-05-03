import { Button, cn } from "@mdcz/ui";
import { FolderCog, Play, Telescope } from "lucide-react";
import { formatBytes } from "./format";

export interface OverviewHeroStartCardProps {
  className?: string;
  data?: {
    fileCount: number;
    totalBytes: number;
    rootPath: string | null;
  } | null;
  hasConfiguredOutput?: boolean;
  isError?: boolean;
  isLoading?: boolean;
  labels?: {
    startAction: string;
    setupAction: string;
  };
  onStart: () => void;
  onSetup: () => void;
}

export function OverviewHeroStartCard({
  className,
  data,
  hasConfiguredOutput = false,
  isError = false,
  isLoading = false,
  labels = { startAction: "去工作台", setupAction: "去设置" },
  onStart,
  onSetup,
}: OverviewHeroStartCardProps) {
  const hasOutputRoot = Boolean(data?.rootPath);
  const canStart = isLoading || isError || hasOutputRoot || hasConfiguredOutput;

  return (
    <section
      className={cn(
        "relative flex min-h-[280px] flex-col justify-between overflow-hidden rounded-quiet-xl bg-[linear-gradient(135deg,#050505_0%,#111111_56%,#2f3131_100%)] p-7 text-white shadow-none md:p-8",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.13),transparent_28%,rgba(255,255,255,0.05)_100%)]" />

      <div className="relative z-10 flex items-start justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">开始刮削</h2>
          <p className="mt-3 max-w-lg text-lg leading-8 text-white/66">
            进入工作台执行元数据提取。当前输出目录概况会在完成刮削后保持更新。
          </p>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-quiet-lg bg-white/10 text-white/55">
          <Telescope className="h-6 w-6" />
        </div>
      </div>

      <div className="relative z-10 mt-10 flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex gap-7">
          {isLoading ? (
            <>
              <MetricBlock label="Files" value="..." />
              <MetricBlock label="Size" value="..." />
            </>
          ) : isError ? (
            <>
              <MetricBlock label="Files" value="-" />
              <MetricBlock label="Size" value="加载失败" />
            </>
          ) : hasOutputRoot ? (
            <>
              <MetricBlock label="Files" value={data?.fileCount ?? 0} />
              <MetricBlock label="Size" value={formatBytes(data?.totalBytes ?? 0)} />
            </>
          ) : hasConfiguredOutput ? (
            <>
              <MetricBlock label="Files" value={0} />
              <MetricBlock label="Size" value="等待首次刮削" />
            </>
          ) : (
            <>
              <MetricBlock label="Files" value="-" />
              <MetricBlock label="Size" value="未配置" />
            </>
          )}
        </div>

        <Button
          type="button"
          className="h-14 rounded-quiet-capsule bg-primary-foreground px-8! font-bold text-primary hover:bg-primary-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
          onClick={canStart ? onStart : onSetup}
        >
          {canStart ? <Play className="h-4 w-4 fill-current" /> : <FolderCog className="h-4 w-4" />}
          {canStart ? labels.startAction : labels.setupAction}
        </Button>
      </div>
    </section>
  );
}

function MetricBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-sm font-medium text-white/54">{label}</div>
      <div className="mt-1 font-numeric text-xl font-bold tracking-tight text-white">{value}</div>
    </div>
  );
}
