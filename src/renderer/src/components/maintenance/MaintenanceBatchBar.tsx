import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { getMaintenancePresetMeta, MAINTENANCE_PRESET_OPTIONS } from "@/components/maintenance/presetMeta";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Label } from "@/components/ui/Label";
import { Progress } from "@/components/ui/Progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useMaintenanceStore } from "@/store/maintenanceStore";

interface MaintenanceBatchBarProps {
  disabledByScrape: boolean;
  onScan: () => void;
  onPreview: () => Promise<boolean>;
  onExecute: () => void;
  onStop: () => void;
}

export default function MaintenanceBatchBar({
  disabledByScrape,
  onScan,
  onPreview,
  onExecute,
  onStop,
}: MaintenanceBatchBarProps) {
  const {
    entries,
    selectedIds,
    presetId,
    setPresetId,
    entriesCount,
    selectedCount,
    executionStatus,
    progressValue,
    progressCurrent,
    progressTotal,
    previewPending,
    previewResults,
    previewReadyCount,
    previewBlockedCount,
  } = useMaintenanceStore((state) => ({
    entries: state.entries,
    selectedIds: state.selectedIds,
    presetId: state.presetId,
    setPresetId: state.setPresetId,
    entriesCount: state.entries.length,
    selectedCount: state.selectedIds.length,
    executionStatus: state.executionStatus,
    progressValue: state.progressValue,
    progressCurrent: state.progressCurrent,
    progressTotal: state.progressTotal,
    previewPending: state.previewPending,
    previewResults: state.previewResults,
    previewReadyCount: state.previewReadyCount,
    previewBlockedCount: state.previewBlockedCount,
  }));

  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);

  const presetMeta = getMaintenancePresetMeta(presetId);
  const executing = executionStatus === "executing" || executionStatus === "stopping";
  const scanning = executionStatus === "scanning";
  const selectedEntries = entries.filter((entry) => selectedIds.includes(entry.id));

  return (
    <>
      <Card className="rounded-xl border shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <Label className="text-xs font-medium text-muted-foreground">预设</Label>
              <Select
                value={presetId}
                onValueChange={(value) => setPresetId(value as typeof presetId)}
                disabled={executing}
              >
                <SelectTrigger className="h-10 w-[180px] rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_PRESET_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!executing && entriesCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  已扫描 {entriesCount} 项 · 已选中 {selectedCount} 项
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!executing ? (
                <>
                  <Button variant="outline" onClick={onScan} disabled={disabledByScrape || scanning}>
                    {entriesCount > 0 ? "重新扫描" : "扫描目录"}
                  </Button>
                  <Button
                    onClick={async () => {
                      const ready = await onPreview();
                      if (ready) {
                        setExecuteDialogOpen(true);
                      }
                    }}
                    disabled={
                      disabledByScrape || scanning || previewPending || entriesCount === 0 || selectedCount === 0
                    }
                  >
                    {previewPending ? "正在预览..." : "开始执行"}
                  </Button>
                </>
              ) : (
                <Button variant="destructive" onClick={() => setStopDialogOpen(true)}>
                  停止执行
                </Button>
              )}
            </div>
          </div>

          {executing ? (
            <div className="space-y-3">
              <Progress value={progressValue} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {executionStatus === "stopping"
                    ? "正在停止维护操作..."
                    : `执行中 ${progressCurrent}/${progressTotal || selectedCount}`}
                </span>
                <span>{Math.round(progressValue)}%</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{presetMeta.description}</p>
              {disabledByScrape && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  正常刮削进行中，维护模式已锁定。
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={executeDialogOpen} onOpenChange={setExecuteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>确认执行维护操作</DialogTitle>
            <DialogDescription>请确认本次维护预设和预览结果。</DialogDescription>
          </DialogHeader>
          {previewPending ? (
            <div className="space-y-3 py-2 text-sm text-muted-foreground">
              <div>正在分析本次维护将要修改的内容...</div>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
                <span className="text-muted-foreground">预设</span>
                <span>{presetMeta.label}</span>
                <span className="text-muted-foreground">选中</span>
                <span>
                  {selectedCount} / {entriesCount} 项
                </span>
                <span className="text-muted-foreground">可执行</span>
                <span>{previewReadyCount} 项</span>
                <span className="text-muted-foreground">阻塞</span>
                <span>{previewBlockedCount} 项</span>
              </div>

              <div className="space-y-2">
                <div className="text-muted-foreground">此操作将:</div>
                <div className="space-y-1">
                  {presetMeta.executeSummary.map((line) => (
                    <div key={line}>· {line}</div>
                  ))}
                </div>
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border p-3">
                {selectedEntries.map((entry) => {
                  const preview = previewResults[entry.id];
                  const diffCount = preview?.fieldDiffs?.length ?? 0;
                  const hasPathChange = Boolean(preview?.pathDiff?.changed);

                  return (
                    <div key={entry.id} className="rounded-lg border bg-muted/20 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{entry.fileInfo.number}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {entry.crawlerData?.title_zh ?? entry.crawlerData?.title ?? entry.fileInfo.fileName}
                          </div>
                        </div>
                        <div
                          className={
                            preview?.status === "blocked"
                              ? "text-xs font-medium text-destructive"
                              : "text-xs font-medium text-emerald-600"
                          }
                        >
                          {preview?.status === "blocked" ? "阻塞" : "可执行"}
                        </div>
                      </div>

                      {preview?.status === "blocked" ? (
                        <div className="mt-2 text-xs text-destructive">{preview.error}</div>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>字段差异 {diffCount} 项</span>
                          {hasPathChange && <span>路径将调整</span>}
                          {!hasPathChange && diffCount === 0 && <span>无额外变更</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecuteDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={previewPending || previewReadyCount === 0}
              onClick={() => {
                setExecuteDialogOpen(false);
                onExecute();
              }}
            >
              {previewReadyCount === 0 ? "无可执行项" : `确认执行 ${previewReadyCount} 项`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>停止维护操作</DialogTitle>
            <DialogDescription>确定要停止当前维护操作吗？已完成的项目不受影响。</DialogDescription>
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
