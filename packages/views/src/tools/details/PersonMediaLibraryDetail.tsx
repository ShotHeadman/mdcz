import type { EmbyConnectionCheckResult, JellyfinConnectionCheckResult } from "@mdcz/shared/ipcTypes";
import { Button, cn, Label, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mdcz/ui";

export type PersonServer = "jellyfin" | "emby";
export type PersonSyncMode = "all" | "missing";
export type PersonConnectionCheckResult = JellyfinConnectionCheckResult | EmbyConnectionCheckResult;

export interface PersonServerPanelState {
  checkPending: boolean;
  checkResult: PersonConnectionCheckResult | null;
  infoMode: PersonSyncMode;
  infoSyncRunning: boolean;
  infoText: string;
  photoMode: PersonSyncMode;
  photoNotice?: string;
  photoSyncRunning: boolean;
  photoText: string;
  progress: number;
}

export interface PersonMediaLibraryDetailProps {
  activeServer: PersonServer;
  emby: PersonServerPanelState;
  jellyfin: PersonServerPanelState;
  settingsDisabled?: boolean;
  onCheck: (server: PersonServer) => void;
  onInfoModeChange: (server: PersonServer, mode: PersonSyncMode) => void;
  onOpenSettings?: () => void;
  onPhotoModeChange: (server: PersonServer, mode: PersonSyncMode) => void;
  onServerChange: (server: PersonServer) => void;
  onSyncInfo: (server: PersonServer) => void;
  onSyncPhoto: (server: PersonServer) => void;
}

function getFirstDiagnosticError(result: PersonConnectionCheckResult) {
  return result.steps.find((step) => step.status === "error");
}

export function canRunPersonSync(result: PersonConnectionCheckResult | null): result is PersonConnectionCheckResult {
  return Boolean(result?.success);
}

export function getFirstDiagnosticBlocker(result: PersonConnectionCheckResult) {
  return getFirstDiagnosticError(result) ?? result.steps.find((step) => step.status !== "ok");
}

export function getDiagnosticHeadline(result: PersonConnectionCheckResult) {
  if (!result.success) return "存在阻塞项";
  if (result.personCount === 0) return "人物库为空";
  return "可以执行人物同步";
}

export function getEmptyPersonLibraryMessage(serverName: "Jellyfin" | "Emby", targetLabel: "人物信息" | "人物头像") {
  return `${serverName} 人物库为空。已确认连接与权限状态正常，当前无法执行${targetLabel}同步。请先在 ${serverName} 中生成人物条目后重试。`;
}

function getStepTone(status: PersonConnectionCheckResult["steps"][number]["status"]) {
  if (status === "ok") return "text-emerald-600 dark:text-emerald-400";
  if (status === "error") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

export function PersonMediaLibraryDetail({
  activeServer,
  emby,
  jellyfin,
  settingsDisabled = false,
  onCheck,
  onInfoModeChange,
  onOpenSettings,
  onPhotoModeChange,
  onServerChange,
  onSyncInfo,
  onSyncPhoto,
}: PersonMediaLibraryDetailProps) {
  const activeState = activeServer === "jellyfin" ? jellyfin : emby;
  const anySyncRunning =
    jellyfin.infoSyncRunning || jellyfin.photoSyncRunning || emby.infoSyncRunning || emby.photoSyncRunning;
  const anyCheckPending = jellyfin.checkPending || emby.checkPending;
  const diagnosticLabel = activeServer === "jellyfin" ? "Jellyfin 诊断结果" : "Emby 诊断结果";

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          value={activeServer}
          onValueChange={(value) => onServerChange(value as PersonServer)}
          disabled={anySyncRunning || anyCheckPending}
        >
          <SelectTrigger className="h-11 w-[160px] rounded-quiet-capsule border-none bg-surface-low px-5 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="jellyfin">Jellyfin</SelectItem>
            <SelectItem value="emby">Emby</SelectItem>
          </SelectContent>
        </Select>

        {onOpenSettings ? (
          <Button
            variant="secondary"
            onClick={onOpenSettings}
            disabled={settingsDisabled || anySyncRunning || anyCheckPending}
            className="h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75"
          >
            连接设置
          </Button>
        ) : null}

        <Button
          variant="secondary"
          onClick={() => onCheck(activeServer)}
          disabled={activeState.checkPending || anySyncRunning}
          className="h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75"
        >
          {activeState.checkPending ? "诊断中..." : "连接诊断"}
        </Button>
      </div>

      {activeState.checkResult ? (
        <div className="space-y-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {diagnosticLabel}
              </div>
              {activeState.checkResult.serverInfo?.serverName || activeState.checkResult.serverInfo?.version ? (
                <div className="mt-2 text-sm font-medium text-foreground">
                  {[activeState.checkResult.serverInfo?.serverName, activeState.checkResult.serverInfo?.version]
                    .filter(Boolean)
                    .join(" ")}
                </div>
              ) : null}
            </div>

            <div
              className={cn(
                "rounded-quiet-capsule px-3 py-1 text-xs font-semibold",
                !activeState.checkResult.success &&
                  "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300",
                activeState.checkResult.success &&
                  activeState.checkResult.personCount === 0 &&
                  "bg-surface-floating text-muted-foreground dark:bg-surface-floating/80",
                activeState.checkResult.success &&
                  activeState.checkResult.personCount !== 0 &&
                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300",
              )}
            >
              {getDiagnosticHeadline(activeState.checkResult)}
            </div>
          </div>

          <div className="grid gap-2.5">
            {activeState.checkResult.steps.map((step) => (
              <div key={step.key} className="rounded-quiet bg-surface-floating/94 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{step.label}</div>
                    <div className="mt-1 text-xs leading-6 text-muted-foreground">{step.message}</div>
                  </div>
                  <div
                    className={cn(
                      "shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em]",
                      getStepTone(step.status),
                    )}
                  >
                    {step.status === "ok" ? "通过" : step.status === "error" ? "失败" : "跳过"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            演员资料同步
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select
              value={activeState.infoMode}
              onValueChange={(value) => onInfoModeChange(activeServer, value as PersonSyncMode)}
            >
              <SelectTrigger className="h-11 flex-1 rounded-quiet-sm border-none bg-surface-floating px-4 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="missing">仅补全空白资料</SelectItem>
                <SelectItem value="all">更新已有资料</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              onClick={() => onSyncInfo(activeServer)}
              disabled={anySyncRunning || activeState.checkPending}
              className="h-11 flex-1 rounded-quiet-capsule bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {activeState.infoSyncRunning ? "同步中..." : "同步信息"}
            </Button>
          </div>
          <div className="text-xs leading-6 text-muted-foreground">{activeState.infoText}</div>
        </div>

        <div className="space-y-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            演员头像同步
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select
              value={activeState.photoMode}
              onValueChange={(value) => onPhotoModeChange(activeServer, value as PersonSyncMode)}
            >
              <SelectTrigger className="h-11 flex-1 rounded-quiet-sm border-none bg-surface-floating px-4 shadow-none focus-visible:ring-2 focus-visible:ring-ring/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="missing">仅补全缺失头像</SelectItem>
                <SelectItem value="all">重新同步头像</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              onClick={() => onSyncPhoto(activeServer)}
              disabled={anySyncRunning || activeState.checkPending}
              className="h-11 flex-1 rounded-quiet-capsule bg-surface-floating px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/70"
            >
              {activeState.photoSyncRunning ? "同步中..." : "同步头像"}
            </Button>
          </div>
          <div className="text-xs leading-6 text-muted-foreground">{activeState.photoText}</div>
          {activeState.photoNotice ? (
            <div className="text-xs leading-6 text-amber-700 dark:text-amber-300">{activeState.photoNotice}</div>
          ) : null}
        </div>
      </div>

      {activeState.progress > 0 ? (
        <div className="grid gap-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
          <div className="flex justify-between text-xs font-semibold text-muted-foreground">
            <span>任务进度</span>
            <span>{Math.round(activeState.progress)}%</span>
          </div>
          <Progress value={activeState.progress} className="h-2 bg-surface-floating" />
        </div>
      ) : null}
    </>
  );
}
