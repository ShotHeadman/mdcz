import { toErrorMessage } from "@mdcz/shared/error";
import type { AppUpdateStatus } from "@mdcz/shared/ipcTypes";
import type { SystemAboutResponse } from "@mdcz/shared/serverDtos";
import { Button, Progress } from "@mdcz/ui";
import { AboutView } from "@mdcz/views/about";
import { useT } from "@mdcz/views/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import AppLogo from "@/assets/images/logo.png";
import { updateConfig } from "@/client/api";
import { ipc } from "@/client/ipc";
import type { ConfigOutput } from "@/client/types";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  const t = useT();
  const [about, setAbout] = useState<SystemAboutResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [updateCheck, setUpdateCheck] = useState<boolean | null>(null);
  const [isSavingUpdateCheck, setIsSavingUpdateCheck] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({ phase: "idle" });
  const isPackagedApp = about?.build.mode === "production";
  const showDebugAction = !isPackagedApp;

  useEffect(() => {
    let cancelled = false;

    Promise.all([ipc.app.info(), ipc.config.get()])
      .then(([info, config]) => {
        if (cancelled) {
          return;
        }
        setAbout({
          productName: "MDCz",
          version: info.version,
          homepage: "https://github.com/ShotHeadman/mdcz",
          repository: "https://github.com/ShotHeadman/mdcz",
          build: {
            mode: info.isPackaged ? "production" : "development",
            server: null,
            web: null,
            node: "electron",
            platform: info.platform,
            arch: info.arch,
          },
        });
        setUpdateCheck((config as ConfigOutput).behavior?.updateCheck ?? true);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(t.desktop.readAboutFailed(toErrorMessage(error, t.common.unknownError)));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void ipc.app.getUpdateStatus().then(setUpdateStatus);
    return ipc.on.updateStatus(setUpdateStatus);
  }, []);

  const onUpdateCheckChange = async (checked: boolean) => {
    const previous = updateCheck ?? true;
    setUpdateCheck(checked);
    setIsSavingUpdateCheck(true);
    try {
      await updateConfig({
        body: {
          behavior: {
            updateCheck: checked,
          },
        },
      });
    } catch (error) {
      setUpdateCheck(previous);
      toast.error(t.desktop.saveFailed(toErrorMessage(error, t.common.unknownError)));
    } finally {
      setIsSavingUpdateCheck(false);
    }
  };

  const debugAction = useMemo(
    () =>
      showDebugAction
        ? async () => {
            await ipc.tool.toggleDevTools();
          }
        : undefined,
    [showDebugAction],
  );

  const checkUpdateButton = (
    <Button
      disabled={updateStatus.phase === "checking"}
      size="sm"
      variant="outline"
      onClick={() => void ipc.app.checkForUpdate()}
    >
      {t.desktop.updateCheckNow}
    </Button>
  );
  const [updateStatusText, updateAction] = ((): [string | null, ReactNode] => {
    switch (updateStatus.phase) {
      case "idle":
        return [null, checkUpdateButton];
      case "checking":
        return [t.desktop.updateChecking, checkUpdateButton];
      case "latest":
        return [t.desktop.updateLatest, checkUpdateButton];
      case "error":
        return [t.desktop.updateFailed(updateStatus.message), checkUpdateButton];
      case "downloading":
        return [t.desktop.updateDownloading(updateStatus.version, updateStatus.percent), null];
      case "downloaded":
        return [
          t.desktop.updateDownloaded(updateStatus.version),
          <Button size="sm" onClick={() => void ipc.app.installUpdate()}>
            {t.desktop.updateInstall}
          </Button>,
        ];
      case "available": {
        const { manualDownloadUrl } = updateStatus;
        return [
          t.desktop.updateAvailable(updateStatus.version),
          manualDownloadUrl ? (
            <Button size="sm" onClick={() => void ipc.app.openExternal(manualDownloadUrl)}>
              {t.desktop.updateOpenDownload}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void ipc.app.downloadUpdate()}>
              {t.desktop.updateDownload}
            </Button>
          ),
        ];
      }
    }
  })();

  return (
    <AboutView
      about={about}
      debugActionLabel={t.desktop.enableDebug}
      loading={loading}
      logoSrc={AppLogo}
      showDebugAction={showDebugAction}
      updateCheck={updateCheck}
      updateCheckDisabled={isSavingUpdateCheck}
      updateStatus={
        <div className="flex flex-col gap-3 px-1">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">{updateStatusText}</p>
            {updateAction}
          </div>
          {updateStatus.phase === "downloading" && <Progress value={updateStatus.percent} />}
        </div>
      }
      onDebug={debugAction}
      onOpenExternal={(url) => void ipc.app.openExternal(url)}
      onUpdateCheckChange={onUpdateCheckChange}
    />
  );
}
