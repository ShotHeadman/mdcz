import { toErrorMessage } from "@mdcz/shared/error";
import type { MediaServerConnectionCheckResult, PersonSyncResult } from "@mdcz/shared/ipcTypes";
import { getT, useT } from "@mdcz/views/i18n";
import {
  canRunPersonSync,
  describeConnectionStep,
  describeFirstDiagnosticBlocker,
  getEmptyPersonLibraryMessage,
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
  return `${label}: ${getT().tools.personSyncSummary(result)}`;
}

export function Person() {
  const t = useT();
  const { showError, showInfo, showSuccess } = useToast();
  const checkJellyfinConnectionMut = useMutation({
    mutationFn: async () => ipc.tool.checkJellyfinConnection(),
  });
  const checkEmbyConnectionMut = useMutation({
    mutationFn: async () => ipc.tool.checkEmbyConnection(),
  });
  const [selectedPersonServer, setSelectedPersonServer] = useState<PersonServer>("jellyfin");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [jellyfinCheckResult, setJellyfinCheckResult] = useState<MediaServerConnectionCheckResult | null>(null);
  const [embyCheckResult, setEmbyCheckResult] = useState<MediaServerConnectionCheckResult | null>(null);
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
    return () => {
      clearProgressResetTimer(jellyfinProgressResetTimerRef);
      clearProgressResetTimer(embyProgressResetTimerRef);
    };
  }, []);

  const runJellyfinConnectionCheck = async (
    silentSuccess = false,
  ): Promise<MediaServerConnectionCheckResult | null> => {
    try {
      const result = await checkJellyfinConnectionMut.mutateAsync();
      setJellyfinCheckResult(result);

      const blocker = describeFirstDiagnosticBlocker(getT(), "jellyfin", result);
      if (!blocker) {
        if (!silentSuccess) {
          showSuccess(t.desktop.serverDiagnosticPassed("Jellyfin"));
        }
      } else if (!silentSuccess) {
        showError(blocker);
      }

      return result;
    } catch (error) {
      showError(t.desktop.serverConnectivityTestFailed("Jellyfin", toErrorMessage(error)));
      setJellyfinCheckResult(null);
      return null;
    }
  };

  const runEmbyConnectionCheck = async (silentSuccess = false): Promise<MediaServerConnectionCheckResult | null> => {
    try {
      const result = await checkEmbyConnectionMut.mutateAsync();
      setEmbyCheckResult(result);

      const blocker = describeFirstDiagnosticBlocker(getT(), "emby", result);
      if (!blocker) {
        if (!silentSuccess) {
          showSuccess(t.desktop.serverDiagnosticPassed("Emby"));
        }
      } else if (!silentSuccess) {
        showError(blocker);
      }

      return result;
    } catch (error) {
      showError(t.desktop.serverConnectivityTestFailed("Emby", toErrorMessage(error)));
      setEmbyCheckResult(null);
      return null;
    }
  };

  const handleSyncJellyfinActorInfo = async () => {
    showInfo(t.desktop.diagnosingServerConnection("Jellyfin"));
    const diagnostic = await runJellyfinConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? describeFirstDiagnosticBlocker(getT(), "jellyfin", diagnostic) : undefined;
      if (blocker) {
        showError(blocker);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Jellyfin", "info"));
      return;
    }

    clearProgressResetTimer(jellyfinProgressResetTimerRef);
    setJellyfinSyncProgress(0);
    setJellyfinInfoSyncRunning(true);
    showInfo(t.desktop.syncingActorInfo("Jellyfin"));
    try {
      const result = await ipc.tool.syncJellyfinActorInfo(jellyfinActorInfoMode);
      setJellyfinSyncProgress(100);
      showSuccess(formatSyncResult(t.desktop.actorInfoSyncCompleted("Jellyfin"), result));
    } catch (error) {
      showError(t.desktop.actorInfoSyncFailed("Jellyfin", toErrorMessage(error)));
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
    showInfo(t.desktop.diagnosingServerConnection("Jellyfin"));
    const diagnostic = await runJellyfinConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? describeFirstDiagnosticBlocker(getT(), "jellyfin", diagnostic) : undefined;
      if (blocker) {
        showError(blocker);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Jellyfin", "photo"));
      return;
    }

    clearProgressResetTimer(jellyfinProgressResetTimerRef);
    setJellyfinSyncProgress(0);
    setJellyfinPhotoSyncRunning(true);
    showInfo(t.desktop.syncingActorPhotos("Jellyfin"));
    try {
      const result = await ipc.tool.syncJellyfinActorPhoto(jellyfinActorPhotoMode);
      setJellyfinSyncProgress(100);
      showSuccess(formatSyncResult(t.desktop.actorPhotosSyncCompleted("Jellyfin"), result));
    } catch (error) {
      showError(t.desktop.actorPhotosSyncFailed("Jellyfin", toErrorMessage(error)));
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
    showInfo(t.desktop.diagnosingServerConnection("Emby"));
    const diagnostic = await runEmbyConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? describeFirstDiagnosticBlocker(getT(), "emby", diagnostic) : undefined;
      if (blocker) {
        showError(blocker);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Emby", "info"));
      return;
    }

    clearProgressResetTimer(embyProgressResetTimerRef);
    setEmbySyncProgress(0);
    setEmbyInfoSyncRunning(true);
    showInfo(t.desktop.syncingActorInfo("Emby"));
    try {
      const result = await ipc.tool.syncEmbyActorInfo(embyActorInfoMode);
      setEmbySyncProgress(100);
      showSuccess(formatSyncResult(t.desktop.actorInfoSyncCompleted("Emby"), result));
    } catch (error) {
      showError(t.desktop.actorInfoSyncFailed("Emby", toErrorMessage(error)));
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
    showInfo(t.desktop.diagnosingServerConnection("Emby"));
    const diagnostic = await runEmbyConnectionCheck(true);
    if (!canRunPersonSync(diagnostic)) {
      const blocker = diagnostic ? describeFirstDiagnosticBlocker(getT(), "emby", diagnostic) : undefined;
      if (blocker) {
        showError(blocker);
      }
      return;
    }
    if (diagnostic.personCount === 0) {
      showInfo(getEmptyPersonLibraryMessage("Emby", "photo"));
      return;
    }

    const adminKeyStep = diagnostic.steps.find((step) => step.key === "adminKey");
    if (adminKeyStep) {
      showInfo(describeConnectionStep(getT(), "emby", adminKeyStep, diagnostic));
    }

    clearProgressResetTimer(embyProgressResetTimerRef);
    setEmbySyncProgress(0);
    setEmbyPhotoSyncRunning(true);
    showInfo(t.desktop.syncingActorPhotos("Emby"));
    try {
      const result = await ipc.tool.syncEmbyActorPhoto(embyActorPhotoMode);
      setEmbySyncProgress(100);
      showSuccess(formatSyncResult(t.desktop.actorPhotosSyncCompleted("Emby"), result));
    } catch (error) {
      showError(t.desktop.actorPhotosSyncFailed("Emby", toErrorMessage(error)));
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
    infoText: jellyfinActorInfoMode === "missing" ? t.desktop.jellyfinInfoMissing : t.desktop.jellyfinInfoAll,
    photoText: jellyfinActorPhotoMode === "missing" ? t.desktop.jellyfinPhotoMissing : t.desktop.jellyfinPhotoAll,
  };
  const embyState: PersonServerPanelState = {
    checkPending: checkEmbyConnectionMut.isPending,
    checkResult: embyCheckResult,
    progress: embySyncProgress,
    infoMode: embyActorInfoMode,
    photoMode: embyActorPhotoMode,
    infoSyncRunning: embyInfoSyncRunning,
    photoSyncRunning: embyPhotoSyncRunning,
    infoText: embyActorInfoMode === "missing" ? t.desktop.embyInfoMissing : t.desktop.embyInfoAll,
    photoText: embyActorPhotoMode === "missing" ? t.desktop.embyPhotoMissing : t.desktop.embyPhotoAll,
    photoNotice: t.desktop.photoAdminNotice,
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
            showInfo(t.desktop.diagnosingServerConnection("Jellyfin"));
            void runJellyfinConnectionCheck();
          } else {
            showInfo(t.desktop.diagnosingServerConnection("Emby"));
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
