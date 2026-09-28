import { toErrorMessage } from "@mdcz/shared/error";
import type { SystemAboutResponse } from "@mdcz/shared/serverDtos";
import { AboutView } from "@mdcz/views/about";
import { useT } from "@mdcz/views/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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

  return (
    <AboutView
      about={about}
      debugActionLabel={t.desktop.enableDebug}
      loading={loading}
      logoSrc={AppLogo}
      showDebugAction={showDebugAction}
      updateCheck={updateCheck}
      updateCheckDisabled={isSavingUpdateCheck}
      onDebug={debugAction}
      onOpenExternal={(url) => void ipc.app.openExternal(url)}
      onUpdateCheckChange={onUpdateCheckChange}
    />
  );
}
