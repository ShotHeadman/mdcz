import type { MediaServerCheckStep, MediaServerConnectionCheckResult } from "@mdcz/shared/ipcTypes";
import { Button, cn, Label, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mdcz/ui";
import { getT, type Messages, useT } from "../../i18n";

export type PersonServer = "jellyfin" | "emby";
export type PersonSyncMode = "all" | "missing";
export type PersonConnectionCheckResult = MediaServerConnectionCheckResult;

export const PERSON_SERVER_NAMES: Record<PersonServer, string> = { jellyfin: "Jellyfin", emby: "Emby" };

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

export function canRunPersonSync(result: PersonConnectionCheckResult | null): result is PersonConnectionCheckResult {
  return Boolean(result?.success);
}

export function describeFirstDiagnosticBlocker(
  t: Messages,
  server: PersonServer,
  result: PersonConnectionCheckResult,
): string | undefined {
  const blocker =
    result.steps.find((step) => step.status === "error") ?? result.steps.find((step) => step.status !== "ok");
  return blocker
    ? `${t.tools.connectionCheck.stepLabels[blocker.key]}: ${describeConnectionStep(t, server, blocker, result)}`
    : undefined;
}

export function getDiagnosticHeadline(result: PersonConnectionCheckResult, t: Messages = getT()) {
  if (!result.success) return t.tools.diagnosticHeadline.blocking;
  if (result.personCount === 0) return t.tools.diagnosticHeadline.empty;
  return t.tools.diagnosticHeadline.ready;
}

export function getEmptyPersonLibraryMessage(
  serverName: "Jellyfin" | "Emby",
  target: "info" | "photo",
  t: Messages = getT(),
) {
  const targetLabel = target === "info" ? t.tools.targetInfo : t.tools.targetPhoto;
  return t.tools.emptyPersonLibraryMessage({ server: serverName, target: targetLabel });
}

export function describeConnectionStep(
  t: Messages,
  server: PersonServer,
  step: MediaServerCheckStep,
  result: PersonConnectionCheckResult,
): string {
  const text = t.tools.connectionCheck;
  const service = PERSON_SERVER_NAMES[server];
  const serverName = [result.serverInfo?.serverName, result.serverInfo?.version].filter(Boolean).join(" ");
  const withDetail = (message: string) => (step.detail ? `${message}: ${step.detail}` : message);

  if (step.key === "adminKey") {
    if (step.reason === "empty_library") return text.adminKeyNoticeEmpty(service);
    return step.reason ? text.skipped[step.reason] : text.adminKeyNotice;
  }
  if (step.status === "skipped") {
    if (step.reason === "empty_library") return text.emptyLibraryWrite(service);
    return step.reason ? text.skipped[step.reason] : "";
  }
  switch (step.key) {
    case "server":
      if (step.status === "error") return withDetail(text.serverUnreachable(service));
      return serverName ? text.connectedTo(serverName) : text.serverReachable(service);
    case "auth":
      if (step.status === "ok") return text.authValid(service);
      return withDetail(step.reason === "auth_rejected" ? text.authRejected(service) : text.authUnverified(service));
    case "peopleRead":
      if (step.status === "error") return withDetail(text.peopleCheckFailed);
      return step.reason === "empty_library" ? text.peopleReadEmpty(service) : text.peopleReadOk;
    case "peopleWrite":
      return step.status === "ok" ? text.peopleWriteOk : withDetail(text.peopleCheckFailed);
  }
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
  const t = useT();
  const checkResult = activeState.checkResult;
  const diagnosticLabel = t.tools.diagnosticResult(activeServer === "jellyfin" ? "Jellyfin" : "Emby");

  return (
    <div className="space-y-6">
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
            {t.tools.connectionSettings}
          </Button>
        ) : null}

        <Button
          variant="secondary"
          onClick={() => onCheck(activeServer)}
          disabled={activeState.checkPending || anySyncRunning}
          className="h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75"
        >
          {activeState.checkPending ? t.tools.checkingConnection : t.tools.runConnectionCheck}
        </Button>
      </div>

      {checkResult ? (
        <div className="space-y-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {diagnosticLabel}
              </div>
              {checkResult.serverInfo?.serverName || checkResult.serverInfo?.version ? (
                <div className="mt-2 text-sm font-medium text-foreground">
                  {[checkResult.serverInfo?.serverName, checkResult.serverInfo?.version].filter(Boolean).join(" ")}
                </div>
              ) : null}
            </div>

            <div
              className={cn(
                "rounded-quiet-capsule px-3 py-1 text-xs font-semibold",
                !checkResult.success && "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300",
                checkResult.success &&
                  checkResult.personCount === 0 &&
                  "bg-surface-floating text-muted-foreground dark:bg-surface-floating/80",
                checkResult.success &&
                  checkResult.personCount !== 0 &&
                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300",
              )}
            >
              {getDiagnosticHeadline(checkResult, t)}
            </div>
          </div>

          <div className="grid gap-2.5">
            {checkResult.steps.map((step) => (
              <div key={step.key} className="rounded-quiet bg-surface-floating/94 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {t.tools.connectionCheck.stepLabels[step.key]}
                    </div>
                    <div className="mt-1 text-xs leading-6 text-muted-foreground">
                      {describeConnectionStep(t, activeServer, step, checkResult)}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em]",
                      getStepTone(step.status),
                    )}
                  >
                    {step.status === "ok"
                      ? t.tools.stepPassed
                      : step.status === "error"
                        ? t.common.failed
                        : t.common.skipped}
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
            {t.tools.actorInfoSync}
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
                <SelectItem value="missing">{t.tools.syncMissingOnly}</SelectItem>
                <SelectItem value="all">{t.tools.syncAll}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              onClick={() => onSyncInfo(activeServer)}
              disabled={anySyncRunning || activeState.checkPending}
              className="h-11 flex-1 rounded-quiet-capsule bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {activeState.infoSyncRunning ? t.tools.syncing : t.tools.syncInfo}
            </Button>
          </div>
          <div className="text-xs leading-6 text-muted-foreground">{activeState.infoText}</div>
        </div>

        <div className="space-y-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t.tools.actorPhotoSync}
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
                <SelectItem value="missing">{t.tools.syncMissingPhotos}</SelectItem>
                <SelectItem value="all">{t.tools.syncAllPhotos}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              onClick={() => onSyncPhoto(activeServer)}
              disabled={anySyncRunning || activeState.checkPending}
              className="h-11 flex-1 rounded-quiet-capsule bg-surface-floating px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/70"
            >
              {activeState.photoSyncRunning ? t.tools.syncing : t.tools.syncPhoto}
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
            <span>{t.tools.taskProgress}</span>
            <span>{Math.round(activeState.progress)}%</span>
          </div>
          <Progress value={activeState.progress} className="h-2 bg-surface-floating" />
        </div>
      ) : null}
    </div>
  );
}
