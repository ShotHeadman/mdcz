import type {
  MaintenanceApplyInput,
  MaintenancePresetIdDto,
  MaintenancePreviewItemDto,
  MediaRootDto,
  ScanTaskDto,
} from "@mdcz/shared";
import { MAINTENANCE_PRESET_OPTIONS } from "@mdcz/shared/maintenancePresets";
import type { FieldDiff, MaintenancePreviewItem } from "@mdcz/shared/types";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Progress,
} from "@mdcz/ui";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ChangeDiffView } from "./ChangeDiffView";
import { PathPlanView } from "./PathPlanView";

export interface MaintenanceViewLabels {
  formatDate: (value: string | null | undefined) => string;
  scanStatus: Record<ScanTaskDto["status"], string>;
}

export interface MaintenanceApplyRequest {
  previewIds?: MaintenanceApplyInput["previewIds"];
  selections?: MaintenanceApplyInput["selections"];
}

export interface MaintenanceViewProps {
  activeTaskId: string | null;
  applyDisabled?: boolean;
  enabledRoots: MediaRootDto[];
  errorMessage?: string | null;
  isApplying?: boolean;
  isStarting?: boolean;
  labels: MaintenanceViewLabels;
  mediaRootsLink?: ReactNode;
  previewItems: MaintenancePreviewItemDto[];
  presetId: MaintenancePresetIdDto;
  rootId: string;
  tasks: ScanTaskDto[];
  onApply: (input: MaintenanceApplyRequest) => void;
  onPresetChange: (presetId: MaintenancePresetIdDto) => void;
  onRefresh: () => void;
  onRootChange: (rootId: string) => void;
  onStart: () => void;
  onTaskControl: (action: "pause" | "resume" | "stop" | "retry", taskId: string) => void;
  onTaskSelect: (taskId: string) => void;
}

const diffPresetIds = new Set<MaintenancePresetIdDto>(["refresh_data", "rebuild_all"]);

const toFieldDiffs = (diffs: MaintenancePreviewItemDto["fieldDiffs"]): FieldDiff[] => diffs as FieldDiff[];

const toPreviewForDiffView = (item: MaintenancePreviewItemDto): MaintenancePreviewItem => ({
  fileId: item.id,
  status: item.status === "ready" || item.status === "applied" ? "ready" : "blocked",
  error: item.error ?? undefined,
  fieldDiffs: toFieldDiffs(item.fieldDiffs),
  unchangedFieldDiffs: toFieldDiffs(item.unchangedFieldDiffs),
  pathDiff: item.pathDiff ?? undefined,
  proposedCrawlerData: item.proposedCrawlerData ?? undefined,
});

const getTaskProgress = (task: ScanTaskDto | null): number => {
  if (!task) return 0;
  if (task.status === "completed") return 100;
  if (task.status === "failed") return 100;
  if (task.status === "paused") return 55;
  if (task.status === "running") return 45;
  if (task.status === "queued") return 12;
  return 0;
};

export function MaintenanceView({
  activeTaskId,
  applyDisabled = false,
  enabledRoots,
  errorMessage,
  isApplying = false,
  isStarting = false,
  labels,
  mediaRootsLink,
  previewItems,
  presetId,
  rootId,
  tasks,
  onApply,
  onPresetChange,
  onRefresh,
  onRootChange,
  onStart,
  onTaskControl,
  onTaskSelect,
}: MaintenanceViewProps) {
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null;
  const readyCount = previewItems.filter((item) => item.status === "ready" || item.status === "applied").length;
  const blockedCount = previewItems.filter((item) => item.status === "blocked" || item.status === "failed").length;
  const usesDiffView = diffPresetIds.has(presetId);
  const hasPreviewResults = previewItems.length > 0;
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<string[]>([]);
  const [fieldSelections, setFieldSelections] = useState<Record<string, Record<string, "old" | "new">>>({});
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const activePreview = previewItems.find((item) => item.id === activePreviewId) ?? previewItems[0] ?? null;
  const readyPreviewIds = useMemo(
    () => previewItems.filter((item) => item.status === "ready" || item.status === "applied").map((item) => item.id),
    [previewItems],
  );
  const selectedReadyIds = selectedPreviewIds.filter((id) => readyPreviewIds.includes(id));
  const selectedItems = previewItems.filter((item) => selectedPreviewIds.includes(item.id));
  const selectedReadyItems = selectedItems.filter((item) => item.status === "ready" || item.status === "applied");
  const allReadySelected = readyPreviewIds.length > 0 && readyPreviewIds.every((id) => selectedPreviewIds.includes(id));
  const someReadySelected = readyPreviewIds.some((id) => selectedPreviewIds.includes(id));
  const progressValue = getTaskProgress(activeTask);
  const previewActionLabel = usesDiffView
    ? hasPreviewResults
      ? "刷新对比"
      : "生成对比"
    : hasPreviewResults
      ? "刷新整理预览"
      : "生成整理预览";
  const executeActionLabel = usesDiffView ? "数据替换" : "执行整理";

  useEffect(() => {
    if (activePreviewId && previewItems.some((item) => item.id === activePreviewId)) return;
    setActivePreviewId(previewItems[0]?.id ?? null);
  }, [activePreviewId, previewItems]);

  useEffect(() => {
    setSelectedPreviewIds((current) => {
      const existing = current.filter((id) => readyPreviewIds.includes(id));
      return existing.length > 0 ? existing : readyPreviewIds;
    });
  }, [readyPreviewIds]);

  const applySelections = useMemo<MaintenanceApplyInput["selections"]>(() => {
    const selectedSet = new Set(selectedReadyIds);
    const selections = Object.entries(fieldSelections)
      .filter(([previewId, values]) => selectedSet.has(previewId) && Object.keys(values).length > 0)
      .map(([previewId, values]) => ({ previewId, fieldSelections: values }));
    return selections.length > 0 ? selections : undefined;
  }, [fieldSelections, selectedReadyIds]);

  const selectField = (previewId: string, field: string, side: "old" | "new") => {
    setFieldSelections((current) => ({
      ...current,
      [previewId]: {
        ...current[previewId],
        [field]: side,
      },
    }));
  };

  const togglePreview = (previewId: string) => {
    setSelectedPreviewIds((current) =>
      current.includes(previewId) ? current.filter((id) => id !== previewId) : [...current, previewId],
    );
  };

  const toggleAllReady = () => {
    setSelectedPreviewIds(allReadySelected ? [] : readyPreviewIds);
  };

  const submitApply = () => {
    onApply({
      previewIds: selectedReadyIds,
      selections: applySelections,
    });
  };

  return (
    <main className="h-full overflow-hidden bg-surface-canvas text-foreground">
      <div className="flex h-full min-h-0 flex-col gap-4 px-6 py-6 lg:px-8">
        <header className="flex shrink-0 flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">维护</h1>
            <p className="mt-2 text-sm text-muted-foreground">预览、对比并应用桌面一致的维护预设。</p>
          </div>
          {mediaRootsLink}
        </header>

        <section className="grid shrink-0 gap-4 rounded-quiet-lg border border-border/60 bg-surface p-4 lg:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.4fr)_auto] lg:items-end">
          <div className="grid gap-2">
            <Label>媒体目录</Label>
            <select
              className="h-10 rounded-quiet border border-border bg-surface-low px-3 text-sm"
              onChange={(event) => onRootChange(event.target.value)}
              value={rootId}
            >
              {enabledRoots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label>维护预设</Label>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {MAINTENANCE_PRESET_OPTIONS.map((preset) => (
                <button
                  className={cn(
                    "rounded-quiet border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    preset.id === presetId
                      ? "border-primary/50 bg-primary/10"
                      : "border-border/60 bg-surface-low hover:bg-surface-raised",
                  )}
                  key={preset.id}
                  onClick={() => onPresetChange(preset.id)}
                  type="button"
                >
                  <span className="block text-sm font-semibold text-foreground">{preset.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!rootId || isStarting} onClick={onStart} type="button">
              <Play className="h-4 w-4" />
              {previewActionLabel}
            </Button>
            <Button onClick={onRefresh} type="button" variant="secondary">
              刷新
            </Button>
          </div>
          {enabledRoots.length === 0 && <p className="text-sm text-muted-foreground">没有已启用的媒体目录。</p>}
          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        </section>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
          <Card className="min-h-0 overflow-hidden">
            <CardHeader>
              <CardTitle>任务与项目</CardTitle>
              <CardDescription>
                {activeTask
                  ? `${labels.scanStatus[activeTask.status]} · ${readyCount} 可应用 · ${blockedCount} 阻塞`
                  : "暂无任务"}
              </CardDescription>
              {activeTask && (
                <div className="flex items-center gap-3 pt-2">
                  <Progress value={progressValue} className="h-1.5" />
                  <span className="w-10 text-right font-numeric text-[11px] font-bold tabular-nums text-muted-foreground">
                    {Math.round(progressValue)}%
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent className="grid max-h-full min-h-0 gap-4 overflow-y-auto">
              <div className="grid gap-2">
                {tasks.map((task) => (
                  <button
                    className={cn(
                      "rounded-quiet border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      activeTaskId === task.id
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/60 bg-surface-low hover:bg-surface-raised",
                    )}
                    key={task.id}
                    onClick={() => onTaskSelect(task.id)}
                    type="button"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{labels.scanStatus[task.status]}</span>
                      <span className="font-numeric text-xs text-muted-foreground">{task.videoCount} 项</span>
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{task.id}</span>
                  </button>
                ))}
                {tasks.length === 0 && <p className="text-sm text-muted-foreground">暂无维护任务。</p>}
              </div>
              <div className="flex items-center gap-2 rounded-quiet bg-surface-low px-3 py-2 text-sm">
                <Checkbox
                  checked={allReadySelected ? true : someReadySelected ? "indeterminate" : false}
                  disabled={readyPreviewIds.length === 0}
                  onCheckedChange={toggleAllReady}
                />
                <span>
                  全选 ({selectedReadyIds.length}/{readyPreviewIds.length})
                </span>
              </div>
              <div className="grid gap-2">
                {previewItems.map((item) => {
                  const selectable = item.status === "ready" || item.status === "applied";
                  return (
                    <button
                      className={cn(
                        "rounded-quiet border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        activePreview?.id === item.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/60 bg-surface-low hover:bg-surface-raised",
                      )}
                      key={item.id}
                      onClick={() => setActivePreviewId(item.id)}
                      type="button"
                    >
                      <span className="flex items-start gap-2">
                        <Checkbox
                          checked={selectedPreviewIds.includes(item.id)}
                          disabled={!selectable}
                          onCheckedChange={() => togglePreview(item.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{item.fileName}</span>
                            <span className="text-xs text-muted-foreground">
                              {selectable ? "可执行" : item.status === "failed" ? "失败" : "阻塞"}
                            </span>
                          </span>
                          <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                            {item.relativePath}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-0 overflow-hidden">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{activePreview?.fileName ?? "预览"}</CardTitle>
                  <CardDescription>
                    {activePreview ? activePreview.relativePath : "选择项目查看字段对比和路径计划"}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!activeTask || activeTask.status !== "running"}
                    onClick={() => activeTask && onTaskControl("pause", activeTask.id)}
                    type="button"
                    variant="secondary"
                  >
                    <Pause className="h-4 w-4" />
                    暂停
                  </Button>
                  <Button
                    disabled={!activeTask || activeTask.status !== "paused"}
                    onClick={() => activeTask && onTaskControl("resume", activeTask.id)}
                    type="button"
                    variant="secondary"
                  >
                    <Play className="h-4 w-4" />
                    恢复
                  </Button>
                  <Button
                    disabled={!activeTask || (activeTask.status !== "running" && activeTask.status !== "queued")}
                    onClick={() => activeTask && onTaskControl("stop", activeTask.id)}
                    type="button"
                    variant="secondary"
                  >
                    <Square className="h-4 w-4" />
                    停止
                  </Button>
                  <Button
                    disabled={!activeTask || activeTask.status === "running" || activeTask.status === "queued"}
                    onClick={() => activeTask && onTaskControl("retry", activeTask.id)}
                    type="button"
                    variant="secondary"
                  >
                    <RotateCcw className="h-4 w-4" />
                    重试
                  </Button>
                  <Button
                    disabled={!activeTask || applyDisabled || isApplying || selectedReadyIds.length === 0}
                    onClick={() => setExecuteDialogOpen(true)}
                    type="button"
                  >
                    {executeActionLabel}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto">
              {activePreview ? (
                <div className="grid gap-4">
                  {activePreview.error && <p className="text-sm text-destructive">{activePreview.error}</p>}
                  {activePreview.pathDiff && <PathPlanView pathDiff={activePreview.pathDiff} />}
                  <ChangeDiffView
                    fileId={activePreview.id}
                    diffs={toFieldDiffs(activePreview.fieldDiffs)}
                    unchangedDiffs={toFieldDiffs(activePreview.unchangedFieldDiffs)}
                    hasResult
                    preview={toPreviewForDiffView(activePreview)}
                    fieldSelections={fieldSelections[activePreview.id] ?? {}}
                    onFieldSelectionChange={selectField}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无预览项。</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={executeDialogOpen} onOpenChange={setExecuteDialogOpen}>
        <DialogContent className="max-w-xl min-w-0 overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{usesDiffView ? "确认数据替换" : "确认执行整理"}</DialogTitle>
            <DialogDescription>
              {usesDiffView
                ? "这里会按当前预览结果，对已选条目批量写入元数据、图片和文件调整。"
                : "这里会按当前整理预览，对已选条目批量调整目录和文件。"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4 text-sm">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
              <span className="text-muted-foreground">预设</span>
              <span className="min-w-0 wrap-break-word">
                {MAINTENANCE_PRESET_OPTIONS.find((preset) => preset.id === presetId)?.label ?? presetId}
              </span>
              <span className="text-muted-foreground">选中</span>
              <span>
                {selectedReadyIds.length} / {readyPreviewIds.length} 项
              </span>
              <span className="text-muted-foreground">可执行</span>
              <span>{selectedReadyItems.length} 项</span>
              <span className="text-muted-foreground">阻塞</span>
              <span>{blockedCount} 项</span>
            </div>

            <div className="max-h-72 min-w-0 space-y-2 overflow-x-hidden overflow-y-auto rounded-xl border p-3">
              {selectedItems.map((item) => (
                <div key={item.id} className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{item.fileName}</div>
                      <div className="break-all text-xs text-muted-foreground">{item.relativePath}</div>
                    </div>
                    <div
                      className={
                        item.status !== "ready" && item.status !== "applied"
                          ? "shrink-0 whitespace-nowrap text-xs font-medium text-destructive"
                          : "shrink-0 whitespace-nowrap text-xs font-medium text-emerald-600"
                      }
                    >
                      {item.status === "ready" || item.status === "applied" ? "可执行" : "阻塞"}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>字段差异 {item.fieldDiffs.filter((diff) => diff.changed).length} 项</span>
                    {item.pathDiff?.changed && <span>路径将调整</span>}
                    {!item.pathDiff?.changed && item.fieldDiffs.filter((diff) => diff.changed).length === 0 && (
                      <span>无额外变更</span>
                    )}
                  </div>
                  {item.error && <div className="mt-2 break-all text-xs text-destructive">{item.error}</div>}
                </div>
              ))}
              {selectedItems.length === 0 && <p className="text-sm text-muted-foreground">尚未选择可执行项目。</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecuteDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={isApplying || selectedReadyIds.length === 0}
              onClick={() => {
                setExecuteDialogOpen(false);
                submitApply();
              }}
            >
              {selectedReadyIds.length === 0 ? "无可执行项" : `开始批量执行 ${selectedReadyIds.length} 项`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
