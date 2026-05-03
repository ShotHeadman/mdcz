import { toErrorMessage } from "@mdcz/shared/error";
import type { EmbyConnectionCheckResult, JellyfinConnectionCheckResult, PersonSyncResult } from "@mdcz/shared/ipcTypes";
import {
  canRunPersonSync,
  getEmptyPersonLibraryMessage,
  getFirstDiagnosticBlocker,
  PersonMediaLibraryDetail,
  type PersonServerPanelState,
  type PersonSyncMode,
} from "@mdcz/views/tools";
import { useMutation } from "@tanstack/react-query";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { ipc } from "@/client/ipc";
import { useToast } from "@/contexts/ToastProvider";
import { type PersonServer, PersonServerSettingsDialog } from "./PersonServerSettingsDialog";

function clearProgressResetTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function formatSyncResult(label: string, result: PersonSyncResult) {
  return `${label}: 成功 ${result.processedCount}，失败 ${result.failedCount}，跳过 ${result.skippedCount}`;
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
  const [jellyfinActorInfoMode, setJellyfinActorInfoMode] = useState<PersonSyncMode>("missing");
  const [jellyfinActorPhotoMode, setJellyfinActorPhotoMode] = useState<PersonSyncMode>("missing");
  const [embyActorInfoMode, setEmbyActorInfoMode] = useState<PersonSyncMode>("missing");
  const [embyActorPhotoMode, setEmbyActorPhotoMode] = useState<PersonSyncMode>("missing");
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

      const firstError = getFirstDiagnosticBlocker(result);
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

      const firstError = getFirstDiagnosticBlocker(result);
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

  const jellyfinState: PersonServerPanelState = {
    checkPending: checkJellyfinConnectionMut.isPending,
    checkResult: jellyfinCheckResult,
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
  };
  const embyState: PersonServerPanelState = {
    checkPending: checkEmbyConnectionMut.isPending,
    checkResult: embyCheckResult,
    progress: embySyncProgress,
    infoMode: embyActorInfoMode,
    photoMode: embyActorPhotoMode,
    infoSyncRunning: embyInfoSyncRunning,
    photoSyncRunning: embyPhotoSyncRunning,
    infoText:
      embyActorInfoMode === "missing"
        ? "仅补全缺失的演员简介与基础资料，并保留未变更字段。"
        : "按当前抓取结果更新演员简介与基础资料，并按同步字段写回 Emby。",
    photoText: embyActorPhotoMode === "missing" ? "仅为缺少头像的演员补充头像。" : "按当前抓取结果重新同步演员头像。",
    photoNotice: "人物头像上传通常需要管理员 API Key。若返回 401 或 403，请改用管理员 API Key 后重试。",
  };

  return (
    <>
      <PersonMediaLibraryDetail
        activeServer={selectedPersonServer}
        emby={embyState}
        jellyfin={jellyfinState}
        settingsDisabled={anyPersonSyncRunning || anyPersonCheckPending}
        onCheck={(server) => {
          if (server === "jellyfin") {
            showInfo("正在诊断 Jellyfin 连接状态...");
            void runJellyfinConnectionCheck();
          } else {
            showInfo("正在诊断 Emby 连接状态...");
            void runEmbyConnectionCheck();
          }
        }}
        onInfoModeChange={(server, mode) => {
          if (server === "jellyfin") setJellyfinActorInfoMode(mode);
          else setEmbyActorInfoMode(mode);
        }}
        onOpenSettings={() => setSettingsDialogOpen(true)}
        onPhotoModeChange={(server, mode) => {
          if (server === "jellyfin") setJellyfinActorPhotoMode(mode);
          else setEmbyActorPhotoMode(mode);
        }}
        onServerChange={setSelectedPersonServer}
        onSyncInfo={(server) => {
          if (server === "jellyfin") void handleSyncJellyfinActorInfo();
          else void handleSyncEmbyActorInfo();
        }}
        onSyncPhoto={(server) => {
          if (server === "jellyfin") void handleSyncJellyfinPhotos();
          else void handleSyncEmbyPhotos();
        }}
      />

      <PersonServerSettingsDialog
        open={settingsDialogOpen}
        server={selectedPersonServer}
        onOpenChange={setSettingsDialogOpen}
      />
    </>
  );
}
