import type { AppUpdateStatus, DesktopBridge } from "@mdcz/shared/desktopBridge";
import { toErrorMessage } from "@mdcz/shared/error";
import { Button, Progress } from "@mdcz/ui";
import { AboutView } from "@mdcz/views/about";
import { useT } from "@mdcz/views/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../client";
import { desktop } from "../desktop";
import { queryKeys } from "../lib/queryKeys";

export const AboutPage = () => {
  const aboutQ = useQuery({ queryKey: queryKeys.system.about, queryFn: () => api.system.about(), enabled: !desktop });
  return desktop ? (
    <DesktopAbout desktop={desktop} />
  ) : (
    <AboutView about={aboutQ.data} loading={aboutQ.isLoading} showUpdateCheck={false} />
  );
};

/** The desktop build reports Electron's version and updates itself. */
const DesktopAbout = ({ desktop }: { desktop: DesktopBridge }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const infoQ = useQuery({ queryKey: ["desktop", "appInfo"], queryFn: () => desktop.appInfo() });
  const configQ = useQuery({ queryKey: queryKeys.config.current, queryFn: () => api.config.read() });
  const [savingUpdateCheck, setSavingUpdateCheck] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({ phase: "idle" });
  const info = infoQ.data;

  useEffect(() => {
    void desktop.updateStatus().then(setUpdateStatus);
    return desktop.on("updateStatus", setUpdateStatus);
  }, [desktop]);

  const checkButton = (
    <Button
      disabled={updateStatus.phase === "checking"}
      size="sm"
      variant="outline"
      onClick={() => void desktop.checkForUpdate()}
    >
      {t.about.updateCheckNow}
    </Button>
  );
  const [statusText, action] = ((): [string | null, ReactNode] => {
    switch (updateStatus.phase) {
      case "idle":
        return [null, checkButton];
      case "checking":
        return [t.about.updateChecking, checkButton];
      case "latest":
        return [t.about.updateLatest, checkButton];
      case "error":
        return [t.about.updateFailed(updateStatus.message), checkButton];
      case "downloading":
        return [t.about.updateDownloading(updateStatus.version, updateStatus.percent), null];
      case "downloaded":
        return [
          t.about.updateDownloaded(updateStatus.version),
          <Button size="sm" onClick={() => void desktop.installUpdate()}>
            {t.about.updateInstall}
          </Button>,
        ];
      case "available": {
        const { manualDownloadUrl } = updateStatus;
        return [
          t.about.updateAvailable(updateStatus.version),
          manualDownloadUrl ? (
            <Button size="sm" onClick={() => window.open(manualDownloadUrl, "_blank", "noopener,noreferrer")}>
              {t.about.updateOpenDownload}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void desktop.downloadUpdate()}>
              {t.about.updateDownload}
            </Button>
          ),
        ];
      }
    }
  })();

  return (
    <AboutView
      about={
        info && {
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
        }
      }
      loading={infoQ.isLoading || configQ.isLoading}
      showDebugAction={info ? !info.isPackaged : false}
      updateCheck={configQ.data?.behavior.updateCheck ?? null}
      updateCheckDisabled={savingUpdateCheck}
      updateStatus={
        <div className="flex flex-col gap-3 px-1">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">{statusText}</p>
            {action}
          </div>
          {updateStatus.phase === "downloading" && <Progress value={updateStatus.percent} />}
        </div>
      }
      onDebug={() => void desktop.toggleDevTools()}
      onUpdateCheckChange={async (checked) => {
        setSavingUpdateCheck(true);
        try {
          await api.config.update({ behavior: { updateCheck: checked } });
          await queryClient.invalidateQueries({ queryKey: queryKeys.config.current });
        } catch (error) {
          toast.error(toErrorMessage(error), { id: "update-check" });
        } finally {
          setSavingUpdateCheck(false);
        }
      }}
    />
  );
};

export const Route = createFileRoute("/about")({
  component: AboutPage,
});
