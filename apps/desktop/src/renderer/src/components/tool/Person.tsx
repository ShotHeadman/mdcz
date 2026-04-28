import { toErrorMessage } from "@mdcz/shared/error";
import type { EmbyConnectionCheckResult, JellyfinConnectionCheckResult, PersonSyncResult } from "@mdcz/shared/ipcTypes";
import { useMutation } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { ipc } from "@/client/ipc";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Progress } from "@/components/ui/Progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select";
import { useToast } from "@/contexts/ToastProvider";
import { cn } from "@/lib/utils";
import { type PersonServer, PersonServerSettingsDialog } from "./PersonServerSettingsDialog";
import { ToolPanel } from "./ToolPanel";
import { TOOL_SELECT_TRIGGER_CLASS, TOOL_SUBSECTION_CLASS } from "./toolStyles";

type SyncMode = "all" | "missing";
type ConnectionCheckResult = JellyfinConnectionCheckResult | EmbyConnectionCheckResult;

function clearProgressResetTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function getFirstDiagnosticError(result: ConnectionCheckResult) {
  return result.steps.find((step) => step.status === "error");
}

function getFirstDiagnosticBlocker(result: ConnectionCheckResult) {
  return getFirstDiagnosticError(result) ?? result.steps.find((step) => step.status !== "ok");
}

function canRunPersonSync(result: ConnectionCheckResult | null): result is ConnectionCheckResult {
  return Boolean(result?.success);
}

function getDiagnosticHeadline(result: ConnectionCheckResult) {
  if (!result.success) {
    return "存在阻塞项";
  }
  if (result.personCount === 0) {
    return "人物库为空";
  }
  return "可以执行人物同步";
}

function getEmptyPersonLibraryMessage(serverName: "Jellyfin" | "Emby", targetLabel: "人物信息" | "人物头像") {
  return `${serverName} 人物库为空。已确认连接与权限状态正常，当前无法执行${targetLabel}同步。请先在 ${serverName} 中生成人物条目后重试。`;
}

function formatSyncResult(label: string, result: PersonSyncResult) {
  return `${label}: 成功 ${result.processedCount}，失败 ${result.failedCount}，跳过 ${result.skippedCount}`;
}

function getStepTone(status: ConnectionCheckResult["steps"][number]["status"]) {
  if (status === "ok") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (status === "error") {
    return "text-red-600 dark:text-red-400";
  }
  return "text-muted-foreground";
}

export function Person() {
  const { showError, showInfo, showSuccess } = useToast();
  const checkJellyfinConnectionMut = useMutation({
    mutationFn: async () => ipc.tool.checkJellyfinConnection(),
  });
  const checkEmbyConnectionMut = useMutation({
    mutationFn: async () => ipc.tool.checkEmbyConnection(),
  });
  const [selectedPersonServer, setSelectedPersonServer] = useState<PersonServer>("jellyfin");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [jellyfinCheckResult, setJellyfinCheckResult] = useState<JellyfinConnectionCheckResult | null>(null);
  const [embyCheckResult, setEmbyCheckResult] = useState<EmbyConnectionCheckResult | null>(null);
  const [jellyfinActorInfoMode, setJellyfinActorInfoMode] = useState<SyncMode>("missing");
  const [jellyfinActorPhotoMode, setJellyfinActorPhotoMode] = useState<SyncMode>("missing");
  const [embyActorInfoMode, setEmbyActorInfoMode] = useState<SyncMode>("missing");
  const [embyActorPhotoMode, setEmbyActorPhotoMode] = useState<SyncMode>("missing");
  const [jellyfinInfoSyncRunning, setJellyfinInfoSyncRunning] = useState(false);
  const [jellyfinPhotoSyncRunning, setJellyfinPhotoSyncRunning] = useState(false);
  const [embyInfoSyncRunning, setEmbyInfoSyncRunning] = useState(false);
  const [embyPhotoSyncRunning, setEmbyPhotoSyncRunning] = useState(false);
  const [jellyfinSyncProgress, setJellyfinSyncProgress] = useState(0);
  const [embySyncProgress, setEmbySyncProgress] = useState(0);
  const jellyfinProgressResetTimerRef = useRef<number | null>(null);
  const embyProgressResetTimerRef = useRef<number | null>(null);

  const jellyfinSyncRunning = jellyfinInfoSyncRunning || jellyfinPhotoSyncRunning;
  const embySyncRunning = embyInfoSyncRunning || embyPhotoSyncRunning;
  const anyPersonSyncRunning = jellyfinSyncRunning || embySyncRunning;
  const anyPersonCheckPending = checkJellyfinConnectionMut.isPending || checkEmbyConnectionMut.isPending;

  useEffect(() => {
    return ipc.on.progress((payload) => {
      if (jellyfinSyncRunning) {
        setJellyfinSyncProgress(payload.value);
        return;
      }
      if (embySyncRunning) {
        setEmbySyncProgress(payload.value);
      }
    });
  }, [embySyncRunning, jellyfinSyncRunning]);

  useEffect(() => {
    return () => {
      clearProgressResetTimer(jellyfinProgressResetTimerRef);
      clearProgressResetTimer(embyProgressResetTimerRef);
    };
  }, []);

  const runJellyfinConnectionCheck = async (silentSuccess = false): Promise<JellyfinConnectionCheckResult | null> => {
    try {
      const result = await checkJellyfinConnectionMut.mutateAsync();
      setJellyfinCheckResult(result);

      const firstError = getFirstDiagnosticError(result);
      if (!firstError) {
        if (!silentSuccess) {
          showSuccess("Jellyfin 连接诊断通过");
        }
      } else if (!silentSuccess) {
        showError(`${firstError.label}: ${firstError.message}`);
      }

      return result;
    } catch (error) {
      showError(`Jellyfin 连通性测试失败: ${toErrorMessage(error)}`);
      setJellyfinCheckResult(null);
      return null;
    }
  };

  const runEmbyConnectionCheck = async (silentSuccess = false): Promise<EmbyConnectionCheckResult | null> => {
    try {
      const result = await checkEmbyConnectionMut.mutateAsync();
      setEmbyCheckResult(result);

      const firstError = getFirstDiagnosticError(result);
      if (!firstError) {
        if (!silentSuccess) {
          showSuccess("Emby 连接诊断通过");
        }
      } else if (!silentSuccess) {
        showError(`${firstError.label}: ${firstError.message}`);
      }

      return result;
    } catch (error) {
      showError(`Emby 连通性测试失败: ${toErrorMessage(error)}`);
      setEmbyCheckResult(null);
      return null;
    }
  };

  const handleSyncJellyfinActorInfo = async () => {
    showInfo("正在诊断 Jellyfin 连接状态...");
    const diagnostic = await runJellyfinConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? getFirstDiagnosticBlocker(diagnostic) : undefined;
      if (blocker) {
        showError(`${blocker.label}: ${blocker.message}`);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Jellyfin", "人物信息"));
      return;
    }

    clearProgressResetTimer(jellyfinProgressResetTimerRef);
    setJellyfinSyncProgress(0);
    setJellyfinInfoSyncRunning(true);
    showInfo("正在同步 Jellyfin 演员信息...");
    try {
      const result = await ipc.tool.syncJellyfinActorInfo(jellyfinActorInfoMode);
      setJellyfinSyncProgress(100);
      showSuccess(formatSyncResult("Jellyfin 演员信息同步完成", result));
    } catch (error) {
      showError(`Jellyfin 演员信息同步失败: ${toErrorMessage(error)}`);
    } finally {
      setJellyfinInfoSyncRunning(false);
      clearProgressResetTimer(jellyfinProgressResetTimerRef);
      jellyfinProgressResetTimerRef.current = window.setTimeout(() => {
        setJellyfinSyncProgress(0);
        jellyfinProgressResetTimerRef.current = null;
      }, 1200);
    }
  };

  const handleSyncJellyfinPhotos = async () => {
    showInfo("正在诊断 Jellyfin 连接状态...");
    const diagnostic = await runJellyfinConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? getFirstDiagnosticBlocker(diagnostic) : undefined;
      if (blocker) {
        showError(`${blocker.label}: ${blocker.message}`);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Jellyfin", "人物头像"));
      return;
    }

    clearProgressResetTimer(jellyfinProgressResetTimerRef);
    setJellyfinSyncProgress(0);
    setJellyfinPhotoSyncRunning(true);
    showInfo("正在同步 Jellyfin 演员头像...");
    try {
      const result = await ipc.tool.syncJellyfinActorPhoto(jellyfinActorPhotoMode);
      setJellyfinSyncProgress(100);
      showSuccess(formatSyncResult("Jellyfin 头像同步完成", result));
    } catch (error) {
      showError(`Jellyfin 头像同步失败: ${toErrorMessage(error)}`);
    } finally {
      setJellyfinPhotoSyncRunning(false);
      clearProgressResetTimer(jellyfinProgressResetTimerRef);
      jellyfinProgressResetTimerRef.current = window.setTimeout(() => {
        setJellyfinSyncProgress(0);
        jellyfinProgressResetTimerRef.current = null;
      }, 1200);
    }
  };

  const handleSyncEmbyActorInfo = async () => {
    showInfo("正在诊断 Emby 连接状态...");
    const diagnostic = await runEmbyConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? getFirstDiagnosticBlocker(diagnostic) : undefined;
      if (blocker) {
        showError(`${blocker.label}: ${blocker.message}`);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Emby", "人物信息"));
      return;
    }

    clearProgressResetTimer(embyProgressResetTimerRef);
    setEmbySyncProgress(0);
    setEmbyInfoSyncRunning(true);
    showInfo("正在同步 Emby 演员信息...");
    try {
      const result = await ipc.tool.syncEmbyActorInfo(embyActorInfoMode);
      setEmbySyncProgress(100);
      showSuccess(formatSyncResult("Emby 演员信息同步完成", result));
    } catch (error) {
      showError(`Emby 演员信息同步失败: ${toErrorMessage(error)}`);
    } finally {
      setEmbyInfoSyncRunning(false);
      clearProgressResetTimer(embyProgressResetTimerRef);
      embyProgressResetTimerRef.current = window.setTimeout(() => {
        setEmbySyncProgress(0);
        embyProgressResetTimerRef.current = null;
      }, 1200);
    }
  };

  const handleSyncEmbyPhotos = async () => {
    showInfo("正在诊断 Emby 连接状态...");
    const diagnostic = await runEmbyConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? getFirstDiagnosticBlocker(diagnostic) : undefined;
      if (blocker) {
        showError(`${blocker.label}: ${blocker.message}`);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Emby", "人物头像"));
      return;
    }

    const adminKeyStep = diagnostic.steps.find((step) => step.key === "adminKey");
    if (adminKeyStep?.message) {
      showInfo(adminKeyStep.message);
    }

    clearProgressResetTimer(embyProgressResetTimerRef);
    setEmbySyncProgress(0);
    setEmbyPhotoSyncRunning(true);
    showInfo("正在同步 Emby 演员头像...");
    try {
      const result = await ipc.tool.syncEmbyActorPhoto(embyActorPhotoMode);
      setEmbySyncProgress(100);
      showSuccess(formatSyncResult("Emby 头像同步完成", result));
    } catch (error) {
      showError(`Emby 头像同步失败: ${toErrorMessage(error)}`);
    } finally {
      setEmbyPhotoSyncRunning(false);
      clearProgressResetTimer(embyProgressResetTimerRef);
      embyProgressResetTimerRef.current = window.setTimeout(() => {
        setEmbySyncProgress(0);
        embyProgressResetTimerRef.current = null;
      }, 1200);
    }
  };

  const activeServerState =
    selectedPersonServer === "jellyfin"
      ? {
          diagnosticLabel: "Jellyfin 诊断结果",
          checkPending: checkJellyfinConnectionMut.isPending,
          checkResult: jellyfinCheckResult as ConnectionCheckResult | null,
          progress: jellyfinSyncProgress,
          infoMode: jellyfinActorInfoMode,
          photoMode: jellyfinActorPhotoMode,
          infoSyncRunning: jellyfinInfoSyncRunning,
          photoSyncRunning: jellyfinPhotoSyncRunning,
          infoText:
            jellyfinActorInfoMode === "missing"
              ? "仅补全缺失的演员简介与基础资料。"
              : "按当前抓取结果更新演员简介与基础资料。",
          photoText:
            jellyfinActorPhotoMode === "missing" ? "仅为缺少头像的演员补充头像。" : "按当前抓取结果重新同步演员头像。",
          photoNotice: "",
          onCheck: () => {
            showInfo("正在诊断 Jellyfin 连接状态...");
            void runJellyfinConnectionCheck();
          },
          onInfoModeChange: setJellyfinActorInfoMode,
          onPhotoModeChange: setJellyfinActorPhotoMode,
          onSyncInfo: () => void handleSyncJellyfinActorInfo(),
          onSyncPhoto: () => void handleSyncJellyfinPhotos(),
        }
      : {
          diagnosticLabel: "Emby 诊断结果",
          checkPending: checkEmbyConnectionMut.isPending,
          checkResult: embyCheckResult as ConnectionCheckResult | null,
          progress: embySyncProgress,
          infoMode: embyActorInfoMode,
          photoMode: embyActorPhotoMode,
          infoSyncRunning: embyInfoSyncRunning,
          photoSyncRunning: embyPhotoSyncRunning,
          infoText:
            embyActorInfoMode === "missing"
              ? "仅补全缺失的演员简介与基础资料，并保留未变更字段。"
              : "按当前抓取结果更新演员简介与基础资料，并按同步字段写回 Emby。",
          photoText:
            embyActorPhotoMode === "missing" ? "仅为缺少头像的演员补充头像。" : "按当前抓取结果重新同步演员头像。",
          photoNotice: "人物头像上传通常需要管理员 API Key。若返回 401 或 403，请改用管理员 API Key 后重试。",
          onCheck: () => {
            showInfo("正在诊断 Emby 连接状态...");
            void runEmbyConnectionCheck();
          },
          onInfoModeChange: setEmbyActorInfoMode,
          onPhotoModeChange: setEmbyActorPhotoMode,
          onSyncInfo: () => void handleSyncEmbyActorInfo(),
          onSyncPhoto: () => void handleSyncEmbyPhotos(),
        };

  return (
    <>
      <ToolPanel
        toolId="media-library-tools"
        icon={<UserCheck className="h-5 w-5" />}
        headerExtra={
          <>
            <Select
              value={selectedPersonServer}
              onValueChange={(value) => setSelectedPersonServer(value as PersonServer)}
              disabled={anyPersonSyncRunning || anyPersonCheckPending}
            >
              <SelectTrigger className={cn(TOOL_SELECT_TRIGGER_CLASS, "w-[160px] bg-surface-low")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jellyfin">Jellyfin</SelectItem>
                <SelectItem value="emby">Emby</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="secondary"
              onClick={() => setSettingsDialogOpen(true)}
              disabled={anyPersonSyncRunning || anyPersonCheckPending}
              className="h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75"
            >
              连接设置
            </Button>

            <Button
              variant="secondary"
              onClick={activeServerState.onCheck}
              disabled={activeServerState.checkPending || anyPersonSyncRunning}
              className="h-11 rounded-quiet-capsule bg-surface-low px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/75"
            >
              {activeServerState.checkPending ? "诊断中..." : "连接诊断"}
            </Button>
          </>
        }
      >
        {activeServerState.checkResult ? (
          <div className={TOOL_SUBSECTION_CLASS}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {activeServerState.diagnosticLabel}
                </div>
                {activeServerState.checkResult.serverInfo?.serverName ||
                activeServerState.checkResult.serverInfo?.version ? (
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {[
                      activeServerState.checkResult.serverInfo?.serverName,
                      activeServerState.checkResult.serverInfo?.version,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                ) : null}
              </div>

              <div
                className={cn(
                  "rounded-quiet-capsule px-3 py-1 text-xs font-semibold",
                  !activeServerState.checkResult.success &&
                    "bg-amber-100 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300",
                  activeServerState.checkResult.success &&
                    activeServerState.checkResult.personCount === 0 &&
                    "bg-surface-floating text-muted-foreground dark:bg-surface-floating/80",
                  activeServerState.checkResult.success &&
                    activeServerState.checkResult.personCount !== 0 &&
                    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300",
                )}
              >
                {getDiagnosticHeadline(activeServerState.checkResult)}
              </div>
            </div>

            <div className="grid gap-2.5">
              {activeServerState.checkResult.steps.map((step) => (
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
                value={activeServerState.infoMode}
                onValueChange={(value) => activeServerState.onInfoModeChange(value as SyncMode)}
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
                onClick={activeServerState.onSyncInfo}
                disabled={anyPersonSyncRunning || activeServerState.checkPending}
                className="h-11 flex-1 rounded-quiet-capsule bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                {activeServerState.infoSyncRunning ? "同步中..." : "同步信息"}
              </Button>
            </div>
            <div className="text-xs leading-6 text-muted-foreground">{activeServerState.infoText}</div>
          </div>

          <div className="space-y-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              演员头像同步
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Select
                value={activeServerState.photoMode}
                onValueChange={(value) => activeServerState.onPhotoModeChange(value as SyncMode)}
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
                onClick={activeServerState.onSyncPhoto}
                disabled={anyPersonSyncRunning || activeServerState.checkPending}
                className="h-11 flex-1 rounded-quiet-capsule bg-surface-floating px-5 text-sm font-semibold text-foreground hover:bg-surface-raised/70"
              >
                {activeServerState.photoSyncRunning ? "同步中..." : "同步头像"}
              </Button>
            </div>
            <div className="text-xs leading-6 text-muted-foreground">{activeServerState.photoText}</div>
            {activeServerState.photoNotice ? (
              <div className="text-xs leading-6 text-amber-700 dark:text-amber-300">
                {activeServerState.photoNotice}
              </div>
            ) : null}
          </div>
        </div>

        {activeServerState.progress > 0 ? (
          <div className="grid gap-3 rounded-quiet-lg bg-surface-low/90 p-4 md:p-5">
            <div className="flex justify-between text-xs font-semibold text-muted-foreground">
              <span>任务进度</span>
              <span>{Math.round(activeServerState.progress)}%</span>
            </div>
            <Progress value={activeServerState.progress} className="h-2 bg-surface-floating" />
          </div>
        ) : null}
      </ToolPanel>

      <PersonServerSettingsDialog
        open={settingsDialogOpen}
        server={selectedPersonServer}
        onOpenChange={setSettingsDialogOpen}
      />
    </>
  );
}
