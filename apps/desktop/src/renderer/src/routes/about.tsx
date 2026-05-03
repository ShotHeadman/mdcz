import { toErrorMessage } from "@mdcz/shared/error";
import type { SystemAboutResponse } from "@mdcz/shared/serverDtos";
import { AboutView } from "@mdcz/views/about";
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
          community: {
            feedback: {
              label: "提交反馈",
              url: "https://github.com/ShotHeadman/mdcz/issues/new/choose",
            },
            links: [
              {
                label: "MDCx",
                url: "https://github.com/sqzw-x/mdcx",
                description: "原 Python 版本项目",
              },
              {
                label: "Movie_Data_Capture",
                url: "https://github.com/yoshiko2/Movie_Data_Capture",
                description: "命令行版核心项目",
              },
            ],
          },
        });
        setUpdateCheck((config as ConfigOutput).behavior?.updateCheck ?? true);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(`读取关于信息失败: ${toErrorMessage(error, "未知错误")}`);
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
      toast.error(`保存失败: ${toErrorMessage(error, "未知错误")}`);
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
      debugActionLabel="开启调试"
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
