import type { MaintenanceItemResult, MaintenancePresetId, PathDiff } from "@mdcz/shared/types";
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
import { useT } from "../i18n";
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
  onPreview: () => Promise<void>;
  onReturnToSetup: () => void;
  onStop: () => void;
  onRerunDirectory?: () => void;
  paused: boolean;
  presetLabel: string;
  previewPending: boolean;
  progressValue: number | null;
  readyCount: number;
  recentResults: MaintenanceItemResult[];
  selectedCount: number;
  stopping: boolean;
  presetId: MaintenancePresetId;
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
  onRerunDirectory,
  paused,
  presetLabel,
  previewPending,
  progressValue,
  readyCount,
  recentResults,
  selectedCount,
  stopping,
  presetId,
}: MaintenanceBatchBarViewProps) {
  const t = useT();
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const usesDiffView = presetId === "refresh_metadata" || presetId === "rebuild_all";
  const previewActionLabel = usesDiffView
    ? hasPreviewResults
      ? t.maintenance.refreshDiff
      : t.maintenance.generateDiff
    : presetId === "import_local"
      ? hasPreviewResults
        ? t.maintenance.executeImport
        : t.maintenance.generateImportPreview
      : hasPreviewResults
        ? t.maintenance.executeOrganize
        : t.maintenance.generateOrganizePreview;

  return (
    <>
      <div className="flex w-fit max-w-full flex-wrap items-center justify-center gap-2">
        {!activeExecution ? (
          <>
            {onRerunDirectory ? (
              <Button variant="ghost" onClick={onRerunDirectory}>
                {t.maintenance.reexecuteMaintenance}
              </Button>
            ) : null}
            <ReturnToWorkbenchSetupButton
              disabled={!canReturnToSetup}
              dialogDescription={t.maintenance.returnDescription}
              onConfirm={onReturnToSetup}
            />
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
            {usesDiffView && (
              <Button
                variant="secondary"
                onClick={() => onExecuteDialogOpenChange(true)}
                disabled={!canRunReplacement}
                className="h-9 rounded-lg px-4"
              >
                {t.maintenance.dataReplace}
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex min-w-44 items-center gap-3 px-1">
              {progressValue === null ? (
                <span role="status" className="text-xs">
                  {t.maintenance.analyzingFiles}
                </span>
              ) : (
                <>
                  <Progress value={progressValue} className="h-1.5 w-28 md:w-36" />
                  <span className="w-10 font-numeric text-[11px] font-bold tabular-nums text-foreground">
                    {Math.round(progressValue)}%
                  </span>
                </>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-quiet-capsule"
              onClick={onPauseToggle}
              disabled={!canPauseMaintenance || stopping}
              aria-label={paused ? t.maintenance.resumeMaintenance : t.maintenance.pauseMaintenance}
              title={paused ? t.common.resume : t.common.pause}
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
              aria-label={t.maintenance.stopMaintenance}
              title={t.common.stop}
            >
              <StopCircle className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {!activeExecution && recentResults.length > 0 ? (
        <div className="max-w-xl rounded-lg border bg-muted/20 px-3 py-2 text-xs">
          <div className="mb-1 font-medium">{t.maintenance.recentBatchResults}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            <span>{t.maintenance.successCount(recentResults.filter((item) => item.status === "success").length)}</span>
            <span>{t.maintenance.failedCount(recentResults.filter((item) => item.status === "failed").length)}</span>
            <span>{t.maintenance.skippedCount(recentResults.filter((item) => item.status === "skipped").length)}</span>
          </div>
          {recentResults.some((item) => item.error) ? (
            <div className="mt-2 max-h-24 space-y-1 overflow-y-auto">
              {recentResults
                .filter((item) => item.error)
                .map((item) => (
                  <div key={`${item.batchId ?? "batch"}:${item.fileId}`} className="break-all text-destructive">
                    {item.fileId}: {item.error}
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog open={usesDiffView && executeDialogOpen} onOpenChange={onExecuteDialogOpenChange}>
        <DialogContent className="max-w-xl min-w-0 overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.maintenance.confirmReplaceTitle}</DialogTitle>
            <DialogDescription>{t.maintenance.confirmReplaceDesc}</DialogDescription>
          </DialogHeader>
          {previewPending ? (
            <div className="space-y-3 py-2 text-sm text-muted-foreground">
              <div>{t.maintenance.analyzingPendingChanges}</div>
            </div>
          ) : (
            <div className="min-w-0 space-y-4 text-sm">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                <span className="text-muted-foreground">{t.maintenance.preset}</span>
                <span className="min-w-0 wrap-break-word">{presetLabel}</span>
                <span className="text-muted-foreground">{t.maintenance.selected}</span>
                <span>{t.maintenance.selectedOfTotal(selectedCount, entriesCount)}</span>
                <span className="text-muted-foreground">{t.maintenance.executable}</span>
                <span>{t.maintenance.executableCount(readyCount)}</span>
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
                        {group.ready ? t.maintenance.executable : t.maintenance.blocked}
                      </div>
                    </div>

                    {!group.ready ? (
                      <div className="mt-2 break-all text-xs text-destructive">
                        {group.blockedError ?? t.maintenance.blockedDefaultReason}
                      </div>
                    ) : (
                      <>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{t.maintenance.diffCount(group.diffCount)}</span>
                          {group.hasPathChange && <span>{t.maintenance.pathWillChange}</span>}
                          {!group.hasPathChange && group.diffCount === 0 && <span>{t.maintenance.noExtraChanges}</span>}
                        </div>
                        {group.hasPathChange && (
                          <div className="mt-3 space-y-2">
                            {group.changedPathItems.map(({ fileId, fileName, pathDiff }) => (
                              <div key={fileId} className="rounded-md border bg-background/50 p-2">
                                <div className="mb-2 text-[11px] font-medium text-muted-foreground">{fileName}</div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="min-w-0 rounded-md border bg-background/70 p-2">
                                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                                      {t.maintenance.currentPath}
                                    </div>
                                    <div className="break-all font-mono text-[11px] leading-relaxed">
                                      {pathDiff.currentVideoPath}
                                    </div>
                                  </div>
                                  <div className="min-w-0 rounded-md border border-primary/20 bg-primary/5 p-2">
                                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                                      {t.maintenance.targetPath}
                                    </div>
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
              {t.common.cancel}
            </Button>
            <Button
              disabled={previewPending || readyCount === 0}
              onClick={() => {
                onExecuteDialogOpenChange(false);
                onExecute();
              }}
            >
              {readyCount === 0 ? t.maintenance.noExecutableItems : t.maintenance.startBatchExecution(readyCount)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.maintenance.stopMaintenanceTitle}</DialogTitle>
            <DialogDescription>{t.maintenance.stopMaintenanceDesc}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setStopDialogOpen(false);
                onStop();
              }}
            >
              {t.maintenance.confirmStop}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
