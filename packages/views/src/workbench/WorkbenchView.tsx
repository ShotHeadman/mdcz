import type { MediaRootDto, RootBrowserEntryDto, ScanTaskDto, ScrapeFileRefDto, ScrapeResultDto } from "@mdcz/shared";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input, Label } from "@mdcz/ui";
import { FileText, FolderOpen, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export interface WorkbenchViewLabels {
  formatDate: (value: string | null | undefined) => string;
  scanStatus: Record<ScanTaskDto["status"], string>;
  taskKind: Record<ScanTaskDto["kind"], string>;
}

export interface WorkbenchViewProps {
  activeEditor?: ReactNode;
  browserEntries: RootBrowserEntryDto[];
  browserLink?: ReactNode;
  enabledRoots: MediaRootDto[];
  errorMessage?: string | null;
  isStarting?: boolean;
  labels: WorkbenchViewLabels;
  manualUrl: string;
  mediaRootsLink?: ReactNode;
  results: ScrapeResultDto[];
  selectedRefs: ScrapeFileRefDto[];
  selectedRootId: string;
  tasks: ScanTaskDto[];
  onDeleteResult: (result: ScrapeResultDto) => void;
  onManualUrlChange: (value: string) => void;
  onRefreshTasks: () => void;
  onResultSelect: (resultId: string) => void;
  onRootChange: (rootId: string) => void;
  onScanRoot: (rootId: string) => void;
  onStartScrape: () => void;
  onTaskControl: (action: "pause" | "resume" | "stop" | "retry", taskId: string) => void;
  onToggleRef: (ref: ScrapeFileRefDto) => void;
  renderBrowserDirectoryLink?: (result: ScrapeResultDto) => ReactNode;
  renderTaskLink?: (task: ScanTaskDto) => ReactNode;
}

export function WorkbenchView({
  activeEditor,
  browserEntries,
  browserLink,
  enabledRoots,
  errorMessage,
  isStarting = false,
  labels,
  manualUrl,
  mediaRootsLink,
  results,
  selectedRefs,
  selectedRootId,
  tasks,
  onDeleteResult,
  onManualUrlChange,
  onRefreshTasks,
  onResultSelect,
  onRootChange,
  onScanRoot,
  onStartScrape,
  onTaskControl,
  onToggleRef,
  renderBrowserDirectoryLink,
  renderTaskLink,
}: WorkbenchViewProps) {
  const selectedKeys = new Set(selectedRefs.map((ref) => `${ref.rootId}:${ref.relativePath}`));

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">工作台</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            从挂载媒体目录选择文件，启动 WebUI 刮削任务，review 元数据并编辑 NFO。
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>扫描媒体目录</CardTitle>
            <CardDescription>选择一个已启用媒体目录开始扫描，扫描结果会成为媒体库与刮削候选。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {mediaRootsLink}
              {browserLink}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {enabledRoots.map((root) => (
                <Button key={root.id} onClick={() => onScanRoot(root.id)} type="button" variant="secondary">
                  <FolderOpen className="h-4 w-4" />
                  {root.displayName}
                </Button>
              ))}
              <Button onClick={onRefreshTasks} type="button" variant="secondary">
                刷新
              </Button>
            </div>
            {enabledRoots.length === 0 && (
              <p className="text-sm text-muted-foreground">没有已启用的媒体目录。先到媒体目录页面添加挂载路径。</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-7 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Card>
            <CardHeader>
              <CardTitle>选择刮削文件</CardTitle>
              <CardDescription>文件引用只保存 rootId + 相对路径，不暴露宿主绝对路径。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>扫描目录</Label>
                <select
                  className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm"
                  onChange={(event) => onRootChange(event.target.value)}
                  value={selectedRootId}
                >
                  {enabledRoots.map((root) => (
                    <option key={root.id} value={root.id}>
                      {root.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-1">
                {browserEntries
                  .filter((entry) => entry.type === "file")
                  .map((entry) => {
                    const ref = { rootId: selectedRootId, relativePath: entry.relativePath };
                    const selected = selectedKeys.has(`${ref.rootId}:${ref.relativePath}`);
                    return (
                      <button
                        className={cn(
                          "rounded-quiet border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected
                            ? "border-primary/50 bg-primary/10"
                            : "border-border/60 bg-surface-low hover:bg-surface-raised",
                        )}
                        key={entry.relativePath}
                        onClick={() => onToggleRef(ref)}
                        type="button"
                      >
                        <span className="block truncate font-medium text-foreground">{entry.name}</span>
                        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                          {entry.relativePath}
                        </span>
                      </button>
                    );
                  })}
              </div>
              <div className="grid gap-2">
                <Label>手动 URL 重刮削</Label>
                <Input
                  onChange={(event) => onManualUrlChange(event.target.value)}
                  placeholder="可选：粘贴站点详情页 URL"
                  value={manualUrl}
                />
              </div>
              <Button disabled={selectedRefs.length === 0 || isStarting} onClick={onStartScrape} type="button">
                <Play className="h-4 w-4" />
                启动刮削（{selectedRefs.length}）
              </Button>
              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>刮削任务</CardTitle>
              <CardDescription>支持暂停、恢复、停止与失败重试。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  labels={labels}
                  link={renderTaskLink?.(task)}
                  onControl={(action) => onTaskControl(action, task.id)}
                  task={task}
                />
              ))}
              {tasks.length === 0 && <p className="text-sm text-muted-foreground">暂无刮削任务。</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>刮削结果</CardTitle>
            <CardDescription>选择结果查看桌面一致字段，并可保存 NFO 或删除源文件。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {results.map((result) => (
              <div
                className="grid gap-3 rounded-quiet border border-border/60 bg-surface-low p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                key={result.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{result.crawlerData?.title ?? result.fileName}</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {result.rootDisplayName} / {result.relativePath}
                  </p>
                  {result.error && <p className="mt-1 text-xs text-destructive">{result.error}</p>}
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button onClick={() => onResultSelect(result.id)} type="button" variant="secondary">
                    Review
                  </Button>
                  <Button
                    disabled={!result.nfoRelativePath}
                    onClick={() => onResultSelect(result.id)}
                    type="button"
                    variant="secondary"
                  >
                    <FileText className="h-4 w-4" />
                    NFO
                  </Button>
                  {renderBrowserDirectoryLink?.(result)}
                  <Button onClick={() => onDeleteResult(result)} type="button" variant="secondary">
                    <Trash2 className="h-4 w-4" />
                    删除文件
                  </Button>
                </div>
              </div>
            ))}
            {results.length === 0 && <p className="text-sm text-muted-foreground">暂无刮削结果。</p>}
          </CardContent>
        </Card>

        {activeEditor}
      </div>
    </main>
  );
}

function TaskCard({
  labels,
  link,
  onControl,
  task,
}: {
  labels: WorkbenchViewLabels;
  link?: ReactNode;
  onControl: (action: "pause" | "resume" | "stop" | "retry") => void;
  task: ScanTaskDto;
}) {
  return (
    <div className="rounded-quiet border border-border/60 bg-surface-low p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">
            {`${labels.taskKind[task.kind]} · ${task.rootDisplayName} · ${labels.scanStatus[task.status]}`}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{task.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={task.status !== "running"}
            onClick={() => onControl("pause")}
            type="button"
            variant="secondary"
          >
            <Pause className="h-4 w-4" />
            暂停
          </Button>
          <Button
            disabled={task.status !== "paused"}
            onClick={() => onControl("resume")}
            type="button"
            variant="secondary"
          >
            <Play className="h-4 w-4" />
            恢复
          </Button>
          <Button
            disabled={task.status !== "running" && task.status !== "queued" && task.status !== "paused"}
            onClick={() => onControl("stop")}
            type="button"
            variant="secondary"
          >
            <Square className="h-4 w-4" />
            停止
          </Button>
          <Button
            disabled={task.status === "queued" || task.status === "running"}
            onClick={() => onControl("retry")}
            type="button"
            variant="secondary"
          >
            <RotateCcw className="h-4 w-4" />
            重试
          </Button>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{task.error ?? `${task.videoCount} 个文件`}</p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">
        创建 {labels.formatDate(task.createdAt)} · 更新 {labels.formatDate(task.updatedAt)}
      </p>
      {link}
    </div>
  );
}
