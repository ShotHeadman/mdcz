import type { MaintenancePreviewItem, PathDiff } from "@mdcz/shared/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
} from "@mdcz/ui";
import { PauseCircle, Play, StopCircle } from "lucide-react";
import { useState } from "react";
import { ReturnToWorkbenchSetupButton } from "../workbench/ReturnToWorkbenchSetupButton";

export interface MaintenanceBatchBarPreviewGroup {
  blockedError?: string;
  changedPathItems: Array<{ fileId: string; fileName: string; pathDiff: PathDiff }>;
  diffCount: number;
  hasPathChange: boolean;
  id: string;
  ready: boolean;
  subtitle: string;
  title: string;
}

export interface MaintenanceBatchBarViewProps {
  activeExecution: boolean;
  canPauseMaintenance: boolean;
  canReturnToSetup: boolean;
  canRunPrimaryAction: boolean;
  canRunReplacement: boolean;
  entriesCount: number;
  executeDialogOpen: boolean;
  groupedSelectedEntries: MaintenanceBatchBarPreviewGroup[];
  hasPreviewResults: boolean;
  onExecute: () => void;
  onExecuteDialogOpenChange: (open: boolean) => void;
  onPauseToggle: () => void;
  onPreview: () => Promise<MaintenancePreviewItem[] | null | undefined>;
  onReturnToSetup: () => void;
  onStop: () => void;
  paused: boolean;
  presetLabel: string;
  previewPending: boolean;
  progressValue: number;
  readyCount: number;
  selectedCount: number;
  stopping: boolean;
  supportsExecution: boolean;
  usesDiffView: boolean;
}

export function MaintenanceBatchBarView({
  activeExecution,
  canPauseMaintenance,
  canReturnToSetup,
  canRunPrimaryAction,
  canRunReplacement,
  entriesCount,
  executeDialogOpen,
  groupedSelectedEntries,
  hasPreviewResults,
  onExecute,
  onExecuteDialogOpenChange,
  onPauseToggle,
  onPreview,
  onReturnToSetup,
  onStop,
  paused,
  presetLabel,
  previewPending,
  progressValue,
  readyCount,
  selectedCount,
  stopping,
  supportsExecution,
  usesDiffView,
}: MaintenanceBatchBarViewProps) {
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const previewActionLabel = usesDiffView
    ? hasPreviewResults
      ? "刷新对比"
      : "生成对比"
    : hasPreviewResults
      ? "执行整理"
      : "生成整理预览";

  return (
    <>
      <div className="flex w-fit max-w-full flex-wrap items-center justify-center gap-2">
        {!activeExecution ? (
          <>
            <ReturnToWorkbenchSetupButton
              disabled={!canReturnToSetup}
              dialogDescription="返回后会清空当前维护列表、预览结果和执行记录。确定继续吗？"
              onConfirm={onReturnToSetup}
            />
            {supportsExecution && (
              <Button
                onClick={async () => {
                  if (!usesDiffView && hasPreviewResults) {
                    onExecute();
                    return;
                  }

                  await onPreview();
                }}
                disabled={!canRunPrimaryAction}
                className="h-9 rounded-lg px-4"
              >
                <Play className="mr-2 h-4 w-4" />
                {previewActionLabel}
              </Button>
            )}
            {usesDiffView && (
              <Button
                variant="secondary"
                onClick={() => onExecuteDialogOpenChange(true)}
                disabled={!canRunReplacement}
                className="h-9 rounded-lg px-4"
              >
                数据替换
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex min-w-44 items-center gap-3 px-1">
              <Progress value={progressValue} className="h-1.5 w-28 md:w-36" />
              <span className="w-10 font-numeric text-[11px] font-bold tabular-nums text-foreground">
                {Math.round(progressValue)}%
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-quiet-capsule"
              onClick={onPauseToggle}
              disabled={!canPauseMaintenance || stopping}
              aria-label={paused ? "恢复维护操作" : "暂停维护操作"}
              title={paused ? "恢复" : "暂停"}
            >
              {paused ? <Play className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              className="rounded-quiet-capsule"
              onClick={() => setStopDialogOpen(true)}
              disabled={stopping}
              aria-label="停止维护操作"
              title="停止"
            >
              <StopCircle className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <Dialog open={usesDiffView && executeDialogOpen} onOpenChange={onExecuteDialogOpenChange}>
        <DialogContent className="max-w-xl min-w-0 overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>确认数据替换</DialogTitle>
            <DialogDescription>这里会按当前预览结果，对已选条目批量写入元数据、图片和文件调整。</DialogDescription>
          </DialogHeader>
          {previewPending ? (
            <div className="space-y-3 py-2 text-sm text-muted-foreground">
              <div>正在分析本次维护将要修改的内容...</div>
            </div>
          ) : (
            <div className="min-w-0 space-y-4 text-sm">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                <span className="text-muted-foreground">预设</span>
                <span className="min-w-0 wrap-break-word">{presetLabel}</span>
                <span className="text-muted-foreground">选中</span>
                <span>
                  {selectedCount} / {entriesCount} 项
                </span>
                <span className="text-muted-foreground">可执行</span>
                <span>{readyCount} 项</span>
              </div>

              <div className="max-h-72 min-w-0 space-y-2 overflow-x-hidden overflow-y-auto rounded-xl border p-3">
                {groupedSelectedEntries.map((group) => (
                  <div key={group.id} className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{group.title}</div>
                        <div className="break-all text-xs text-muted-foreground">{group.subtitle}</div>
                      </div>
                      <div
                        className={
                          !group.ready
                            ? "shrink-0 whitespace-nowrap text-xs font-medium text-destructive"
                            : "shrink-0 whitespace-nowrap text-xs font-medium text-emerald-600"
                        }
                      >
                        {group.ready ? "可执行" : "阻塞"}
                      </div>
                    </div>

                    {!group.ready ? (
                      <div className="mt-2 break-all text-xs text-destructive">
                        {group.blockedError ?? "部分分盘文件无法完成预览"}
                      </div>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>字段差异 {group.diffCount} 项</span>
                          {group.hasPathChange && <span>路径将调整</span>}
                          {!group.hasPathChange && group.diffCount === 0 && <span>无额外变更</span>}
                        </div>
                        {group.hasPathChange && (
                          <div className="mt-3 space-y-2">
                            {group.changedPathItems.map(({ fileId, fileName, pathDiff }) => (
                              <div key={fileId} className="rounded-md border bg-background/50 p-2">
                                <div className="mb-2 text-[11px] font-medium text-muted-foreground">{fileName}</div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="min-w-0 rounded-md border bg-background/70 p-2">
                                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">当前路径</div>
                                    <div className="break-all font-mono text-[11px] leading-relaxed">
                                      {pathDiff.currentVideoPath}
                                    </div>
                                  </div>
                                  <div className="min-w-0 rounded-md border border-primary/20 bg-primary/5 p-2">
                                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">目标路径</div>
                                    <div className="break-all font-mono text-[11px] leading-relaxed">
                                      {pathDiff.targetVideoPath}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onExecuteDialogOpenChange(false)}>
              取消
            </Button>
            <Button
              disabled={previewPending || readyCount === 0}
              onClick={() => {
                onExecuteDialogOpenChange(false);
                onExecute();
              }}
            >
              {readyCount === 0 ? "无可执行项" : `开始批量执行 ${readyCount} 项`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>停止维护操作</DialogTitle>
            <DialogDescription>确定要停止当前维护流程吗？已完成的项目不受影响。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setStopDialogOpen(false);
                onStop();
              }}
            >
              确定停止
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
